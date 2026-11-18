import { CustomerWallet, WalletTransaction } from '../components/views/CustomerWallets';

/**
 * Filter customer wallets by customer name or phone number.
 */
export function filterWallets(
  wallets: CustomerWallet[],
  search: string
): CustomerWallet[] {
  const query = search.trim().toLowerCase();
  if (!query) return wallets;
  return wallets.filter(
    (w) =>
      w.customer_name.toLowerCase().includes(query) ||
      (w.customer_phone && w.customer_phone.includes(query))
  );
}

/**
 * Calculate summary KPI metrics from wallets.
 */
export function calculateWalletKPIs(wallets: CustomerWallet[]): {
  activeCount: number;
  exhaustedCount: number;
  totalLiability: number;
  lifetimeToppedUp: number;
  lifetimeUsed: number;
} {
  let activeCount = 0;
  let exhaustedCount = 0;
  let totalLiability = 0;
  let lifetimeToppedUp = 0;
  let lifetimeUsed = 0;

  for (const w of wallets) {
    if ((w.balance || 0) > 0) {
      activeCount++;
    } else {
      exhaustedCount++;
    }
    totalLiability += w.balance || 0;
    lifetimeToppedUp += w.total_topped_up || 0;
    lifetimeUsed += w.total_used || 0;
  }

  return {
    activeCount,
    exhaustedCount,
    totalLiability,
    lifetimeToppedUp,
    lifetimeUsed,
  };
}

/**
 * Determine whether a transaction type is a credit (balance increases) or deduction (balance decreases).
 */
export function isTransactionCredit(type: WalletTransaction['type']): boolean {
  return (
    type === 'top_up' ||
    type === 'refund' ||
    type === 'adjustment' ||
    type === 'retrieval_refund' ||
    type === 'reversal'
  );
}

/**
 * Get human-readable sentence-case label for a wallet transaction type.
 */
export function getTransactionTypeLabel(type: WalletTransaction['type']): string {
  switch (type) {
    case 'top_up':
      return 'Top-up';
    case 'deduction':
      return 'Deduction';
    case 'cash_payout':
      return 'Cash payout';
    case 'retrieval_refund':
      return 'Retrieval refund';
    case 'reversal':
      return 'Reversal';
    case 'adjustment':
      return 'Adjustment';
    case 'refund':
      return 'Refund';
    default:
      return type;
  }
}

/**
 * Get human-readable sentence-case label for a wallet source type.
 */
export function getSourceTypeLabel(sourceType: CustomerWallet['source_type']): string {
  switch (sourceType) {
    case 'advance_deposit':
      return 'Advance deposit';
    case 'airline_retrieval':
      return 'Airline retrieval';
    case 'refund':
      return 'Overcharge refund';
    case 'manual_credit':
      return 'Manual credit';
    default:
      return sourceType;
  }
}

/**
 * Permission checks for wallet actions based on user role.
 */
export function canApprovePayoutsRole(role: string): boolean {
  return ['accountant', 'admin', 'super_admin'].includes(role);
}

export function canForceDeleteRole(role: string): boolean {
  return ['super_admin', 'accountant', 'admin', 'office_work'].includes(role);
}

export function canDirectTopUpRole(role: string): boolean {
  return ['accountant', 'admin', 'super_admin', 'auditor'].includes(role);
}

/**
 * Filter wallet history transactions by directional category (all, credits, debits).
 */
export function filterWalletTransactions(
  transactions: WalletTransaction[],
  filter: 'all' | 'credits' | 'debits'
): WalletTransaction[] {
  if (filter === 'all') return transactions;
  if (filter === 'credits') {
    return transactions.filter((tx) => isTransactionCredit(tx.type));
  }
  return transactions.filter((tx) => !isTransactionCredit(tx.type));
}

/**
 * Determine archive/delete eligibility for a wallet.
 */
export function canArchiveWallet(wallet: {
  balance: number;
  total_topped_up: number;
  total_used: number;
}): {
  allowed: boolean;
  isPermanentDelete: boolean;
  reason?: string;
} {
  const hasHistory = wallet.total_topped_up > 0 || wallet.total_used > 0;
  if (wallet.balance > 0) {
    return {
      allowed: false,
      isPermanentDelete: false,
      reason: 'Wallet still has an active balance',
    };
  }
  if (!hasHistory && wallet.balance === 0) {
    return {
      allowed: true,
      isPermanentDelete: true,
      reason: 'Empty wallet with no transaction history can be deleted',
    };
  }
  return {
    allowed: true,
    isPermanentDelete: false,
    reason: 'Zero-balance wallet with transaction history can be safely archived',
  };
}

