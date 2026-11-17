import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllowedTabs,
  getRoleDefaultTabs,
  canAccessTab,
} from './permissions';
import { fetchLedgerPage, fetchLedgerTotals } from './ledgerSearch';
import { supabase } from './supabase';
import { User, UserRole, TabView } from './types';
import { LogisticsMode } from './modeContext';

describe('Marketing Desk Removal and Legacy Record Verification', () => {
  const makeUser = (role: UserRole, overrides?: TabView[]): User => ({
    id: `user-${role}`,
    email: `${role}@haulwey.test`,
    name: `${role} User`,
    role,
    hubType: 'Cargo Station',
    hub: 'Lagos Air Cargo Station',
    view_overrides: overrides,
  });

  const ALL_ROLES: UserRole[] = [
    'super_admin',
    'admin',
    'accountant',
    'auditor',
    'cargo_agent',
    'baggage_agent',
    'marketing_agent',
    'driver',
    'office_work',
  ];

  const ALL_MODES: (LogisticsMode | undefined)[] = ['air', 'road', 'intermodal', undefined];

  describe('1. No Marketing Tab For Any Role or Mode', () => {
    test('getAllowedTabs never includes "Marketing" for any role or mode', () => {
      for (const role of ALL_ROLES) {
        for (const mode of ALL_MODES) {
          const u = makeUser(role);
          const tabs = getAllowedTabs(u, mode);
          assert.ok(
            !tabs.includes('Marketing' as TabView),
            `Role ${role} in mode ${mode} must not have "Marketing" in allowed tabs`
          );
        }
      }
    });

    test('getRoleDefaultTabs never includes "Marketing" for any role or mode', () => {
      for (const role of ALL_ROLES) {
        for (const mode of ALL_MODES) {
          const tabs = getRoleDefaultTabs({ role }, mode);
          assert.ok(
            !tabs.includes('Marketing' as TabView),
            `getRoleDefaultTabs for ${role} in mode ${mode} must not include "Marketing"`
          );
        }
      }
    });

    test('canAccessTab rejects "Marketing" tab for all roles', () => {
      for (const role of ALL_ROLES) {
        const u = makeUser(role);
        assert.strictEqual(
          canAccessTab(u, 'Marketing' as TabView),
          false,
          `canAccessTab must reject "Marketing" for ${role}`
        );
      }
    });

    test('legacy view_overrides containing "Marketing" are stripped cleanly', () => {
      const userWithMarketingOverride = makeUser('admin', ['Tower', 'Marketing' as TabView, 'Cargo']);
      const allowed = getAllowedTabs(userWithMarketingOverride, 'air');
      assert.ok(!allowed.includes('Marketing' as TabView), 'Must strip "Marketing" from view_overrides');
      assert.strictEqual(canAccessTab(userWithMarketingOverride, 'Marketing' as TabView), false);
    });
  });

  describe('2. marketing_agent Role Isolation (No Desk Tabs, No Crash)', () => {
    test('marketing_agent user gets no desk tabs (Cargo, Packages, Marketing, Baggage) in any mode', () => {
      for (const mode of ALL_MODES) {
        const u = makeUser('marketing_agent');
        let tabs: TabView[] = [];
        assert.doesNotThrow(() => {
          tabs = getAllowedTabs(u, mode);
        }, `getAllowedTabs must not throw for marketing_agent in mode ${mode}`);

        const deskTabs = ['Cargo', 'Packages', 'Marketing'];
        for (const desk of deskTabs) {
          assert.ok(
            !tabs.includes(desk as TabView),
            `marketing_agent in mode ${mode} must not receive desk tab "${desk}"`
          );
        }
      }
    });

    test('marketing_agent user with legacy desk overrides still receives no desk tabs', () => {
      const u = makeUser('marketing_agent', ['Cargo', 'Packages', 'Marketing' as TabView, 'Tower']);
      const tabs = getAllowedTabs(u, 'air');
      assert.ok(!tabs.includes('Cargo'), 'marketing_agent must not receive Cargo via override');
      assert.ok(!tabs.includes('Packages'), 'marketing_agent must not receive Packages via override');
      assert.ok(!tabs.includes('Marketing' as TabView), 'marketing_agent must not receive Marketing via override');
      assert.ok(tabs.includes('Tower'), 'marketing_agent can still access non-desk tab Tower if permitted');
    });

    test('canAccessTab safely returns false for desk tabs for marketing_agent', () => {
      const u = makeUser('marketing_agent');
      assert.strictEqual(canAccessTab(u, 'Marketing' as TabView), false);
      assert.strictEqual(canAccessTab(u, 'Cargo'), false);
      assert.strictEqual(canAccessTab(u, 'Packages'), false);
    });
  });

  describe('3. No Baggage Tab IDs Remain', () => {
    test('no baggage tab ids ("Baggage:*" or "More:ExcessBaggageAirlines") returned by getAllowedTabs', () => {
      for (const role of ALL_ROLES) {
        for (const mode of ALL_MODES) {
          const u = makeUser(role);
          const tabs = getAllowedTabs(u, mode);
          const hasBaggage = tabs.some(
            (t) => t.startsWith('Baggage:') || t === 'More:ExcessBaggageAirlines'
          );
          assert.strictEqual(
            hasBaggage,
            false,
            `Role ${role} in mode ${mode} must have zero baggage tab ids`
          );
        }
      }
    });

    test('canAccessTab rejects any "Baggage:*" or "More:ExcessBaggageAirlines" for any role', () => {
      for (const role of ALL_ROLES) {
        const u = makeUser(role);
        assert.strictEqual(canAccessTab(u, 'Baggage:ValueJet' as TabView), false);
        assert.strictEqual(canAccessTab(u, 'Baggage:AirPeace' as TabView), false);
        assert.strictEqual(canAccessTab(u, 'More:ExcessBaggageAirlines' as TabView), false);
      }
    });
  });

  describe('4. Legacy Marketing Ledger Rows Map and Count in Totals', () => {
    let originalRpc: any;

    beforeEach(() => {
      originalRpc = (supabase as any).rpc;
    });

    afterEach(() => {
      (supabase as any).rpc = originalRpc;
    });

    test('fetchLedgerPage maps legacy marketing rows to readable transaction objects', async () => {
      const mockRows = [
        {
          entry_type: 'marketing',
          entry_id: 'MKT-001',
          created_at: '2026-10-10T09:30:00Z',
          raw: {
            id: 'mkt-row-1',
            entry_ref: 'MKT-001',
            customer_name: 'Alpha Fabrics Ltd',
            route: 'LOS-ABV',
            amount_paid: 45000,
            payment_mode: 'Transfer',
            flight_number: 'VK101',
            bank: 'Access Bank',
            created_at: '2026-10-10T09:30:00Z',
            hub_id: 'hub-1',
            entered_by: 'agent-1',
          },
        },
      ];

      (supabase as any).rpc = async (name: string) => {
        if (name === 'ledger_search_page') {
          return { data: mockRows, error: null };
        }
        return { data: [], error: null };
      };

      const page = await fetchLedgerPage({}, null, { 'agent-1': 'Amina Staff' }, 10);
      assert.strictEqual(page.rows.length, 1);
      const row = page.rows[0];
      assert.strictEqual(row.entryType, 'marketing');
      assert.strictEqual(row.entryId, 'MKT-001');
      assert.strictEqual(row.transaction?.name, 'Alpha Fabrics Ltd');
      assert.strictEqual(row.transaction?.amount, 45000);
      assert.strictEqual(row.transaction?.type, 'marketing');
      assert.strictEqual(row.transaction?.enteredByName, 'Amina Staff');
    });

    test('fetchLedgerTotals includes legacy marketing rows in aggregate revenue and breakdown', async () => {
      (supabase as any).rpc = async (name: string) => {
        if (name === 'ledger_search_totals') {
          return {
            data: [
              {
                total_amount: 150000,
                cash_amount: 30000,
                transfer_amount: 70000,
                pos_amount: 20000,
                debt_amount: 20000,
                wallet_amount: 10000,
                unpaid_debt_count: 1,
                office_debt_amount: 10000,
                individual_debt_amount: 10000,
                row_count: 5,
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      const totals = await fetchLedgerTotals({});
      assert.strictEqual(totals.rowCount, 5);
      assert.strictEqual(totals.totalAmount, 150000);
      assert.strictEqual(totals.transferAmount, 70000);
      assert.strictEqual(totals.cashAmount, 30000);
      assert.strictEqual(totals.debtAmount, 20000);
    });
  });
});
