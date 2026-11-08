-- =============================================================
-- Migration: 20261108_multi_tenant_foundation.sql
-- Real authoring date: 2026-11-08
-- Enforces: Rule 3 (Strict Tenant & Sibling RLS Isolation)
--           Rule 2 (Post-lock idempotency check on wallet transactions)
-- =============================================================

-- ── 1. Tenants Table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  brand_logo_url text,
  brand_color text DEFAULT '#3b82f6',
  active_modes text[] NOT NULL DEFAULT ARRAY['air', 'road', 'intermodal']::text[],
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed primary default tenant for existing operations
INSERT INTO public.tenants (id, slug, name, brand_color, active_modes)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'ehi-logistics',
  'EHI Logistics Network',
  '#3b82f6',
  ARRAY['air', 'road', 'intermodal']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Add tenant_id to core operational tables ──────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.package_entries
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

ALTER TABLE public.customer_wallets
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fleet_vehicles') THEN
    ALTER TABLE public.fleet_vehicles ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'driver_trips') THEN
    ALTER TABLE public.driver_trips ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
  END IF;
END $$;

-- Backfill default tenant for pre-existing records
UPDATE public.user_profiles SET tenant_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE public.hubs SET tenant_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE public.cargo_entries SET tenant_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE public.package_entries SET tenant_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE tenant_id IS NULL;
UPDATE public.customer_wallets SET tenant_id = '00000000-0000-0000-0000-000000000001'::uuid WHERE tenant_id IS NULL;

-- Indexes for tenant isolation query performance
CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_id ON public.user_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hubs_tenant_id ON public.hubs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cargo_entries_tenant_id ON public.cargo_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_package_entries_tenant_id ON public.package_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallets_tenant_id ON public.customer_wallets(tenant_id);

-- ── 3. Helper function: current_user_tenant_id() ─────────────
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid();
$$;

-- ── 4. Scoped sibling_hub_ids() with strict tenant check ─────
CREATE OR REPLACE FUNCTION public.sibling_hub_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT array_agg(id)
  FROM public.hubs
  WHERE public.current_user_hub_id() IS NOT NULL
    AND (
      -- If current user has a tenant, hub must match the tenant
      (public.current_user_tenant_id() IS NOT NULL AND tenant_id = public.current_user_tenant_id())
      OR
      -- Fallback if user has no tenant assigned
      (public.current_user_tenant_id() IS NULL)
    )
    AND lower(trim(state)) IS NOT DISTINCT FROM (
      SELECT lower(trim(state)) FROM public.hubs
      WHERE id = public.current_user_hub_id()
        AND (
          (public.current_user_tenant_id() IS NOT NULL AND tenant_id = public.current_user_tenant_id())
          OR
          (public.current_user_tenant_id() IS NULL)
        )
    );
$$;

-- ── 5. Harden apply_wallet_transaction (Post-lock idempotency) 
CREATE OR REPLACE FUNCTION public.apply_wallet_transaction(
  p_wallet_id        uuid,
  p_type             text,
  p_amount           numeric,
  p_cargo_ref        text DEFAULT NULL,
  p_cargo_entry_id   uuid DEFAULT NULL,
  p_description      text DEFAULT NULL,
  p_logged_by        text DEFAULT NULL,
  p_department       text DEFAULT 'cargo',
  p_payment_mode     text DEFAULT NULL,
  p_idempotency_key  uuid DEFAULT NULL
)
RETURNS TABLE(new_balance numeric, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet_hub      uuid;
  v_wallet_tenant   uuid;
  v_balance_before  numeric;
  v_balance_after   numeric;
  v_delta           numeric;
  v_txn_id          uuid;
  v_existing_id     uuid;
  v_existing_after  numeric;
BEGIN
  -- Quick pre-check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, balance_after INTO v_existing_id, v_existing_after
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing_after, v_existing_id;
      RETURN;
    END IF;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Wallet transaction amount must be positive (got %)', p_amount;
  END IF;

  IF p_type NOT IN ('top_up', 'deduction', 'refund', 'adjustment') THEN
    RAISE EXCEPTION 'Invalid wallet transaction type: %', p_type;
  END IF;

  IF p_payment_mode IS NOT NULL AND p_payment_mode NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Invalid payment mode: %', p_payment_mode;
  END IF;

  IF p_type IN ('top_up', 'adjustment') AND NOT public.is_hub_unrestricted() THEN
    RAISE EXCEPTION 'Only accountant/admin/super_admin/auditor roles may top up or adjust a wallet balance directly';
  END IF;

  v_delta := CASE WHEN p_type = 'deduction' THEN -p_amount ELSE p_amount END;

  -- Acquire exclusive row lock on the customer wallet
  SELECT hub_id, tenant_id, balance INTO v_wallet_hub, v_wallet_tenant, v_balance_before
  FROM public.customer_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer wallet not found: %', p_wallet_id;
  END IF;

  -- POST-LOCK IDEMPOTENCY RE-CHECK:
  -- If another concurrent request with the exact same idempotency_key committed
  -- while this transaction was waiting on FOR UPDATE, detect it and abort the delta.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, balance_after INTO v_existing_id, v_existing_after
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN QUERY SELECT v_existing_after, v_existing_id;
      RETURN;
    END IF;
  END IF;

  IF p_type = 'deduction' AND (v_balance_before + v_delta) < 0 THEN
    RAISE EXCEPTION 'Insufficient wallet balance: current balance is %, attempted deduction is %',
      v_balance_before, p_amount;
  END IF;

  v_balance_after := v_balance_before + v_delta;

  UPDATE public.customer_wallets
  SET balance = v_balance_after,
      updated_at = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.wallet_transactions (
    wallet_id,
    type,
    amount,
    balance_before,
    balance_after,
    cargo_ref,
    cargo_entry_id,
    description,
    logged_by,
    department,
    payment_mode,
    idempotency_key
  ) VALUES (
    p_wallet_id,
    p_type,
    p_amount,
    v_balance_before,
    v_balance_after,
    p_cargo_ref,
    p_cargo_entry_id,
    p_description,
    p_logged_by,
    p_department,
    p_payment_mode,
    p_idempotency_key
  )
  RETURNING id INTO v_txn_id;

  RETURN QUERY SELECT v_balance_after, v_txn_id;
END;
$$;

-- ── 6. RLS Policies on Tenants Table ─────────────────────────
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tenant"
  ON public.tenants FOR SELECT
  USING (
    id = public.current_user_tenant_id()
    OR public.current_user_role() = 'super_admin'
  );

CREATE POLICY "Super admin can manage tenants"
  ON public.tenants FOR ALL
  USING (public.current_user_role() = 'super_admin')
  WITH CHECK (public.current_user_role() = 'super_admin');

-- ── 7. Bookkeeping record ────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('20261108_multi_tenant_foundation.sql')
ON CONFLICT (filename) DO NOTHING;
