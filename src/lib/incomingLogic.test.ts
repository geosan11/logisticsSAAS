import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  timeSince,
  matchesDestinationHub,
  filterIncomingCargo,
  calculateIncomingMetrics,
  canAccessIncomingRole,
  formatCargoSpecs,
  formatRouteDisplay,
  type IncomingCargoItem,
} from './incomingLogic';

describe('Incoming to Hub Logic & Helpers', () => {
  describe('timeSince', () => {
    const fixedNow = 1731672000000; // Reference timestamp

    test('returns minutes for duration under 1 hour', () => {
      const fiveMinsAgo = new Date(fixedNow - 5 * 60 * 1000).toISOString();
      assert.strictEqual(timeSince(fiveMinsAgo, fixedNow), '5m');

      const zeroMinsAgo = new Date(fixedNow).toISOString();
      assert.strictEqual(timeSince(zeroMinsAgo, fixedNow), '1m'); // At least 1m minimum
    });

    test('returns hours for duration between 1 hour and 24 hours', () => {
      const threeHoursAgo = new Date(fixedNow - 3 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(threeHoursAgo, fixedNow), '3h');

      const twentyThreeHoursAgo = new Date(fixedNow - 23 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(twentyThreeHoursAgo, fixedNow), '23h');
    });

    test('returns days for duration over 24 hours', () => {
      const twoDaysAgo = new Date(fixedNow - 48 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(twoDaysAgo, fixedNow), '2d');
    });

    test('handles invalid date strings gracefully', () => {
      assert.strictEqual(timeSince('invalid-date', fixedNow), '—');
    });
  });

  describe('formatCargoSpecs', () => {
    test('formats numeric pieces and weights correctly', () => {
      const res = formatCargoSpecs(5, 25.5);
      assert.strictEqual(res.pcsStr, '5 pcs');
      assert.strictEqual(res.kgStr, '25.5 kg');
    });

    test('formats string pieces and weights correctly with coercion', () => {
      const res = formatCargoSpecs('12', '84.23');
      assert.strictEqual(res.pcsStr, '12 pcs');
      assert.strictEqual(res.kgStr, '84.2 kg');
    });

    test('falls back gracefully to dashes for null, undefined, or zero values', () => {
      const res1 = formatCargoSpecs(null, undefined);
      assert.strictEqual(res1.pcsStr, '— pcs');
      assert.strictEqual(res1.kgStr, '— kg');

      const res2 = formatCargoSpecs(0, 0);
      assert.strictEqual(res2.pcsStr, '— pcs');
      assert.strictEqual(res2.kgStr, '— kg');
    });
  });

  describe('formatRouteDisplay', () => {
    test('returns trimmed route when present', () => {
      assert.strictEqual(formatRouteDisplay('  Abuja - Lagos  '), 'Abuja - Lagos');
      assert.strictEqual(formatRouteDisplay('Kano Station'), 'Kano Station');
    });

    test('falls back to "Direct route" when null, empty, or whitespace', () => {
      assert.strictEqual(formatRouteDisplay(null), 'Direct route');
      assert.strictEqual(formatRouteDisplay(undefined), 'Direct route');
      assert.strictEqual(formatRouteDisplay('   '), 'Direct route');
    });
  });

  describe('matchesDestinationHub', () => {
    test('matches case-insensitively using hub word tokens (>= 3 chars)', () => {
      assert.strictEqual(matchesDestinationHub('Lagos - Ikeja Express', 'Lagos Hub'), true);
      assert.strictEqual(matchesDestinationHub('Abuja Central Route', 'Abuja'), true);
      assert.strictEqual(matchesDestinationHub('Port Harcourt Destination', 'Port Harcourt'), true);
    });

    test('returns false when no word tokens match', () => {
      assert.strictEqual(matchesDestinationHub('Kano Station', 'Lagos Hub'), false);
      assert.strictEqual(matchesDestinationHub('Enugu Terminal', 'Abuja'), false);
    });

    test('handles empty or missing route values without throwing', () => {
      assert.strictEqual(matchesDestinationHub(null, 'Lagos Hub'), false);
      assert.strictEqual(matchesDestinationHub(undefined, 'Lagos Hub'), false);
      assert.strictEqual(matchesDestinationHub('', 'Lagos Hub'), false);
    });

    test('matches any route if hubName is empty or has no >=3 char words', () => {
      assert.strictEqual(matchesDestinationHub('Lagos', ''), true);
      assert.strictEqual(matchesDestinationHub('Abuja', 'AB'), true);
    });
  });

  describe('filterIncomingCargo', () => {
    const sampleItems: IncomingCargoItem[] = [
      {
        id: '1',
        entry_ref: 'LOS-CRG-001',
        consignee_name: 'Aliko Dangote Industries',
        route: 'Abuja Station',
        total_pcs: 5,
        total_kg: 25.5,
        content_type: 'General Cargo',
        airline: 'Air Peace',
        awb_tag_number: 'APK-12345',
        created_at: '2026-11-15T10:00:00Z',
      },
      {
        id: '2',
        entry_ref: 'KAN-CRG-002',
        consignee_name: 'Binta Bello Pharmacy',
        route: 'Lagos Hub',
        total_pcs: 2,
        total_kg: 10,
        content_type: 'Pharmaceuticals',
        airline: 'Green Africa',
        awb_tag_number: 'GA-98765',
        created_at: '2026-11-15T11:00:00Z',
      },
      {
        id: '3',
        entry_ref: 'PHC-CRG-003',
        consignee_name: 'Chinedu Eze Electronics',
        route: 'Lagos Hub',
        total_pcs: 12,
        total_kg: 84.2,
        content_type: 'Electronics',
        airline: 'Ibom Air',
        awb_tag_number: 'IA-45678',
        created_at: '2026-11-15T12:00:00Z',
      },
    ];

    test('returns all items when query is empty', () => {
      assert.strictEqual(filterIncomingCargo(sampleItems, '').length, 3);
      assert.strictEqual(filterIncomingCargo(sampleItems, '   ').length, 3);
    });

    test('filters by consignee name (case-insensitive)', () => {
      const res = filterIncomingCargo(sampleItems, 'binta');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].consignee_name, 'Binta Bello Pharmacy');
    });

    test('filters by multi-token search query', () => {
      const res = filterIncomingCargo(sampleItems, 'binta lagos');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entry_ref, 'KAN-CRG-002');

      const resNone = filterIncomingCargo(sampleItems, 'binta abuja');
      assert.strictEqual(resNone.length, 0);
    });

    test('filters by entry reference', () => {
      const res = filterIncomingCargo(sampleItems, 'crg-001');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entry_ref, 'LOS-CRG-001');
    });

    test('filters by AWB tag number', () => {
      const res = filterIncomingCargo(sampleItems, '45678');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].awb_tag_number, 'IA-45678');
    });

    test('filters by airline name', () => {
      const res = filterIncomingCargo(sampleItems, 'Green Africa');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].airline, 'Green Africa');
    });

    test('filters by route destination', () => {
      const res = filterIncomingCargo(sampleItems, 'Lagos');
      assert.strictEqual(res.length, 2);
    });

    test('filters by content type', () => {
      const res = filterIncomingCargo(sampleItems, 'pharmaceuticals');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].consignee_name, 'Binta Bello Pharmacy');
    });

    test('returns empty array when no items match query', () => {
      const res = filterIncomingCargo(sampleItems, 'Nonexistent Query 999');
      assert.strictEqual(res.length, 0);
    });
  });

  describe('calculateIncomingMetrics', () => {
    test('computes count, total pieces, and total weight correctly', () => {
      const items = [
        { total_pcs: 4, total_kg: 12.5 },
        { total_pcs: '6', total_kg: '20.2' },
        { total_pcs: 0, total_kg: 0 },
        { total_pcs: null, total_kg: undefined },
      ];
      const metrics = calculateIncomingMetrics(items);
      assert.strictEqual(metrics.count, 4);
      assert.strictEqual(metrics.totalPieces, 10);
      assert.strictEqual(metrics.totalWeight, 32.7);
    });

    test('returns zeroes when items list is empty', () => {
      const metrics = calculateIncomingMetrics([]);
      assert.strictEqual(metrics.count, 0);
      assert.strictEqual(metrics.totalPieces, 0);
      assert.strictEqual(metrics.totalWeight, 0);
    });
  });

  describe('canAccessIncomingRole', () => {
    test('authorizes expected operational and administrative roles', () => {
      assert.strictEqual(canAccessIncomingRole('super_admin'), true);
      assert.strictEqual(canAccessIncomingRole('admin'), true);
      assert.strictEqual(canAccessIncomingRole('cargo_agent'), true);
      assert.strictEqual(canAccessIncomingRole('baggage_agent'), true);
      assert.strictEqual(canAccessIncomingRole('driver'), true);
      assert.strictEqual(canAccessIncomingRole('office_work'), true);
    });

    test('denies unauthorized roles', () => {
      assert.strictEqual(canAccessIncomingRole('guest'), false);
      assert.strictEqual(canAccessIncomingRole('auditor'), false);
      assert.strictEqual(canAccessIncomingRole('viewer'), false);
    });
  });
});
