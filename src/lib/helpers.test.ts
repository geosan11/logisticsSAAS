import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmt,
  roundMoney,
  cleanRoute,
  getHubCode,
  getCityName,
  txDisplayDateTime,
  formatPaymentModeDisplay,
  parseLocalDateBoundary,
  lagosBusinessDate,
  rowsEqualById,
  sanitizeSpreadsheetCell,
  sanitizeSpreadsheetRows,
  sanitizeSpreadsheetAoA,
  generatePaymentNarration,
  extractNarrationFromText,
} from './helpers';

describe('Money & Formatting Helpers', () => {
  describe('fmt (currency formatting)', () => {
    test('formats positive numbers with commas and decimals', () => {
      assert.strictEqual(fmt(1234567.89), '1,234,567.89');
      assert.strictEqual(fmt(5000), '5,000');
      assert.strictEqual(fmt(150.5), '150.5');
    });

    test('formats zero correctly', () => {
      assert.strictEqual(fmt(0), '0');
    });

    test('formats negative numbers properly', () => {
      assert.strictEqual(fmt(-45000), '-45,000');
      assert.strictEqual(fmt(-1250.75), '-1,250.75');
    });
  });

  describe('roundMoney', () => {
    test('rounds floats to 2 decimal places to avoid compounding IEEE-754 drift', () => {
      assert.strictEqual(roundMoney(8300 * (1 - 7 / 100)), 7719);
      assert.strictEqual(roundMoney(10.555), 10.56);
      assert.strictEqual(roundMoney(10.554), 10.55);
      assert.strictEqual(roundMoney(0), 0);
    });
  });

  describe('formatPaymentModeDisplay', () => {
    test('returns plain mode when no wallet deduction was applied', () => {
      assert.strictEqual(formatPaymentModeDisplay('Cash', undefined, 5000), 'Cash');
      assert.strictEqual(formatPaymentModeDisplay('Transfer', 0, 10000), 'Transfer');
      assert.strictEqual(formatPaymentModeDisplay('Wallet', 5000, 5000), 'Wallet');
    });

    test('returns combined mode with breakdown when wallet was partially used', () => {
      const display = formatPaymentModeDisplay('POS', 3000, 10000);
      assert.ok(display.includes('POS + Wallet'), 'must mention both methods');
      assert.ok(display.includes('₦7,000 POS'), 'must show POS remainder');
      assert.ok(display.includes('₦3,000 Wallet'), 'must show wallet deduction');
    });
  });

  describe('cleanRoute', () => {
    test('removes Air Cargo Station suffixes and standardizes casing', () => {
      assert.strictEqual(cleanRoute('Lagos Air Cargo Station'), 'LAGOS');
      assert.strictEqual(cleanRoute('Abuja Cargo Station'), 'ABUJA');
      assert.strictEqual(cleanRoute('Kano air cargo station'), 'KANO');
      assert.strictEqual(cleanRoute('Port Harcourt'), 'PORT HARCOURT');
    });

    test('handles empty or missing route safely', () => {
      assert.strictEqual(cleanRoute(null), '—');
      assert.strictEqual(cleanRoute(undefined), '—');
      assert.strictEqual(cleanRoute(''), '—');
    });
  });

  describe('getHubCode & getCityName', () => {
    test('returns standard 3-letter IATA hub codes for known hubs', () => {
      assert.strictEqual(getHubCode('Murtala Air Cargo Station (LOS)'), 'LOS');
      assert.strictEqual(getHubCode('Abuja Cargo Station'), 'ABV');
      assert.strictEqual(getHubCode('Kano Hub'), 'KAN');
      assert.strictEqual(getHubCode('Enugu'), 'ENU');
      assert.strictEqual(getHubCode('Port Harcourt Station'), 'PHC');
    });

    test('derives fallback 3-letter code for unknown hub names', () => {
      assert.strictEqual(getHubCode('Calabar Depot'), 'CBQ'); // known route in CARGO_ROUTES
      assert.strictEqual(getHubCode('Zungeru Outpost'), 'ZUN'); // unknown: derived from name
      assert.strictEqual(getHubCode(null), 'XXX');
      assert.strictEqual(getHubCode(''), 'XXX');
    });

    test('getCityName extracts city portion', () => {
      assert.strictEqual(getCityName('LOS/Lagos'), 'Lagos');
      assert.strictEqual(getCityName('ABV/Abuja'), 'Abuja');
      assert.strictEqual(getCityName('Direct City'), 'Direct City');
      assert.strictEqual(getCityName(null), 'UNKNOWN');
    });
  });

  describe('parseLocalDateBoundary & lagosBusinessDate', () => {
    test('parses date string to local midnight and local end-of-day', () => {
      const start = parseLocalDateBoundary('2026-11-16', false);
      const end = parseLocalDateBoundary('2026-11-16', true);

      assert.strictEqual(start.getHours(), 0);
      assert.strictEqual(start.getMinutes(), 0);
      assert.strictEqual(start.getSeconds(), 0);

      assert.strictEqual(end.getHours(), 23);
      assert.strictEqual(end.getMinutes(), 59);
      assert.strictEqual(end.getSeconds(), 59);
    });

    test('lagosBusinessDate returns YYYY-MM-DD in Africa/Lagos timezone', () => {
      const fixedUtcDate = new Date('2026-11-16T23:30:00Z'); // 00:30 on Nov 17 in Lagos (UTC+1)
      const bDate = lagosBusinessDate(fixedUtcDate);
      assert.strictEqual(bDate, '2026-11-17', 'Must recognize midnight crossover into next Lagos day');
    });
  });

  describe('txDisplayDateTime', () => {
    test('formats valid ISO created_at and time string', () => {
      const display = txDisplayDateTime('2026-11-16T10:30:00Z', '11:30');
      assert.ok(display.includes('11:30'), 'must contain time');
      assert.ok(display.includes('/'), 'must contain date slashes in en-GB format');
    });

    test('falls back gracefully on invalid or missing date', () => {
      const display = txDisplayDateTime(undefined, '14:00');
      assert.ok(display.includes('14:00'));
    });
  });

  describe('rowsEqualById', () => {
    test('returns true for identically content-matched rows', () => {
      const listA = [{ id: '1', amount: 100 }, { id: '2', amount: 200 }];
      const listB = [{ id: '1', amount: 100 }, { id: '2', amount: 200 }];
      assert.strictEqual(rowsEqualById(listA, listB), true);
    });

    test('returns true even if rows are in different order', () => {
      const listA = [{ id: '1', amount: 100 }, { id: '2', amount: 200 }];
      const listB = [{ id: '2', amount: 200 }, { id: '1', amount: 100 }];
      assert.strictEqual(rowsEqualById(listA, listB), true);
    });

    test('returns false when content changes or lengths differ', () => {
      const listA = [{ id: '1', amount: 100 }];
      const listB = [{ id: '1', amount: 105 }];
      assert.strictEqual(rowsEqualById(listA, listB), false);

      const listC = [{ id: '1', amount: 100 }, { id: '2', amount: 200 }];
      assert.strictEqual(rowsEqualById(listA, listC), false);
    });
  });

  describe('Spreadsheet Formula Injection Sanitization', () => {
    test('neutralizes leading =, +, -, @ formula triggers with leading apostrophe', () => {
      assert.strictEqual(sanitizeSpreadsheetCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
      assert.strictEqual(sanitizeSpreadsheetCell('+cmd|/c calc'), "'+cmd|/c calc");
      assert.strictEqual(sanitizeSpreadsheetCell('-100+20'), "'-100+20");
      assert.strictEqual(sanitizeSpreadsheetCell('@evil.com'), "'@evil.com");
    });

    test('leaves safe strings, numbers, and null untouched', () => {
      assert.strictEqual(sanitizeSpreadsheetCell('Normal Name'), 'Normal Name');
      assert.strictEqual(sanitizeSpreadsheetCell(12345), 12345);
      assert.strictEqual(sanitizeSpreadsheetCell(null), null);
    });

    test('sanitizeSpreadsheetRows sanitizes entire object collections', () => {
      const rows = [
        { name: '=DDE("server")', amount: 500 },
        { name: 'John Doe', amount: 250 },
      ];
      const sanitized = sanitizeSpreadsheetRows(rows);
      assert.strictEqual(sanitized[0].name, "'=DDE(\"server\")");
      assert.strictEqual(sanitized[0].amount, 500);
      assert.strictEqual(sanitized[1].name, 'John Doe');
    });

    test('sanitizeSpreadsheetAoA sanitizes 2D arrays', () => {
      const aoa = [
        ['Customer', 'Amount'],
        ['=HYPERLINK("http://bad.site")', 1000],
      ];
      const sanitized = sanitizeSpreadsheetAoA(aoa);
      assert.strictEqual(sanitized[1][0], "'=HYPERLINK(\"http://bad.site\")");
      assert.strictEqual(sanitized[1][1], 1000);
    });
  });

  describe('generatePaymentNarration & extractNarrationFromText', () => {
    test('generates expected narration code format: EHI-[HUB]-[YYMMDD]-[SERIAL]', () => {
      const narration = generatePaymentNarration('Lagos Air Cargo Station', 42);
      assert.match(narration, /^EHI-LOS-\d{6}-0042$/);
    });

    test('extractNarrationFromText parses code out of unstructured SMS alert text', () => {
      const sms = 'Credit alert of NGN 50,000 ref: EHI-LOS-261116-0042 from Access Bank';
      const extracted = extractNarrationFromText(sms);
      assert.strictEqual(extracted, 'EHI-LOS-261116-0042');
    });
  });
});
