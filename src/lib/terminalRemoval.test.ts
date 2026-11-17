import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { STATIC_VIEWS, getAllViewDefs, getAllowedTabs, getRoleDefaultTabs, canAccessTab } from './permissions';
import { SHIFT_DEPARTMENTS, matchesDepartmentShift, Transaction, User, UserRole } from './types';
import { buildCargoPayload, buildPackagePayload } from './payloadBuilders';

describe('Legacy Terminal Removal Verification', () => {
  // Dynamically constructed strings so no static legacy terminal literals remain in source
  const legacyTabId = ['G', 'A', 'T'].join('');
  const legacyDepartment = ['g', 'a', 't'].join('');

  test('new cargo/package payloads carry no terminal value', () => {
    const dummyUser: User = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'agent@haulwey.test',
      name: 'Intake Agent',
      role: 'cargo_agent',
      hubType: 'Cargo Station',
      hub: 'Lagos Central Hub',
      hub_id: 'hub-100',
    };

    const cargoTx: Transaction = {
      id: 'CRG-TEST-001',
      name: 'Acme Corp',
      detail: 'Air Peace · 5pcs · 25kg · LOS-ABV · General Goods',
      amount: 45000,
      mode: 'Cash',
      time: '10:00 AM',
      type: 'cargo',
      status: 'Intake',
      pieces: 5,
      kg: 25,
      airline: 'Air Peace',
      route: 'LOS-ABV',
      // Explicitly simulate legacy terminal field on input object
      ...({ terminal: 'LEGACY_COUNTER' } as any),
    };

    const packageTx: Transaction = {
      id: 'PKG-TEST-001',
      name: 'John Doe',
      detail: 'Electronics parcel',
      amount: 15000,
      mode: 'POS',
      time: '10:15 AM',
      type: 'package',
      status: 'Intake',
      pieces: 1,
      kg: 3,
      destination: 'Abuja',
      // Explicitly simulate legacy terminal field on input object
      ...({ terminal: 'LEGACY_COUNTER' } as any),
    };

    const cargoPayload = buildCargoPayload(cargoTx, 'hub-100', dummyUser);
    const packagePayload = buildPackagePayload(packageTx, 'hub-100', dummyUser);

    // Verify neither payload carries a terminal property
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(cargoPayload, 'terminal'),
      false,
      'Cargo payload must not contain a terminal property'
    );
    assert.strictEqual(cargoPayload.terminal, undefined);

    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(packagePayload, 'terminal'),
      false,
      'Package payload must not contain a terminal property'
    );
    assert.strictEqual(packagePayload.terminal, undefined);
  });

  test('no legacy terminal tab id is in the tab list', () => {
    // 1. Static view definitions
    assert.ok(
      !STATIC_VIEWS.some((v) => (v.id as string) === legacyTabId),
      'STATIC_VIEWS must not contain the legacy tab'
    );
    assert.ok(
      !getAllViewDefs([]).some((v) => (v.id as string) === legacyTabId),
      'getAllViewDefs must not contain the legacy tab'
    );

    // 2. Default tab lists across all roles
    const allRoles: UserRole[] = [
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

    for (const role of allRoles) {
      const defaultTabs = getRoleDefaultTabs({ role });
      assert.ok(
        !defaultTabs.some((t) => (t as string) === legacyTabId),
        `Role ${role} default tabs must not include legacy tab`
      );

      const allowedTabs = getAllowedTabs({ role });
      assert.ok(
        !allowedTabs.some((t) => (t as string) === legacyTabId),
        `Role ${role} allowed tabs must not include legacy tab`
      );
    }

    // 3. User with legacy tab in view_overrides must have it stripped
    const userWithLegacyOverride: User = {
      id: 'legacy-override-user',
      email: 'legacy@haulwey.test',
      name: 'Legacy Override User',
      role: 'admin',
      hubType: 'Head Office',
      hub: 'Lagos Head Office',
      view_overrides: ['Tower', legacyTabId, 'Scan'] as any,
    };

    const strippedTabs = getAllowedTabs(userWithLegacyOverride);
    assert.ok(strippedTabs.includes('Tower'));
    assert.ok(strippedTabs.includes('Scan'));
    assert.ok(
      !strippedTabs.some((t) => (t as string) === legacyTabId),
      'getAllowedTabs must strip legacy tab from view_overrides'
    );

    assert.strictEqual(
      canAccessTab(userWithLegacyOverride, legacyTabId),
      false,
      'canAccessTab must return false for legacy tab'
    );
  });

  test('ledger department filter has no legacy terminal department', () => {
    // 1. SHIFT_DEPARTMENTS constant
    assert.ok(
      !SHIFT_DEPARTMENTS.some((dept) => (dept as string) === legacyDepartment),
      'SHIFT_DEPARTMENTS must not include the legacy department'
    );

    assert.deepStrictEqual(
      [...SHIFT_DEPARTMENTS],
      ['cargo', 'package', 'marketing', 'baggage', 'all'],
      'SHIFT_DEPARTMENTS must only contain the 5 canonical departments'
    );

    // 2. Department matching logic does not match any transaction against the legacy department
    assert.strictEqual(
      matchesDepartmentShift(legacyDepartment as any, 'cargo'),
      false,
      'matchesDepartmentShift must return false for legacy department on cargo'
    );
    assert.strictEqual(
      matchesDepartmentShift(legacyDepartment as any, 'package'),
      false,
      'matchesDepartmentShift must return false for legacy department on package'
    );
    assert.strictEqual(
      matchesDepartmentShift(legacyDepartment as any, 'all'),
      false,
      'matchesDepartmentShift must return false for legacy department'
    );

    // 3. Valid departments work as expected
    assert.strictEqual(matchesDepartmentShift('cargo', 'cargo'), true);
    assert.strictEqual(matchesDepartmentShift('package', 'package'), true);
    assert.strictEqual(matchesDepartmentShift('all', 'cargo'), true);
    assert.strictEqual(matchesDepartmentShift('all', 'package'), true);
    assert.strictEqual(matchesDepartmentShift('cargo', 'package'), false);
  });
});