/**
 * Format search result count string for counter staff clarity.
 */
export function formatWalletResultCount(
  filteredCount: number,
  totalCount: number,
  hasSearch: boolean
): string {
  if (hasSearch) {
    return `Showing ${filteredCount} of ${totalCount} accounts`;
  }
  return `${totalCount} ${totalCount === 1 ? 'account' : 'accounts'}`;
}

/**
 * Validate customer top-up amount input.
 */
export function validateTopUpAmount(amountStr: string): {
  valid: boolean;
  amount: number;
  error?: string;
} {
  const trimmed = amountStr.trim();
  if (!trimmed) {
    return { valid: false, amount: 0, error: 'Please enter a top-up amount' };
  }
  const parsed = parseFloat(trimmed);
  if (isNaN(parsed) || parsed <= 0) {
    return { valid: false, amount: 0, error: 'Top-up amount must be greater than ₦0' };
  }
  if (!Number.isFinite(parsed) || parsed > 100_000_000) {
    return { valid: false, amount: 0, error: 'Top-up amount exceeds maximum allowed single transaction (₦100,000,000)' };
  }
  return { valid: true, amount: parsed };
}

/**
 * Validate cash payout amount input against current wallet balance.
 */
export function validateCashPayoutAmount(
  amountStr: string,
  currentBalance: number
): {
  valid: boolean;
  amount: number;
  error?: string;
} {
  const trimmed = amountStr.trim();
  if (!trimmed) {
    return { valid: false, amount: 0, error: 'Enter a valid payout amount' };
  }
  const parsed = parseFloat(trimmed);
  if (isNaN(parsed) || parsed <= 0) {
    return { valid: false, amount: 0, error: 'Payout amount must be greater than ₦0' };
  }
  if (parsed > currentBalance) {
    return {
      valid: false,
      amount: parsed,
      error: `Cannot pay out more than available balance (₦${currentBalance.toLocaleString('en-NG')})`,
    };
  }
  return { valid: true, amount: parsed };
}

/**
 * Get status badge configuration for customer wallets following the Grok status-dot pattern.
 */
export function getWalletStatusBadge(
  status: CustomerWallet['status'],
  balance: number
): {
  label: string;
  dotClass: string;
  isPositive: boolean;
} {
  if (status === 'frozen') {
    return {
      label: 'Frozen',
      dotClass: 'bg-[var(--color-warning)]',
      isPositive: false,
    };
  }
  if (balance > 0) {
    return {
      label: 'Active',
      dotClass: 'bg-[var(--color-success)]',
      isPositive: true,
    };
  }
  return {
    label: 'Exhausted',
    dotClass: 'bg-[var(--color-muted)]',
    isPositive: false,
  };
}

/**
 * Quick amount preset values for top-up operations on counter touchscreens.
 */
export const TOP_UP_PRESET_AMOUNTS = [10000, 20000, 50000, 100000, 200000] as const;

/**
 * Density-aware Tailwind CSS classes for the Customer Wallets view.
 */
export function getWalletDensityClasses(isCompact: boolean): {
  containerPadding: string;
  headerSpacing: string;
  cardPadding: string;
  gridGap: string;
  itemPadding: string;
  toolbarGap: string;
} {
  if (isCompact) {
    return {
      containerPadding: 'p-3 sm:p-4 space-y-3',
      headerSpacing: 'pb-2.5',
      cardPadding: 'p-3 sm:p-3.5',
      gridGap: 'gap-2.5',
      itemPadding: 'p-3',
      toolbarGap: 'gap-2',
    };
  }

  return {
    containerPadding: 'p-4 sm:p-6 space-y-4 sm:space-y-5',
    headerSpacing: 'pb-3.5',
    cardPadding: 'p-4 sm:p-5',
    gridGap: 'gap-3 sm:gap-4',
    itemPadding: 'p-4',
    toolbarGap: 'gap-3',
  };
}
