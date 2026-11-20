-- =============================================================
-- Migration: 20261120_tenant_tag_prefix_airline_awb.sql
-- Real authoring date: 2026-11-20
-- Enforces: Rule 3 (Strict Tenant RLS & Tag Prefix Isolation)
--           Requirement 1 (Tenant Tag Prefix 3-5 uppercase letters)
--           Requirement 5 (Optional Airline AWB on Cargo entries)
-- =============================================================

-- ── 1. Tenant Tag Prefix Column & Constraints ─────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tag_prefix text;

-- Backfill default tenant if null so constraint checks succeed
UPDATE public.tenants
SET tag_prefix = 'HWY'
WHERE tag_prefix IS NULL AND id = '00000000-0000-0000-0000-000000000001'::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_tag_prefix_format'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_tag_prefix_format CHECK (tag_prefix ~ '^[A-Z]{3,5}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_tag_prefix_unique'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_tag_prefix_unique UNIQUE (tag_prefix);
  END IF;
END $$;

-- ── 2. Add airline_awb to cargo_entries ───────────────────────
ALTER TABLE public.cargo_entries
  ADD COLUMN IF NOT EXISTS airline_awb text;

-- Trigram index for search performance in ledger
CREATE INDEX IF NOT EXISTS cargo_entries_airline_awb_trgm_idx
  ON public.cargo_entries USING gin (airline_awb gin_trgm_ops);

-- ── 3. Tenant RLS Update Policy ───────────────────────────────
-- Allow tenant admins / authenticated users to update their own tenant settings
DROP POLICY IF EXISTS "Tenant admin can update own tenant" ON public.tenants;
CREATE POLICY "Tenant admin can update own tenant"
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (
    id = public.current_user_tenant_id()
    OR public.current_user_role() = 'super_admin'
  )
  WITH CHECK (
    id = public.current_user_tenant_id()
    OR public.current_user_role() = 'super_admin'
  );

-- ── 4. Bookkeeping record ────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('20261120_tenant_tag_prefix_airline_awb.sql')
ON CONFLICT (filename) DO NOTHING;
