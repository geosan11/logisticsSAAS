import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTagNumber, parseTagNumber, getTenantTagPrefix, setTenantTagPrefix } from './tagNumber';
import { DEMO_PROFILES, seedDemoDataIfEmpty } from './auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Print Buttons Simplification & Tag State Code Tests', () => {
  describe('TASK A: Simplified Print Actions in UI', () => {
    const srcDir = path.resolve(__dirname, '..');
    const transactionLedgerSource = fs.readFileSync(path.join(srcDir, 'components', 'views', 'TransactionLedger.tsx'), 'utf-8');
    const cargoFormSource = fs.readFileSync(path.join(srcDir, 'components', 'views', 'CargoForm.tsx'), 'utf-8');
    const packageFormSource = fs.readFileSync(path.join(srcDir, 'components', 'views', 'PackageForm.tsx'), 'utf-8');

    test('TransactionLedger detail sheet shows ONLY "80mm receipt" and "USB tag print"', () => {
      // Must contain 80mm receipt and USB tag print
      assert.ok(transactionLedgerSource.includes('80mm receipt'), 'TransactionLedger must have "80mm receipt" button');
      assert.ok(transactionLedgerSource.includes('USB tag print'), 'TransactionLedger must have "USB tag print" button');

      // Must NOT contain removed button labels
      assert.ok(!transactionLedgerSource.includes('Receipt (58)'), 'TransactionLedger must not contain "Receipt (58)"');
      assert.ok(!transactionLedgerSource.includes('Receipt (80)'), 'TransactionLedger must not contain old "Receipt (80)"');
      assert.ok(!transactionLedgerSource.includes('PDF receipt'), 'TransactionLedger must not contain "PDF receipt"');
      assert.ok(!transactionLedgerSource.includes('Tag PDF'), 'TransactionLedger must not contain "Tag PDF"');
      assert.ok(!transactionLedgerSource.includes('Print tag'), 'TransactionLedger must not contain old "Print tag"');
    });

    test('CargoForm shows ONLY "80mm receipt" and "USB tag print"', () => {
      assert.ok(cargoFormSource.includes('80mm receipt'), 'CargoForm must have "80mm receipt"');
      assert.ok(cargoFormSource.includes('USB tag print'), 'CargoForm must have "USB tag print"');

      // Removed labels
      assert.ok(!cargoFormSource.includes('POS print (58mm)'), 'CargoForm must not contain "POS print (58mm)"');
      assert.ok(!cargoFormSource.includes('POS print (80mm)'), 'CargoForm must not contain old "POS print (80mm)"');
      assert.ok(!cargoFormSource.includes('POS print all (58mm)'), 'CargoForm must not contain "POS print all (58mm)"');
      assert.ok(!cargoFormSource.includes('POS print all (80mm)'), 'CargoForm must not contain old "POS print all (80mm)"');
      assert.ok(!cargoFormSource.includes('PDF receipt'), 'CargoForm must not contain "PDF receipt"');
      assert.ok(!cargoFormSource.includes('All PDF receipts'), 'CargoForm must not contain "All PDF receipts"');
      assert.ok(!cargoFormSource.includes('Tag PDF'), 'CargoForm must not contain "Tag PDF"');
    });

    test('PackageForm shows ONLY "80mm receipt" and "USB tag print"', () => {
      assert.ok(packageFormSource.includes('80mm receipt'), 'PackageForm must have "80mm receipt"');
      assert.ok(packageFormSource.includes('USB tag print'), 'PackageForm must have "USB tag print"');

      // Removed labels
      assert.ok(!packageFormSource.includes('POS (58mm)'), 'PackageForm must not contain "POS (58mm)"');
      assert.ok(!packageFormSource.includes('POS (80mm)'), 'PackageForm must not contain old "POS (80mm)"');
      assert.ok(!packageFormSource.includes('Receipt PDF'), 'PackageForm must not contain "Receipt PDF"');
      assert.ok(!packageFormSource.includes('Tag PDF'), 'PackageForm must not contain "Tag PDF"');
    });

    test('Each button is paired with the required icon (Receipt icon for 80mm receipt, Tag icon for USB tag print)', () => {
      // TransactionLedger uses Receipt and Tag
      assert.ok(transactionLedgerSource.includes('<Receipt'), 'TransactionLedger must render <Receipt icon');
      assert.ok(transactionLedgerSource.includes('<Tag'), 'TransactionLedger must render <Tag icon');

      // CargoForm uses Receipt and Tag
      assert.ok(cargoFormSource.includes('<Receipt'), 'CargoForm must render <Receipt icon');
      assert.ok(cargoFormSource.includes('<Tag'), 'CargoForm must render <Tag icon');

      // PackageForm uses Receipt and Tag
      assert.ok(packageFormSource.includes('<Receipt'), 'PackageForm must render <Receipt icon');
      assert.ok(packageFormSource.includes('<Tag'), 'PackageForm must render <Tag icon');
    });

    test('src/lib/escposPackagePrinting.ts contains NO "EHI" anywhere', () => {
      const escposPkgSource = fs.readFileSync(path.join(srcDir, 'lib', 'escposPackagePrinting.ts'), 'utf-8');
      assert.ok(!escposPkgSource.includes('EHI'), 'escposPackagePrinting.ts must not have any EHI reference');
    });
  });

  describe('TASK B: Tag STATE Code from Origin Hub/State Rule', () => {
    const origPrefix = getTenantTagPrefix();

    beforeEach(() => {
      setTenantTagPrefix('HWY');
    });

    afterEach(() => {
      setTenantTagPrefix(origPrefix);
    });

    test('buildTagNumber takes STATE from origin hubCode parameter, not hardcoded LOS', () => {
      const abvPkgTag = buildTagNumber({ hubCode: 'ABV', sequence: 512, contentTypeCode: 'PKG' });
      assert.strictEqual(abvPkgTag, 'HWY-ABV-PKG-000512');

      const losPkgTag = buildTagNumber({ hubCode: 'LOS', sequence: 512, contentTypeCode: 'PKG' });
      assert.strictEqual(losPkgTag, 'HWY-LOS-PKG-000512');

      const kanCargoTag = buildTagNumber({ hubCode: 'KAN', sequence: 1042, contentCode: 'CG' });
      assert.strictEqual(kanCargoTag, 'HWY-KAN-CG-001042');

      const phcPkgTag = buildTagNumber({ hubCode: 'PHC', sequence: 99, contentTypeCode: 'PKG' });
      assert.strictEqual(phcPkgTag, 'HWY-PHC-PKG-000099');
    });

    test('parseTagNumber accurately extracts the state/hub code', () => {
      const parsed = parseTagNumber('HWY-ABV-PKG-000512');
      assert.ok(parsed !== null);
      assert.strictEqual(parsed?.prefix, 'HWY');
      assert.strictEqual(parsed?.hubCode, 'ABV');
      assert.strictEqual(parsed?.stream, 'PKG');
      assert.strictEqual(parsed?.sequence, 512);
    });

    test('seedDemoDataIfEmpty seeds tag matching the user origin hub (ABV for Road demo profile)', () => {
      const mockStorage: Record<string, string> = {};
      const origLocalStorage = globalThis.localStorage;

      globalThis.localStorage = {
        getItem: (k: string) => mockStorage[k] || null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
        clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
        length: 0,
        key: () => null,
      } as any;

      try {
        const roadUser = DEMO_PROFILES.road;
        assert.strictEqual(roadUser.hub_code, 'ABV');

        seedDemoDataIfEmpty(roadUser);

        const txKey = `ehi_recent_tx_v1_${roadUser.id}`;
        const stored = mockStorage[txKey];
        assert.ok(stored, 'Demo transactions should be seeded in localStorage');

        const txs = JSON.parse(stored);
        const pkgTx = txs.find((t: any) => t.type === 'package');
        assert.ok(pkgTx, 'Package transaction must be present in seeded demo data');

        // State code MUST be ABV matching roadUser.hub_code, NOT LOS
        assert.strictEqual(pkgTx.id, 'HWY-ABV-PKG-000512', 'Package from ABV must have HWY-ABV-PKG-000512');
        assert.strictEqual(pkgTx.hub, 'Abuja Hub');

        // Check that admin user in Lagos gets LOS
        const adminUser = DEMO_PROFILES.admin;
        seedDemoDataIfEmpty(adminUser);
        const adminTxs = JSON.parse(mockStorage[`ehi_recent_tx_v1_${adminUser.id}`]);
        const adminPkgTx = adminTxs.find((t: any) => t.type === 'package');
        assert.strictEqual(adminPkgTx.id, 'HWY-LOS-PKG-000512', 'Package from LOS must have HWY-LOS-PKG-000512');
      } finally {
        globalThis.localStorage = origLocalStorage;
      }
    });
  });
});
