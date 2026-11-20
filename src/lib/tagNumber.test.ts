import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TAG_PREFIX,
  TAG_PREFIX_REGEX,
  isValidTagPrefix,
  getTenantTagPrefix,
  setTenantTagPrefix,
  buildTagNumber,
  parseTagNumber,
  isValidTagNumber,
  isValidAirlineAwb,
  formatAirlineAwb,
  hasTenantIssuedTags,
} from './tagNumber';
import { db } from './db';

describe('Tag Number System & Tenant Prefix', () => {
  const initialPrefix = getTenantTagPrefix();

  afterEach(() => {
    setTenantTagPrefix(initialPrefix);
  });

  describe('Tag Prefix Validation (/^[A-Z]{3,5}$/)', () => {
    test('validates 3 to 5 uppercase ASCII letters', () => {
      assert.strictEqual(isValidTagPrefix('RED'), true);
      assert.strictEqual(isValidTagPrefix('HWY'), true);
      assert.strictEqual(isValidTagPrefix('HAUL'), true);
      assert.strictEqual(isValidTagPrefix('CARGO'), true);
      assert.strictEqual(isValidTagPrefix('AWA'), true);
    });

    test('rejects prefixes shorter than 3 letters or longer than 5 letters', () => {
      assert.strictEqual(isValidTagPrefix('HW'), false, '2 letters should fail');
      assert.strictEqual(isValidTagPrefix('A'), false, '1 letter should fail');
      assert.strictEqual(isValidTagPrefix('HAULWAY'), false, '7 letters should fail');
      assert.strictEqual(isValidTagPrefix('CARGOS'), false, '6 letters should fail');
    });

    test('rejects lowercase letters, numbers, spaces, and punctuation', () => {
      assert.strictEqual(isValidTagPrefix('red'), false);
      assert.strictEqual(isValidTagPrefix('Red'), false);
      assert.strictEqual(isValidTagPrefix('HW1'), false);
      assert.strictEqual(isValidTagPrefix('123'), false);
      assert.strictEqual(isValidTagPrefix('HW-Y'), false);
      assert.strictEqual(isValidTagPrefix('HW Y'), false);
      assert.strictEqual(isValidTagPrefix(''), false);
      assert.strictEqual(isValidTagPrefix(null as any), false);
      assert.strictEqual(isValidTagPrefix(undefined as any), false);
    });

    test('regex pattern matches specification exactly', () => {
      assert.strictEqual(TAG_PREFIX_REGEX.source, '^[A-Z]{3,5}$');
    });
  });

  describe('Tenant Tag Prefix Getter & Setter with Fallback', () => {
    test('defaults to neutral fallback HWY when unset', () => {
      setTenantTagPrefix(null);
      assert.strictEqual(getTenantTagPrefix(), 'HWY');
      assert.strictEqual(DEFAULT_TAG_PREFIX, 'HWY');
    });

    test('sets valid 3-5 uppercase letter prefix and converts lowercase automatically', () => {
      setTenantTagPrefix('RED');
      assert.strictEqual(getTenantTagPrefix(), 'RED');

      setTenantTagPrefix('haul');
      assert.strictEqual(getTenantTagPrefix(), 'HAUL');

      setTenantTagPrefix('fleet');
      assert.strictEqual(getTenantTagPrefix(), 'FLEET');
    });

    test('ignores invalid prefix values and keeps fallback', () => {
      setTenantTagPrefix(null);
      setTenantTagPrefix('TOOLONGPREFIX');
      assert.strictEqual(getTenantTagPrefix(), 'HWY');

      setTenantTagPrefix('12');
      assert.strictEqual(getTenantTagPrefix(), 'HWY');
    });
  });

  describe('buildTagNumber Builder Function', () => {
    test('builds PREFIX-STATE-CONTENT-NNNNNN format correctly', () => {
      setTenantTagPrefix('RED');
      const tag = buildTagNumber({
        hubCode: 'LOS',
        contentTypeCode: 'CG',
        sequence: 1234,
      });
      assert.strictEqual(tag, 'RED-LOS-CG-001234');
    });

    test('pads sequence numbers to 6 digits', () => {
      setTenantTagPrefix('HWY');
      assert.strictEqual(
        buildTagNumber({ hubCode: 'ABV', contentTypeCode: 'PKG', sequence: 5 }),
        'HWY-ABV-PKG-000005'
      );
      assert.strictEqual(
        buildTagNumber({ hubCode: 'KAN', contentTypeCode: 'CG', sequence: 999999 }),
        'HWY-KAN-CG-999999'
      );
    });

    test('accepts explicit prefix override', () => {
      const tag = buildTagNumber({
        prefix: 'AERO',
        hubCode: 'PHC',
        contentTypeCode: 'PKG',
        sequence: 42,
      });
      assert.strictEqual(tag, 'AERO-PHC-PKG-000042');
    });

    test('sanitizes input hubCode and contentTypeCode to uppercase', () => {
      setTenantTagPrefix('RED');
      const tag = buildTagNumber({
        hubCode: 'los',
        contentTypeCode: 'pkg',
        sequence: 77,
      });
      assert.strictEqual(tag, 'RED-LOS-PKG-000077');
    });
  });

  describe('Tag Number Parsing & Legacy EHI Backward Compatibility', () => {
    test('parses modern tag numbers with 3, 4, or 5 letter prefixes', () => {
      const p3 = parseTagNumber('RED-LOS-CG-001234');
      assert.deepStrictEqual(p3, {
        prefix: 'RED',
        hubCode: 'LOS',
        stream: 'CG',
        sequence: 1234,
        raw: 'RED-LOS-CG-001234',
        isLegacyEhi: false,
      });

      const p4 = parseTagNumber('HAUL-ABV-PKG-000042');
      assert.deepStrictEqual(p4, {
        prefix: 'HAUL',
        hubCode: 'ABV',
        stream: 'PKG',
        sequence: 42,
        raw: 'HAUL-ABV-PKG-000042',
        isLegacyEhi: false,
      });

      const p5 = parseTagNumber('FLEET-KAN-CG-000999');
      assert.deepStrictEqual(p5, {
        prefix: 'FLEET',
        hubCode: 'KAN',
        stream: 'CG',
        sequence: 999,
        raw: 'FLEET-KAN-CG-000999',
        isLegacyEhi: false,
      });
    });

    test('parses legacy EHI- numbers and flags them as isLegacyEhi', () => {
      const legacy = parseTagNumber('EHI-LOS-CG-001042');
      assert.deepStrictEqual(legacy, {
        prefix: 'EHI',
        hubCode: 'LOS',
        stream: 'CG',
        sequence: 1042,
        raw: 'EHI-LOS-CG-001042',
        isLegacyEhi: true,
      });
    });

    test('isValidTagNumber validates both legacy EHI and modern tenant tag numbers', () => {
      assert.strictEqual(isValidTagNumber('EHI-LOS-CG-001042'), true);
      assert.strictEqual(isValidTagNumber('EHI-ABV-PKG-000512'), true);
      assert.strictEqual(isValidTagNumber('HWY-LOS-CG-000100'), true);
      assert.strictEqual(isValidTagNumber('RED-LOS-CG-001234'), true);
      assert.strictEqual(isValidTagNumber('HAUL-ABV-PKG-000001'), true);

      // Invalid tag numbers
      assert.strictEqual(isValidTagNumber('INVALID'), false);
      assert.strictEqual(isValidTagNumber('HW-LOS-CG-000100'), false, '2-letter prefix should be invalid');
      assert.strictEqual(isValidTagNumber('HAULWAY-LOS-CG-000100'), false, '7-letter prefix should be invalid');
      assert.strictEqual(isValidTagNumber('RED-LOS-CG-1234'), false, '4-digit sequence should be invalid');
      assert.strictEqual(isValidTagNumber(''), false);
    });
  });

  describe('Airline AWB Validation & Formatting', () => {
    test('isValidAirlineAwb accepts standard IATA 11-digit airway bills', () => {
      // 3-digit airline prefix + 8-digit serial with dash
      assert.strictEqual(isValidAirlineAwb('072-12345678'), true);
      assert.strictEqual(isValidAirlineAwb('125-84920194'), true);
      // 11 continuous digits without dash
      assert.strictEqual(isValidAirlineAwb('07212345678'), true);
      assert.strictEqual(isValidAirlineAwb('  072-12345678  '), true, 'whitespace trimmed');
    });

    test('isValidAirlineAwb rejects invalid formats', () => {
      assert.strictEqual(isValidAirlineAwb('12-12345678'), false, '10 digits');
      assert.strictEqual(isValidAirlineAwb('1234-12345678'), false, '12 digits');
      assert.strictEqual(isValidAirlineAwb('072-1234567A'), false, 'non-digit character');
      assert.strictEqual(isValidAirlineAwb(''), false);
      assert.strictEqual(isValidAirlineAwb(null as any), false);
    });

    test('formatAirlineAwb formats 11 continuous digits to NNN-NNNNNNNN', () => {
      assert.strictEqual(formatAirlineAwb('07212345678'), '072-12345678');
      assert.strictEqual(formatAirlineAwb('072-12345678'), '072-12345678');
      assert.strictEqual(formatAirlineAwb('  12584920194  '), '125-84920194');
    });

    test('formatAirlineAwb returns original string if not 11 digits', () => {
      assert.strictEqual(formatAirlineAwb('INVALID'), 'INVALID');
    });
  });

  describe('Airline AWB Visibility Rules', () => {
    test('Airline AWB is for AIR cargo only', () => {
      // Cargo with air mode
      const airCargo = { type: 'cargo', mode: 'Air', airline: 'Air Peace' };
      const roadCargo = { type: 'cargo', mode: 'Road', airline: undefined };
      const packageEntry = { type: 'package', destination: 'Abuja' };

      const shouldShowAirlineAwb = (entry: { type: string; mode?: string }) => {
        return entry.type === 'cargo' && entry.mode !== 'Road';
      };

      assert.strictEqual(shouldShowAirlineAwb(airCargo), true);
      assert.strictEqual(shouldShowAirlineAwb(roadCargo), false);
      assert.strictEqual(shouldShowAirlineAwb(packageEntry), false);
    });
  });

  describe('Prefix Lock Logic (hasTenantIssuedTags)', () => {
    let originalCargoEntries: any;
    let originalPackageEntries: any;
    let mockCargoCount = 0;
    let mockPkgCount = 0;

    beforeEach(() => {
      originalCargoEntries = (db as any).cargo_entries;
      originalPackageEntries = (db as any).package_entries;
      mockCargoCount = 0;
      mockPkgCount = 0;

      (db as any).cargo_entries = {
        count: async () => mockCargoCount,
      };
      (db as any).package_entries = {
        count: async () => mockPkgCount,
      };
    });

    afterEach(() => {
      (db as any).cargo_entries = originalCargoEntries;
      (db as any).package_entries = originalPackageEntries;
    });

    test('returns false when no tags have been issued yet', async () => {
      mockCargoCount = 0;
      mockPkgCount = 0;
      const hasIssued = await hasTenantIssuedTags();
      assert.strictEqual(hasIssued, false);
    });

    test('returns true when cargo entries exist', async () => {
      mockCargoCount = 1;
      const hasIssued = await hasTenantIssuedTags();
      assert.strictEqual(hasIssued, true);
    });

    test('returns true when package entries exist', async () => {
      mockCargoCount = 0;
      mockPkgCount = 5;
      const hasIssued = await hasTenantIssuedTags();
      assert.strictEqual(hasIssued, true);
    });
  });
});
