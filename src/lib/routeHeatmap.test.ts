import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouteHeatmap,
  calculateThresholds,
  classifyLevel,
  calculateQuantile,
  normalizeRoute,
  RawRouteRecord,
} from './routeHeatmap';

describe('Route Capacity Heatmap Engine', () => {
  describe('normalizeRoute', () => {
    test('normalizes dashes and arrows to standard hyphen separator', () => {
      assert.strictEqual(normalizeRoute('LOS-ABV'), 'LOS - ABV');
      assert.strictEqual(normalizeRoute('LOS -> ABV'), 'LOS - ABV');
      assert.strictEqual(normalizeRoute('los - abv'), 'LOS - ABV');
      assert.strictEqual(normalizeRoute('LOS–ABV'), 'LOS - ABV');
    });

    test('strips Air Cargo Station suffix', () => {
      assert.strictEqual(normalizeRoute('Lagos Air Cargo Station'), 'LAGOS');
      assert.strictEqual(normalizeRoute('Abuja Cargo Station'), 'ABUJA');
      assert.strictEqual(normalizeRoute('Port Harcourt'), 'PORT HARCOURT');
    });

    test('returns empty string for null, undefined, empty, or placeholder strings', () => {
      assert.strictEqual(normalizeRoute(null), '');
      assert.strictEqual(normalizeRoute(undefined), '');
      assert.strictEqual(normalizeRoute(''), '');
      assert.strictEqual(normalizeRoute('   '), '');
      assert.strictEqual(normalizeRoute('—'), '');
    });
  });

  describe('calculateQuantile', () => {
    test('handles empty and single-element arrays', () => {
      assert.strictEqual(calculateQuantile([], 0.5), 0);
      assert.strictEqual(calculateQuantile([42], 0.5), 42);
    });

    test('calculates correct linear interpolation quantiles', () => {
      const sorted = [10, 20, 30, 40];
      assert.strictEqual(calculateQuantile(sorted, 0), 10);
      assert.strictEqual(calculateQuantile(sorted, 1), 40);
      assert.strictEqual(calculateQuantile(sorted, 0.5), 25);
    });
  });

  describe('calculateThresholds and classification thresholds', () => {
    test('handles all zeros gracefully', () => {
      const thresholds = calculateThresholds([0, 0, 0, 0]);
      assert.strictEqual(thresholds.min, 0);
      assert.strictEqual(thresholds.max, 0);
      assert.strictEqual(classifyLevel(0, thresholds), 'low');
    });

    test('handles uniform positive numbers', () => {
      const thresholds = calculateThresholds([5, 5, 5, 5]);
      assert.strictEqual(thresholds.min, 5);
      assert.strictEqual(thresholds.max, 5);
      assert.strictEqual(classifyLevel(5, thresholds), 'medium');
    });

    test('divides into clean terciles when distinct values exist', () => {
      // 6 points: 1, 2, 3, 4, 5, 6
      const thresholds = calculateThresholds([1, 2, 3, 4, 5, 6]);
      // Terciles: 1 & 2 low, 3 & 4 medium, 5 & 6 high
      assert.strictEqual(classifyLevel(1, thresholds), 'low');
      assert.strictEqual(classifyLevel(2, thresholds), 'low');
      assert.strictEqual(classifyLevel(3, thresholds), 'medium');
      assert.strictEqual(classifyLevel(4, thresholds), 'medium');
      assert.strictEqual(classifyLevel(5, thresholds), 'high');
      assert.strictEqual(classifyLevel(6, thresholds), 'high');
    });

    test('handles zero-inflated distributions without collapsing to a single tier', () => {
      // 5 zeros and one high peak
      const thresholds = calculateThresholds([0, 0, 0, 0, 0, 10]);
      assert.strictEqual(classifyLevel(0, thresholds), 'low');
      assert.strictEqual(classifyLevel(3, thresholds), 'medium');
      assert.strictEqual(classifyLevel(10, thresholds), 'high');
    });
  });

  describe('buildRouteHeatmap', () => {
    test('returns empty array when input data is empty', () => {
      const result = buildRouteHeatmap([]);
      assert.deepStrictEqual(result, []);
    });

    test('handles entries with invalid dates or blank routes without throwing', () => {
      const entries: RawRouteRecord[] = [
        { route: '', created_at: '2026-10-12T10:00:00Z' },
        { route: null, created_at: '2026-10-12T10:00:00Z' },
        { destination: undefined, created_at: '2026-10-12T10:00:00Z' },
        { route: 'LOS-ABV', created_at: 'invalid-date' },
      ];
      const result = buildRouteHeatmap(entries);
      assert.deepStrictEqual(result, []);
    });

    test('correctly processes a single route and classifies its weekday variance', () => {
      // We will create entries for LOS - ABV across weekdays
      // 2026-10-12 is Monday, 2026-10-13 Tue, 14 Wed, 15 Thu, 16 Fri, 17 Sat
      const entries: RawRouteRecord[] = [
        // Monday: 1 entry
        { route: 'LOS - ABV', created_at: '2026-10-12T09:00:00Z' },
        // Tuesday: 2 entries
        { route: 'LOS - ABV', created_at: '2026-10-13T09:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-13T14:00:00Z' },
        // Wednesday: 3 entries
        { route: 'LOS - ABV', created_at: '2026-10-14T09:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-14T11:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-14T15:00:00Z' },
        // Thursday: 4 entries
        { route: 'LOS - ABV', created_at: '2026-10-15T09:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-15T11:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-15T13:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-15T15:00:00Z' },
        // Friday: 5 entries
        { route: 'LOS - ABV', created_at: '2026-10-16T09:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-16T11:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-16T13:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-16T15:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-16T17:00:00Z' },
        // Saturday: 6 entries
        { route: 'LOS - ABV', created_at: '2026-10-17T09:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-17T11:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-17T13:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-17T15:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-17T17:00:00Z' },
        { route: 'LOS - ABV', created_at: '2026-10-17T19:00:00Z' },
      ];

      const result = buildRouteHeatmap(entries, { weeks: 8 });
      assert.strictEqual(result.length, 1);
      const row = result[0];
      assert.strictEqual(row.route, 'LOS - ABV');
      assert.strictEqual(row.totalCount, 21);
      assert.strictEqual(row.weeklyAverage, 21 / 8);

      // Tercile distribution for [1/8, 2/8, 3/8, 4/8, 5/8, 6/8]:
      // Mon (1) and Tue (2) -> low
      // Wed (3) and Thu (4) -> medium
      // Fri (5) and Sat (6) -> high
      assert.strictEqual(row.Mon, 'low');
      assert.strictEqual(row.Tue, 'low');
      assert.strictEqual(row.Wed, 'medium');
      assert.strictEqual(row.Thu, 'medium');
      assert.strictEqual(row.Fri, 'high');
      assert.strictEqual(row.Sat, 'high');
    });

    test('combines cargo_entries (route) and package_entries (destination)', () => {
      const entries: RawRouteRecord[] = [
        // Cargo desk: 'LOS-PHC'
        { route: 'LOS-PHC', created_at: '2026-10-12T10:00:00Z' },
        { route: 'LOS-PHC', created_at: '2026-10-12T11:00:00Z' },
        // Package desk: 'LOS - PHC' in destination
        { destination: 'LOS - PHC', created_at: '2026-10-12T12:00:00Z' },
      ];

      const result = buildRouteHeatmap(entries, { weeks: 8 });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].route, 'LOS - PHC');
      assert.strictEqual(result[0].totalCount, 3);
    });

    test('limits output to at most the top 8 routes sorted by volume', () => {
      const entries: RawRouteRecord[] = [];
      const routeNames = [
        'LOS - ABV',
        'LOS - PHC',
        'LOS - KAN',
        'LOS - BNI',
        'LOS - ENU',
        'LOS - OWR',
        'LOS - CBQ',
        'LOS - ILR',
        'LOS - QOW',
        'LOS - AKR',
      ];

      // Give route 0 the highest volume (10), route 9 the lowest (1)
      routeNames.forEach((name, idx) => {
        const count = 10 - idx;
        for (let i = 0; i < count; i++) {
          entries.push({
            route: name,
            created_at: '2026-10-14T10:00:00Z', // Wednesday
          });
        }
      });

      const result = buildRouteHeatmap(entries, { weeks: 8, maxRoutes: 8 });
      assert.strictEqual(result.length, 8, 'Must return at most top 8 routes');
      assert.strictEqual(result[0].route, 'LOS - ABV');
      assert.strictEqual(result[1].route, 'LOS - PHC');
      assert.strictEqual(result[7].route, 'LOS - ILR');

      // 9th and 10th routes should be omitted
      assert.ok(!result.some((r) => r.route === 'LOS - QOW'));
      assert.ok(!result.some((r) => r.route === 'LOS - AKR'));
    });

    test('Sunday entries contribute to route volume ranking but are excluded from Mon-Sat calendar columns', () => {
      // 2026-10-11 is Sunday
      const entries: RawRouteRecord[] = [
        { route: 'LOS - ABV', created_at: '2026-10-11T12:00:00Z' }, // Sunday
        { route: 'LOS - ABV', created_at: '2026-10-12T12:00:00Z' }, // Monday
      ];

      const result = buildRouteHeatmap(entries, { weeks: 8 });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].totalCount, 2); // 2 total entries
      assert.strictEqual(result[0].Mon, 'high'); // Only weekday with entries
      assert.strictEqual(result[0].Tue, 'low');
    });
  });
});
