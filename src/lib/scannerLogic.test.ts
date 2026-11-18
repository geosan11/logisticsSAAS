import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatScanModeLabel,
  getScanModeDescription,
  getScanModeSublabel,
  getScanActionLabel,
  parseScannedReference,
  formatScanResultBadge,
  calculateBatchMetrics,
  isDuplicateInBatch,
  formatScanTimestamp,
  canAccessScannerRole,
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

    test('returns unambiguous action button labels for each mode', () => {
      assert.strictEqual(getScanActionLabel('ARRIVE'), 'Log arrival');
      assert.strictEqual(getScanActionLabel('DEPART'), 'Log departure');
      assert.strictEqual(getScanActionLabel('DELIVER'), 'Log delivery');
      assert.strictEqual(getScanActionLabel('' as any), 'Record scan');
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
});
