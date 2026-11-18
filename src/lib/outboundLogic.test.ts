import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  timeSince,
  formatOutboundSpecs,
  formatAwbDisplay,
  formatRouteDisplay,
  formatDestinationLabel,
  filterOutboundArrivals,
  calculateOutboundMetrics,
  formatOutboundTelemetry,
  generateOutboundCsv,
  canAccessOutboundRole,
  OutboundArrivalItem,
} from './outboundLogic';

describe('Outbound Arrivals Pure Logic & Helpers', () => {
  describe('timeSince', () => {
    it('formats minutes correctly for timestamps less than 1 hour ago', () => {
      const now = 1700000000000;
      const thirtyMinsAgo = new Date(now - 30 * 60 * 1000).toISOString();
      assert.strictEqual(timeSince(thirtyMinsAgo, now), '30m ago');

      const oneMinAgo = new Date(now - 60 * 1000).toISOString();
      assert.strictEqual(timeSince(oneMinAgo, now), '1m ago');
    });

    it('formats hours correctly for timestamps under 24 hours', () => {
      const now = 1700000000000;
      const twoHoursAgo = new Date(now - 2 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(twoHoursAgo, now), '2h ago');

      const twentyThreeHoursAgo = new Date(now - 23 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(twentyThreeHoursAgo, now), '23h ago');
    });

    it('formats days correctly for timestamps 24 hours or older', () => {
      const now = 1700000000000;
      const oneDayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(oneDayAgo, now), '1d ago');

      const fiveDaysAgo = new Date(now - 5 * 24 * 3600 * 1000).toISOString();
      assert.strictEqual(timeSince(fiveDaysAgo, now), '5d ago');
    });

    it('handles invalid timestamp gracefully', () => {
      assert.strictEqual(timeSince('invalid-date'), '—');
      assert.strictEqual(timeSince(''), '—');
    });
  });

  describe('formatOutboundSpecs', () => {
    it('formats positive numeric pieces and weight', () => {
      const res = formatOutboundSpecs(15, 230.5);
      assert.strictEqual(res.pcsStr, '15 pcs');
      assert.strictEqual(res.kgStr, '230.5 kg');
    });

    it('handles string numbers and decimals with rounding', () => {
      const res = formatOutboundSpecs('8', '45.289');
      assert.strictEqual(res.pcsStr, '8 pcs');
      assert.strictEqual(res.kgStr, '45.3 kg');
    });

    it('returns fallbacks for null or missing values', () => {
      const res = formatOutboundSpecs(null, undefined);
      assert.strictEqual(res.pcsStr, '— pcs');
      assert.strictEqual(res.kgStr, '— kg');
    });
  });

  describe('formatAwbDisplay', () => {
    it('handles clean AWB prefixes without duplicate tags', () => {
      assert.strictEqual(formatAwbDisplay('AWB-LOS-1234'), 'AWB-LOS-1234');
      assert.strictEqual(formatAwbDisplay('awb-los-5678'), 'AWB-LOS-5678');
      assert.strictEqual(formatAwbDisplay('AWB 99120'), 'AWB 99120');
    });

    it('formats bare numbers or tags with standard AWB prefix', () => {
      assert.strictEqual(formatAwbDisplay('99120'), 'AWB 99120');
      assert.strictEqual(formatAwbDisplay('KAN-8812'), 'AWB KAN-8812');
    });

    it('formats AWB123 into AWB-123', () => {
      assert.strictEqual(formatAwbDisplay('awb12345'), 'AWB-12345');
    });

    it('returns empty string for null, undefined or empty strings', () => {
      assert.strictEqual(formatAwbDisplay(null), '');
      assert.strictEqual(formatAwbDisplay(undefined), '');
      assert.strictEqual(formatAwbDisplay('   '), '');
    });
  });

  describe('formatRouteDisplay', () => {
    it('replaces ASCII arrows with typographic arrow →', () => {
      assert.strictEqual(
        formatRouteDisplay('Lagos Hub -> Kano Station'),
        'Lagos Hub → Kano Station'
      );
      assert.strictEqual(
        formatRouteDisplay('Lagos Hub --> Abuja Cargo'),
        'Lagos Hub → Abuja Cargo'
      );
    });

    it('handles "to" separator', () => {
      assert.strictEqual(
        formatRouteDisplay('Lagos to Port Harcourt'),
        'Lagos → Port Harcourt'
      );
    });

    it('handles direct destinations or empty routes', () => {
      assert.strictEqual(formatRouteDisplay('Ibadan Drop Point'), 'Ibadan Drop Point');
      assert.strictEqual(formatRouteDisplay(''), 'Direct route');
      assert.strictEqual(formatRouteDisplay(null), 'Direct route');
    });
  });

  describe('formatDestinationLabel', () => {
    it('identifies transit routes with arrows and assigns "Route" label', () => {
      const res = formatDestinationLabel('Lagos Hub -> Kano Station');
      assert.strictEqual(res.isRoute, true);
      assert.strictEqual(res.displayText, 'Lagos Hub → Kano Station');
      assert.strictEqual(res.typeLabel, 'Route');
    });

    it('identifies single station or office drop-points and assigns "Destination" label', () => {
      const res = formatDestinationLabel('Abuja Central Office');
      assert.strictEqual(res.isRoute, false);
      assert.strictEqual(res.displayText, 'Abuja Central Office');
      assert.strictEqual(res.typeLabel, 'Destination');
    });

    it('handles null, undefined, or empty destination inputs gracefully', () => {
      const res = formatDestinationLabel(null);
      assert.strictEqual(res.isRoute, false);
      assert.strictEqual(res.displayText, 'Direct route');
      assert.strictEqual(res.typeLabel, 'Destination');
    });
  });

  describe('filterOutboundArrivals', () => {
    const mockItems: OutboundArrivalItem[] = [
      {
        key: 'Cargo-1',
        source: 'Cargo',
        entryRef: 'EHI-CRG-001',
        customerName: 'Dangote Industries',
        destinationLabel: 'Lagos Hub -> Kano Station',
        pcs: 20,
        kg: 450,
        awb: 'AWB-LOS-101',
        airline: 'Air Peace',
        contentType: 'Machinery',
        createdAt: '2026-11-18T12:00:00Z',
      },
      {
        key: 'Package-2',
        source: 'Package',
        entryRef: 'EHI-PKG-002',
        customerName: 'Adeola Chambers',
        destinationLabel: 'Abuja Central Office',
        pcs: 3,
        kg: 5.5,
        contentType: 'Legal Documents',
        createdAt: '2026-11-18T10:00:00Z',
      },
      {
        key: 'Cargo-3',
        source: 'Cargo',
        entryRef: 'EHI-CRG-003',
        customerName: 'Zenith Tech',
        destinationLabel: 'Port Harcourt',
        pcs: 12,
        kg: 180,
        awb: 'AWB-LOS-202',
        airline: 'Ibom Air',
        contentType: 'Telecom Spares',
        createdAt: '2026-11-18T08:00:00Z',
      },
    ];

    it('returns all items when query is empty and source filter is all', () => {
      const res = filterOutboundArrivals(mockItems, '', 'all');
      assert.strictEqual(res.length, 3);
    });

    it('filters by source', () => {
      const cargoOnly = filterOutboundArrivals(mockItems, '', 'cargo');
      assert.strictEqual(cargoOnly.length, 2);
      assert.ok(cargoOnly.every((i) => i.source === 'Cargo'));

      const pkgOnly = filterOutboundArrivals(mockItems, '', 'package');
      assert.strictEqual(pkgOnly.length, 1);
      assert.strictEqual(pkgOnly[0].customerName, 'Adeola Chambers');
    });

    it('filters by customer name', () => {
      const res = filterOutboundArrivals(mockItems, 'dangote', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-001');
    });

    it('filters by entry reference', () => {
      const res = filterOutboundArrivals(mockItems, 'PKG-002', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].customerName, 'Adeola Chambers');
    });

    it('filters by destination', () => {
      const res = filterOutboundArrivals(mockItems, 'kano', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-001');
    });

    it('filters by AWB tag', () => {
      const res = filterOutboundArrivals(mockItems, 'LOS-202', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-003');
    });

    it('filters by airline', () => {
      const res = filterOutboundArrivals(mockItems, 'ibom air', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].customerName, 'Zenith Tech');
    });

    it('supports multi-token searching across different fields (e.g. customer + route)', () => {
      const res = filterOutboundArrivals(mockItems, 'dangote kano', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-001');
    });

    it('supports multi-token searching for airline + destination', () => {
      const res = filterOutboundArrivals(mockItems, 'air peace kano', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-001');
    });

    it('supports multi-token searching for customer + content type', () => {
      const res = filterOutboundArrivals(mockItems, 'zenith telecom spares', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-CRG-003');
    });

    it('handles excess whitespace in multi-token queries safely', () => {
      const res = filterOutboundArrivals(mockItems, '   adeola    chambers   abuja   ', 'all');
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0].entryRef, 'EHI-PKG-002');
    });

    it('returns empty array when one of the tokens fails to match', () => {
      const res = filterOutboundArrivals(mockItems, 'dangote calabar', 'all');
      assert.strictEqual(res.length, 0);
    });

    it('combines source filter and search query', () => {
      const res = filterOutboundArrivals(mockItems, 'chambers', 'cargo');
      assert.strictEqual(res.length, 0); // Chambers is Package, not Cargo
    });
  });

  describe('calculateOutboundMetrics', () => {
    const mockItems: OutboundArrivalItem[] = [
      {
        key: 'c1',
        source: 'Cargo',
        entryRef: 'CRG-1',
        customerName: 'Client 1',
        destinationLabel: 'Kano',
        pcs: 10,
        kg: 100.5,
        createdAt: '2026-11-18T10:00:00Z',
      },
      {
        key: 'p1',
        source: 'Package',
        entryRef: 'PKG-1',
        customerName: 'Client 2',
        destinationLabel: 'Abuja',
        pcs: 4,
        kg: 12.3,
        createdAt: '2026-11-18T09:00:00Z',
      },
      {
        key: 'l1',
        source: 'Legacy',
        entryRef: 'LEG-1',
        customerName: 'Client 3',
        destinationLabel: 'Enugu',
        pcs: 2,
        createdAt: '2026-11-18T08:00:00Z',
      },
    ];

    it('calculates aggregates and breakdowns accurately', () => {
      const metrics = calculateOutboundMetrics(mockItems);
      assert.strictEqual(metrics.totalCount, 3);
      assert.strictEqual(metrics.totalPieces, 16);
      assert.strictEqual(metrics.totalWeight, 112.8);
      assert.strictEqual(metrics.cargoCount, 1);
      assert.strictEqual(metrics.packageCount, 1);
      assert.strictEqual(metrics.legacyCount, 1);
    });

    it('handles empty items array gracefully', () => {
      const metrics = calculateOutboundMetrics([]);
      assert.strictEqual(metrics.totalCount, 0);
      assert.strictEqual(metrics.totalPieces, 0);
      assert.strictEqual(metrics.totalWeight, 0);
      assert.strictEqual(metrics.cargoCount, 0);
      assert.strictEqual(metrics.packageCount, 0);
      assert.strictEqual(metrics.legacyCount, 0);
    });
  });

  describe('formatOutboundTelemetry', () => {
    it('formats unfiltered telemetry with truthful metrics', () => {
      const res = formatOutboundTelemetry(12, 12, 150, 420.5, false);
      assert.strictEqual(res.arrivedText, '12 confirmed arrived');
      assert.strictEqual(res.piecesText, '150 pcs');
      assert.strictEqual(res.weightText, '420.5 kg');
    });

    it('formats filtered telemetry displaying active matching pieces and weight', () => {
      const res = formatOutboundTelemetry(3, 12, 45, 90, true);
      assert.strictEqual(res.arrivedText, '3 of 12 confirmed');
      assert.strictEqual(res.piecesText, '45 pcs');
      assert.strictEqual(res.weightText, '90 kg');
    });
  });

  describe('generateOutboundCsv', () => {
    it('generates standard RFC-compliant CSV with escaped fields', () => {
      const items: OutboundArrivalItem[] = [
        {
          key: 'c1',
          source: 'Cargo',
          entryRef: 'CRG-100',
          customerName: 'Dangote, Cement & Co',
          destinationLabel: 'Lagos -> Kano',
          pcs: 10,
          kg: 250,
          awb: 'AWB-123',
          airline: 'Air Peace',
          contentType: 'Cement "Heavy"',
          createdAt: '2026-11-18T10:00:00Z',
        },
      ];

      const csv = generateOutboundCsv(items);
      assert.ok(csv.startsWith('Entry Ref,Source,Customer / Consignee,Destination,Pieces,Weight (kg),AWB Tag,Airline,Content Type,Confirmed At'));
      assert.ok(csv.includes('"Dangote, Cement & Co"'));
      assert.ok(csv.includes('"Cement ""Heavy"""'));
      assert.ok(csv.includes('"CRG-100"'));
    });
  });

  describe('canAccessOutboundRole', () => {
    it('allows permitted logistics roles', () => {
      assert.strictEqual(canAccessOutboundRole('super_admin'), true);
      assert.strictEqual(canAccessOutboundRole('admin'), true);
      assert.strictEqual(canAccessOutboundRole('cargo_agent'), true);
      assert.strictEqual(canAccessOutboundRole('driver'), true);
      assert.strictEqual(canAccessOutboundRole('accountant'), true);
      assert.strictEqual(canAccessOutboundRole('auditor'), true);
      assert.strictEqual(canAccessOutboundRole('office_work'), true);
    });

    it('denies unknown or unauthorized roles', () => {
      assert.strictEqual(canAccessOutboundRole('guest'), false);
      assert.strictEqual(canAccessOutboundRole('anonymous'), false);
      assert.strictEqual(canAccessOutboundRole('customer'), false);
    });
  });
});
