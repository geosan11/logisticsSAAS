import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getTenantTagPrefix,
  setTenantTagPrefix,
  parseTagNumber,
  isValidTagNumber,
} from './tagPool';

describe('Haulwey Rebranding Verification', () => {
  const originalPrefix = getTenantTagPrefix();

  afterEach(() => {
    setTenantTagPrefix(originalPrefix);
  });

  describe('Tag Prefix Configuration & Fallback', () => {
    test('defaults to HWY fallback when no tenant tag prefix is configured', () => {
      setTenantTagPrefix(null);
      assert.strictEqual(getTenantTagPrefix(), 'HWY');
    });

    test('accepts tenant custom override prefix and sanitizes input', () => {
      setTenantTagPrefix('EXP');
      assert.strictEqual(getTenantTagPrefix(), 'EXP');

      setTenantTagPrefix('haul');
      assert.strictEqual(getTenantTagPrefix(), 'HAUL');

      // Revert back
      setTenantTagPrefix(null);
      assert.strictEqual(getTenantTagPrefix(), 'HWY');
    });
  });

  describe('Legacy EHI- Numbers Backward Compatibility', () => {
    test('validates both legacy EHI numbers and new HWY/tenant numbers', () => {
      assert.strictEqual(isValidTagNumber('EHI-LOS-CG-001042'), true);
      assert.strictEqual(isValidTagNumber('EHI-ABV-PKG-000512'), true);
      assert.strictEqual(isValidTagNumber('HWY-LOS-PKG-000101'), true);
      assert.strictEqual(isValidTagNumber('HWY-KAN-CG-009999'), true);
      assert.strictEqual(isValidTagNumber('EXP-LOS-PKG-000001'), true);

      // Invalid formats
      assert.strictEqual(isValidTagNumber('INVALID'), false);
      assert.strictEqual(isValidTagNumber(''), false);
    });

    test('parses legacy EHI- and new HWY- tag numbers into structured segments', () => {
      const legacy = parseTagNumber('EHI-LOS-CG-001042');
      assert.deepStrictEqual(legacy, {
        prefix: 'EHI',
        hubCode: 'LOS',
        stream: 'CG',
        sequence: 1042,
        raw: 'EHI-LOS-CG-001042',
        isLegacyEhi: true,
      });

      const modern = parseTagNumber('HWY-ABV-PKG-000512');
      assert.deepStrictEqual(modern, {
        prefix: 'HWY',
        hubCode: 'ABV',
        stream: 'PKG',
        sequence: 512,
        raw: 'HWY-ABV-PKG-000512',
        isLegacyEhi: false,
      });

      const custom = parseTagNumber('EXP-PHC-MK-000088');
      assert.deepStrictEqual(custom, {
        prefix: 'EXP',
        hubCode: 'PHC',
        stream: 'MK',
        sequence: 88,
        raw: 'EXP-PHC-MK-000088',
        isLegacyEhi: false,
      });

      assert.strictEqual(parseTagNumber('NOT-A-TAG'), null);
    });
  });

  describe('PWA Manifest & App Identity', () => {
    test('vite.config.ts configures PWA manifest name and short_name as Haulwey', () => {
      const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');
      const content = fs.readFileSync(viteConfigPath, 'utf8');

      // Check name and short_name
      assert.match(content, /name:\s*['"]Haulwey['"]/);
      assert.match(content, /short_name:\s*['"]Haulwey['"]/);
    });

    test('index.html contains Haulwey title and metadata', () => {
      const indexPath = path.resolve(process.cwd(), 'index.html');
      const content = fs.readFileSync(indexPath, 'utf8');

      assert.ok(content.includes('<title>Haulwey | Logistics OS</title>'));
      assert.ok(content.includes('content="Haulwey"'));
    });
  });

  describe('Zero User-Visible "EHI Multisystems" in src/', () => {
    test('no user-visible "EHI Multisystems" phrases remain in src/', () => {
      const srcDir = path.resolve(process.cwd(), 'src');
      const forbiddenPhrases = [
        'EHI Multisystems',
        'EHI MULTISYSTEMS',
        'MULTISYSTEMS',
        'EHI Logistics',
      ];

      function scanDir(dir: string): { file: string; line: number; text: string }[] {
        const violations: { file: string; line: number; text: string }[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            violations.push(...scanDir(fullPath));
          } else if (
            entry.isFile() &&
            (entry.name.endsWith('.ts') ||
              entry.name.endsWith('.tsx') ||
              entry.name.endsWith('.html') ||
              entry.name.endsWith('.css'))
          ) {
            // Exclude this test file itself from forbidden phrases check
            if (entry.name === 'rebrand.test.ts') continue;

            const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
            lines.forEach((lineText, idx) => {
              for (const phrase of forbiddenPhrases) {
                if (lineText.includes(phrase)) {
                  violations.push({
                    file: fullPath,
                    line: idx + 1,
                    text: lineText.trim(),
                  });
                }
              }
            });
          }
        }
        return violations;
      }

      const violations = scanDir(srcDir);
      assert.deepStrictEqual(
        violations,
        [],
        `Found forbidden user-facing legacy brand phrases:\n${violations.map(v => `${v.file}:${v.line} -> ${v.text}`).join('\n')}`
      );
    });
  });
});
