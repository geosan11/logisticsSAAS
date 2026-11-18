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
  getPaymentToneClass,
  getPaymentBadgeClasses,
  summarisePaymentHistory,
  canAccessLedger,
  getDensityClasses,
  formatAlertCountBadge,
  isBatchSelectable,
  summariseSelection,
  formatDestinationFilter,
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

    test('maps tone to Grok color classes', () => {
      assert.ok(getPaymentToneClass('success').includes('var(--color-success)'));
      assert.ok(getPaymentToneClass('error').includes('var(--color-error)'));
      assert.ok(getPaymentToneClass('warning').includes('var(--color-warning)'));
      assert.ok(getPaymentToneClass('neutral').includes('var(--color-surface-2)'));
      assert.ok(getPaymentToneClass('info').includes('var(--color-accent-cobalt)'));
    });

    test('returns complete badge metadata with class names', () => {
      const debt = getPaymentBadgeClasses('Debt');
      assert.strictEqual(debt.label, 'Debt');
      assert.strictEqual(debt.tone, 'error');
      assert.ok(debt.className.includes('var(--color-error)'));

      const cleared = getPaymentBadgeClasses('Debt Paid');
      assert.strictEqual(cleared.label, 'Debt cleared');
      assert.strictEqual(cleared.tone, 'success');
      assert.ok(cleared.className.includes('var(--color-success)'));

      const unverifiedCash = getPaymentBadgeClasses('Cash', false);
      assert.strictEqual(unverifiedCash.label, 'Cash');
      assert.strictEqual(unverifiedCash.tone, 'warning');
      assert.ok(unverifiedCash.className.includes('var(--color-warning)'));

      const transfer = getPaymentBadgeClasses('Transfer', true);
      assert.strictEqual(transfer.label, 'Transfer');
      assert.strictEqual(transfer.tone, 'neutral');
      assert.ok(transfer.className.includes('var(--color-surface-2)'));
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

  describe('formatAlertCountBadge', () => {
    test('returns alert state and label when count > 0', () => {
      assert.deepStrictEqual(formatAlertCountBadge(3), { label: '3', hasAlert: true });
      assert.deepStrictEqual(formatAlertCountBadge(1), { label: '1', hasAlert: true });
    });

    test('returns inactive state for zero or negative counts', () => {
      assert.deepStrictEqual(formatAlertCountBadge(0), { label: '', hasAlert: false });
      assert.deepStrictEqual(formatAlertCountBadge(-1), { label: '', hasAlert: false });
    });
  });

  describe('isBatchSelectable', () => {
    test('allows transaction entries to be batch selected', () => {
      assert.strictEqual(isBatchSelectable({ source: 'transaction' }), true);
    });

    test('disallows expenses or shift-markers from batch selection', () => {
      assert.strictEqual(isBatchSelectable({ source: 'expense' }), false);
      assert.strictEqual(isBatchSelectable({ source: 'shift-marker' } as any), false);
      assert.strictEqual(isBatchSelectable(null), false);
    });
  });

  describe('summariseSelection', () => {
    test('calculates batch metrics correctly', () => {
      const selected = new Set(['tx-1', 'tx-2']);
      const entries = [
        { id: 'tx-1', amount: 25000, mode: 'Debt', source: 'transaction' },
        { id: 'tx-2', amount: 15000, mode: 'Transfer', source: 'transaction' },
        { id: 'tx-3', amount: 5000, mode: 'Debt', source: 'transaction' },
      ];
      const summary = summariseSelection(selected, entries);
      assert.strictEqual(summary.count, 2);
      assert.strictEqual(summary.totalAmount, 40000);
      assert.strictEqual(summary.debtCount, 1);
    });
  });

  describe('formatDestinationFilter', () => {
    test('formats destination routes and airport codes cleanly', () => {
      assert.strictEqual(formatDestinationFilter('All'), 'All destinations');
      assert.strictEqual(formatDestinationFilter(''), 'All destinations');
      assert.strictEqual(formatDestinationFilter(null), 'All destinations');
      assert.strictEqual(formatDestinationFilter('ABV/Abuja'), 'ABV · Abuja');
      assert.strictEqual(formatDestinationFilter('LOS-KAN'), 'LOS-KAN');
    });
  });
});
