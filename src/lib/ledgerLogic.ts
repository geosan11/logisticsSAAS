/**
 * Transaction Ledger Logic, Formatting & Permissions Helpers (Grok UI)
 *
 * Provides pure logic helpers for Transaction Ledger presentation:
 * - Sentence-case labels & titles
 * - Restrained status badge mappings (color only for status)
 * - Tabular numbers and currency formatting
 * - Destination parsing & detail stripping
 * - Permission & role checks
 * - Density configuration (Compact vs Spacious) with CF-31 44px tap targets
 */

export interface PaymentBadgeResult {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

export interface AmountFormatResult {
  formatted: string;
  isNegative: boolean;
  originalFormatted?: string;
}

/**
 * Returns clean sentence-case header title for the ledger screen.
 */
export function formatLedgerTitle(defaultTypeFilter?: string | null): string {
  if (defaultTypeFilter === 'cargo') return 'Cargo ledger';
  if (defaultTypeFilter === 'package') return 'Package ledger';
  if (defaultTypeFilter === 'baggage' || defaultTypeFilter === 'marketing' || defaultTypeFilter === 'legacy') {
    return 'Legacy ledger';
  }
  return 'Master ledger';
}

/**
 * Formats entry type into clean sentence-case label.
 */
export function formatEntryTypeLabel(type: string): string {
  const norm = (type || '').toLowerCase();
  switch (norm) {
    case 'cargo':
      return 'Cargo';
    case 'package':
      return 'Package';
    case 'expense':
      return 'Expense';
    case 'officework':
    case 'office work':
    case 'office':
      return 'Office work';
    case 'legacy':
    case 'baggage':
    case 'marketing':
      return 'Legacy';
    default:
      return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'All';
  }
}

/**
 * Formats a currency amount into tabular digits string (₦X,XXX.XX).
 */
export function formatLedgerAmount(
  amount: number,
  isExpense: boolean = false,
  retrievedAmount: number = 0
): AmountFormatResult {
  const netAmount = Math.max(0, isExpense ? amount : amount - retrievedAmount);
  const formattedNet = netAmount.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const result: AmountFormatResult = {
    formatted: `₦${formattedNet}`,
    isNegative: isExpense,
  };

  if (retrievedAmount > 0 && !isExpense) {
    result.originalFormatted = `₦${amount.toLocaleString('en-NG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }

  return result;
}

/**
 * Formats weight in kg with tabular-friendly output.
 */
export function formatWeightKg(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || isNaN(kg)) return '—';
  return `${Number(kg).toLocaleString('en-NG', { maximumFractionDigits: 1 })} kg`;
}

/**
 * Returns clean destination code or truncated string for dense table columns.
 */
export function shortenDestination(dest: string | null | undefined): string {
  if (!dest) return '';
  const trimmed = dest.trim();

  // If format is like "Lagos Hub -> Abuja Station" or "LOS -> ABV"
  if (trimmed.includes('->')) {
    const parts = trimmed.split('->').map(s => s.trim());
    return parts[parts.length - 1];
  }

  // If format has slash code like "ABV/Abuja"
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx > 0 && slashIdx <= 4) {
    return trimmed.slice(0, slashIdx);
  }

  return trimmed;
}

/**
 * Strips fields already highlighted in badges from the raw detail line
 * to eliminate visual repetition.
 */
export function stripBadgedFieldsFromDetail(
  detail: string,
  ...values: (string | null | undefined)[]
): string {
  if (!detail) return '';
  let result = detail;
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    // Replace standalone occurrences surrounded by bullet/pipe/space
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\s*[·|•,-]\\s*)${escaped}(?:\\s*[·|•,-]\\s*|$)`, 'gi');
    result = result.replace(regex, ' · ');
  }
  return result.replace(/^(\s*[·|•,-]\s*)+|(\s*[·|•,-]\s*)+$/g, '').trim();
}

/**
 * Maps payment modes to Grok-style status tone and clean sentence-case label.
 * Color is reserved strictly for status meaning (green for paid/cleared, red for debt, amber for pending).
 */
export function formatPaymentModeBadge(
  mode: string,
  paymentConfirmed: boolean = true,
  walletDeduction: number = 0
): PaymentBadgeResult {
  const m = (mode || '').trim();

  if (m === 'Debt') {
    return { label: 'Debt', tone: 'error' };
  }
  if (m === 'Debt Paid' || m === 'Debt Cleared') {
    return { label: 'Debt cleared', tone: 'success' };
  }
  if (m === 'Cash') {
    return {
      label: 'Cash',
      tone: paymentConfirmed ? 'success' : 'warning',
    };
  }
  if (m === 'Transfer') {
    return {
      label: 'Transfer',
      tone: paymentConfirmed ? 'neutral' : 'warning',
    };
  }
  if (m === 'POS') {
    return {
      label: 'POS',
      tone: paymentConfirmed ? 'neutral' : 'warning',
    };
  }
  if (m === 'Wallet') {
    return { label: 'Wallet', tone: 'neutral' };
  }
  if (walletDeduction > 0) {
    return { label: `${m} + wallet`, tone: paymentConfirmed ? 'neutral' : 'warning' };
  }
  if (m === 'Expense') {
    return { label: 'Expense', tone: 'neutral' };
  }
  return { label: m || 'Unknown', tone: 'neutral' };
}

/**
 * Calculates debt collection summary from raw payment history.
 */
export function summarisePaymentHistory(raw: any): {
  totalPaid: number;
  remainingDebt: number;
  isSettled: boolean;
} {
  const originalAmount = Number(raw?.amount || 0);
  const history: any[] = Array.isArray(raw?.paymentHistory) ? raw.paymentHistory : [];

  let totalPaid = 0;
  for (const p of history) {
    totalPaid += Number(p.amount || 0);
  }

  const remaining = Math.max(0, originalAmount - totalPaid);
  return {
    totalPaid,
    remainingDebt: remaining,
    isSettled: remaining === 0,
  };
}

/**
 * Verifies user permissions for viewing and editing the Transaction Ledger.
 */
export function canAccessLedger(user: { role: string; can_edit_ledger?: boolean } | null | undefined): {
  canView: boolean;
  canEdit: boolean;
} {
  if (!user || !user.role) {
    return { canView: false, canEdit: false };
  }

  const allowedRoles = [
    'super_admin',
    'admin',
    'accountant',
    'auditor',
    'cargo_agent',
    'baggage_agent',
    'marketing_agent',
    'office_work',
  ];

  const canView = allowedRoles.includes(user.role);
  const canEdit = user.role === 'super_admin' || user.role === 'admin' || Boolean(user.can_edit_ledger);

  return { canView, canEdit };
}

/**
 * Returns density-aware classes respecting CF-31 44px tap targets.
 */
export function getDensityClasses(isCompact: boolean): {
  tableRowPadding: string;
  cardPadding: string;
  tapTargetHeight: string;
  toolbarPadding: string;
  textPrimary: string;
  textSecondary: string;
} {
  if (isCompact) {
    return {
      tableRowPadding: 'py-2 px-3',
      cardPadding: 'p-2.5',
      tapTargetHeight: 'min-h-[44px]',
      toolbarPadding: 'py-2 px-3',
      textPrimary: 'text-[12px]',
      textSecondary: 'text-[11px]',
    };
  }

  return {
    tableRowPadding: 'py-3 px-4',
    cardPadding: 'p-4',
    tapTargetHeight: 'min-h-[44px]',
    toolbarPadding: 'py-3 px-4',
    textPrimary: 'text-[13px]',
    textSecondary: 'text-[12px]',
  };
}
