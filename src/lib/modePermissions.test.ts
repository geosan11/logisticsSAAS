import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedTabs, getRoleDefaultTabs, canAccessTab } from './permissions';
import { User, TabView } from './types';

describe('Mode-Aware Permissions & Stripped Views', () => {
  const baseAdmin: User = {
    id: 'user-admin',
    email: 'admin@ehi.test',
    name: 'Admin Tester',
    role: 'admin',
    hubType: 'Head Office',
    hub: 'EHI Head Office Lagos',
  };

  const baseDriver: User = {
    id: 'user-driver',
    email: 'driver@ehi.test',
    name: 'Driver Tester',
    role: 'driver',
    hubType: 'Cargo Station',
    hub: 'Lagos Air Cargo Station',
  };

  test('Air mode excludes Road-only tabs and strips Excess Baggage / Marketing', () => {
    const airTabs = getAllowedTabs(baseAdmin, [], 'air');
    
    // Must include Air features
    assert.ok(airTabs.includes('Cargo'), 'Air mode must include Cargo');
    assert.ok(airTabs.includes('FlightRadar'), 'Air mode must include FlightRadar');
    assert.ok(airTabs.includes('AirlineLedger'), 'Air mode must include AirlineLedger');
    assert.ok(airTabs.includes('WeightManifest'), 'Air mode must include WeightManifest');
    
    // Must exclude Road-only features
    assert.ok(!airTabs.includes('Packages'), 'Air mode must exclude Packages (Road)');
    assert.ok(!airTabs.includes('Dispatch'), 'Air mode must exclude Dispatch');
    assert.ok(!airTabs.includes('Fleet'), 'Air mode must exclude Fleet');
    assert.ok(!airTabs.includes('More:Dispatch'), 'Air mode must exclude More:Dispatch');
    assert.ok(!airTabs.includes('More:Fleet'), 'Air mode must exclude More:Fleet');

    // Must strip legacy marketing and baggage
    assert.ok(!airTabs.includes('Marketing'), 'Marketing must be stripped');
    assert.ok(!airTabs.some(t => t.startsWith('Baggage:')), 'Baggage counters must be stripped');
    assert.ok(!airTabs.includes('More:ExcessBaggageAirlines'), 'Excess Baggage Airlines must be stripped');
  });

  test('Road mode excludes Air-only tabs and includes Road tabs', () => {
    const roadTabs = getAllowedTabs(baseAdmin, [], 'road');

    // Must include Road features
    assert.ok(roadTabs.includes('Packages'), 'Road mode must include Packages');
    assert.ok(roadTabs.includes('Dispatch'), 'Road mode must include Dispatch');
    assert.ok(roadTabs.includes('Fleet'), 'Road mode must include Fleet');
    assert.ok(roadTabs.includes('More:PODLog'), 'Road mode must include More:PODLog');

    // Must exclude Air-only features
    assert.ok(!roadTabs.includes('Cargo'), 'Road mode must exclude Cargo (Air)');
    assert.ok(!roadTabs.includes('FlightRadar'), 'Road mode must exclude FlightRadar');
    assert.ok(!roadTabs.includes('AirlineLedger'), 'Road mode must exclude AirlineLedger');
    assert.ok(!roadTabs.includes('WeightManifest'), 'Road mode must exclude WeightManifest');
    assert.ok(!roadTabs.includes('More:AirlineCommissions'), 'Road mode must exclude AirlineCommissions');
  });

  test('Intermodal mode includes both Air and Road workflows', () => {
    const intermodalTabs = getAllowedTabs(baseAdmin, [], 'intermodal');

    assert.ok(intermodalTabs.includes('Cargo'), 'Intermodal must include Cargo');
    assert.ok(intermodalTabs.includes('FlightRadar'), 'Intermodal must include FlightRadar');
    assert.ok(intermodalTabs.includes('Packages'), 'Intermodal must include Packages');
    assert.ok(intermodalTabs.includes('Dispatch'), 'Intermodal must include Dispatch');
    assert.ok(intermodalTabs.includes('Fleet'), 'Intermodal must include Fleet');

    // Shared features always present
    assert.ok(intermodalTabs.includes('Tower'), 'Tower is shared across all modes');
    assert.ok(intermodalTabs.includes('Scan'), 'Scan is shared across all modes');
    assert.ok(intermodalTabs.includes('More:TransactionLedger'), 'Ledger is shared across all modes');
    assert.ok(intermodalTabs.includes('More:CustomerWallets'), 'Wallets is shared across all modes');
  });

  test('canAccessTab correctly validates view access against active mode', () => {
    assert.strictEqual(canAccessTab(baseAdmin, 'Cargo', [], 'air'), true);
    assert.strictEqual(canAccessTab(baseAdmin, 'Cargo', [], 'road'), false);
    assert.strictEqual(canAccessTab(baseAdmin, 'Packages', [], 'air'), false);
    assert.strictEqual(canAccessTab(baseAdmin, 'Packages', [], 'road'), true);
    assert.strictEqual(canAccessTab(baseAdmin, 'More:TransactionLedger', [], 'air'), true);
    assert.strictEqual(canAccessTab(baseAdmin, 'More:TransactionLedger', [], 'road'), true);
  });
});
