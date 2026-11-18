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
