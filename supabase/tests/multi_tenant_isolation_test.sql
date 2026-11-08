-- =============================================================
-- TEST SCRIPT: Multi-Tenant & Sibling Isolation (Rule 3, Rule 2)
-- Safe to run against staging/test database; each block runs in a transaction and ROLLBACKs.
-- =============================================================

-- TEST 1: Cross-tenant sibling_hub_ids() isolation
-- Given Tenant 1 and Tenant 2 each having a hub in 'Lagos',
-- when sibling_hub_ids() runs for a user in Tenant 1,
-- then only Tenant 1's Lagos hub is returned (Tenant 2's hub is never returned).
BEGIN;

DO $$
DECLARE
  v_tenant_1 uuid := gen_random_uuid();
  v_tenant_2 uuid := gen_random_uuid();
  v_hub_1 uuid := gen_random_uuid();
  v_hub_2 uuid := gen_random_uuid();
  v_user_1 uuid := gen_random_uuid();
  v_siblings uuid[];
BEGIN
  -- Setup tenants
  INSERT INTO public.tenants (id, slug, name) VALUES
    (v_tenant_1, 'test-tenant-1', 'Test Tenant 1'),
    (v_tenant_2, 'test-tenant-2', 'Test Tenant 2');

  -- Setup hubs in same state ('Lagos') under different tenants
  INSERT INTO public.hubs (id, name, code, state, tenant_id) VALUES
    (v_hub_1, 'Tenant 1 Lagos Hub', 'T1L', 'Lagos', v_tenant_1),
    (v_hub_2, 'Tenant 2 Lagos Hub', 'T2L', 'Lagos', v_tenant_2);

  -- Setup user under Tenant 1
  INSERT INTO public.user_profiles (id, full_name, role, hub_id, tenant_id) VALUES
    (v_user_1, 'Staff T1', 'counter_staff', v_hub_1, v_tenant_1);

  -- Mock auth.uid() to v_user_1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_1, 'role', 'authenticated')::text, true);

  -- Run sibling_hub_ids()
  SELECT public.sibling_hub_ids() INTO v_siblings;

  -- ASSERT: v_hub_1 must be in siblings, v_hub_2 must NOT be in siblings
  IF NOT (v_hub_1 = ANY(v_siblings)) THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Own tenant hub % missing from siblings: %', v_hub_1, v_siblings;
  END IF;

  IF (v_hub_2 = ANY(v_siblings)) THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Foreign tenant hub % leaked into siblings: %', v_hub_2, v_siblings;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: Strict cross-tenant hub isolation verified.';
END $$;

ROLLBACK;

-- TEST 2: Wallet post-lock idempotency check (Rule 2)
-- When apply_wallet_transaction is called twice with the same idempotency_key,
-- the second call must return the exact same balance without deducting twice.
BEGIN;

DO $$
DECLARE
  v_wallet_id uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_initial_bal numeric := 50000;
  v_deduct numeric := 10000;
  v_bal1 numeric;
  v_txn1 uuid;
  v_bal2 numeric;
  v_txn2 uuid;
BEGIN
  -- Setup wallet
  INSERT INTO public.customer_wallets (id, customer_name, phone, balance)
  VALUES (v_wallet_id, 'Idempotency Test Customer', '08000000001', v_initial_bal);

  -- First deduction call
  SELECT new_balance, transaction_id INTO v_bal1, v_txn1
  FROM public.apply_wallet_transaction(
    p_wallet_id := v_wallet_id,
    p_type := 'deduction',
    p_amount := v_deduct,
    p_logged_by := 'Test Agent',
    p_idempotency_key := v_key
  );

  IF v_bal1 <> 40000 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected balance 40000 after first call, got %', v_bal1;
  END IF;

  -- Second deduction call with SAME idempotency_key
  SELECT new_balance, transaction_id INTO v_bal2, v_txn2
  FROM public.apply_wallet_transaction(
    p_wallet_id := v_wallet_id,
    p_type := 'deduction',
    p_amount := v_deduct,
    p_logged_by := 'Test Agent',
    p_idempotency_key := v_key
  );

  IF v_bal2 <> 40000 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Second call double-deducted! Balance is %, expected 40000', v_bal2;
  END IF;

  IF v_txn1 <> v_txn2 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected matching transaction_id %, got %', v_txn1, v_txn2;
  END IF;

  RAISE NOTICE 'TEST 2 PASSED: Post-lock wallet idempotency verified.';
END $$;

ROLLBACK;
