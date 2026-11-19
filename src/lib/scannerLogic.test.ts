import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatScanModeLabel,
  getScanModeDescription,
  getScanModeSublabel,
  getScanActionLabel,
  getScannerDensityClasses,
  truncateConsignee,
  parseScannedReference,
  formatScanResultBadge,
  calculateBatchMetrics,
  isDuplicateInBatch,
  formatScanTimestamp,
  canAccessScannerRole,
  SCANNER_MANUAL_INPUT_PLACEHOLDER,
} from './scannerLogic';

describe('QR Scanner Logic & Formatting (Grok UI)', () => {
  describe('formatScanModeLabel & Descriptions', () => {
    test('returns clean sentence-case mode labels', () => {
      assert.strictEqual(formatScanModeLabel('ARRIVE'), 'Arrive');
      assert.strictEqual(formatScanModeLabel('DEPART'), 'Depart');
      assert.strictEqual(formatScanModeLabel('DELIVER'), 'Deliver');
    });

    test('returns operational descriptions for each mode', () => {
      assert.strictEqual(
        getScanModeDescription('ARRIVE'),
        'Scan cargo arriving at this hub'
      );
      assert.strictEqual(
        getScanModeDescription('DEPART'),
        'Scan cargo departing from this hub'
      );
      assert.strictEqual(
        getScanModeDescription('DELIVER'),
        'Capture proof of delivery for recipient'
      );
    });

    test('returns compact sublabels for mode pills', () => {
      assert.strictEqual(getScanModeSublabel('ARRIVE'), 'Cargo landed here');
      assert.strictEqual(getScanModeSublabel('DEPART'), 'Sending to carrier');
      assert.strictEqual(getScanModeSublabel('DELIVER'), 'Handover to consignee');
    });

    test('manual reference placeholder is bounded for 390px mobile viewports and preserves package', () => {
      assert.ok(SCANNER_MANUAL_INPUT_PLACEHOLDER.toLowerCase().includes('package'));
      assert.ok(SCANNER_MANUAL_INPUT_PLACEHOLDER.length <= 35);
    });

    test('returns unambiguous action button labels for each mode', () => {
      assert.strictEqual(getScanActionLabel('ARRIVE'), 'Log arrival');
      assert.strictEqual(getScanActionLabel('DEPART'), 'Log departure');
      assert.strictEqual(getScanActionLabel('DELIVER'), 'Log delivery');
      assert.strictEqual(getScanActionLabel('' as any), 'Record scan');
    });

    test('returns density-aware classes for compact and spacious modes', () => {
      const compact = getScannerDensityClasses(true);
      const spacious = getScannerDensityClasses(false);

      assert.ok(compact.workspace.includes('space-y-3'));
      assert.ok(spacious.workspace.includes('space-y-4'));
      assert.ok(compact.cameraCard.includes('min-h-[160px]'));
      assert.ok(spacious.cameraCard.includes('min-h-[190px]'));
      assert.ok(compact.modeButton.includes('py-1.5'));
      assert.ok(spacious.modeButton.includes('py-2'));
      assert.ok(compact.modeButton.includes('min-h-[56px]'));
      assert.ok(spacious.modeButton.includes('min-h-[58px]'));
      assert.ok(spacious.modeButton.includes('sm:min-h-[64px]'));
    });

    test('truncates consignee names cleanly when exceeding maxLen', () => {
      assert.strictEqual(truncateConsignee('Dangote Industries Ltd', 15), 'Dangote Indust…');
      assert.strictEqual(truncateConsignee('Short Name', 20), 'Short Name');
      assert.strictEqual(truncateConsignee(''), '');
      assert.strictEqual(truncateConsignee(null as any), '');
    });
  });

  describe('parseScannedReference', () => {
    test('extracts reference from plain string with trimming and uppercasing', () => {
      assert.strictEqual(parseScannedReference('  crg-1024  '), 'CRG-1024');
      assert.strictEqual(parseScannedReference('awb-los-5501'), 'AWB-LOS-5501');
    });

    test('extracts reference from URL path', () => {
      assert.strictEqual(
        parseScannedReference('https://app.haulwey.com/track/MK-260704-3Y0RQF'),
        'MK-260704-3Y0RQF'
      );
      assert.strictEqual(
        parseScannedReference('http://localhost:3456/cargo/CRG-9988'),
        'CRG-9988'
      );
      assert.strictEqual(
        parseScannedReference('https://track.ehi.ng/AWB-7712/'),
        'AWB-7712'
      );
    });

    test('extracts reference from JSON payload', () => {
      assert.strictEqual(
        parseScannedReference('{"ref":"CRG-8812","destination":"ABV"}'),
        'CRG-8812'
      );
      assert.strictEqual(
        parseScannedReference('{"id":"AWB-9021","pieces":3}'),
        'AWB-9021'
      );
      assert.strictEqual(
        parseScannedReference('{"awb":"TAG-4411"}'),
        'TAG-4411'
      );
    });

    test('handles empty or invalid inputs gracefully', () => {
      assert.strictEqual(parseScannedReference(''), '');
      assert.strictEqual(parseScannedReference('   '), '');
      assert.strictEqual(parseScannedReference(null as any), '');
      assert.strictEqual(parseScannedReference(undefined as any), '');
    });
  });

  describe('formatScanResultBadge', () => {
    test('maps successful scan results to appropriate status labels and tones', () => {
      assert.deepStrictEqual(formatScanResultBadge('SUCCESS_ARRIVE'), {
        label: 'Arrived',
        tone: 'success',
      });
      assert.deepStrictEqual(formatScanResultBadge('SUCCESS_DEPART'), {
        label: 'Departed',
        tone: 'info',
      });
      assert.deepStrictEqual(formatScanResultBadge('SUCCESS_DELIVER'), {
        label: 'Delivered',
        tone: 'success',
      });
    });

    test('maps error and alert scan results accurately', () => {
      assert.deepStrictEqual(formatScanResultBadge('WRONG_DESTINATION'), {
        label: 'Wrong station',
        tone: 'error',
      });
      assert.deepStrictEqual(formatScanResultBadge('ALREADY_PROCESSED'), {
        label: 'Already logged',
        tone: 'warning',
      });
      assert.deepStrictEqual(formatScanResultBadge('NOT_LOGGED_IN'), {
        label: 'Arrive first',
        tone: 'warning',
      });
      assert.deepStrictEqual(formatScanResultBadge('NOT_FOUND'), {
        label: 'Not found',
        tone: 'error',
      });
      assert.deepStrictEqual(formatScanResultBadge('ERROR'), {
        label: 'Scan error',
        tone: 'error',
      });
    });
  });

  describe('calculateBatchMetrics', () => {
    test('computes total, success, and alert metrics correctly', () => {
      const items = [
        { result: 'SUCCESS_ARRIVE' },
        { result: 'SUCCESS_DEPART' },
        { result: 'WRONG_DESTINATION' },
        { result: 'ALREADY_PROCESSED' },
        { result: 'NOT_FOUND' },
        { result: 'SUCCESS_DELIVER' },
      ];

      const metrics = calculateBatchMetrics(items);
      assert.strictEqual(metrics.total, 6);
      assert.strictEqual(metrics.successCount, 3);
      // Alerts: WRONG_DESTINATION and NOT_FOUND count as alerts; ALREADY_PROCESSED does not
      assert.strictEqual(metrics.alertCount, 2);
    });

    test('handles empty array', () => {
      const metrics = calculateBatchMetrics([]);
      assert.strictEqual(metrics.total, 0);
      assert.strictEqual(metrics.successCount, 0);
      assert.strictEqual(metrics.alertCount, 0);
    });
  });

  describe('isDuplicateInBatch', () => {
    test('detects duplicates for matching reference and mode', () => {
      const queue = [
        { ref: 'CRG-101', mode: 'ARRIVE' as const },
        { ref: 'CRG-102', mode: 'DEPART' as const },
      ];

      assert.strictEqual(isDuplicateInBatch(queue, 'CRG-101', 'ARRIVE'), true);
      assert.strictEqual(isDuplicateInBatch(queue, 'crg-101', 'ARRIVE'), true);
      assert.strictEqual(isDuplicateInBatch(queue, 'CRG-101', 'DEPART'), false);
      assert.strictEqual(isDuplicateInBatch(queue, 'CRG-103', 'ARRIVE'), false);
    });
  });

  describe('formatScanTimestamp', () => {
    test('formats valid date strings and timestamps', () => {
      const ts = formatScanTimestamp('2026-11-18T10:15:00Z');
      assert.ok(ts.length > 0);
      assert.ok(ts.includes('18'));
    });

    test('handles invalid date values gracefully', () => {
      assert.strictEqual(formatScanTimestamp('invalid-date'), '');
      assert.strictEqual(formatScanTimestamp(null as any), '');
    });
  });

  describe('canAccessScannerRole', () => {
    test('authorizes operational logistics roles', () => {
      assert.strictEqual(canAccessScannerRole('super_admin'), true);
      assert.strictEqual(canAccessScannerRole('admin'), true);
      assert.strictEqual(canAccessScannerRole('cargo_agent'), true);
      assert.strictEqual(canAccessScannerRole('baggage_agent'), true);
      assert.strictEqual(canAccessScannerRole('driver'), true);
      assert.strictEqual(canAccessScannerRole('accountant'), true);
      assert.strictEqual(canAccessScannerRole('auditor'), true);
      assert.strictEqual(canAccessScannerRole('office_work'), true);
    });

    test('rejects unauthorized or unknown roles', () => {
      assert.strictEqual(canAccessScannerRole('customer'), false);
      assert.strictEqual(canAccessScannerRole('guest'), false);
      assert.strictEqual(canAccessScannerRole(''), false);
    });
  });

  describe('QR Scanner Component Presentation & Focus (Depart / Arrive / Deliver)', async () => {
    // Dynamic import to support component rendering under node test runner
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const { Scanner } = await import('../components/views/Scanner');
    const { ConfirmProvider } = await import('./ConfirmContext');

    const mockUser = {
      id: 'test-user-id',
      name: 'Musa Ibrahim',
      role: 'cargo_agent',
      hub: 'LOS',
      hub_id: 'hub-los',
    };

    const renderScannerView = (initialMode: 'DEPART' | 'ARRIVE' | 'DELIVER' = 'DEPART') => {
      return renderToString(
        React.createElement(
          ConfirmProvider,
          null,
          React.createElement(Scanner, {
            user: mockUser as any,
            transactions: [],
            initialMode,
          })
        )
      );
    };

    test('renders screen header with title QR Scanner and active station', () => {
      const html = renderScannerView();
      assert.ok(html.includes('QR Scanner'), 'Must include screen title QR Scanner');
      assert.ok(html.includes('Active station:'), 'Must display active station label');
      assert.ok(html.includes('LOS'), 'Must display active hub name');
    });

    test('renders all three primary actions: Depart, Arrive and Deliver', () => {
      const html = renderScannerView();
      assert.ok(html.includes('data-mode="DEPART"'), 'Must render Depart action button');
      assert.ok(html.includes('data-mode="ARRIVE"'), 'Must render Arrive action button');
      assert.ok(html.includes('data-mode="DELIVER"'), 'Must render Deliver action button');
      assert.ok(html.includes('Depart'), 'Must render Depart text');
      assert.ok(html.includes('Arrive'), 'Must render Arrive text');
      assert.ok(html.includes('Deliver'), 'Must render Deliver text');
    });

    test('primary action buttons are prominent with minimum 56px height', () => {
      const html = renderScannerView();
      // All action buttons must contain touch-friendly min-h-[56px] or greater
      assert.ok(
        html.includes('min-h-[56px]') || html.includes('min-h-[58px]'),
        'Action buttons must have at least 56px height on CF-31 and phone'
      );
    });

    test('switches selected state cleanly when initialMode is DEPART', () => {
      const html = renderScannerView('DEPART');
      // DEPART must be selected
      assert.match(
        html,
        /data-mode="DEPART"[^>]*data-selected="true"/,
        'DEPART action must have selected state'
      );
      assert.match(
        html,
        /data-mode="ARRIVE"[^>]*data-selected="false"/,
        'ARRIVE action must be unselected'
      );
      assert.match(
        html,
        /data-mode="DELIVER"[^>]*data-selected="false"/,
        'DELIVER action must be unselected'
      );
      // Selected button has obvious stark high-contrast Grok monochrome style
      assert.ok(
        html.includes('bg-black text-white dark:bg-white dark:text-black'),
        'Selected button must have prominent monochrome selected styling'
      );
    });

    test('switches selected state cleanly when initialMode is ARRIVE', () => {
      const html = renderScannerView('ARRIVE');
      assert.match(
        html,
        /data-mode="ARRIVE"[^>]*data-selected="true"/,
        'ARRIVE action must have selected state'
      );
      assert.match(
        html,
        /data-mode="DEPART"[^>]*data-selected="false"/,
        'DEPART action must be unselected'
      );
      assert.match(
        html,
        /data-mode="DELIVER"[^>]*data-selected="false"/,
        'DELIVER action must be unselected'
      );
    });

    test('switches selected state cleanly when initialMode is DELIVER', () => {
      const html = renderScannerView('DELIVER');
      assert.match(
        html,
        /data-mode="DELIVER"[^>]*data-selected="true"/,
        'DELIVER action must have selected state'
      );
      assert.match(
        html,
        /data-mode="DEPART"[^>]*data-selected="false"/,
        'DEPART action must be unselected'
      );
      assert.match(
        html,
        /data-mode="ARRIVE"[^>]*data-selected="false"/,
        'ARRIVE action must be unselected'
      );
    });

    test('order-related UI is compact and secondary while preserving 44px tap targets', () => {
      const html = renderScannerView();
      // Recent scans card is secondary with compact heading and tap target
      assert.ok(html.includes('Recent scans'), 'Recent scans card is present');
      // Preservation of "Package" keyword
      assert.ok(html.toLowerCase().includes('package'), 'Must preserve the word Package');
      // Direct log and batch queue controls keep 44px tap targets
      assert.ok(html.includes('min-h-[44px]'), 'Must maintain at least 44px tap targets');
    });
  });
});
