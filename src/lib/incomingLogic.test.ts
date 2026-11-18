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
  formatAwbDisplay,
  formatRoutePath,
  formatTelemetryMetrics,
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
    test('returns trimmed route when present and normalizes arrows', () => {
      assert.strictEqual(formatRouteDisplay('  Abuja - Lagos  '), 'Abuja → Lagos');
      assert.strictEqual(formatRouteDisplay('Kano -> Lagos Hub'), 'Kano → Lagos Hub');
      assert.strictEqual(formatRouteDisplay('Kano Station'), 'Kano Station');
    });

    test('falls back to "Direct route" when null, empty, or whitespace', () => {
      assert.strictEqual(formatRouteDisplay(null), 'Direct route');
      assert.strictEqual(formatRouteDisplay(undefined), 'Direct route');
      assert.strictEqual(formatRouteDisplay('   '), 'Direct route');
    });
  });

  describe('formatAwbDisplay', () => {
    test('preserves and uppercases tags that already start with AWB prefix', () => {
      assert.strictEqual(formatAwbDisplay('AWB-LOS-89102'), 'AWB-LOS-89102');
      assert.strictEqual(formatAwbDisplay('awb-abv-44120'), 'AWB-ABV-44120');
      assert.strictEqual(formatAwbDisplay('AWB:PHC-99214'), 'AWB:PHC-99214');
      assert.strictEqual(formatAwbDisplay('awb 12345'), 'AWB 12345');
      assert.strictEqual(formatAwbDisplay('awb88990'), 'AWB-88990');
    });

    test('prepends AWB prefix cleanly when absent', () => {
      assert.strictEqual(formatAwbDisplay('987654'), 'AWB 987654');
      assert.strictEqual(formatAwbDisplay('LOS-9988'), 'AWB LOS-9988');
    });

    test('returns empty string for null, undefined, or empty values', () => {
      assert.strictEqual(formatAwbDisplay(null), '');
      assert.strictEqual(formatAwbDisplay(undefined), '');
      assert.strictEqual(formatAwbDisplay(''), '');
      assert.strictEqual(formatAwbDisplay('   '), '');
    });
  });

  describe('formatRoutePath', () => {
    test('extracts origin and destination from arrow or hyphen separated strings', () => {
      const p1 = formatRoutePath('Kano -> Lagos Hub');
      assert.strictEqual(p1.origin, 'Kano');
      assert.strictEqual(p1.destination, 'Lagos Hub');
      assert.strictEqual(p1.display, 'Kano → Lagos Hub');

      const p2 = formatRoutePath('Abuja to Lagos');
      assert.strictEqual(p2.origin, 'Abuja');
      assert.strictEqual(p2.destination, 'Lagos');
      assert.strictEqual(p2.display, 'Abuja → Lagos');
    });

    test('handles single hub or station name gracefully', () => {
      const p = formatRoutePath('Kano Station');
      assert.strictEqual(p.origin, 'Kano Station');
      assert.strictEqual(p.destination, '');
      assert.strictEqual(p.display, 'Kano Station');
    });
  });

  describe('formatTelemetryMetrics', () => {
    test('formats in-transit and metric strings cleanly without stutter', () => {
      const m1 = formatTelemetryMetrics(4, 4, 47, 916.5, false);
      assert.strictEqual(m1.inTransitText, '4 in transit');
      assert.strictEqual(m1.piecesText, '47 pcs');
      assert.strictEqual(m1.weightText, '916.5 kg');

      const m2 = formatTelemetryMetrics(1, 4, 14, 320.5, true);
      assert.strictEqual(m2.inTransitText, '1 of 4 in transit');
      assert.strictEqual(m2.piecesText, '14 pcs');
      assert.strictEqual(m2.weightText, '320.5 kg');
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
