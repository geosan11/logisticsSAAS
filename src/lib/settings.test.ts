import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTING_GROUPS,
  SETTING_ITEMS,
  MORE_REDIRECT_ALIASES,
  PROMOTED_OPERATIONAL_ITEMS,
  getAccessibleSettings,
  getAccessibleGroups,
  searchSettings,
} from '../components/views/settingsData';
import { User } from './types';

describe('Grok Settings Progressive Disclosure & Permissions', () => {
  const superAdminUser: User = {
    id: 'user-super',
    email: 'super@ehi.test',
    name: 'Super Admin',
    role: 'super_admin',
    hubType: 'Head Office',
    hub: 'LOS',
  };

  const driverUser: User = {
    id: 'user-driver',
    email: 'driver@ehi.test',
    name: 'Driver Joe',
    role: 'driver',
    hubType: 'Cargo Station',
    hub: 'LOS',
  };

  const accountantUser: User = {
    id: 'user-accountant',
    email: 'accountant@ehi.test',
    name: 'Accountant Jane',
    role: 'accountant',
    hubType: 'Head Office',
    hub: 'LOS',
  };

  test('All 6 structured groups exist and have required metadata', () => {
    assert.strictEqual(SETTING_GROUPS.length, 6);
    const ids = SETTING_GROUPS.map((g) => g.id);
    assert.deepStrictEqual(ids, ['financial', 'pricing', 'records', 'hardware', 'fleet', 'system']);
    for (const g of SETTING_GROUPS) {
      assert.ok(g.title, `Group ${g.id} must have a title`);
      assert.ok(g.description, `Group ${g.id} must have a description`);
      assert.ok(g.icon, `Group ${g.id} must have an icon`);
    }
  });

  test('Every setting item belongs to one of the 6 groups and has disclosure level', () => {
    const validGroupIds = new Set(SETTING_GROUPS.map((g) => g.id));
    assert.strictEqual(SETTING_ITEMS.length, 37, 'Must have exactly 37 non-operational setting items');
    for (const item of SETTING_ITEMS) {
      assert.ok(validGroupIds.has(item.groupId), `Item ${item.id} has invalid groupId ${item.groupId}`);
      assert.ok(item.level === 'primary' || item.level === 'advanced', `Item ${item.id} must be primary or advanced`);
      assert.ok(item.keywords.length > 0, `Item ${item.id} must have keywords for search`);
      assert.ok(item.permission, `Item ${item.id} must have a permission check string`);
      assert.ok(item.target.path, `Item ${item.id} must have a target path`);
    }
  });

  test('Operational screens promoted to main nav do not reappear in Settings', () => {
    for (const op of PROMOTED_OPERATIONAL_ITEMS) {
      const match = SETTING_ITEMS.find(
        (item) => item.title.toLowerCase() === op.toLowerCase() || item.id === op.toLowerCase()
      );
      assert.strictEqual(match, undefined, `Operational screen ${op} must NOT appear in SETTING_ITEMS`);
    }
  });

  test('Search matches by title, subtitle, group name, and keywords', () => {
    // 1. By title
    const resLedger = searchSettings(SETTING_ITEMS, 'Transaction Ledger');
    assert.ok(resLedger.length >= 1);
    assert.strictEqual(resLedger[0].id, 'ledger');

    // 2. By partial subtitle
    const resEOD = searchSettings(SETTING_ITEMS, 'reconciliation reports');
    assert.ok(resEOD.some((i) => i.id === 'eod'));

    // 3. By group title
    const resPricing = searchSettings(SETTING_ITEMS, 'Pricing & Tariffs');
    assert.ok(resPricing.length >= 8, 'Searching group title returns its items');

    // 4. By keywords
    const resThermal = searchSettings(SETTING_ITEMS, 'thermal');
    assert.ok(resThermal.some((i) => i.id === 'printer-config'));

    const resB2B = searchSettings(SETTING_ITEMS, 'b2b');
    assert.ok(resB2B.some((i) => i.id === 'corporate-billing'));

    // 5. Case insensitivity and whitespace
    const resCase = searchSettings(SETTING_ITEMS, '  fLeEt  ');
    assert.ok(resCase.some((i) => i.id === 'fleet'));

    // 6. Empty query
    assert.deepStrictEqual(searchSettings(SETTING_ITEMS, ''), []);
    assert.deepStrictEqual(searchSettings(SETTING_ITEMS, '   '), []);

    // 7. Non-matching query
    assert.deepStrictEqual(searchSettings(SETTING_ITEMS, 'xyznonexistent123'), []);
  });

  test('Role hiding: Super Admin sees all accessible groups and items', () => {
    const accessible = getAccessibleSettings(SETTING_ITEMS, superAdminUser, []);
    assert.ok(accessible.length >= 35, 'Super admin sees almost all items');
    const groups = getAccessibleGroups(SETTING_GROUPS, accessible);
    assert.strictEqual(groups.length, 6, 'Super admin sees all 6 groups');
  });

  test('Role hiding: Driver only sees authorized items and empty groups are hidden', () => {
    const accessible = getAccessibleSettings(SETTING_ITEMS, driverUser, []);
    // Drivers have access to ledger, eod, debtCollectionLog, support, etc.
    const accessibleIds = accessible.map((i) => i.id);
    assert.ok(accessibleIds.includes('ledger'), 'Driver can access ledger');
    assert.ok(accessibleIds.includes('eod'), 'Driver can access eod');
    assert.ok(accessibleIds.includes('support'), 'Driver can access support');

    // Drivers cannot access Staff Management or Pricing Config
    assert.ok(!accessibleIds.includes('staff'), 'Driver cannot access staff management');
    assert.ok(!accessibleIds.includes('pricing'), 'Driver cannot access pricing config');
    assert.ok(!accessibleIds.includes('hub-cargo-rates'), 'Driver cannot access hub cargo rates');
    assert.ok(!accessibleIds.includes('settings'), 'Driver cannot access platform settings');

    const groups = getAccessibleGroups(SETTING_GROUPS, accessible);
    const groupIds = groups.map((g) => g.id);
    // Groups with 0 items for driver (e.g. Fleet & Logistics) must be completely omitted
    assert.ok(!groupIds.includes('fleet'), 'Fleet group must be hidden when driver has 0 accessible items in it');
  });

  test('Role hiding: Accountant sees financial, pricing, and records hubs', () => {
    const accessible = getAccessibleSettings(SETTING_ITEMS, accountantUser, []);
    const accessibleIds = accessible.map((i) => i.id);
    assert.ok(accessibleIds.includes('accounting'), 'Accountant sees Accounting ERP');
    assert.ok(accessibleIds.includes('bank-recon'), 'Accountant sees Bank Recon');
    assert.ok(accessibleIds.includes('pricing'), 'Accountant sees Pricing Config');
    assert.ok(accessibleIds.includes('rates-list'), 'Accountant sees Rates Directory');
    // Accountant cannot access Staff Management
    assert.ok(!accessibleIds.includes('staff'), 'Accountant cannot access staff management');

    const groups = getAccessibleGroups(SETTING_GROUPS, accessible);
    const groupIds = groups.map((g) => g.id);
    assert.ok(groupIds.includes('financial'));
    assert.ok(groupIds.includes('pricing'));
    assert.ok(groupIds.includes('records'));
  });

  test('Redirect aliases map legacy /more/... URLs to their new routes', () => {
    assert.strictEqual(MORE_REDIRECT_ALIASES['credit-debit'], '/credit-debit');
    assert.strictEqual(MORE_REDIRECT_ALIASES['airline-performance'], '/airline-performance');
    assert.strictEqual(MORE_REDIRECT_ALIASES['airline-ledger'], '/airline-ledger');
    assert.strictEqual(MORE_REDIRECT_ALIASES['weight-manifest'], '/weight-manifest');
    assert.strictEqual(MORE_REDIRECT_ALIASES['data-import'], '/data-import');
    assert.strictEqual(MORE_REDIRECT_ALIASES['airline-logos'], '/airline-logos');
    assert.strictEqual(MORE_REDIRECT_ALIASES['it-debug'], '/it-debug');
    assert.strictEqual(MORE_REDIRECT_ALIASES['incoming'], '/incoming');
    assert.strictEqual(MORE_REDIRECT_ALIASES['outbound-arrivals'], '/outbound-arrivals');
    assert.strictEqual(MORE_REDIRECT_ALIASES['packages'], '/packages');
    assert.strictEqual(MORE_REDIRECT_ALIASES['flight-radar'], '/flight-radar');
  });
});
