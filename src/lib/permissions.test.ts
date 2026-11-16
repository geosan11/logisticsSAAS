import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllowedTabs,
  getRoleDefaultTabs,
  canAccessTab,
  getBaggageViews,
  STATIC_VIEWS,
} from './permissions';
import { User, UserRole, TabView } from './types';

describe('Permissions & canAccessTab Comprehensive Test Suite', () => {
  const makeUser = (role: UserRole, overrides?: TabView[]): User => ({
    id: `user-${role}`,
    email: `${role}@ehi.test`,
    name: `${role} User`,
    role,
    hubType: 'Cargo Station',
    hub: 'Lagos Air Cargo Station',
    view_overrides: overrides,
  });

  describe('Stripping of Removed Excess Baggage Tabs', () => {
    test('getBaggageViews returns empty array', () => {
      assert.deepStrictEqual(getBaggageViews('baggage_agent', undefined, []), []);
      assert.deepStrictEqual(getBaggageViews('admin', 'ValueJet', [{ id: '1', name: 'ValueJet', tag_code: 'VK', flight_prefix: 'VK', free_allowance_kg: 20, rate_per_kg: 1000, active: true }]), []);
    });

    test('canAccessTab rejects Baggage:* and More:ExcessBaggageAirlines for all roles', () => {
      const roles: UserRole[] = [
        'super_admin',
        'admin',
        'baggage_agent',
        'cargo_agent',
        'marketing_agent',
        'accountant',
        'auditor',
        'driver',
        'office_work',
      ];

      for (const role of roles) {
        const u = makeUser(role);
        assert.strictEqual(canAccessTab(u, 'Baggage:ValueJet'), false, `${role} must not access Baggage:ValueJet`);
        assert.strictEqual(canAccessTab(u, 'Baggage:AirPeace'), false, `${role} must not access Baggage:AirPeace`);
        assert.strictEqual(canAccessTab(u, 'More:ExcessBaggageAirlines'), false, `${role} must not access More:ExcessBaggageAirlines`);
      }
    });

    test('legacy view_overrides with Baggage tabs are stripped cleanly', () => {
      const baggageAgentWithLegacyOverrides = makeUser('baggage_agent', [
        'Tower',
        'Scan',
        'Baggage:ValueJet' as TabView,
        'Baggage:AirPeace' as TabView,
        'More:ExcessBaggageAirlines' as TabView,
      ]);

      const allowed = getAllowedTabs(baggageAgentWithLegacyOverrides);
      assert.ok(!allowed.includes('Baggage:ValueJet' as TabView), 'Must strip Baggage:ValueJet from overrides');
      assert.ok(!allowed.includes('Baggage:AirPeace' as TabView), 'Must strip Baggage:AirPeace from overrides');
      assert.ok(!allowed.includes('More:ExcessBaggageAirlines' as TabView), 'Must strip More:ExcessBaggageAirlines from overrides');

      assert.strictEqual(canAccessTab(baggageAgentWithLegacyOverrides, 'Baggage:ValueJet'), false);
      assert.strictEqual(canAccessTab(baggageAgentWithLegacyOverrides, 'More:ExcessBaggageAirlines'), false);
      assert.strictEqual(canAccessTab(baggageAgentWithLegacyOverrides, 'Tower'), true);
      assert.strictEqual(canAccessTab(baggageAgentWithLegacyOverrides, 'Scan'), true);
    });
  });

  describe('Role-Based Tab Access Gating', () => {
    test('super_admin has exclusive access to IT Debug and Platform Settings', () => {
      const superAdmin = makeUser('super_admin');
      const admin = makeUser('admin');
      const accountant = makeUser('accountant');

      assert.strictEqual(canAccessTab(superAdmin, 'IT Debug'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'More:Settings'), true);

      assert.strictEqual(canAccessTab(admin, 'IT Debug'), false);
      assert.strictEqual(canAccessTab(admin, 'More:Settings'), false);

      assert.strictEqual(canAccessTab(accountant, 'IT Debug'), false);
      assert.strictEqual(canAccessTab(accountant, 'More:Settings'), false);
    });

    test('driver role is restricted to operational driving & delivery views', () => {
      const driver = makeUser('driver');

      assert.strictEqual(canAccessTab(driver, 'MyTrips'), true);
      assert.strictEqual(canAccessTab(driver, 'Scan'), true);
      assert.strictEqual(canAccessTab(driver, 'OutboundArrivals'), true);

      // Financial & administrative tabs must be blocked
      assert.strictEqual(canAccessTab(driver, 'Tower'), false);
      assert.strictEqual(canAccessTab(driver, 'Cargo'), false);
      assert.strictEqual(canAccessTab(driver, 'Credit & Debit'), false);
      assert.strictEqual(canAccessTab(driver, 'More:AccountingConsole'), false);
      assert.strictEqual(canAccessTab(driver, 'More:StaffManagement'), false);
    });

    test('accountant role has financial access but not driver or admin IT console', () => {
      const accountant = makeUser('accountant');

      assert.strictEqual(canAccessTab(accountant, 'Credit & Debit'), true);
      assert.strictEqual(canAccessTab(accountant, 'More:AccountingConsole'), true);
      assert.strictEqual(canAccessTab(accountant, 'More:BankReconciliation'), true);
      assert.strictEqual(canAccessTab(accountant, 'More:CorporateBilling'), true);
      assert.strictEqual(canAccessTab(accountant, 'AirlineLedger'), true);

      assert.strictEqual(canAccessTab(accountant, 'MyTrips'), false);
      assert.strictEqual(canAccessTab(accountant, 'IT Debug'), false);
      assert.strictEqual(canAccessTab(accountant, 'More:StaffManagement'), false);
    });
  });

  describe('Mode-Aware Permissions (Air / Road / Intermodal)', () => {
    test('Air mode blocks Road-specific tabs even for super_admin', () => {
      const superAdmin = makeUser('super_admin');

      assert.strictEqual(canAccessTab(superAdmin, 'Cargo', [], 'air'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'air'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'AirlineLedger', [], 'air'), true);

      assert.strictEqual(canAccessTab(superAdmin, 'Packages', [], 'air'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'Dispatch', [], 'air'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'Fleet', [], 'air'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'More:PODLog', [], 'air'), false);
    });

    test('Road mode blocks Air-specific tabs even for super_admin', () => {
      const superAdmin = makeUser('super_admin');

      assert.strictEqual(canAccessTab(superAdmin, 'Packages', [], 'road'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'Dispatch', [], 'road'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'Fleet', [], 'road'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'More:PODLog', [], 'road'), true);

      assert.strictEqual(canAccessTab(superAdmin, 'Cargo', [], 'road'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'road'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'AirlineLedger', [], 'road'), false);
      assert.strictEqual(canAccessTab(superAdmin, 'WeightManifest', [], 'road'), false);
    });

    test('Intermodal mode allows both Air and Road workflows simultaneously', () => {
      const superAdmin = makeUser('super_admin');

      assert.strictEqual(canAccessTab(superAdmin, 'Cargo', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'Packages', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'FlightRadar', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'Dispatch', [], 'intermodal'), true);
      assert.strictEqual(canAccessTab(superAdmin, 'Fleet', [], 'intermodal'), true);
    });

    test('Universal tabs remain accessible across all modes', () => {
      const admin = makeUser('admin');
      const modes: Array<'air' | 'road' | 'intermodal'> = ['air', 'road', 'intermodal'];

      for (const mode of modes) {
        assert.strictEqual(canAccessTab(admin, 'Scan', [], mode), true, `Scan must be accessible in ${mode}`);
        assert.strictEqual(canAccessTab(admin, 'OutboundArrivals', [], mode), true, `OutboundArrivals must be accessible in ${mode}`);
        assert.strictEqual(canAccessTab(admin, 'More', [], mode), true, `More must be accessible in ${mode}`);
      }
    });
  });
});
