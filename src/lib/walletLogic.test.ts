import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterWallets,
  calculateWalletKPIs,
  isTransactionCredit,
  getTransactionTypeLabel,
  getSourceTypeLabel,
  canApprovePayoutsRole,
  canForceDeleteRole,
  canDirectTopUpRole,
  getWalletDensityClasses,
  filterWalletTransactions,
  canArchiveWallet,
  formatWalletResultCount,
  validateTopUpAmount,
  validateCashPayoutAmount,
  getWalletStatusBadge,
  TOP_UP_PRESET_AMOUNTS,
} from './walletLogic';
import type { CustomerWallet, WalletTransaction } from '../components/views/CustomerWallets';

describe('walletLogic', () => {
  const sampleWallets: CustomerWallet[] = [
    {
      id: 'w-1',
      customer_name: 'Dangote Group Logistics',
      customer_phone: '08031234567',
      opening_balance: 500000,
      balance: 450000,
      total_topped_up: 1200000,
      total_used: 750000,
      source_type: 'advance_deposit',
      status: 'active',
      created_by: 'Musa Agent',
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-11-18T10:30:00Z',
    },
    {
      id: 'w-2',
      customer_name: 'Alhaji Bello Motors',
      customer_phone: '08029876543',
      opening_balance: 150000,
      balance: 85500,
      total_topped_up: 250000,
      total_used: 164500,
      source_type: 'advance_deposit',
      status: 'active',
      created_by: 'Audu Supervisor',
      created_at: '2026-10-25T13:00:00Z',
      updated_at: '2026-11-16T16:45:00Z',
    },
    {
      id: 'w-3',
      customer_name: 'Amina Bello Express Trading',
      customer_phone: '08091112233',
      opening_balance: 150000,
      balance: 0,
      total_topped_up: 150000,
      total_used: 150000,
      source_type: 'refund',
      status: 'exhausted',
      created_by: 'Musa Agent',
      created_at: '2026-08-20T10:00:00Z',
      updated_at: '2026-11-10T17:00:00Z',
    },
  ];

  describe('filterWallets', () => {
    it('returns all wallets when search query is empty', () => {
      assert.equal(filterWallets(sampleWallets, '').length, 3);
      assert.equal(filterWallets(sampleWallets, '   ').length, 3);
    });

    it('filters wallets case-insensitively by customer name', () => {
      const result = filterWallets(sampleWallets, 'dangote');
      assert.equal(result.length, 1);
      assert.equal(result[0].customer_name, 'Dangote Group Logistics');

      const bello = filterWallets(sampleWallets, 'BELLO');
      assert.equal(bello.length, 2);
    });

    it('filters wallets by customer phone number', () => {
      const result = filterWallets(sampleWallets, '0802987');
      assert.equal(result.length, 1);
      assert.equal(result[0].customer_name, 'Alhaji Bello Motors');
    });

    it('returns empty array when no matches are found', () => {
      const result = filterWallets(sampleWallets, 'NonExistentCustomer');
      assert.equal(result.length, 0);
    });
  });

  describe('calculateWalletKPIs', () => {
    it('computes counts, liability, and lifetime volume correctly', () => {
      const kpis = calculateWalletKPIs(sampleWallets);
      assert.equal(kpis.activeCount, 2);
      assert.equal(kpis.exhaustedCount, 1);
      assert.equal(kpis.totalLiability, 450000 + 85500 + 0);
      assert.equal(kpis.lifetimeToppedUp, 1200000 + 250000 + 150000);
      assert.equal(kpis.lifetimeUsed, 750000 + 164500 + 150000);
    });

    it('handles empty wallet array gracefully', () => {
      const kpis = calculateWalletKPIs([]);
      assert.equal(kpis.activeCount, 0);
      assert.equal(kpis.exhaustedCount, 0);
      assert.equal(kpis.totalLiability, 0);
      assert.equal(kpis.lifetimeToppedUp, 0);
      assert.equal(kpis.lifetimeUsed, 0);
    });
  });

  describe('isTransactionCredit', () => {
    it('identifies credit transaction types (increasing balance)', () => {
      assert.equal(isTransactionCredit('top_up'), true);
      assert.equal(isTransactionCredit('refund'), true);
      assert.equal(isTransactionCredit('adjustment'), true);
      assert.equal(isTransactionCredit('retrieval_refund'), true);
      assert.equal(isTransactionCredit('reversal'), true);
    });

    it('identifies debit/deduction transaction types (decreasing balance)', () => {
      assert.equal(isTransactionCredit('deduction'), false);
      assert.equal(isTransactionCredit('cash_payout'), false);
    });
  });

  describe('getTransactionTypeLabel & getSourceTypeLabel', () => {
    it('formats transaction types in sentence case', () => {
      assert.equal(getTransactionTypeLabel('top_up'), 'Top-up');
      assert.equal(getTransactionTypeLabel('deduction'), 'Deduction');
      assert.equal(getTransactionTypeLabel('cash_payout'), 'Cash payout');
      assert.equal(getTransactionTypeLabel('retrieval_refund'), 'Retrieval refund');
      assert.equal(getTransactionTypeLabel('reversal'), 'Reversal');
      assert.equal(getTransactionTypeLabel('adjustment'), 'Adjustment');
      assert.equal(getTransactionTypeLabel('refund'), 'Refund');
    });

    it('formats source types in sentence case', () => {
      assert.equal(getSourceTypeLabel('advance_deposit'), 'Advance deposit');
      assert.equal(getSourceTypeLabel('airline_retrieval'), 'Airline retrieval');
      assert.equal(getSourceTypeLabel('refund'), 'Overcharge refund');
      assert.equal(getSourceTypeLabel('manual_credit'), 'Manual credit');
    });
  });

  describe('Role permission checks', () => {
    it('verifies canApprovePayoutsRole', () => {
      assert.equal(canApprovePayoutsRole('super_admin'), true);
      assert.equal(canApprovePayoutsRole('admin'), true);
      assert.equal(canApprovePayoutsRole('accountant'), true);
      assert.equal(canApprovePayoutsRole('cargo_agent'), false);
      assert.equal(canApprovePayoutsRole('driver'), false);
    });

    it('verifies canForceDeleteRole', () => {
      assert.equal(canForceDeleteRole('super_admin'), true);
      assert.equal(canForceDeleteRole('admin'), true);
      assert.equal(canForceDeleteRole('accountant'), true);
      assert.equal(canForceDeleteRole('office_work'), true);
      assert.equal(canForceDeleteRole('cargo_agent'), false);
      assert.equal(canForceDeleteRole('marketing_agent'), false);
    });

    it('verifies canDirectTopUpRole', () => {
      assert.equal(canDirectTopUpRole('super_admin'), true);
      assert.equal(canDirectTopUpRole('admin'), true);
      assert.equal(canDirectTopUpRole('accountant'), true);
      assert.equal(canDirectTopUpRole('auditor'), true);
      assert.equal(canDirectTopUpRole('cargo_agent'), false);
      assert.equal(canDirectTopUpRole('driver'), false);
    });
  });

  describe('getWalletDensityClasses', () => {
    it('returns tight spacing for compact mode', () => {
      const compact = getWalletDensityClasses(true);
      assert.ok(compact.containerPadding.includes('space-y-3'));
      assert.ok(compact.cardPadding.includes('p-3'));
    });

    it('returns comfortable spacing for spacious mode', () => {
      const spacious = getWalletDensityClasses(false);
      assert.ok(spacious.containerPadding.includes('space-y-4'));
      assert.ok(spacious.cardPadding.includes('p-4'));
    });
  });

  describe('filterWalletTransactions', () => {
    const sampleTxs: WalletTransaction[] = [
      {
        id: 'tx-1',
        wallet_id: 'w-1',
        type: 'top_up',
        amount: 50000,
        balance_before: 0,
        balance_after: 50000,
        logged_by: 'Musa',
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        id: 'tx-2',
        wallet_id: 'w-1',
        type: 'deduction',
        amount: 20000,
        balance_before: 50000,
        balance_after: 30000,
        logged_by: 'Musa',
        created_at: '2026-11-18T11:00:00Z',
      },
      {
        id: 'tx-3',
        wallet_id: 'w-1',
        type: 'refund',
        amount: 5000,
        balance_before: 30000,
        balance_after: 35000,
        logged_by: 'Supervisor',
        created_at: '2026-11-18T12:00:00Z',
      },
      {
        id: 'tx-4',
        wallet_id: 'w-1',
        type: 'cash_payout',
        amount: 10000,
        balance_before: 35000,
        balance_after: 25000,
        logged_by: 'Supervisor',
        created_at: '2026-11-18T13:00:00Z',
      },
    ];

    it('returns all transactions when filter is all', () => {
      assert.equal(filterWalletTransactions(sampleTxs, 'all').length, 4);
    });

    it('filters credit transactions (top_up, refund)', () => {
      const credits = filterWalletTransactions(sampleTxs, 'credits');
      assert.equal(credits.length, 2);
      assert.ok(credits.every((tx) => tx.type === 'top_up' || tx.type === 'refund'));
    });

    it('filters debit transactions (deduction, cash_payout)', () => {
      const debits = filterWalletTransactions(sampleTxs, 'debits');
      assert.equal(debits.length, 2);
      assert.ok(debits.every((tx) => tx.type === 'deduction' || tx.type === 'cash_payout'));
    });
  });

  describe('canArchiveWallet', () => {
    it('disallows archiving when wallet has an active positive balance', () => {
      const res = canArchiveWallet({ balance: 5000, total_topped_up: 5000, total_used: 0 });
      assert.equal(res.allowed, false);
      assert.equal(res.isPermanentDelete, false);
      assert.ok(res.reason?.includes('active balance'));
    });

    it('allows permanent delete when zero balance and no transaction history', () => {
      const res = canArchiveWallet({ balance: 0, total_topped_up: 0, total_used: 0 });
      assert.equal(res.allowed, true);
      assert.equal(res.isPermanentDelete, true);
    });

    it('allows archiving (history preserved) when zero balance with past transactions', () => {
      const res = canArchiveWallet({ balance: 0, total_topped_up: 50000, total_used: 50000 });
      assert.equal(res.allowed, true);
      assert.equal(res.isPermanentDelete, false);
      assert.ok(res.reason?.includes('safely archived'));
    });
  });

  describe('formatWalletResultCount', () => {
    it('formats unfiltered count correctly', () => {
      assert.equal(formatWalletResultCount(5, 5, false), '5 accounts');
      assert.equal(formatWalletResultCount(1, 1, false), '1 account');
    });

    it('formats filtered count correctly', () => {
      assert.equal(formatWalletResultCount(2, 5, true), 'Showing 2 of 5 accounts');
    });
  });

  describe('validateTopUpAmount', () => {
    it('validates valid positive amounts', () => {
      const res = validateTopUpAmount('50000');
      assert.equal(res.valid, true);
      assert.equal(res.amount, 50000);
      assert.equal(res.error, undefined);
    });

    it('rejects empty or whitespace input', () => {
      const res = validateTopUpAmount('   ');
      assert.equal(res.valid, false);
      assert.equal(res.amount, 0);
      assert.ok(res.error?.includes('Please enter'));
    });

    it('rejects negative or zero amounts', () => {
      const zero = validateTopUpAmount('0');
      assert.equal(zero.valid, false);
      assert.ok(zero.error?.includes('greater than ₦0'));

      const neg = validateTopUpAmount('-500');
      assert.equal(neg.valid, false);
    });

    it('rejects absurdly large or non-numeric inputs', () => {
      const nan = validateTopUpAmount('abc');
      assert.equal(nan.valid, false);

      const huge = validateTopUpAmount('1000000000');
      assert.equal(huge.valid, false);
      assert.ok(huge.error?.includes('maximum allowed'));
    });
  });

  describe('validateCashPayoutAmount', () => {
    it('accepts valid payout up to available balance', () => {
      const res = validateCashPayoutAmount('25000', 50000);
      assert.equal(res.valid, true);
      assert.equal(res.amount, 25000);
    });

    it('accepts exact full balance payout', () => {
      const res = validateCashPayoutAmount('50000', 50000);
      assert.equal(res.valid, true);
      assert.equal(res.amount, 50000);
    });

    it('rejects payout exceeding available balance', () => {
      const res = validateCashPayoutAmount('50001', 50000);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('more than available balance'));
    });

    it('rejects zero or negative payout', () => {
      const res = validateCashPayoutAmount('0', 50000);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('greater than ₦0'));
    });
  });

  describe('getWalletStatusBadge', () => {
    it('returns Active badge when balance is positive', () => {
      const badge = getWalletStatusBadge('active', 450000);
      assert.equal(badge.label, 'Active');
      assert.equal(badge.isPositive, true);
      assert.ok(badge.dotClass.includes('color-success'));
    });

    it('returns Exhausted badge when balance is zero', () => {
      const badge = getWalletStatusBadge('exhausted', 0);
      assert.equal(badge.label, 'Exhausted');
      assert.equal(badge.isPositive, false);
      assert.ok(badge.dotClass.includes('color-muted'));
    });

    it('returns Frozen badge when status is frozen', () => {
      const badge = getWalletStatusBadge('frozen', 100000);
      assert.equal(badge.label, 'Frozen');
      assert.equal(badge.isPositive, false);
      assert.ok(badge.dotClass.includes('color-warning'));
    });
  });

  describe('TOP_UP_PRESET_AMOUNTS', () => {
    it('provides standard Panasonic CF-31 counter quick presets', () => {
      assert.equal(TOP_UP_PRESET_AMOUNTS.length, 5);
      assert.deepEqual([...TOP_UP_PRESET_AMOUNTS], [10000, 20000, 50000, 100000, 200000]);
    });
  });
});
