import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  formatLedgerTitle,
  formatEntryTypeLabel,
  formatLedgerAmount,
  formatWeightKg,
  shortenDestination,
  stripBadgedFieldsFromDetail,
  formatPaymentModeBadge,
  summarisePaymentHistory,
  canAccessLedger,
  getDensityClasses,
} from './ledgerLogic';

describe('Transaction Ledger Logic & Formatting (Grok UI)', () => {
  describe('formatLedgerTitle', () => {
    test('returns clean sentence-case titles for different ledger modes', () => {
      assert.strictEqual(formatLedgerTitle('cargo'), 'Cargo ledger');
      assert.strictEqual(formatLedgerTitle('package'), 'Package ledger');
      assert.strictEqual(formatLedgerTitle('legacy'), 'Legacy ledger');
      assert.strictEqual(formatLedgerTitle('baggage'), 'Legacy ledger');
      assert.strictEqual(formatLedgerTitle('marketing'), 'Legacy ledger');
      assert.strictEqual(formatLedgerTitle(null), 'Master ledger');
      assert.strictEqual(formatLedgerTitle(undefined), 'Master ledger');
    });
  });

  describe('formatEntryTypeLabel', () => {
    test('formats entry types into clean sentence case', () => {
      assert.strictEqual(formatEntryTypeLabel('cargo'), 'Cargo');
      assert.strictEqual(formatEntryTypeLabel('package'), 'Package');
      assert.strictEqual(formatEntryTypeLabel('expense'), 'Expense');
      assert.strictEqual(formatEntryTypeLabel('office work'), 'Office work');
      assert.strictEqual(formatEntryTypeLabel('officework'), 'Office work');
      assert.strictEqual(formatEntryTypeLabel('legacy'), 'Legacy');
    });
  });

  describe('formatLedgerAmount', () => {
    test('formats positive revenue amounts cleanly with Naira currency prefix', () => {
      const res = formatLedgerAmount(125000);
      assert.strictEqual(res.formatted, '₦125,000');
      assert.strictEqual(res.isNegative, false);
      assert.strictEqual(res.originalFormatted, undefined);
    });

    test('formats expense amounts with negative flag', () => {
      const res = formatLedgerAmount(4500, true);
      assert.strictEqual(res.formatted, '₦4,500');
      assert.strictEqual(res.isNegative, true);
    });

    test('deducts retrieved amounts and includes original formatted amount', () => {
      const res = formatLedgerAmount(80000, false, 30000);
      assert.strictEqual(res.formatted, '₦50,000');
      assert.strictEqual(res.isNegative, false);
      assert.strictEqual(res.originalFormatted, '₦80,000');
    });
  });

  describe('formatWeightKg', () => {
    test('formats kilograms with units', () => {
      assert.strictEqual(formatWeightKg(128.5), '128.5 kg');
      assert.strictEqual(formatWeightKg(45), '45 kg');
      assert.strictEqual(formatWeightKg(null), '—');
      assert.strictEqual(formatWeightKg(undefined), '—');
    });
  });

  describe('shortenDestination', () => {
    test('extracts terminus from route arrows', () => {
      assert.strictEqual(shortenDestination('Lagos Hub -> Abuja Station'), 'Abuja Station');
      assert.strictEqual(shortenDestination('LOS -> ABV'), 'ABV');
    });

    test('extracts airport code from slashed entries', () => {
      assert.strictEqual(shortenDestination('ABV/Abuja'), 'ABV');
      assert.strictEqual(shortenDestination('KAN/Kano'), 'KAN');
      assert.strictEqual(shortenDestination('Enugu'), 'Enugu');
    });

    test('handles empty or missing destination', () => {
      assert.strictEqual(shortenDestination(null), '');
      assert.strictEqual(shortenDestination(''), '');
    });
  });

  describe('stripBadgedFieldsFromDetail', () => {
    test('removes repeated airline or route tokens from detail string', () => {
      const detail = 'Air Peace · 4pcs · 128KG · LOS-ABV · Industrial Spares';
      const cleaned = stripBadgedFieldsFromDetail(detail, 'Air Peace', 'LOS-ABV');
      assert.strictEqual(cleaned, '4pcs · 128KG · Industrial Spares');
    });
  });

  describe('formatPaymentModeBadge', () => {
    test('applies color only for status meaning', () => {
      assert.deepStrictEqual(formatPaymentModeBadge('Debt'), {
        label: 'Debt',
        tone: 'error',
      });
      assert.deepStrictEqual(formatPaymentModeBadge('Debt Paid'), {
        label: 'Debt cleared',
        tone: 'success',
      });
      assert.deepStrictEqual(formatPaymentModeBadge('Cash', true), {
        label: 'Cash',
        tone: 'success',
      });
      assert.deepStrictEqual(formatPaymentModeBadge('Cash', false), {
        label: 'Cash',
        tone: 'warning',
      });
      assert.deepStrictEqual(formatPaymentModeBadge('Transfer', true), {
        label: 'Transfer',
        tone: 'neutral',
      });
      assert.deepStrictEqual(formatPaymentModeBadge('Transfer', false), {
        label: 'Transfer',
        tone: 'warning',
      });
    });
  });

  describe('summarisePaymentHistory', () => {
    test('calculates debt clearance balance correctly', () => {
      const raw = {
        amount: 50000,
        paymentHistory: [
          { amount: 20000, by: 'Officer A' },
          { amount: 15000, by: 'Officer B' },
        ],
      };
      const res = summarisePaymentHistory(raw);
      assert.strictEqual(res.totalPaid, 35000);
      assert.strictEqual(res.remainingDebt, 15000);
      assert.strictEqual(res.isSettled, false);
    });

    test('identifies fully settled debts', () => {
      const raw = {
        amount: 40000,
        paymentHistory: [{ amount: 40000, by: 'Accountant' }],
      };
      const res = summarisePaymentHistory(raw);
      assert.strictEqual(res.totalPaid, 40000);
      assert.strictEqual(res.remainingDebt, 0);
      assert.strictEqual(res.isSettled, true);
    });
  });

  describe('canAccessLedger', () => {
    test('authorizes admin and accountant roles with edit permissions', () => {
      assert.deepStrictEqual(canAccessLedger({ role: 'super_admin' }), {
        canView: true,
        canEdit: true,
      });
      assert.deepStrictEqual(canAccessLedger({ role: 'admin' }), {
        canView: true,
        canEdit: true,
      });
      assert.deepStrictEqual(canAccessLedger({ role: 'accountant', can_edit_ledger: true }), {
        canView: true,
        canEdit: true,
      });
      assert.deepStrictEqual(canAccessLedger({ role: 'cargo_agent', can_edit_ledger: false }), {
        canView: true,
        canEdit: false,
      });
    });

    test('denies access to unknown or missing roles', () => {
      assert.deepStrictEqual(canAccessLedger(null), { canView: false, canEdit: false });
      assert.deepStrictEqual(canAccessLedger({ role: 'guest' }), { canView: false, canEdit: false });
    });
  });

  describe('getDensityClasses', () => {
    test('enforces CF-31 44px min tap targets in both compact and spacious modes', () => {
      const compact = getDensityClasses(true);
      const spacious = getDensityClasses(false);

      assert.strictEqual(compact.tapTargetHeight, 'min-h-[44px]');
      assert.strictEqual(spacious.tapTargetHeight, 'min-h-[44px]');
      assert.strictEqual(compact.tableRowPadding, 'py-2 px-3');
      assert.strictEqual(spacious.tableRowPadding, 'py-3 px-4');
    });
  });
});
