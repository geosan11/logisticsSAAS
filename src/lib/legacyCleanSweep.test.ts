import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDepartmentRows, RawDepartmentStream } from './departmentBreakdown';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Legacy Clean Sweep Verification Protocol', () => {
  describe('1. Codebase Scan: Zero User-Visible Forbidden Terms in .tsx and Export/Report Labels', () => {
    const FORBIDDEN_REGEX = /(?:Marketing|Field Marketing|Mktg|Excess Baggage|Baggage|ValueJet|Passengers)/;

    // Helper to recursively collect files
    function getFiles(dir: string, extension: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFiles(fullPath, extension));
        } else if (file.endsWith(extension)) {
          results.push(fullPath);
        }
      });
      return results;
    }

    test('All .tsx files have zero user-visible forbidden strings in JSX/rendered text', () => {
      const srcDir = path.resolve(__dirname, '..');
      const tsxFiles = getFiles(srcDir, '.tsx');

      const violations: { file: string; line: number; text: string }[] = [];

      // Allowed patterns: code comments, internal DB table names, type declarations, internal props/keys
      const ALLOWED_LINE_PATTERNS = [
        /^\s*\/\//, // single line comments
        /^\s*\*/, // multi line comments
        /\/\*[\s\S]*?\*\//, // inline comments
        /table:\s*['"](?:manifests|marketing_entries)['"]/,
        /from\(['"](?:manifests|marketing_entries)['"]\)/,
        /table_name\s*===?\s*['"](?:manifests|marketing_entries)['"]/,
        /['"](?:marketing_entries|manifests)['"]/,
        /type:\s*['"](?:baggage|marketing)['"]/,
        /viewingDetail\.type === ['"](?:marketing|baggage)['"]/,
        /editingTx\.type === ['"](?:marketing|baggage)['"]/,
        /e\.type === ['"](?:marketing|baggage)['"]/,
        /r\.type === ['"](?:marketing|baggage)['"]/,
        /t\.type === ['"](?:marketing|baggage)['"]/,
        /tx\.type === ['"](?:marketing|baggage)['"]/,
        /sourceTxType === ['"](?:marketing|baggage)['"]/,
        /deptType === ['"](?:marketing|baggage)['"]/,
        /defaultTypeFilter === ['"](?:marketing|baggage)['"]/,
        /defaultTypeFilter\?:\s*['"]/,
        /id="edit-tx-(?:marketing|baggage)/,
        /name="edit-tx-(?:marketing|baggage)/,
        /baggage_agent|marketing_agent/,
        /baggageRes|mktRes/,
        /baggageRows|mktRows/,
        /ExcessBaggageAirline/,
        /downloadBaggageLedgerPDF/,
        /BaggageLedgerReportData/,
        /BaggageLedgerPDF/,
        /isWideAirline/,
        /passenger_name|passenger_phone/,
        /r\.passenger_name|tx\.passenger_name/,
        /name:\s*string;\s*\/\/\s*Consignee \/ Passenger name/,
      ];

      for (const file of tsxFiles) {
        // Skip test files if any
        if (file.endsWith('.test.tsx')) continue;

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((lineText, idx) => {
          if (FORBIDDEN_REGEX.test(lineText)) {
            const isAllowed = ALLOWED_LINE_PATTERNS.some((p) => p.test(lineText));
            if (!isAllowed) {
              violations.push({
                file: path.relative(srcDir, file),
                line: idx + 1,
                text: lineText.trim(),
              });
            }
          }
        });
      }

      assert.deepStrictEqual(
        violations,
        [],
        `Found user-visible forbidden terms:\n${violations.map((v) => `  ${v.file}:${v.line} -> ${v.text}`).join('\n')}`
      );
    });

    test('Export and report labels in src/lib have zero forbidden terms', () => {
      const filesToCheck = [
        path.resolve(__dirname, 'excelExport.ts'),
        path.resolve(__dirname, 'departmentBreakdown.ts'),
      ];

      for (const file of filesToCheck) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((lineText, idx) => {
          // Check for forbidden labels in object maps or string exports
          if (/label:\s*['"](?:Marketing|Baggage|ValueJet)['"]/i.test(lineText) ||
              /name:\s*['"](?:Marketing|Baggage|ValueJet)['"]/i.test(lineText)) {
            assert.fail(`Forbidden label at ${path.basename(file)}:${idx + 1} -> ${lineText.trim()}`);
          }
        });
      }
    });
  });

  describe('2. Forecasting View: No Hardcoded Sample Data', () => {
    test('Forecasting.tsx contains no hardcoded historical series data or fake sample numbers', () => {
      const forecastingPath = path.resolve(__dirname, '../components/views/Forecasting.tsx');
      const content = fs.readFileSync(forecastingPath, 'utf-8');

      // Check for previously hardcoded numbers and structures
      assert.ok(!content.includes('Cargo: 320000'), 'Must not contain hardcoded Cargo sample data');
      assert.ok(!content.includes('Marketing: 140000'), 'Must not contain hardcoded Marketing sample data');
      assert.ok(!content.includes('ExcessBaggage: 95000'), 'Must not contain hardcoded ExcessBaggage sample data');
      assert.ok(!content.includes('Cargo: 480000'), 'Must not contain hardcoded sample data series');
      assert.ok(!content.includes('SAMPLE_FORECAST'), 'Must not declare sample forecast constants');
      assert.ok(!content.includes('SAMPLE_HISTORICAL'), 'Must not declare sample historical data');

      // Verify that initial state starts empty and renders empty state
      assert.ok(content.includes('useState<ForecastDay[]>([])'), 'Must initialize forecast data as empty array');
      assert.ok(content.includes('No Historical Data Recorded'), 'Must provide empty state UI when data is empty');
    });
  });

  describe('3. Legacy Stream Grouping & Financial Integrity', () => {
    test('Legacy grouping hides Legacy row when count is zero in the period', () => {
      const streams: RawDepartmentStream[] = [
        { key: 'cargo', amount: 250000, count: 10, kg: 500 },
        { key: 'package', amount: 45000, count: 5, kg: 20 },
        { key: 'baggage', amount: 0, count: 0, kg: 0 },
        { key: 'marketing', amount: 0, count: 0, kg: 0 },
      ];

      const { rows, grandTotal } = buildDepartmentRows(streams);

      // Verify Legacy stream is completely absent when 0
      const legacyRow = rows.find((r) => r.key === 'legacy' || r.name === 'Legacy');
      assert.strictEqual(legacyRow, undefined, 'Legacy row must be hidden when period total is zero');

      // Verify grand totals are preserved
      assert.strictEqual(grandTotal, 295000);
      assert.strictEqual(rows.length, 2);
    });

    test('Legacy grouping presents old marketing and baggage under ONE neutral "Legacy" label when non-zero', () => {
      const streams: RawDepartmentStream[] = [
        { key: 'cargo', amount: 300000, count: 8, kg: 400 },
        { key: 'baggage', amount: 60000, count: 3, kg: 50 },
        { key: 'marketing', amount: 40000, count: 2, kg: 30 },
      ];

      const { rows, grandTotal } = buildDepartmentRows(streams);

      // Verify no separate baggage or marketing rows
      assert.strictEqual(rows.some((r) => r.key === 'baggage'), false);
      assert.strictEqual(rows.some((r) => r.key === 'marketing'), false);

      // Verify single Legacy row
      const legacyRows = rows.filter((r) => r.key === 'legacy');
      assert.strictEqual(legacyRows.length, 1, 'Must have exactly one Legacy row');

      const legacy = legacyRows[0];
      assert.strictEqual(legacy.name, 'Legacy');
      assert.strictEqual(legacy.count, 5); // 3 + 2
      assert.strictEqual(legacy.amount, 100000); // 60,000 + 40,000
      assert.strictEqual(legacy.kg, 80); // 50 + 30
      assert.strictEqual(legacy.isLegacy, true);

      // Verify grand total equals exact sum (no money lost)
      assert.strictEqual(grandTotal, 400000);
    });
  });
});
