import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from './supabase';
import {
  fetchLedgerPage,
  fetchLedgerTotals,
  LedgerSearchParams,
  LedgerCursor,
  LEDGER_PAGE_SIZE,
} from './ledgerSearch';

describe('Ledger Search & RPC Pagination', () => {
  let originalRpc: any;
  let lastRpcName: string | null;
  let lastRpcParams: any;

  beforeEach(() => {
    originalRpc = (supabase as any).rpc;
    lastRpcName = null;
    lastRpcParams = null;
  });

  afterEach(() => {
    (supabase as any).rpc = originalRpc;
  });

  describe('fetchLedgerPage', () => {
    test('maps search params to p_* RPC parameters and handles nulls', async () => {
      (supabase as any).rpc = async (name: string, params: any) => {
        lastRpcName = name;
        lastRpcParams = params;
        return { data: [], error: null };
      };

      const params: LedgerSearchParams = {
        query: '  EHI-LOS-00123  ',
        types: ['cargo', 'package'],
        terminal: 'T1',
        mode: 'Cash',
        officeWorkOnly: true,
        debtClass: 'Office',
        includeExpenses: false,
      };

      const cursor: LedgerCursor = {
        createdAt: '2026-11-16T12:00:00Z',
        entryId: 'C-001',
      };

      await fetchLedgerPage(params, cursor, {}, 50);

      assert.strictEqual(lastRpcName, 'ledger_search_page');
      assert.strictEqual(lastRpcParams.p_query, 'EHI-LOS-00123', 'query should be trimmed');
      assert.deepStrictEqual(lastRpcParams.p_types, ['cargo', 'package']);
      assert.strictEqual(lastRpcParams.p_terminal, 'T1');
      assert.strictEqual(lastRpcParams.p_mode, 'Cash');
      assert.strictEqual(lastRpcParams.p_office_work_only, true);
      assert.strictEqual(lastRpcParams.p_debt_class, 'Office');
      assert.strictEqual(lastRpcParams.p_include_expenses, false);
      assert.strictEqual(lastRpcParams.p_cursor_created_at, '2026-11-16T12:00:00Z');
      assert.strictEqual(lastRpcParams.p_cursor_entry_id, 'C-001');
      assert.strictEqual(lastRpcParams.p_limit, 50);
    });

    test('correctly maps raw rows of all entry types to typed transactions and expenses', async () => {
      const mockRawData = [
        {
          entry_type: 'cargo',
          entry_id: 'C-100',
          created_at: '2026-11-16T10:00:00Z',
          raw: {
            id: 'C-100',
            entry_ref: 'C-100',
            consignee_name: 'Bello Trading',
            amount: 55000,
            receipt_mode: 'Transfer',
            created_at: '2026-11-16T10:00:00Z',
            airline: 'Air Peace',
            route: 'LOS -> ABV',
            total_kg: 25,
            total_pcs: 3,
            entered_by: 'staff-1',
          },
        },
        {
          entry_type: 'package',
          entry_id: 'PKG-200',
          created_at: '2026-11-16T10:05:00Z',
          raw: {
            id: 'PKG-200',
            entry_ref: 'PKG-200',
            customer_name: 'Ibrahim Parcels',
            amount: 8000,
            payment_mode: 'Cash',
            created_at: '2026-11-16T10:05:00Z',
            destination: 'Kano',
            total_kg: 5,
            total_pcs: 1,
          },
        },
        {
          entry_type: 'marketing',
          entry_id: 'MKT-300',
          created_at: '2026-11-16T10:10:00Z',
          raw: {
            id: 'MKT-300',
            entry_ref: 'MKT-300',
            customer_name: 'Adewale Fabrics',
            amount_paid: 22000,
            payment_mode: 'POS',
            created_at: '2026-11-16T10:10:00Z',
            route: 'LOS -> ENU',
            qty_big_bag: 2,
          },
        },
        {
          entry_type: 'baggage',
          entry_id: 'BAG-400',
          created_at: '2026-11-16T10:15:00Z',
          raw: {
            id: 'BAG-400',
            transaction_id: 'BAG-400',
            passenger_name: 'Dr. Chidi',
            amount: 15000,
            payment_mode: 'Cash',
            created_at: '2026-11-16T10:15:00Z',
            airline: 'ValueJet',
            excess_kg: 10,
          },
        },
        {
          entry_type: 'expense',
          entry_id: 'EXP-500',
          created_at: '2026-11-16T10:20:00Z',
          raw: {
            id: 'EXP-500',
            category: 'Fuel',
            amount: 12000,
            description: 'Generator diesel',
            created_at: '2026-11-16T10:20:00Z',
          },
        },
      ];

      (supabase as any).rpc = async () => ({
        data: mockRawData,
        error: null,
      });

      const profileLookup = { 'staff-1': 'Tunde Admin' };
      const page = await fetchLedgerPage({}, null, profileLookup, 10);

      assert.strictEqual(page.rows.length, 5);

      // Verify Cargo
      const cargoRow = page.rows[0];
      assert.strictEqual(cargoRow.entryType, 'cargo');
      assert.strictEqual(cargoRow.transaction?.name, 'Bello Trading');
      assert.strictEqual(cargoRow.transaction?.amount, 55000);
      assert.strictEqual(cargoRow.transaction?.enteredByName, 'Tunde Admin');

      // Verify Package
      const pkgRow = page.rows[1];
      assert.strictEqual(pkgRow.entryType, 'package');
      assert.strictEqual(pkgRow.transaction?.name, 'Ibrahim Parcels');
      assert.strictEqual(pkgRow.transaction?.amount, 8000);

      // Verify Marketing
      const mktRow = page.rows[2];
      assert.strictEqual(mktRow.entryType, 'marketing');
      assert.strictEqual(mktRow.transaction?.name, 'Adewale Fabrics');
      assert.strictEqual(mktRow.transaction?.amount, 22000);

      // Verify Baggage
      const bagRow = page.rows[3];
      assert.strictEqual(bagRow.entryType, 'baggage');
      assert.strictEqual(bagRow.transaction?.name, 'Dr. Chidi');
      assert.strictEqual(bagRow.transaction?.amount, 15000);

      // Verify Expense
      const expRow = page.rows[4];
      assert.strictEqual(expRow.entryType, 'expense');
      assert.strictEqual(expRow.expense?.type, 'Fuel');
      assert.strictEqual(expRow.expense?.amount, 12000);

      // Since returned rows (5) < limit (10), hasMore should be false and nextCursor null
      assert.strictEqual(page.hasMore, false);
      assert.strictEqual(page.nextCursor, null);
    });

    test('constructs nextCursor and sets hasMore when rows equal limit', async () => {
      const mockRows = Array.from({ length: 3 }, (_, i) => ({
        entry_type: 'cargo',
        entry_id: `C-${i + 1}`,
        created_at: `2026-11-16T10:0${i}:00Z`,
        raw: {
          id: `C-${i + 1}`,
          entry_ref: `C-${i + 1}`,
          consignee_name: `Customer ${i + 1}`,
          amount: 1000 * (i + 1),
        },
      }));

      (supabase as any).rpc = async () => ({
        data: mockRows,
        error: null,
      });

      const page = await fetchLedgerPage({}, null, {}, 3); // limit: 3

      assert.strictEqual(page.hasMore, true);
      assert.deepStrictEqual(page.nextCursor, {
        createdAt: '2026-11-16T10:02:00Z',
        entryId: 'C-3',
      });
    });

    test('throws when RPC returns error', async () => {
      (supabase as any).rpc = async () => ({
        data: null,
        error: new Error('RPC execution failed: RLS permission denied'),
      });

      await assert.rejects(
        async () => fetchLedgerPage({}, null, {}, 10),
        /RLS permission denied/
      );
    });
  });

  describe('fetchLedgerTotals', () => {
    test('fetches and converts totals from RPC', async () => {
      (supabase as any).rpc = async (name: string, params: any) => {
        assert.strictEqual(name, 'ledger_search_totals');
        return {
          data: [
            {
              total_amount: '1500000.50',
              cash_amount: '500000',
              transfer_amount: '600000.50',
              pos_amount: '200000',
              debt_amount: '150000',
              wallet_amount: '50000',
              unpaid_debt_count: '4',
              office_debt_amount: '100000',
              individual_debt_amount: '50000',
              row_count: '85',
            },
          ],
          error: null,
        };
      };

      const totals = await fetchLedgerTotals({ query: 'Lagos' });

      assert.strictEqual(totals.totalAmount, 1500000.5);
      assert.strictEqual(totals.cashAmount, 500000);
      assert.strictEqual(totals.transferAmount, 600000.5);
      assert.strictEqual(totals.posAmount, 200000);
      assert.strictEqual(totals.debtAmount, 150000);
      assert.strictEqual(totals.walletAmount, 50000);
      assert.strictEqual(totals.unpaidDebtCount, 4);
      assert.strictEqual(totals.officeDebtAmount, 100000);
      assert.strictEqual(totals.individualDebtAmount, 50000);
      assert.strictEqual(totals.rowCount, 85);
    });

    test('returns zero totals when data is empty or null', async () => {
      (supabase as any).rpc = async () => ({
        data: [],
        error: null,
      });

      const totals = await fetchLedgerTotals({});
      assert.strictEqual(totals.totalAmount, 0);
      assert.strictEqual(totals.rowCount, 0);
    });
  });
});
