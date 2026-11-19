import { describe, test } from 'node:test';
import assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  formatBadgeCount,
  getAccessibleBadgeLabel,
  matchesDestination,
  computeHubCounts,
  ConsignmentItem,
  fetchHubCountsFromDb,
} from './hubCounts';
import { NavBadge } from '../components/NavBadge';

describe('Hub Counts & Navigation Badge Logic', () => {
  describe('formatBadgeCount', () => {
    test('returns null when count is 0 or negative (badge hides at 0)', () => {
      assert.strictEqual(formatBadgeCount(0), null);
      assert.strictEqual(formatBadgeCount(-1), null);
      assert.strictEqual(formatBadgeCount(-10), null);
      assert.strictEqual(formatBadgeCount(NaN), null);
    });

    test('returns exact string representation for counts from 1 to 99', () => {
      assert.strictEqual(formatBadgeCount(1), '1');
      assert.strictEqual(formatBadgeCount(12), '12');
      assert.strictEqual(formatBadgeCount(50), '50');
      assert.strictEqual(formatBadgeCount(99), '99');
    });

    test('applies 99+ cap for counts over 99', () => {
      assert.strictEqual(formatBadgeCount(100), '99+');
      assert.strictEqual(formatBadgeCount(105), '99+');
      assert.strictEqual(formatBadgeCount(999), '99+');
    });
  });

  describe('getAccessibleBadgeLabel', () => {
    test('formats accessible label for incoming and outbound', () => {
      assert.strictEqual(getAccessibleBadgeLabel(12, 'incoming'), '12 incoming');
      assert.strictEqual(getAccessibleBadgeLabel(5, 'outbound'), '5 outbound');
      assert.strictEqual(getAccessibleBadgeLabel(0, 'incoming'), '0 incoming');
      assert.strictEqual(getAccessibleBadgeLabel(120, 'incoming'), 'Over 99 incoming');
      assert.strictEqual(getAccessibleBadgeLabel(200, 'outbound'), 'Over 99 outbound');
    });
  });

  describe('matchesDestination', () => {
    test('matches destination containing hub name words', () => {
      assert.strictEqual(matchesDestination('Lagos MMA2 Cargo', 'Murtala Muhammed Lagos'), true);
      assert.strictEqual(matchesDestination('Abuja Station', 'Abuja Air Hub'), true);
      assert.strictEqual(matchesDestination('Kano Central Depot', 'Mallam Aminu Kano Hub'), true);
    });

    test('rejects destinations belonging to different hubs', () => {
      assert.strictEqual(matchesDestination('Port Harcourt Hub', 'Murtala Muhammed Lagos'), false);
      assert.strictEqual(matchesDestination('Kano Central Depot', 'Abuja Air Hub'), false);
    });
  });

  describe('computeHubCounts lifecycle', () => {
    const hubLagos = { id: 'hub-los-01', name: 'Lagos Hub' };
    const hubAbuja = { id: 'hub-abv-02', name: 'Abuja Hub' };

    test('initial state with no in-transit items has 0 counts (badge hidden)', () => {
      const items: ConsignmentItem[] = [
        { id: 'PKG-1', status: 'Intake', route: 'Abuja Hub', hub_id: 'hub-los-01' },
        { id: 'CRG-2', status: 'Draft', destination: 'Lagos Hub', hub_id: 'hub-abv-02' },
      ];

      const countsLagos = computeHubCounts(items, hubLagos);
      const countsAbuja = computeHubCounts(items, hubAbuja);

      assert.strictEqual(countsLagos.incoming, 0);
      assert.strictEqual(countsLagos.outbound, 0);
      assert.strictEqual(countsAbuja.incoming, 0);
      assert.strictEqual(countsAbuja.outbound, 0);
      assert.strictEqual(formatBadgeCount(countsLagos.incoming), null);
      assert.strictEqual(formatBadgeCount(countsLagos.outbound), null);
    });

    test('scanned out increments: when item is scanned out from Lagos to Abuja, Lagos outbound +1 and Abuja incoming +1', () => {
      // 1. Initially at intake
      const consignment: ConsignmentItem = {
        id: 'PKG-101',
        status: 'Intake',
        destination: 'Abuja Hub',
        hub_id: 'hub-los-01',
      };

      const countsBeforeLagos = computeHubCounts([consignment], hubLagos);
      const countsBeforeAbuja = computeHubCounts([consignment], hubAbuja);
      assert.strictEqual(countsBeforeLagos.outbound, 0);
      assert.strictEqual(countsBeforeAbuja.incoming, 0);

      // 2. Scanned out (DEPART) -> status moves to In-Transit
      const scannedOutConsignment: ConsignmentItem = {
        ...consignment,
        status: 'In-Transit',
      };

      const countsAfterLagos = computeHubCounts([scannedOutConsignment], hubLagos);
      const countsAfterAbuja = computeHubCounts([scannedOutConsignment], hubAbuja);

      // Lagos sending hub: outbound incremented by 1
      assert.strictEqual(countsAfterLagos.outbound, 1);
      assert.strictEqual(countsAfterLagos.incoming, 0);

      // Abuja destination hub: incoming incremented by 1
      assert.strictEqual(countsAfterAbuja.incoming, 1);
      assert.strictEqual(countsAfterAbuja.outbound, 0);
    });

    test('scanned in decrements: when receiving hub scans consignment in, both counts drop to 0 and badge disappears', () => {
      // Item currently in-transit
      const inTransitItem: ConsignmentItem = {
        id: 'CRG-202',
        status: 'In-Transit',
        route: 'Abuja Air Station',
        hub_id: 'hub-los-01',
      };

      const countsInTransitLagos = computeHubCounts([inTransitItem], hubLagos);
      const countsInTransitAbuja = computeHubCounts([inTransitItem], hubAbuja);
      assert.strictEqual(countsInTransitLagos.outbound, 1);
      assert.strictEqual(countsInTransitAbuja.incoming, 1);

      // Receiving hub scans item in (ARRIVE) -> status moves to Arrived
      const arrivedItem: ConsignmentItem = {
        ...inTransitItem,
        status: 'Arrived',
      };

      const countsArrivedLagos = computeHubCounts([arrivedItem], hubLagos);
      const countsArrivedAbuja = computeHubCounts([arrivedItem], hubAbuja);

      // Both counts drop by 1 back to 0
      assert.strictEqual(countsArrivedLagos.outbound, 0);
      assert.strictEqual(countsArrivedAbuja.incoming, 0);

      // Badges disappear at 0
      assert.strictEqual(formatBadgeCount(countsArrivedLagos.outbound), null);
      assert.strictEqual(formatBadgeCount(countsArrivedAbuja.incoming), null);
    });

    test('other hubs items excluded: only relevant station items count', () => {
      const items: ConsignmentItem[] = [
        // Lagos -> Abuja (In-Transit)
        { id: '1', status: 'In-Transit', route: 'Abuja Hub', hub_id: 'hub-los-01' },
        // Kano -> Port Harcourt (In-Transit) - unrelated to Lagos or Abuja
        { id: '2', status: 'In-Transit', route: 'Port Harcourt Hub', hub_id: 'hub-kano-03' },
        // Abuja -> Kano (In-Transit)
        { id: '3', status: 'In-Transit', route: 'Kano Hub', hub_id: 'hub-abv-02' },
        // Lagos -> Kano (Arrived - already reached destination)
        { id: '4', status: 'Arrived', route: 'Kano Hub', hub_id: 'hub-los-01' },
        // Lagos -> Abuja (Delivered)
        { id: '5', status: 'Delivered', destination: 'Abuja Hub', hub_id: 'hub-los-01' },
      ];

      const lagosCounts = computeHubCounts(items, hubLagos);
      // Only item #1 is In-Transit from Lagos
      assert.strictEqual(lagosCounts.outbound, 1);
      // No items are In-Transit destined for Lagos
      assert.strictEqual(lagosCounts.incoming, 0);

      const abujaCounts = computeHubCounts(items, hubAbuja);
      // Item #1 is In-Transit destined for Abuja
      assert.strictEqual(abujaCounts.incoming, 1);
      // Item #3 is In-Transit dispatched from Abuja
      assert.strictEqual(abujaCounts.outbound, 1);
    });

    test('counts Package and Cargo entries consistently', () => {
      const items: ConsignmentItem[] = [
        // Package entry with destination
        { id: 'PKG-101', status: 'In-Transit', destination: 'Lagos Hub', hub_id: 'hub-abv-02' },
        // Air Cargo entry with route
        { id: 'CRG-202', status: 'In-Transit', route: 'Lagos Hub', hub_id: 'hub-abv-02' },
      ];

      const counts = computeHubCounts(items, hubLagos);
      assert.strictEqual(counts.incoming, 2);

      const abujaCounts = computeHubCounts(items, hubAbuja);
      assert.strictEqual(abujaCounts.outbound, 2);
    });
  });

  describe('Marketing and Baggage exclusion', () => {
    test('live counts never query marketing or baggage tables', async () => {
      const tables: string[] = [];
      const makeQ = (rows: unknown[]) => {
        const q: any = {
          select: () => q, eq: () => q, or: () => q, limit: () => q,
          then: (res: (v: unknown) => void) => res({ count: rows.length, data: rows }),
        };
        return q;
      };
      const fake: any = {
        from: (t: string) => { tables.push(t); return makeQ([{ id: '1', route: 'Lagos Hub', destination: 'Lagos Hub' }]); },
      };
      const res = await fetchHubCountsFromDb({ hub: 'Lagos Hub', hub_id: 'hub-lag' }, fake);
      assert.deepStrictEqual(res, { incoming: 2, outbound: 2 });
      assert.ok(tables.length > 0);
      for (const t of tables) {
        assert.ok(!/marketing|baggage/i.test(t), `unexpected table ${t}`);
      }
    });
  });

  describe('NavBadge Component Tests', () => {
    test('renders nothing when count is 0', () => {
      const html = renderToStaticMarkup(React.createElement(NavBadge, { count: 0, type: 'incoming' }));
      assert.strictEqual(html, '');
    });

    test('renders nothing when count is negative', () => {
      const html = renderToStaticMarkup(React.createElement(NavBadge, { count: -5, type: 'outbound' }));
      assert.strictEqual(html, '');
    });

    test('renders neutral monochrome pill with count and accessible label', () => {
      const html = renderToStaticMarkup(React.createElement(NavBadge, { count: 12, type: 'incoming' }));
      assert.ok(html.includes('12'), 'should contain count text');
      assert.ok(html.includes('aria-label="12 incoming"'), 'should have accessible label');
      assert.ok(html.includes('bg-[var(--color-surface-3)]'), 'should use neutral surface token');
      assert.ok(html.includes('text-[var(--color-foreground)]'), 'should use foreground text token');
      assert.ok(!html.includes('gold') && !html.includes('amber'), 'must NEVER contain gold');
    });

    test('renders 99+ cap when count exceeds 99', () => {
      const html = renderToStaticMarkup(React.createElement(NavBadge, { count: 120, type: 'outbound' }));
      assert.ok(html.includes('99+'), 'should display 99+');
      assert.ok(html.includes('aria-label="Over 99 outbound"'), 'should have over 99 accessible label');
    });

    test('renders compact variant for collapsed rail and mobile navigation', () => {
      const html = renderToStaticMarkup(
        React.createElement(NavBadge, { count: 7, type: 'incoming', compact: true })
      );
      assert.ok(html.includes('7'), 'should contain count text');
      assert.ok(html.includes('min-w-[15px]'), 'compact variant should use compact dimensions');
    });
  });
});
