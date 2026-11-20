import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Transaction, User, Expense } from "../../lib/types";
import { fmt, tnow, isStandalonePWA, getHubCode, getShiftBoundary, txDisplayDateTime, normalizeAirlineName, formatPaymentModeDisplay, roundMoney, parseLocalDateBoundary, cleanRoute } from "../../lib/helpers";
import { processRetrieval, unretrieveEntry, approveRetrieval, RetrievalEntryType } from "../../lib/wallet";
import { clearDebt, reopenDebt, DebtEntryType, DEBT_TABLE_NAME } from "../../lib/debt";
import { computeDebtDisplayModeFromRow } from "../../lib/debtStatus";
import { deleteTransaction } from "../../lib/deleteTransaction";
import { confirmPayment, PaymentEntryType } from "../../lib/paymentConfirmation";
import { useHubRoutes, useHubNames } from "../../lib/hubRoutes";
import { canAccessTab } from "../../lib/permissions";
import { getEquivalentHubIds } from "../../lib/lagosHubSync";
import { useAirlines } from "../../lib/airlines";
import { statusChipClass, statusMeta } from "../../lib/status";
import { Button } from "../ui";
import { MIN_PACKAGE_AMOUNT, CARGO_ROUTES } from "../../lib/constants";
import { useContentTypes } from "../../lib/contentTypes";
import { useSpecialGoodsRates, resolveSpecialGoodsRate } from "../../lib/specialGoodsRates";
import { useFlatTierRates, resolveFlatTier } from "../../lib/flatTierRates";
import { useSizeTierRates, resolveSizeTier, useSizeTierContentTypeNames } from "../../lib/sizeTierRates";
import { useMinimumCharges, resolveMinimumCharge } from "../../lib/minimumCharges";
import { isOfficeWorkEntry as isOfficeWorkEntryCore } from "../../lib/officeWork";
import { useBanks } from "../../lib/banks";
import { formatAirlineAwb, isValidAirlineAwb } from "../../lib/tagNumber";
import { BackButton } from "../BackButton";
import { useDensity } from "../../lib/useDensity";
import {
  formatLedgerTitle,
  formatEntryTypeLabel,
  formatPaymentModeBadge,
  getPaymentToneClass,
  getPaymentBadgeClasses,
  getDensityClasses,
} from "../../lib/ledgerLogic";
import {
  Edit2,
  X,
  Check,
  Loader2,
  Filter,
  Search,
  QrCode,
  CheckSquare,
  Package,
  Plane,
  TrendingUp,
  Archive,
  Minus,
  ChevronRight,
  Download,
  Printer,
  Receipt,
  Tag,
  HandCoins,
  Clock,
  Undo2,
  ShieldCheck,
  Truck,
  ChevronDown,
  ChevronUp,
  Calendar,
  Trash2,
  LayoutGrid,
  Banknote,
  ArrowLeftRight,
  CreditCard,
  AlertTriangle,
  Wallet,
  Building2,
  User as UserIcon,
  MapPin,
} from "lucide-react";
import { QRCode } from "../QRCode";
import TagPrintHistory from "./TagPrintHistory";
import { supabase, writeAuditLog, fetchAllRows } from "../../lib/supabase";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";
import { LiveCreditFeed } from "../LiveCreditFeed";
import { PartialRetrievalModal } from "./PartialRetrievalModal";
import { CustomerWallet } from "../../lib/types";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { fetchLedgerPage, fetchLedgerTotals, fetchProfileLookup, fetchAllLedgerRowsForExport, LedgerSearchParams, LedgerCursor, LedgerEntryType, LedgerTotals } from "../../lib/ledgerSearch";

type Entry = {
  id: string;
  time: string;
  type: string;
  name: string;
  detail: string;
  amount: number;
  mode: string;
  status: string;
  source: "transaction" | "expense";
  airline_awb?: string | null;
  raw: any;
  paymentConfirmed?: boolean;
  posApprovalCode?: string;
};

// Deterministic per-airline badge color, purely for visual scanning of the
// row list -- same airline always lands on the same color (hashed off
// normalizeAirlineName's output, not the raw string, so casing/spacing
// variants of the same airline never split across two colors), no meaning
// attached to which color a given airline gets.
function airlineBadgeColors(_airlineName: string) {
  return {
    bg: 'var(--color-surface-2)',
    text: 'var(--color-foreground)',
    border: 'var(--color-border)',
  };
}

// Airline/destination now show as their own badge beside the customer name
// (see airlineBadgeColors above) -- this strips those same two facts back
// out of the plain detail line so they don't also appear there. `detail` is
// a pre-built flat string whose exact shape varies by transaction type AND
// by which code path built/last edited it (this file's own edit-save
// handler alone has at least 4 different templates), so this deliberately
// does NOT re-parse it positionally by type (a past ledger detail-string
// change broke exactly that way). Instead it removes only exact-value
// substring matches of the real current field -- if a given entry's detail
// doesn't contain that exact text (an older/different format), this is a
// no-op and the original text is left untouched rather than mangled.
function stripBadgedFieldsFromDetail(detail: string, ...values: (string | null | undefined)[]): string {
  let result = detail;
  for (const v of values) {
    if (!v) continue;
    result = result.split(v).join('');
  }
  return result
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/^\s*·\s*/, '')
    .replace(/\s*·\s*$/, '')
    .trim();
}

// Shortens long destination strings (e.g. "ABV/ABUJA AIR CARGO STATION" -> "ABV",
// "KAN/KANO CARGO STATION" -> "KAN") for compact badge display.
// Prefers a real 2-4 letter hub code when present; if none, shows the clean state/city name.
function shortenDestination(dest: string | null | undefined): string {
  if (!dest) return '';
  const trimmed = dest.trim();
  if (!trimmed) return '';

  // 1. Check for leading 2-4 letter code before a "/"
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx > 0) {
    const candidateCode = trimmed.slice(0, slashIdx).trim();
    if (/^[A-Za-z]{2,4}$/.test(candidateCode)) {
      return candidateCode.toUpperCase();
    }
  }

  // 2. Check against known CARGO_ROUTES for a match
  const lower = trimmed.toLowerCase();
  for (const route of CARGO_ROUTES) {
    if (route === 'Other') continue;
    const [c, city] = route.split('/');
    if (city && (lower.includes(city.toLowerCase()) || lower === c.toLowerCase())) {
      return c.toUpperCase();
    }
  }

  // 3. No real hub code found: show the state/city part without the long suffix
  const cityPart = slashIdx >= 0 ? trimmed.slice(slashIdx + 1).trim() : trimmed;
  const cleaned = cleanRoute(cityPart);
  return cleaned !== '—' ? cleaned : cityPart;
}

// Maps a transaction type to its real DB table -- needed anywhere a
// retrieval/approval action writes an audit_log row, since audit_log's
// table_name should point at the actual table (cargo_entries/manifests/
// marketing_entries/package_entries), not the app-level 'cargo'/'baggage'/
// 'marketing'/'package' type string.
const RETRIEVAL_TABLE_NAME: Record<RetrievalEntryType, string> = {
  cargo: 'cargo_entries',
  baggage: 'manifests',
  marketing: 'marketing_entries',
  package: 'package_entries',
};

// Human-readable labels for audit_log.action, used by the transaction
// detail modal's Activity History section below.
const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Edited',
  DELETE: 'Deleted',
  PAYMENT_CONFIRM: 'Payment Confirmed',
  RETRIEVAL: 'Retrieved',
  UNRETRIEVE: 'Retrieval Reversed',
  RETRIEVAL_APPROVE: 'Retrieval Approved',
  DEBT_COLLECTION: 'Debt Payment Collected',
  DEBT_REOPENED: 'Debt Reopened',
};

const dateInputValue = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// One-line breakdown of how a debt was collected, from its payment_history
// array -- e.g. "₦9,000 Wallet + ₦6,000 Cash". Used on the original debt row
// and its detail modal so a settled/part-settled debt reads its own state
// without having to cross-reference the separate DC- collection rows.
const summarisePaymentHistory = (
  history?: { amount: number; mode: string }[] | null,
): string => {
  if (!Array.isArray(history) || history.length === 0) return '';
  const byMode = new Map<string, number>();
  for (const h of history) {
    if (!h || typeof h.amount !== 'number') continue;
    byMode.set(h.mode || 'Other', roundMoney((byMode.get(h.mode || 'Other') || 0) + h.amount));
  }
  return [...byMode.entries()]
    .filter(([, amt]) => amt > 0)
    .map(([mode, amt]) => `₦${fmt(amt)} ${mode}`)
    .join(' + ');
};

export const TransactionLedger = ({
  user,
  transactions,
  expenses = [],
  onBack,
  onUpdateTx,
  onDeleteTx,
  defaultTypeFilter,
  viewOnly = false,
  dateRange,
  onDateRangeChange,
  activeShift,
  shifts,
  onStartShift,
  onEndShift,
  shiftLabel,
  shiftAutoManaged = false,
  customerWallets = [],
  refetchCustomerWallets,
  ledgerRowsTruncated = false,
  onLoadMoreLedgerRows,
  ledgerRowsLoadingMore = false,
}: {
  user: User;
  transactions: Transaction[];
  expenses?: Expense[];
  onBack: () => void;
  onUpdateTx: (tx: Transaction) => void;
  // Called after delete_transaction's RPC call already succeeded server-side
  // -- this only removes the row from local state (see confirmDeleteTransaction).
  onDeleteTx: (type: string, id: string) => void;
  customerWallets?: CustomerWallet[];
  // Edit Transaction's wallet picker previously trusted whatever this
  // global cache currently held -- which could be stale (e.g. a wallet
  // created/credited elsewhere in the session that a missed realtime event
  // never patched in). Calling this on modal open guarantees a fresh read
  // for this financially-sensitive path regardless of that cache's state.
  refetchCustomerWallets?: () => void;
  defaultTypeFilter?: 'cargo' | 'baggage' | 'marketing' | 'package' | null;
  viewOnly?: boolean;
  dateRange?: { start: string; end: string };
  onDateRangeChange?: (range: { start: string; end: string }) => void;
  activeShift?: any;
  shifts?: any[];
  // Human label for the Start/End Day controls below ("Cargo", "Package", ...)
  // -- shift management is now per-department (each stream has its own
  // independent hub_shifts lifecycle), so the generic "Shift"/"Day" wording
  // alone would be ambiguous when several departments can be open at once.
  // Omitted entirely on the unfiltered Master Ledger, where the wording
  // stays exactly as it was before departments existed.
  shiftLabel?: string;
  onStartShift?: () => void;
  onEndShift?: () => void;
  // True for Cargo/Package -- the shift boundary is now fully automatic
  // (fixed 18:00-18:00, see EHIApp.tsx's autoRollShift), so the status
  // text still shows but the Start Day/End Day buttons never render,
  // regardless of activeShift.
  shiftAutoManaged?: boolean;
  // True when EHIApp.tsx's fetchInitial (the shared, date-range-bounded
  // fetch behind Current Shift -- NOT All Time, which is separately
  // server-paginated and never truncates this way) hit its per-table row
  // cap on the most recent load. Drives the "Load More" button at the end
  // of the row list below; both onLoadMoreLedgerRows/ledgerRowsLoadingMore
  // are only meaningful together with this.
  ledgerRowsTruncated?: boolean;
  onLoadMoreLedgerRows?: () => void;
  ledgerRowsLoadingMore?: boolean;
}) => {
  const navigate = useNavigate();
  const { isCompact } = useDensity();
  const density = getDensityClasses(isCompact);
  const contentTypes = useContentTypes();
  const routes = useHubRoutes();
  // Hoisted up from further down in this component specifically so
  // commitSearch (declared not far below) can list it in a useCallback
  // dependency array -- that array is evaluated immediately, synchronously,
  // as part of calling useCallback() during render, so a `const` declared
  // LATER in this same function is still in its temporal dead zone at that
  // point and throws "Cannot access 'showToast' before initialization" the
  // instant this component first renders. Real prod incident, not a
  // hypothetical: this exact ordering (showToast declared ~200 lines below
  // commitSearch) is why a previous version of the 3-character search
  // guard below crashed the Ledger for every user. Keep this above every
  // hook/callback that references showToast in its own deps array.
  const { showToast } = useToast();
  // hub_id -> name, for the debt-clearance shadow entry's `hub` display
  // field in confirmClearDebt below -- tx.hub is unreliable (see
  // useHubNames' own comment: fetchInitial never selects the DB `hub`
  // text column for any of the 4 department types), so this is the only
  // way to reliably show the debt's REAL hub name.
  const hubNames = useHubNames();
  // includeOther: false -- same as the Route select right below this field,
  // which also has no "Other" entry. A free-text escape hatch isn't offered
  // here (unlike CargoForm.tsx's intake picker); editAirlineOptions below
  // still guarantees the entry's current value is always selectable even if
  // it's since fallen out of the canonical list.
  const editAirlines = useAirlines({ includeOther: false });
  const banks = useBanks();
  const [showPrintHistory, setShowPrintHistory] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  // The mode the entry actually had when the edit modal opened -- only
  // switching TO 'Wallet' from something else should trigger a deduction;
  // re-saving an edit that was already 'Wallet' (or leaving it unchanged)
  // must not charge the wallet a second time.
  const [editOriginalMode, setEditOriginalMode] = useState<string | null>(null);
  // Captured alongside editOriginalMode -- an entry that already carries a
  // wallet contribution (either fully 'Wallet'-mode, or a split from a prior
  // edit/intake where mode is now the remainder method) must not be
  // re-charged just because the mode dropdown gets set to 'Wallet' again;
  // `editOriginalMode !== 'Wallet'` alone isn't a reliable "not yet charged"
  // signal once split entries exist (see switchingToWallet below).
  const [editOriginalWalletDeduction, setEditOriginalWalletDeduction] = useState<number>(0);
  const [editWallet, setEditWallet] = useState<CustomerWallet | null>(null);
  // Mirrors CargoForm.tsx's walletRemainderMode/walletRemainderBank -- lets a
  // wallet that can't cover the full edited amount be topped up by a second
  // payment method instead of blocking the save outright.
  const [editWalletRemainderMode, setEditWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [editWalletRemainderBank, setEditWalletRemainderBank] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // In-flight guard for toggleConfirm/savePosCode -- neither had any
  // per-row lock before, so a fast double-click could fire two
  // confirmPayment() RPC calls for the same entry with no reconciliation
  // between the two responses.
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set());
  // selectAllCash had no in-flight guard at all (every other write action in
  // this file -- toggleConfirm, savePosCode, handleSaveEdit -- does), so a
  // fast double-click fired two overlapping Promise.all batches of
  // confirmPayment calls across the same rows.
  const [bulkConfirming, setBulkConfirming] = useState(false);
  // Clear Debt previously hardcoded mode: 'Cash' with no prompt at all, so
  // the resulting DC- collection entry always claimed Cash regardless of
  // how the money actually came in. clearDebtEntry holds the pending entry
  // while the mode/bank picker is open; null means the picker is closed.
  const [clearDebtEntry, setClearDebtEntry] = useState<Entry | null>(null);
  // 'Wallet' = settle from the customer's wallet; the remainder (if the
  // wallet can't cover it) is collected via clearDebtRemainderMode in the
  // SAME confirm, so a Clear Debt always fully clears the balance.
  const [clearDebtMode, setClearDebtMode] = useState<'Cash' | 'Transfer' | 'POS' | 'Wallet'>('Cash');
  const [clearDebtBank, setClearDebtBank] = useState('');
  const [clearDebtWallet, setClearDebtWallet] = useState<CustomerWallet | null>(null);
  const [clearDebtRemainderMode, setClearDebtRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');

  // Batch clear/print, Debt mode only -- lets an agent settle several of one
  // customer's outstanding debts (different routes/shipments) in one action
  // instead of opening Clear Debt separately per row, then print one
  // combined receipt for the batch. Wallet isn't offered here (unlike the
  // single-entry Clear Debt above) -- splitting a wallet+remainder payment
  // safely across N different-balance debts at once isn't worth the added
  // risk for what bulk clearing is actually used for.
  const [selectedDebtIds, setSelectedDebtIds] = useState<Set<string>>(new Set());
  const [batchClearingDebts, setBatchClearingDebts] = useState(false);
  // Starts (and resets to) empty rather than defaulting to 'Cash' -- a
  // silent default meant a staff member could clear a debt without ever
  // consciously choosing how it was actually paid, which is exactly what
  // was reported ("it's clearing to Cash"). Requiring an explicit pick
  // each time a batch starts fresh makes the choice deliberate.
  const [batchDebtMode, setBatchDebtMode] = useState<'Cash' | 'Transfer' | 'POS' | ''>('');
  const [batchDebtBank, setBatchDebtBank] = useState('');
  const [clearingDebt, setClearingDebt] = useState(false);
  const [reopeningDebt, setReopeningDebt] = useState(false);
  const [deletingTx, setDeletingTx] = useState(false);
  // Marketing entries store bag counts inside the composed `detail` string,
  // not as discrete Transaction fields, so the edit modal keeps its own
  // working copy (seeded by parsing `detail` in handleEditClick) and
  // reassembles `detail` from it in handleSaveEdit.
  const [editBagCounts, setEditBagCounts] = useState({ bb: '0', mb: '0', sb: '0' });
  // Pieces/weight/amount are edited as plain strings, not numbers, and only
  // parsed in handleSaveEdit -- binding a number input's value directly to a
  // number forces every keystroke through parseFloat/parseInt and back into
  // the input, which silently eats a trailing decimal point (typing "99."
  // re-renders as "99", so the next digit lands after the whole number
  // instead of after the point) and made editing an existing amount unreliable.
  const [pieceInput, setPieceInput] = useState('');
  const [kgInput, setKgInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  // Free-text fallback when the Content Type/Contents select is set to
  // "Other" in the edit modal -- separate local state (not bound to
  // editingTx.contentType/contents directly), so typing into it doesn't
  // itself change the select's controlled value away from "Other" and
  // collapse this input on the first keystroke. Always starts blank on
  // open (handleEditClick), matching CargoForm/PackageForm's own create-
  // time "Other" input, which never pre-fills either.
  const [editCustomContentType, setEditCustomContentType] = useState('');
  const [editCustomContents, setEditCustomContents] = useState('');
  // Screen size (inches) for editing a size-tier-priced cargo entry (e.g.
  // Plasma TV) -- mirrors CargoForm.tsx's own sizeInches input/state,
  // which the edit modal never had at all until now.
  const [sizeInchesInput, setSizeInchesInput] = useState('');
  const [viewingQrTx, setViewingQrTx] = useState<Entry | null>(null);
  const [viewingDetail, setViewingDetail] = useState<Entry | null>(null);
  // Full activity trail for whichever transaction is currently open in the
  // detail modal -- every edit/retrieval/unretrieve/approval/debt-collection/
  // payment-confirmation already writes an audit_log row (table_name +
  // record_id identify exactly this transaction), but none of that was ever
  // surfaced in the UI itself. Any staff can act on a transaction (retrieval,
  // refund-to-wallet, unretrieve); this is the accountability mechanism that
  // replaces blocking those actions -- everything done to a transaction is
  // visible here, in order, with who did it and when, so it's always
  // traceable who to hold accountable rather than who was merely allowed
  // to click the button.
  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [txHistoryLoading, setTxHistoryLoading] = useState(false);

  // Esc-to-close for the four portalled modals on this screen (none had it).
  // Closes the top-most; edit + clear-debt ignore Esc while a save is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewingQrTx) setViewingQrTx(null);
      else if (clearDebtEntry) { if (!clearingDebt) setClearDebtEntry(null); }
      else if (editingTx) { if (!savingEdit) setEditingTx(null); }
      else if (viewingDetail) setViewingDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingDetail, editingTx, viewingQrTx, clearDebtEntry, clearingDebt, savingEdit]);

  useEffect(() => {
    if (!viewingDetail || viewingDetail.source !== 'transaction') { setTxHistory([]); return; }
    const tx = viewingDetail.raw as Transaction;
    const tableName = RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType];
    if (!tableName || !tx.id) { setTxHistory([]); return; }
    let cancelled = false;
    setTxHistoryLoading(true);
    supabase.from('audit_log').select('*')
      .eq('table_name', tableName).eq('record_id', tx.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setTxHistory(data || []);
        setTxHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [viewingDetail]);
  const [retrievalModalEntry, setRetrievalModalEntry] = useState<Entry | null>(null);
  // Guards executeRetrieval against a double-click/slow-network double
  // submit -- process_*_retrieval only rejects a retrieval that would push
  // cumulative retrieved_amount past the entry's TOTAL, so two identical
  // partial retrievals that each individually fit under the total both
  // succeed, double-crediting the wallet or double-clearing debt. Mirrors
  // clearingDebt's same guard on the debt-clearance confirm flow below.
  const [processingRetrieval, setProcessingRetrieval] = useState(false);
  // Raw input value (updates on every keystroke for controlled input) --
  // does NOT feed filteredEntries/the All Time RPC on its own; only
  // commitSearch below does.
  const [searchInput, setSearchInput] = useState("");
  // Committed value fed into filteredEntries (Current Shift) and
  // allTimeFilterParams (All Time, triggers a server refetch). Previously
  // auto-committed 200ms after the last keystroke -- changed to require an
  // explicit Enter/search-icon click (or the clear button, for cancelling)
  // so All Time's search-triggered refetch never fires mid-typing. That
  // debounce still let a fast typist queue up several overlapping RPC
  // calls (one per pause &gt;200ms), each racing the others -- see
  // allTimeFetchEpochRef above for how a stale one landing after a newer
  // one is now discarded regardless, but not auto-firing in the first
  // place is the more direct fix.
  const [searchQuery, setSearchQuery] = useState("");
  // 'current' = only entries within the current operational shift (7PM–7PM).
  // 'all' = unfiltered by shift (shows all loaded transactions as before).
  const [shiftFilter, setShiftFilter] = useState<'current' | 'all'>('current');
  const handleSearchInputChange = useCallback((val: string) => {
    setSearchInput(val);
    if (!val.trim()) {
      setSearchQuery("");
    }
  }, []);

  // For Current Shift mode (in-memory client filtering), debounce 250ms so typing immediately filters
  // without requiring an explicit Enter key. In All Time mode, commitSearch (Enter/click) remains required to protect the server RPC.
  useEffect(() => {
    if (shiftFilter !== 'current') return;
    const trimmed = searchInput.trim();
    if (trimmed.length === 1) return;
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput, shiftFilter]);
  // Runs the search -- Enter key, the search icon, or a one-shot
  // programmatic trigger (LiveCreditFeed's "filter ledger by this
  // customer" click) all funnel through here and commit immediately,
  // unlike free-text typing above.
  //
  // A single-character query is refused outright (below the "type at
  // least 2 characters" hint) rather than committed -- ledger_search_page/
  // ledger_search_totals's ILIKE '%query%' matching is backed by pg_trgm
  // GIN indexes, which Postgres can only use for patterns of 3+ characters
  // (a trigram is 3 consecutive characters; nothing shorter produces a
  // usable one), so even a 2-character query still forces a full
  // sequential scan across every department table -- ledger_search_totals
  // in particular has no LIMIT at all and, for hub-unrestricted roles
  // (admin/super_admin/accountant/auditor), scans the entire company's
  // history. This floor was originally 3 (fully avoiding that scan), but
  // dropped to 2 deliberately: some existing consignee names are only 2
  // characters long (predating CargoForm's own 3-character minimum), and
  // staff need to be able to find them. A 1-character query gets no
  // benefit from that trade-off (matches almost everything, still slow)
  // and stays blocked. Blocking here is a client-side guard, not a query
  // rewrite -- it doesn't touch the RPCs themselves. showToast is declared
  // near the top of this component (not further down where it used to
  // live) specifically so this dependency array is safe to read at render
  // time -- see that declaration's own comment for the incident this caused.
  const commitSearch = useCallback((val: string) => {
    const trimmed = val.trim();
    if (trimmed.length === 1) {
      showToast({ message: 'Type at least 2 characters to search.', type: 'warning' });
      return;
    }
    setSearchInput(val);
    setSearchQuery(val);
  }, [showToast]);
  // Cancels a search immediately (no Enter needed) -- clearing is treated
  // as a discrete "stop searching" action, not something that should sit
  // half-typed waiting for a commit.
  const clearSearch = useCallback(() => commitSearch(""), [commitSearch]);

  const normalizeType = useCallback((t: string | null | undefined): string => {
    if (!t) return "All";
    const lower = t.toLowerCase();
    if (lower === 'cargo') return 'Cargo';
    if (lower === 'baggage' || lower === 'marketing' || lower === 'legacy') return 'Legacy';
    if (lower === 'package') return 'Package';
    if (lower === 'expense') return 'Expense';
    if (lower === 'office work') return 'Office Work';
    return t;
  }, []);

  const [typeFilter, setTypeFilter] = useState(() => normalizeType(defaultTypeFilter));

  useEffect(() => {
    if (defaultTypeFilter) {
      setTypeFilter(normalizeType(defaultTypeFilter));
    }
  }, [defaultTypeFilter, normalizeType]);
  const [modeFilter, setModeFilter] = useState("All");
  // Office (B2B/corporate) vs Individual split for Debt entries specifically
  // -- reuses the same clientType/linked_as_office_work/corporate_client_id
  // classification DebtorsTab.tsx already relies on. Selecting either value
  // narrows the ledger to unpaid Debt entries of that class regardless of
  // modeFilter, since picking a debt-type split is inherently about debts.
  const [debtClassFilter, setDebtClassFilter] = useState<'All' | 'Office' | 'Individual'>('All');
  // A batch-clear/print selection surviving a search/filter change could
  // silently include rows no longer even visible -- same reasoning as
  // DebtorsTab.tsx's matching selectedIds reset.
  useEffect(() => { setSelectedDebtIds(new Set()); }, [modeFilter, debtClassFilter, searchQuery, typeFilter]);
  // Forces a fresh, deliberate mode choice for every new batch -- fires
  // whenever the selection returns to empty (after a completed/aborted
  // clear, a filter change resetting it above, or manually unchecking
  // everything), not on every incremental checkbox added to an
  // already-in-progress selection, which would otherwise force staff to
  // re-pick the mode after every single click.
  useEffect(() => { if (selectedDebtIds.size === 0) setBatchDebtMode(''); }, [selectedDebtIds]);
  const [timeFilter, setTimeFilter] = useState<"All" | "Morning" | "Afternoon" | "Evening" | "Custom">("All");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [posCodeInput, setPosCodeInput] = useState<{ id: string; code: string }>({ id: '', code: '' });

  // Corporate roster for the "unlinked office work" highlight. Lightweight
  // id+name fetch; matched by normalized name against each cargo row.
  const [corpNameSet, setCorpNameSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    supabase.from('corporate_clients').select('company_name').then(({ data }) => {
      if (data) setCorpNameSet(new Set(data.map((c: any) => c.company_name.trim().toUpperCase().replace(/\s+/g, ' '))));
    });
  }, []);

  const isUnlinkedOffice = (e: any): boolean =>
    e.type === 'cargo'
    && !e.raw?.corporate_client_id
    && corpNameSet.has((e.name || '').trim().toUpperCase().replace(/\s+/g, ' '));


  const [hubAirlineRates, setHubAirlineRates] = useState<Record<string, number>>({});
  const [hubRouteRates, setHubRouteRates] = useState<Record<string, number>>({});
  const [standardRatesMap, setStandardRatesMap] = useState<Record<string, number>>({});
  // Same equivalent-hub-id set CargoForm.tsx's own lagosHubIds uses, feeding
  // resolveSpecialGoodsRate/resolveFlatTier/resolveSizeTier's hub-scoping
  // below -- reuses the hubIds this effect already computes rather than a
  // second getEquivalentHubIds() call.
  const [lagosHubIds, setLagosHubIds] = useState<string[]>([]);
  const specialGoodsRates = useSpecialGoodsRates();
  const flatTierRates = useFlatTierRates();
  const sizeTierRates = useSizeTierRates();
  const sizeTierContentTypeNames = useSizeTierContentTypeNames();
  const minimumCharges = useMinimumCharges();

  useEffect(() => {
    let active = true;
    const fetchRates = async () => {
      const hubIds = user?.hub_id ? await getEquivalentHubIds(user.hub_id) : [];
      if (active) setLagosHubIds(hubIds);
      // fetchAllRows paginates past PostgREST's implicit ~1000-row cap --
      // these are small config/lookup tables today, but a plain .select()
      // would silently truncate (and this is used for live pricing, not
      // just display) once any of them crossed that cap. Promise.allSettled
      // (not Promise.all) so one query failing doesn't wipe out the other
      // two's already-successful results, matching the original per-query
      // fallback behavior.
      // .order() before .range() on every page -- fetchAllRows pages via
      // repeated OFFSET/LIMIT-style requests, which Postgres/PostgREST does
      // NOT guarantee a stable row order across without an explicit ORDER
      // BY; an unordered multi-page fetch can duplicate or skip rows once a
      // table crosses the page size, which for a rate lookup means a route
      // silently falling back to the wrong (or no) rate.
      const [stdResult, airResult, hubResult] = await Promise.allSettled([
        fetchAllRows<any>((from, to) => supabase.from('standard_cargo_rates').select('route_name, rate_per_kg').order('route_name').range(from, to)),
        hubIds.length > 0 ? fetchAllRows<any>((from, to) => supabase.from('hub_airline_route_rates').select('airline, route_name, rate_per_kg').in('hub_id', hubIds).order('airline').order('route_name').order('id').range(from, to)) : Promise.resolve([]),
        hubIds.length > 0 ? fetchAllRows<any>((from, to) => supabase.from('hub_route_rates').select('route_name, rate_per_kg').in('hub_id', hubIds).order('route_name').order('id').range(from, to)) : Promise.resolve([]),
      ]);

      if (!active) return;

      if (stdResult.status === 'fulfilled') {
        const stdMap: Record<string, number> = {};
        stdResult.value.forEach((r: any) => { stdMap[r.route_name] = Number(r.rate_per_kg); });
        setStandardRatesMap(stdMap);
        localStorage.setItem("ehi_standard_cargo_rates", JSON.stringify(stdMap));
      } else {
        const saved = localStorage.getItem("ehi_standard_cargo_rates");
        if (saved) setStandardRatesMap(JSON.parse(saved));
      }

      if (airResult.status === 'fulfilled') {
        const airMap: Record<string, number> = {};
        airResult.value.forEach((r: any) => {
          airMap[`${r.airline}|${r.route_name}`] = Number(r.rate_per_kg);
        });
        setHubAirlineRates(airMap);
      }

      if (hubResult.status === 'fulfilled') {
        const hMap: Record<string, number> = {};
        hubResult.value.forEach((r: any) => { hMap[r.route_name] = Number(r.rate_per_kg); });
        setHubRouteRates(hMap);
      }
    };
    fetchRates();
    return () => { active = false; };
  }, [user?.hub_id]);

  // Plain per-kg rate cascade (special-goods override -> exact
  // airline+route -> hub-default route -> company-wide route), mirroring
  // CargoForm.tsx's own local resolveRate exactly -- that function isn't
  // exported (create-form-local), so this is the same cascade
  // reimplemented here using the rate-lookup state this file already
  // fetches for itself above.
  const resolveRateForCargoEdit = (forAirline: string, forRoute: string, forContentType: string, forKg: number): number | null => {
    const special = resolveSpecialGoodsRate(specialGoodsRates, forContentType, forAirline, forKg, user.hub_id, forRoute, lagosHubIds);
    if (special != null) return special;
    const a = (forAirline || '').trim();
    const r = (forRoute || '').trim();
    if (a && r && hubAirlineRates[`${a}|${r}`] != null) return hubAirlineRates[`${a}|${r}`];
    if (a && r && hubAirlineRates[`${normalizeAirlineName(a)}|${r}`] != null) return hubAirlineRates[`${normalizeAirlineName(a)}|${r}`];
    if (r && hubRouteRates[r] != null) return hubRouteRates[r];
    if (r && standardRatesMap[r] != null) return standardRatesMap[r];
    const saved = localStorage.getItem("ehi_standard_cargo_rates");
    if (saved && r) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed[r] != null) return Number(parsed[r]);
      } catch {}
    }
    return null;
  };

  // Auto-calculate amount for cargo edits when Content Type, Airline,
  // Route, KG, or Screen Size changes -- full tiered cascade (size-tier ->
  // flat-tier -> per-kg rate with special-goods override -> minimum
  // charge floor), mirroring CargoForm.tsx's create-time autoAmount
  // exactly. The previous version of this effect only ever did a plain
  // per-kg airline+route lookup with no content-type awareness at all, so
  // editing weight/pieces on a special-goods (e.g. Perishable), flat-tier,
  // or size-tier cargo entry silently recalculated using the wrong
  // generic formula instead of that content type's actual configured
  // rate.
  useEffect(() => {
    if (!editingTx || editingTx.type !== 'cargo') return;
    const contentType = editingTx.contentType || '';
    const airline = editingTx.airline || '';
    const route = editingTx.route || '';
    const kg = parseFloat(kgInput) || 0;

    if (sizeTierContentTypeNames.has(contentType)) {
      const inches = Math.round(parseFloat(sizeInchesInput)) || 0;
      if (inches > 0) {
        const sized = resolveSizeTier(sizeTierRates, contentType, airline, route, inches, user.hub_id, lagosHubIds);
        if (sized != null) {
          setAmountInput(sized.toString());
          return;
        }
      }
    }

    if (kg <= 0) return;
    const flat = resolveFlatTier(flatTierRates, contentType, airline, route, kg, user.hub_id, lagosHubIds);
    if (flat != null) {
      setAmountInput(flat.toString());
      return;
    }
    const rate = resolveRateForCargoEdit(airline, route, contentType, kg);
    const minCharge = resolveMinimumCharge(minimumCharges, airline, route, kg);
    if (rate == null && minCharge == null) return;
    const computed = rate != null ? roundMoney(kg * rate) : 0;
    const final = minCharge != null ? Math.max(computed, minCharge) : computed;
    setAmountInput(final.toString());
  }, [
    editingTx?.airline, editingTx?.route, editingTx?.contentType, editingTx?.type,
    kgInput, sizeInchesInput,
    hubAirlineRates, hubRouteRates, standardRatesMap,
    specialGoodsRates, flatTierRates, sizeTierRates, sizeTierContentTypeNames, minimumCharges, lagosHubIds,
  ]);

  const [vjFlightFilter, setVjFlightFilter] = useState("All");
  const [vjDestFilter, setVjDestFilter] = useState("All");
  // General destination filter, replacing route/destination as a free-text
  // search field (see filteredEntries' search-text comment) -- unlike
  // vjDestFilter above (baggage-only, options scraped from whatever rows
  // happen to be loaded), this applies to every entry type and sources its
  // options from useHubRoutes() (`routes`, already fetched for the Edit
  // Transaction modal's own route selects), so a destination shows up here
  // even before any entry going there has loaded this session.
  const [destFilter, setDestFilter] = useState("All");
  const confirm = useConfirm();

  const [wallets, setWallets] = useState<CustomerWallet[]>([]);
  useEffect(() => {
    let active = true;
    const fetchWallets = async () => {
      try {
        // Narrow select: LiveCreditFeed (the only consumer of this Ledger-local
        // `wallets` state) reads only id/customer_name/customer_phone/balance
        // (plus updated_at driving this ORDER BY) -- CustomerWallets.tsx's own
        // full wallet-management screen fetches every column separately and is
        // untouched by this.
        const { data } = await supabase.from('customer_wallets').select('id,customer_name,customer_phone,balance,updated_at').order('updated_at', { ascending: false });
        if (active && data) setWallets(data as CustomerWallet[]);
      } catch {}
    };
    fetchWallets();

    const channel = supabase
      .channel('customer_wallets_ledger_realtime')
      // UPDATE: patch in-place — avoids a full SELECT * on every wallet change
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'customer_wallets' }, payload => {
        const updated = payload.new as any;
        setWallets(prev => prev.map(w => w.id === updated.id ? { ...w, ...updated } : w));
      })
      // INSERT: prepend the new wallet
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_wallets' }, payload => {
        const inserted = payload.new as any;
        setWallets(prev => [inserted, ...prev]);
      })
      // DELETE: drop it from local state -- CustomerWallets.tsx's
      // handleRemoveWallet/handleForceDelete both hard-delete the row (the
      // latter with no zero-balance restriction), and the old blanket `'*'`
      // subscription this replaced used to catch that via a full refetch.
      // Without this, a wallet deleted from another tab/session stayed
      // in this screen's Live Credit Feed -- balance, liability total and
      // all -- until a manual page reload.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'customer_wallets' }, payload => {
        const deletedId = (payload.old as any)?.id;
        if (!deletedId) return;
        setWallets(prev => prev.filter(w => w.id !== deletedId));
      })
      // wallet_transactions: trigger a targeted balance refresh for just that wallet
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, payload => {
        const walletId = (payload.new as any)?.wallet_id || (payload.old as any)?.wallet_id;
        if (!walletId) { fetchWallets(); return; }
        supabase.from('customer_wallets').select('id,customer_name,customer_phone,balance,updated_at').eq('id', walletId).single()
          .then(({ data }) => {
            if (data) setWallets(prev => prev.map(w => w.id === walletId ? { ...w, ...data } : w));
          });
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  // Current shift boundary. When an explicit hub_shifts shift is open, this
  // ledger's own "current shift" filter uses ITS real started_at -- it would
  // be confusing for the same screen that has the Start/End Day buttons to
  // ignore the very shift those buttons control. Falls back to the fixed
  // hub shift_start_hour boundary (default 18 / 6PM) when no shift is open,
  // which is still what Analytics/AirlinePerformance/EODReconciliation use
  // for their own "shift" period option -- those weren't migrated to the
  // explicit-shift system in this pass, so the two definitions intentionally
  // still coexist outside this one screen.
  const shiftHour: number = (user as any).shift_start_hour ?? 18;
  // Stable primitive keys instead of the raw activeShift/shifts references
  // below -- the caller (EHIApp.tsx's fetchInitial, feeding this both
  // directly and via More.tsx's Master Ledger) can hand down a
  // fresh-but-logically-identical activeShift/shifts on every poll/tab
  // switch; keying shiftBoundary's memo off id+timestamps instead means it
  // only recomputes when the shift DATA actually changes, not when its
  // wrapper object/array reference does. id/started_at/ended_at are the
  // only HubShift fields the memo body below reads. Same "stabilize the
  // consumer's own memo keys" fix as shiftsToMark got (see its comment
  // further down) -- this is the one other place in this file with the
  // identical shape of bug.
  const activeShiftKey = activeShift ? `${activeShift.id}:${activeShift.started_at}:${activeShift.ended_at ?? ''}` : '';
  const shiftsKey = useMemo(
    () => (shifts ?? []).map((s: any) => `${s.id}:${s.started_at}:${s.ended_at ?? ''}`).sort().join('|'),
    [shifts]
  );
  const shiftBoundary = useMemo((): { start: Date; end: Date | null } => {
    if (activeShift?.started_at) {
      // end: null while the shift is still open -- `end: new Date()` here
      // would freeze at whatever instant this memo last recomputed (only
      // re-runs when activeShift's own reference changes, i.e. shift
      // start/end events), silently excluding every transaction created
      // after that instant from "Current Shift" until the shift closes.
      return { start: new Date(activeShift.started_at), end: null };
    }
    // No shift open right now -- fall back to the most recently closed one
    // (by ended_at, or started_at for a still-forming record) rather than
    // the generic shift_start_hour cutoff, so "Current Shift" still means
    // an actual explicit shift wherever this hub has shift history.
    if (shifts && shifts.length > 0) {
      const mostRecent = [...shifts].sort((a: any, b: any) =>
        (b.ended_at || b.started_at).localeCompare(a.ended_at || a.started_at)
      )[0];
      if (mostRecent?.started_at) {
        return { start: new Date(mostRecent.started_at), end: mostRecent.ended_at ? new Date(mostRecent.ended_at) : null };
      }
    }
    return getShiftBoundary(shiftHour);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately
    // keyed on the derived primitive keys above, not activeShift/shifts
    // themselves (still read via closure); see comment above.
  }, [shiftHour, activeShiftKey, shiftsKey]);

  // "All Time" previously eagerly fetched up to 20,000 rows PER TABLE (up
  // to 80,000 total) into memory the instant it was clicked, then filtered
  // that giant in-memory set client-side. Replaced with server-side
  // keyset pagination via ledger_search_page/ledger_search_totals
  // (supabase/migrations/20260938_ledger_search_and_totals_rpc.sql): one
  // 500-row page across ALL entry types combined (not per table), newest
  // first, with search/type/terminal/office-work/debt-class narrowing
  // pushed server-side so a search or filter change doesn't require
  // downloading everything first. The KPI tiles source from a SEPARATE
  // always-correct aggregate RPC so they reflect every matching row, not
  // just whatever's currently loaded on screen (see displayTotals below).
  //
  // modeFilter's pseudo-values (Revenue/Expense/Unverified/Retrieved/Debt
  // Paid/Debt Clearance) and timeFilter/vjFlightFilter/vjDestFilter have
  // no server-side equivalent and deliberately keep applying only to
  // whatever's currently loaded (filteredEntries below already does this
  // unconditionally) -- a documented limitation for this first pass, not
  // a silent gap: see the caption rendered near the KPI tiles when one of
  // those is active while All Time is engaged.
  const [allTimeTxRows, setAllTimeTxRows] = useState<Transaction[]>([]);
  const [allTimeExpenseRows, setAllTimeExpenseRows] = useState<Expense[]>([]);
  const [allTimeCursor, setAllTimeCursor] = useState<LedgerCursor | null>(null);
  const [allTimeHasMore, setAllTimeHasMore] = useState(true);
  const [loadingAllTimeFirst, setLoadingAllTimeFirst] = useState(false);
  const [loadingAllTimeMore, setLoadingAllTimeMore] = useState(false);
  const [allTimeEngaged, setAllTimeEngaged] = useState(false);
  const [allTimeTotals, setAllTimeTotals] = useState<LedgerTotals | null>(null);
  const allTimeProfileLookupRef = useRef<Record<string, string>>({});
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const printMenuRef = useRef<HTMLDivElement>(null);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ehi_ledger_summary_expanded_v1') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSummaryExpanded = useCallback(() => {
    setIsSummaryExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ehi_ledger_summary_expanded_v1', String(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportOptions(false);
      }
      if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
        setShowPrintOptions(false);
      }
    };
    if (showExportOptions || showPrintOptions) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportOptions, showPrintOptions]);
  // Guards fetchAllTimeFirstPage/fetchAllTimeNextPage against an
  // out-of-order response -- e.g. a user searches "abc", then clears the
  // search before that request resolves; without this, the stale "abc"
  // response could land AFTER the correct (empty-search) one and overwrite
  // it with wrong results, or a stale in-flight "load more" tied to the OLD
  // search could get appended onto the NEW search's freshly-reset rows.
  // fetchAllTimeFirstPage increments this (a genuinely new search/filter
  // view); fetchAllTimeNextPage only reads it (continuing the SAME search's
  // pagination). Same pattern as EHIApp.tsx's fetchEpochRef.
  const allTimeFetchEpochRef = useRef(0);

  // p_mode on the RPC only accepts the 5 raw DB values -- the modeFilter
  // dropdown also has pseudo-values with no direct column equivalent
  // (see comment above), which stay client-side instead of being sent.
  const RAW_MODE_VALUES = ['Cash', 'Transfer', 'POS', 'Debt', 'Wallet'];

  const allTimeFilterParams: LedgerSearchParams = useMemo(() => {
    const typeFilterLower = typeFilter.toLowerCase();
    const isLegacy = typeFilterLower === 'legacy' || typeFilterLower === 'baggage' || typeFilterLower === 'marketing';
    const isRealType = ['cargo', 'package'].includes(typeFilterLower);
    const types: LedgerEntryType[] | null = isLegacy
      ? (['baggage', 'marketing'] as LedgerEntryType[])
      : isRealType
      ? [typeFilterLower as LedgerEntryType]
      : (typeFilter === 'Expense' ? [] : null);
    return {
      query: searchQuery,
      types,
      terminal: null,
      mode: RAW_MODE_VALUES.includes(modeFilter) ? modeFilter : null,
      officeWorkOnly: typeFilter === 'Office Work',
      debtClass: debtClassFilter !== 'All' ? debtClassFilter : null,
      includeExpenses: typeFilter === 'All' || typeFilter === 'Expense',
    };
  }, [searchQuery, typeFilter, modeFilter, debtClassFilter]);

  const splitPageRows = (rows: { transaction?: Transaction; expense?: Expense }[]) => {
    const tx: Transaction[] = [], exp: Expense[] = [];
    rows.forEach((r) => { if (r.transaction) tx.push(r.transaction); else if (r.expense) exp.push(r.expense); });
    return { tx, exp };
  };

  const fetchAllTimeFirstPage = useCallback(async (paramsOverride?: LedgerSearchParams) => {
    const activeParams = paramsOverride || allTimeFilterParams;
    const myEpoch = ++allTimeFetchEpochRef.current;
    setLoadingAllTimeFirst(true);
    // A stale in-flight "load more" belonging to whatever search was active
    // before this one must not be allowed to append onto the rows this call
    // is about to set -- its own epoch check below will make it a no-op
    // when it resolves, but reset the loading flag now rather than leaving
    // it stuck true with nothing left to clear it.
    setLoadingAllTimeMore(false);
    try {
      if (Object.keys(allTimeProfileLookupRef.current).length === 0) {
        allTimeProfileLookupRef.current = await fetchProfileLookup();
      }
      const [page, totals] = await Promise.all([
        fetchLedgerPage(activeParams, null, allTimeProfileLookupRef.current),
        fetchLedgerTotals(activeParams),
      ]);
      if (allTimeFetchEpochRef.current !== myEpoch) return; // superseded by a newer search while this was in flight
      const { tx, exp } = splitPageRows(page.rows);
      setAllTimeTxRows(tx);
      setAllTimeExpenseRows(exp);
      setAllTimeCursor(page.nextCursor);
      setAllTimeHasMore(page.hasMore);
      setAllTimeTotals(totals);
      setAllTimeEngaged(true);
    } catch (err: any) {
      if (allTimeFetchEpochRef.current === myEpoch) {
        showToast({ message: `Failed to load ledger history: ${err.message || err}`, type: 'error' });
      }
    } finally {
      if (allTimeFetchEpochRef.current === myEpoch) setLoadingAllTimeFirst(false);
    }
  }, [allTimeFilterParams, showToast]);

  const fetchAllTimeNextPage = useCallback(async () => {
    if (!allTimeHasMore || loadingAllTimeMore || loadingAllTimeFirst || !allTimeCursor) return;
    // Captured, not incremented -- this continues the CURRENT search's
    // pagination, not a new one, so it should be invalidated by (not itself
    // invalidate) a genuinely new search started via fetchAllTimeFirstPage.
    const myEpoch = allTimeFetchEpochRef.current;
    setLoadingAllTimeMore(true);
    try {
      const page = await fetchLedgerPage(allTimeFilterParams, allTimeCursor, allTimeProfileLookupRef.current);
      if (allTimeFetchEpochRef.current !== myEpoch) return; // the search changed while this page was in flight
      const { tx, exp } = splitPageRows(page.rows);
      setAllTimeTxRows(prev => [...prev, ...tx]);
      setAllTimeExpenseRows(prev => [...prev, ...exp]);
      setAllTimeCursor(page.nextCursor);
      setAllTimeHasMore(page.hasMore);
    } catch (err: any) {
      if (allTimeFetchEpochRef.current === myEpoch) {
        showToast({ message: `Failed to load more history: ${err.message || err}`, type: 'error' });
      }
    } finally {
      if (allTimeFetchEpochRef.current === myEpoch) setLoadingAllTimeMore(false);
    }
  }, [allTimeFilterParams, allTimeCursor, allTimeHasMore, loadingAllTimeMore, loadingAllTimeFirst, showToast]);

  // Search/type/terminal/mode/debt-class change while All Time is already
  // engaged -> reset to page 1 under the new params. The scope button's
  // own onClick handles the FIRST engagement (see below); this effect only
  // fires on subsequent param changes so switching to All Time doesn't
  // double-fetch.
  const allTimeParamsKey = JSON.stringify(allTimeFilterParams);
  const prevAllTimeParamsKeyRef = useRef(allTimeParamsKey);
  useEffect(() => {
    if (shiftFilter !== 'all' || !allTimeEngaged) { prevAllTimeParamsKeyRef.current = allTimeParamsKey; return; }
    if (prevAllTimeParamsKeyRef.current === allTimeParamsKey) return;
    prevAllTimeParamsKeyRef.current = allTimeParamsKey;
    fetchAllTimeFirstPage(allTimeFilterParams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTimeParamsKey, shiftFilter, allTimeEngaged]);

  // After any write action while All Time is engaged (clear debt, confirm
  // payment, retrieval, edit-save all funnel through onUpdateTx/onDeleteTx,
  // which changes the `transactions`/`expenses` props), re-fetch just the
  // aggregate totals (cheap) so the KPI tiles don't go stale relative to an
  // edit made against a currently-loaded row -- the row list itself already
  // reflects the edit immediately via mergedTransactions'/mergedExpenses'
  // merge-by-id logic below, only the server-computed aggregate needs an
  // explicit nudge. Debounced since a bulk action can touch several rows.
  useEffect(() => {
    if (shiftFilter !== 'all' || !allTimeEngaged) return;
    const t = setTimeout(() => {
      fetchLedgerTotals(allTimeFilterParams).then(setAllTimeTotals).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, expenses]);

  // shiftFilter === 'all' (All Time engaged) sources from the paginated
  // fetch above, refreshed against the live `transactions`/`expenses` props
  // (prop wins on id collision, so a same-session edit made from within the
  // Ledger -- Edit Transaction, Clear Debt, Confirm Payment, Retrieval --
  // shows immediately without waiting for a refetch) -- otherwise
  // unchanged, sourcing from `transactions`/`expenses` alone exactly as
  // before this fix.
  //
  // Only REFRESHES ids already present in allTimeTxRows/allTimeExpenseRows
  // -- does not append the rest of the prop array. transactions/expenses
  // are EHIApp.tsx's own separate, date-range-bounded fetch (up to several
  // thousand rows, independently growable via the Ledger's own "Load More"
  // button) and were previously unioned in WHOLESALE the instant All Time
  // engaged, on top of the paginated rows -- ballooning the merged list to
  // tens of thousands of rows in one render and blowing well past what the
  // row/card virtualizers below were sized for, which is what actually hit
  // the ErrorBoundary ("the ledger hit a snag") the moment All Time was
  // clicked. A brand-new entry (created from Cargo/Marketing/Package --
  // never the Ledger itself) simply appears on the next natural All Time
  // refetch instead of instantly; every edit path that matters here always
  // targets an already-loaded (and therefore already-keyed) row.
  const mergedTransactions = useMemo(() => {
    if (shiftFilter !== 'all' || !allTimeEngaged) return transactions;
    const byId = new Map<string, Transaction>();
    allTimeTxRows.forEach(t => byId.set(t.id, t));
    transactions.forEach(t => byId.set(t.id, t));
    return Array.from(byId.values());
  }, [transactions, allTimeTxRows, allTimeEngaged, shiftFilter]);

  const mergedExpenses = useMemo(() => {
    if (shiftFilter !== 'all' || !allTimeEngaged) return expenses;
    const byId = new Map<string, Expense>();
    allTimeExpenseRows.forEach(e => byId.set(e.id, e));
    expenses.forEach(e => byId.set(e.id, e));
    return Array.from(byId.values());
  }, [expenses, allTimeExpenseRows, allTimeEngaged, shiftFilter]);

  const entries = useMemo(() => {
    const list: Entry[] = [
      ...mergedTransactions.map((t) => {
        const dtStr = t.created_at || t.time;
        const d = dtStr ? new Date(dtStr) : null;
        let displayDate = 'Unknown date';
        let displayDateMobile = 'Unknown';
        let displayTime = t.time || '';
        let _sortTime = 0;
        if (d && !isNaN(d.getTime())) {
          _sortTime = d.getTime();
          displayDate = d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
          displayDateMobile = d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });
          displayTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
        return {
          ...t,
          source: "transaction" as const,
          raw: t,
          _sortTime,
          displayDate,
          displayDateMobile,
          displayTime,
        };
      }),
      ...mergedExpenses.map((e) => {
        const dtStr = e.time;
        const d = dtStr ? new Date(dtStr) : null;
        let displayDate = 'Unknown date';
        let displayDateMobile = 'Unknown';
        let displayTime = e.time || '';
        let _sortTime = 0;
        if (d && !isNaN(d.getTime())) {
          _sortTime = d.getTime();
          displayDate = d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
          displayDateMobile = d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });
          displayTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
        return {
          id: e.id,
          time: e.time,
          type: "expense",
          name: e.type || 'Expense',
          detail: e.logged_by ? `${e.description} (Logged by: ${e.logged_by})` : e.description,
          amount: e.amount,
          mode: e.mode || "Expense",
          status: e.status || "N/A",
          source: "expense" as const,
          raw: e,
          paymentConfirmed: e.posApprovalCode ? true : false,
          posApprovalCode: e.posApprovalCode,
          _sortTime,
          displayDate,
          displayDateMobile,
          displayTime,
        };
      }),
    ];
    return list.sort((a: any, b: any) => {
      const timeA = a._sortTime || 0;
      const timeB = b._sortTime || 0;
      
      // If both have timestamps, sort descending
      if (timeA && timeB) {
        return timeB - timeA;
      }
      
      // Fallback to alphabetical sorting by time string if both lack timestamps
      if (a.time > b.time) return -1;
      if (a.time < b.time) return 1;
      return 0;
    });
  }, [mergedTransactions, mergedExpenses]);

  // viewingDetail/clearDebtEntry are value snapshots captured once at click
  // time (see their setters below), never otherwise re-synced -- clearing
  // this same debt from elsewhere (another agent, another tab, a realtime
  // event) left an already-open modal showing stale data until the user
  // manually closed and reopened it. Neither modal holds local-only draft
  // state of its own (the clear-debt payment form fields live in separate
  // clearDebtMode/clearDebtBank/clearDebtWallet state below), so re-seeding
  // the whole snapshot from the live `entries` array whenever it changes is
  // safe and keeps both modals -- and anything printed/reprinted from them
  // -- current without requiring a manual refresh.
  useEffect(() => {
    if (!viewingDetail) return;
    const fresh = entries.find(e => e.id === viewingDetail.id);
    if (fresh && fresh !== viewingDetail) setViewingDetail(fresh as Entry);
  }, [entries]);

  useEffect(() => {
    if (!clearDebtEntry) return;
    const fresh = entries.find(e => e.id === clearDebtEntry.id);
    if (!fresh) return;
    if (fresh.mode !== 'Debt') {
      // Fully settled (or reopened into a non-Debt mode) by another
      // action while this modal was still open -- nothing left to clear.
      setClearDebtEntry(null);
      showToast({ message: 'This debt was already settled elsewhere', type: 'info' });
      return;
    }
    if (fresh !== clearDebtEntry) setClearDebtEntry(fresh as Entry);
  }, [entries]);

  // Single source of truth (src/lib/officeWork.ts) shared with
  // DebtorsTab.tsx and Analytics.tsx, so the Office/Individual split can't
  // drift between screens the way it already had once (see that file's own
  // comment). e.raw is the Transaction; isOfficeWorkEntryCore also matches
  // "office work" typed anywhere in the remark, not just a real
  // corporate-client link.
  const isOfficeWorkEntry = (e: Entry): boolean => isOfficeWorkEntryCore(e.raw);

  const filteredEntries = useMemo(() => entries.filter((e) => {
    if (debtClassFilter !== 'All') {
      if (e.mode !== 'Debt') return false;
      const isOffice = isOfficeWorkEntry(e);
      if (debtClassFilter === 'Office' && !isOffice) return false;
      if (debtClassFilter === 'Individual' && isOffice) return false;
    }

    if (typeFilter !== "All") {
      if (typeFilter === "Office Work") {
        if (!isOfficeWorkEntry(e)) return false;
      } else if (typeFilter === "Legacy") {
        if (e.type !== 'baggage' && e.type !== 'marketing' && e.type !== 'legacy') return false;
      } else if (e.type !== typeFilter.toLowerCase()) {
        return false;
      }
    }

    if ((typeFilter.toLowerCase() === 'legacy' || typeFilter.toLowerCase() === 'baggage') && e.source === 'transaction') {
      const tx = e.raw as Transaction;
      if (vjFlightFilter !== "All" && tx.flight !== vjFlightFilter) return false;
      if (vjDestFilter !== "All" && tx.destination !== vjDestFilter) return false;
    }

    // General destination filter -- applies across every entry type
    // (cargo/marketing carry it as `route`, baggage/package as
    // `destination`), unlike vjDestFilter above which is baggage-only.
    // cleanRoute() on both sides absorbs the casing/"Air Cargo Station"
    // suffix drift. Expenses have no route/destination and are excluded.
    if (destFilter !== "All") {
      if (e.source === 'expense') return false;
      const raw = e.raw as any;
      const entryDest = (e.type === 'cargo' || e.type === 'marketing') ? raw?.route : raw?.destination;
      if (cleanRoute(entryDest) !== cleanRoute(destFilter)) return false;
    }

    if (modeFilter !== "All") {
      if (modeFilter === "Revenue") {
        if (e.source === "expense" || e.mode === "Debt") return false;
      } else if (modeFilter === "Expense") {
        if (e.source !== "expense") return false;
      } else if (modeFilter === "Unverified") {
        if (!((e.mode === 'Cash' || e.mode === 'Transfer' || e.mode === 'POS') && !e.raw.paymentConfirmed)) return false;
      } else if (modeFilter === "Retrieved") {
        const raw = e.raw as any;
        const retAmt = Number(raw?.retrieved_amount ?? raw?.raw?.retrieved_amount ?? 0);
        const isRet = raw?.retrieved === true || raw?.raw?.retrieved === true || retAmt > 0;
        if (!isRet) return false;
      } else if (modeFilter === "Debt Clearance" || modeFilter === "Debt Paid") {
        // Show BOTH the original entry whose mode flipped to 'Debt Paid' AND
        // any DC-... shadow collection entry created when a debt was cleared.
        const isDC = (e.raw as any)?.is_debt_clearance || e.id?.startsWith('DC-');
        const isPaidMode = e.mode.toLowerCase() === 'debt paid';
        if (!isPaidMode && !isDC) return false;
      } else {
        if (e.mode.toLowerCase() !== modeFilter.toLowerCase()) return false;
      }
    }

    if (timeFilter !== "All") {
      const tm = ((): { hour: number; minute: number } | null => {
        if (e.raw?.created_at) {
          const d = new Date(e.raw.created_at);
          if (!isNaN(d.getTime())) return { hour: d.getHours(), minute: d.getMinutes() };
        }
        if ((e as any)._sortTime && (e as any)._sortTime > 0) {
          const d = new Date((e as any)._sortTime);
          if (!isNaN(d.getTime())) return { hour: d.getHours(), minute: d.getMinutes() };
        }
        if (e.time) {
          const match = e.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
          if (match) {
            let h = parseInt(match[1], 10);
            const m = parseInt(match[2], 10);
            const ampm = match[3]?.toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            return { hour: h, minute: m };
          }
        }
        return null;
      })();

      if (tm) {
        const totalMins = tm.hour * 60 + tm.minute;
        if (timeFilter === "Morning") {
          // 06:00 to 11:59 (360 to 719 mins)
          if (totalMins < 360 || totalMins >= 720) return false;
        } else if (timeFilter === "Afternoon") {
          // 12:00 to 16:59 (720 to 1019 mins)
          if (totalMins < 720 || totalMins >= 1020) return false;
        } else if (timeFilter === "Evening") {
          // 17:00 to 23:59 (1020 to 1439 mins)
          if (totalMins < 1020) return false;
        } else if (timeFilter === "Custom") {
          if (timeStart) {
            const [sh, sm] = timeStart.split(':').map(Number);
            const startMins = (sh || 0) * 60 + (sm || 0);
            if (totalMins < startMins) return false;
          }
          if (timeEnd) {
            const [eh, em] = timeEnd.split(':').map(Number);
            const endMins = (eh || 0) * 60 + (em || 0);
            if (totalMins > endMins) return false;
          }
        }
      }
    }

    // Shift filter — only show entries inside the current operational shift
    // when shiftFilter === 'current'. This is the key fix that replaces the
    // implicit "today since midnight" assumption with the real 7PM–7PM window.
    if (shiftFilter === 'current') {
      const { start, end } = shiftBoundary;
      // Was only ever checking created_at -- clearing a debt on an entry
      // logged days/weeks ago (handleClearDebt/DebtorsTab, or the RPC path)
      // sets confirmedAt/paymentHistory[].at to "now" but never touches
      // created_at, so a debt cleared THIS shift on an old entry was silently
      // excluded from "Current Shift" -- invisible to the very agent who just
      // cleared it. Same candidate timestamps as the attribution badge below
      // (editedAt/confirmedAt/last payment), taking the MOST RECENT one so an
      // entry shows up under whichever shift its latest activity happened in.
      const raw = e.raw as any;
      const lastPayment = Array.isArray(raw?.paymentHistory) && raw.paymentHistory.length > 0
        ? raw.paymentHistory[raw.paymentHistory.length - 1]
        : null;
      // The editedAt/confirmedAt/lastPayment broadening only applies to
      // debt-related entries -- restricted here after this same broadening
      // was found to inflate the Cash/Total KPI tiles: confirming an
      // old, previously-unconfirmed CASH sale today (toggleConfirm just
      // stamps confirmedAt) folded that entry's full original amount into
      // today's shift totals even though no cash was actually collected
      // today. For debt clearance specifically that's correct and
      // intentional (the whole reason this broadening exists) since the
      // debt-recovered figures are tracked separately from the raw
      // `amount` the KPI tiles sum.
      const isDebtRelated = e.mode === 'Debt' || e.mode === 'Debt Paid' || !!raw?.is_debt_clearance;
      const candidateTimes = [e.raw?.created_at, (e as any)._sortTime, ...(isDebtRelated ? [raw?.editedAt, raw?.confirmedAt, lastPayment?.at] : [])]
        .map((v) => (v ? new Date(v).getTime() : NaN))
        .filter((t) => !isNaN(t));
      const entryTime = candidateTimes.length > 0 ? new Date(Math.max(...candidateTimes)) : null;
      if (entryTime && (entryTime < start || (end && entryTime >= end))) return false;
    }

    // When viewing custom date range, clamp entries to the selected dateRange
    if (shiftFilter === 'all' && dateRange?.start && dateRange?.end) {
      const raw = e.raw as any;
      const candidateTimes = [raw?.created_at, (e as any)._sortTime, raw?.editedAt, raw?.confirmedAt]
        .map((v) => (v ? new Date(v).getTime() : NaN))
        .filter((t) => !isNaN(t));
      const entryTime = candidateTimes.length > 0 ? new Date(Math.max(...candidateTimes)) : null;
      if (entryTime) {
        const startBound = parseLocalDateBoundary(dateRange.start);
        const endBound = parseLocalDateBoundary(dateRange.end);
        endBound.setDate(endBound.getDate() + 1);
        if (entryTime < startBound || entryTime >= endBound) return false;
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const raw = e.raw as any;
      // Comprehensive searchable text surface: IDs, names (sender, consignee, passenger),
      // references (AWB, tag, PNR, flight, bank ref, POS code, PIN), amounts, routes, and remarks.
      const text =
        `${e.id} ${e.time} ${e.type} ${e.name} ${e.detail} ${e.mode} ${e.amount} ${fmt(e.amount)} ${raw?.awb_tag_number || ''} ${e.airline_awb || raw?.airline_awb || ''} ${raw?.remarks || ''} ${raw?.remark || ''} ${raw?.related_tx_id || ''} ${raw?.phone || ''} ${raw?.consignee_phone || ''} ${raw?.consigneePhone || ''} ${raw?.customer_phone || ''} ${raw?.passenger_phone || ''} ${raw?.consignee || ''} ${raw?.consignee_name || ''} ${raw?.passenger_name || ''} ${raw?.customer_name || ''} ${raw?.pnr || ''} ${raw?.flight || ''} ${raw?.flight_no || ''} ${raw?.pickupPin || ''} ${raw?.pickup_pin || ''} ${raw?.bankReference || ''} ${raw?.bank_reference || ''} ${raw?.bankSender || ''} ${raw?.bank_sender || ''} ${raw?.posApprovalCode || ''} ${raw?.pos_approval_code || ''} ${raw?.airline || ''} ${raw?.contents || ''} ${raw?.contentType || ''} ${raw?.content_type || ''} ${raw?.route || ''} ${raw?.destination || ''} ${(e as any).enteredByName || raw?.entered_by || ''}`.toLowerCase();
      if (!text.includes(q)) return false;
    }

    return true;
  }), [entries, typeFilter, modeFilter, timeFilter, timeStart, timeEnd, searchQuery, shiftFilter, shiftBoundary, vjFlightFilter, vjDestFilter, destFilter, debtClassFilter, dateRange, allTimeEngaged]);

  // Per-airline weight/pieces/revenue roll-up for whatever's currently in
  // filteredEntries -- recomputes with every filter change so it always
  // matches what's actually on screen (e.g. just today's Cargo, or just one
  // airline's baggage). Only cargo/baggage carry a meaningful airline+kg
  // pairing; marketing/package entries and expenses are excluded rather than
  // silently lumped into a fake "Unknown" bucket.
  const airlineManifestSummary = useMemo(() => {
    const byAirline = new Map<string, { airline: string; entries: number; kg: number; pieces: number; amount: number }>();
    filteredEntries.forEach((e) => {
      if (e.source !== 'transaction') return;
      if (e.type !== 'cargo' && e.type !== 'baggage') return;
      const raw = e.raw as any;
      if (!raw?.airline) return;
      const key = normalizeAirlineName(raw.airline);
      const kg = Number(raw.totalKg ?? raw.excessKg ?? raw.kg ?? 0) || 0;
      const pieces = Number(raw.pieces ?? 1) || 0;
      const existing = byAirline.get(key) || { airline: key, entries: 0, kg: 0, pieces: 0, amount: 0 };
      existing.entries += 1;
      existing.kg += kg;
      existing.pieces += pieces;
      existing.amount += Number(e.amount || 0);
      byAirline.set(key, existing);
    });
    return Array.from(byAirline.values()).sort((a, b) => b.kg - a.kg);
  }, [filteredEntries]);

  const userHubCode = getHubCode(user.hub_code || user.hub);

  // The entry open in the Edit modal has nothing left to owe -- every naira
  // is already recorded as paid, retrieved, or wallet-deducted. "Customer
  // Wallet" is disabled for it in the Payment Mode dropdown: charging a
  // wallet against a settled entry only double-charges the customer (use
  // Reopen Debt to correct a wrong payment instead).
  const editFullySettled = !!editingTx && (
    editOriginalMode === 'Debt Paid' ||
    roundMoney((editingTx.amountPaid || 0) + ((editingTx.raw as any)?.retrieved_amount || 0) + editOriginalWalletDeduction)
      >= roundMoney(editingTx.amount || 0)
  );

  const handleEditClick = (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    // Debt-collection rows (real historical shadow rows, or the synthetic
    // ones derived live from payment_history -- see
    // 20260941_debt_collection_events.sql) are a record of a payment
    // event, not an editable entity -- there's no backing row for a
    // synthetic id to save changes against, and even a real historical
    // shadow row was never meant to be edited. Defense-in-depth alongside
    // the Edit button's own render guard below.
    if (e.source === "transaction" && (e.raw as any)?.is_debt_clearance) return;
    if (e.source === "transaction") {
      const tx = { ...e.raw } as Transaction;
      refetchCustomerWallets?.();
      setEditingTx(tx);
      setEditOriginalMode(tx.mode);
      setEditOriginalWalletDeduction(tx.wallet_deduction_amount || 0);
      setEditWallet(null);
      setEditWalletRemainderMode('Cash');
      setEditWalletRemainderBank('');
      setPieceInput(String(tx.pieces ?? ''));
      setKgInput(String(tx.kg ?? ''));
      setAmountInput(String(tx.amount ?? ''));
      setEditCustomContentType('');
      setEditCustomContents('');
      setSizeInchesInput(tx.sizeInches != null ? String(tx.sizeInches) : '');
      if (tx.type === 'marketing') {
        const bagsStr = tx.detail?.split(' · ')[1] || '';
        setEditBagCounts({
          bb: bagsStr.match(/(\d+)\s*BB/)?.[1] || '0',
          mb: bagsStr.match(/(\d+)\s*MB/)?.[1] || '0',
          sb: bagsStr.match(/(\d+)\s*SB/)?.[1] || '0',
        });
      }
    }
  };

  const handleSaveEdit = async () => {
    if (!editingTx) return;
    // Synchronous, first line -- a fast double-click/double-tap on Save
    // Changes previously reached the async wallet-charge branch below
    // twice before React re-rendered the button's disabled state,
    // double-deducting the same customer's wallet for one edit.
    if (savingEdit) return;
    setSavingEdit(true);
    // Everything below is wrapped in try/finally -- setSavingEdit(true)
    // now guards the WHOLE save (previously only the wallet-charge branch),
    // so an unhandled exception anywhere in here (e.g. chargeWalletForSale's
    // underlying RPC call throwing instead of resolving to {ok:false}) must
    // still release the lock, or every future edit attempt -- for any
    // transaction, not just this one -- would find the Save button
    // permanently disabled until a page reload.
    try {
      const pieces = parseInt(pieceInput) || 0;
      const kg = parseFloat(kgInput) || 0;
      const amount = parseFloat(amountInput) || 0;
      const bb = parseInt(editBagCounts.bb) || 0;
      const mb = parseInt(editBagCounts.mb) || 0;
      const sb = parseInt(editBagCounts.sb) || 0;
      if (amount < 0 || pieces < 0 || kg < 0 || bb < 0 || mb < 0 || sb < 0) {
        showToast({ message: 'Amount, pieces, weight, and bag counts cannot be negative.', type: 'warning' });
        return;
      }
      if (editingTx.type === 'package' && amount < MIN_PACKAGE_AMOUNT) {
        showToast({ message: `Package/Parcel transactions must have an amount of at least ₦${MIN_PACKAGE_AMOUNT.toLocaleString()}`, type: 'warning' });
        return;
      }
      // Amount can never be edited below what's already been recorded as
      // paid (a partial debt payment), retrieved (goods already released
      // against this balance), OR wallet-deducted (money already taken from
      // a customer's wallet against this entry, whether from intake or an
      // earlier wallet-split edit) -- doing so would drive the true
      // remaining balance negative, silently corrupting DebtorsTab's/
      // CreditDebit's balance math and every clear_*_debt RPC's own
      // remaining-balance check (all of which subtract both amountPaid AND
      // retrieved_amount, not amountPaid alone -- see clear_cargo_debt's
      // formula). This previously only checked amountPaid, so a Debt-mode
      // entry that had already been partially retrieved (or wallet-split)
      // could still have its amount edited down below what was actually
      // collected, silently clamped to a 0 balance server-side with the
      // real gap unrecoverable through the normal clear-debt flow.
      const alreadyAccountedFor = (editingTx.amountPaid || 0) + ((editingTx.raw as any)?.retrieved_amount || 0) + editOriginalWalletDeduction;
      if (alreadyAccountedFor > 0 && amount < alreadyAccountedFor) {
        showToast({ message: `Amount cannot be reduced below the ₦${fmt(alreadyAccountedFor)} already recorded as paid, retrieved, or wallet-deducted on this entry.`, type: 'warning' });
        return;
      }

      // Picking "Customer Wallet" as the Payment Mode here means "settle this
      // debt from the customer's wallet". It is ONLY valid for a Debt entry
      // that still has an outstanding balance, and it is routed through
      // clear_*_debt (with p_wallet_id) -- so the payment lands in
      // payment_history / amount_paid and the entry reads "Debt Cleared" like
      // any other cleared debt. It is NEVER a bare wallet charge from this
      // screen any more: charging an already-settled entry silently
      // double-charged the customer and left contradictory state (the old
      // chargeWalletForSale path), and charging an OPEN debt this way wrote
      // nothing to payment_history. Any correction to how a debt was already
      // paid goes through "Reopen Debt" first.
      if (editingTx.mode === 'Wallet' && editOriginalMode !== 'Wallet') {
        if (editOriginalWalletDeduction > 0) {
          showToast({ message: 'This entry already has a wallet contribution recorded. Use "Reopen Debt" to correct how it was paid.', type: 'error' });
          return;
        }
        const debtRemaining = roundMoney(
          (editingTx.amount || 0) - (editingTx.amountPaid || 0) - ((editingTx.raw as any)?.retrieved_amount || 0)
        );
        if (debtRemaining <= 0) {
          showToast({ message: `This shipment is already fully settled (₦${fmt(alreadyAccountedFor)} recorded as paid/retrieved). Charging the wallet now would double-charge the customer -- use "Reopen Debt" first if the recorded payment was wrong.`, type: 'error' });
          return;
        }
        if (!editWallet) {
          showToast({ message: 'Select a customer wallet to charge before saving.', type: 'warning' });
          return;
        }
        const walletPay = Math.min(debtRemaining, editWallet.balance);
        if (walletPay <= 0) {
          showToast({ message: `${editWallet.customer_name}'s wallet has no balance to apply.`, type: 'warning' });
          return;
        }
        // Whatever the wallet can't cover MUST be collected now by a second
        // tender -- a wallet settlement always fully clears the debt (no more
        // "the rest stays on this debt" stub that needs a callback to finish).
        // WalletRemainderSelector in the modal + the Save button's own guard
        // already force a bank for Transfer/POS; this is the last-line check.
        const remainder = roundMoney(Math.max(0, debtRemaining - walletPay));
        if (
          remainder > 0 &&
          (editWalletRemainderMode === 'Transfer' || editWalletRemainderMode === 'POS') &&
          !editWalletRemainderBank.trim()
        ) {
          showToast({ message: `Enter the bank/terminal for the ₦${fmt(remainder)} ${editWalletRemainderMode} remainder.`, type: 'warning' });
          return;
        }
        const settleLoggedBy = user.name || 'Unknown';

        // Leg 1 -- the wallet. clear_*_debt(p_wallet_id) debits the wallet,
        // writes the linked deduction row + wallet_txn_id tag, and bumps
        // amount_paid, all in one DB transaction.
        const s1 = await clearDebt({
          type: editingTx.type as DebtEntryType,
          id: editingTx.id,
          paymentAmount: walletPay,
          paymentMode: 'Wallet',
          walletId: editWallet.id,
          loggedBy: settleLoggedBy,
          expectedRemaining: debtRemaining,
        });
        if (!s1.ok) {
          showToast({ message: s1.error || 'Failed to settle this debt from the wallet. Nothing was charged.', type: 'error' });
          return;
        }

        // wallet_txn_id must ride along -- onUpdateTx writes this optimistic
        // payment_history back over the server's, and reopen_*_debt needs the
        // tag to find + refund the wallet later.
        const walletHist = {
          amount: walletPay, mode: 'Wallet' as const, by: settleLoggedBy, at: new Date().toISOString(),
          ...(s1.walletTxnId ? { wallet_txn_id: s1.walletTxnId } : {}),
        };

        // Leg 2 -- the remainder, by the chosen Cash/Transfer/POS method.
        // NOT atomic with leg 1: if it fails, the wallet leg still stands
        // (the customer really did pay that part) and the entry is left as a
        // normal partial debt for the remainder -- recoverable by clearing it
        // again from the ledger, never a double charge.
        let s2: Awaited<ReturnType<typeof clearDebt>> | null = null;
        if (remainder > 0) {
          s2 = await clearDebt({
            type: editingTx.type as DebtEntryType,
            id: editingTx.id,
            paymentAmount: remainder,
            paymentMode: editWalletRemainderMode,
            bank: editWalletRemainderMode !== 'Cash' ? editWalletRemainderBank.trim() : undefined,
            loggedBy: settleLoggedBy,
            expectedRemaining: s1.remainingBalance,
          });
        }

        const resetEditWalletState = () => {
          setEditingTx(null);
          setEditWallet(null);
          setEditOriginalMode(null);
          setEditOriginalWalletDeduction(0);
          setEditWalletRemainderMode('Cash');
          setEditWalletRemainderBank('');
        };

        if (remainder > 0 && (!s2 || !s2.ok)) {
          // Wallet leg recorded, remainder leg didn't -- reflect the wallet
          // leg optimistically, leave the debt open for the remainder, and
          // tell the user the exact amount still to collect.
          const partial: Transaction = {
            ...editingTx,
            amountPaid: s1.newAmountPaid ?? ((editingTx.amountPaid || 0) + walletPay),
            paymentHistory: [...(editingTx.paymentHistory || []), walletHist],
            mode: 'Debt',
          };
          onUpdateTx(partial);
          writeAuditLog({
            user_id: user.id, user_name: settleLoggedBy, action: 'DEBT_COLLECTION',
            table_name: RETRIEVAL_TABLE_NAME[editingTx.type as RetrievalEntryType], record_id: editingTx.id,
            description: `₦${fmt(walletPay)} collected against ${editingTx.name}'s debt via Customer Wallet (₦${fmt(remainder)} ${editWalletRemainderMode} remainder did NOT record)`,
            hub: hubNames[editingTx.hub_id || ''] || editingTx.hub, hub_id: editingTx.hub_id,
            old_values: { amount_paid: editingTx.amountPaid || 0 },
            new_values: { amount_paid: s1.newAmountPaid, mode: 'Wallet', amount: walletPay },
          }).catch(() => {});
          refetchCustomerWallets?.();
          showToast({
            message: `₦${fmt(walletPay)} taken from ${editWallet.customer_name}'s wallet, but the ₦${fmt(remainder)} ${editWalletRemainderMode} leg didn't record${s2?.error ? ` (${s2.error})` : ''} -- clear the remaining ₦${fmt(remainder)} again from the ledger.`,
            type: 'error',
          });
          if (viewingDetail && viewingDetail.id === editingTx.id) {
            setViewingDetail({ ...viewingDetail, mode: 'Debt', raw: partial });
          }
          resetEditWalletState();
          return;
        }

        // Both legs done (or the wallet covered it all) -- the debt is settled.
        const finalRes = s2 && s2.ok ? s2 : s1;
        const totalCollected = walletPay + remainder;
        const stillOwed = finalRes.remainingBalance ?? 0;
        const fullyPaid = finalRes.fullyPaid ?? (stillOwed <= 0);
        const history = [
          ...(editingTx.paymentHistory || []),
          walletHist,
          ...(remainder > 0
            ? [{ amount: remainder, mode: editWalletRemainderMode, by: settleLoggedBy, at: new Date().toISOString() }]
            : []),
        ];
        const settled: Transaction = {
          ...editingTx,
          amountPaid: finalRes.newAmountPaid ?? ((editingTx.amountPaid || 0) + totalCollected),
          paymentHistory: history,
          // finalRes.newMode is the RPC's own real final value -- trust it
          // over an assumed 'Debt Paid' the same way amountPaid just above
          // trusts newAmountPaid, so this object's redundant onUpdateTx
          // write below can't overwrite a same-shift reclassification back
          // to plain 'Debt' a moment after the RPC set it correctly.
          mode: fullyPaid ? (finalRes.newMode || 'Debt Paid') : 'Debt',
          paymentConfirmed: fullyPaid,
          confirmedBy: fullyPaid ? settleLoggedBy : editingTx.confirmedBy,
          confirmedAt: fullyPaid ? new Date().toISOString() : editingTx.confirmedAt,
          ...(editingTx.type === 'package' && fullyPaid ? { debtPaid: true, debtPaidAt: new Date().toISOString() } : {}),
        };
        onUpdateTx(settled);
        writeAuditLog({
          user_id: user.id, user_name: settleLoggedBy, action: 'DEBT_COLLECTION',
          table_name: RETRIEVAL_TABLE_NAME[editingTx.type as RetrievalEntryType], record_id: editingTx.id,
          description: `₦${fmt(totalCollected)} collected against ${editingTx.name}'s debt — ₦${fmt(walletPay)} Customer Wallet${remainder > 0 ? ` + ₦${fmt(remainder)} ${editWalletRemainderMode}` : ''}${stillOwed > 0 ? ` (₦${fmt(stillOwed)} still owed)` : ' (fully cleared)'}`,
          hub: hubNames[editingTx.hub_id || ''] || editingTx.hub, hub_id: editingTx.hub_id,
          old_values: { amount_paid: editingTx.amountPaid || 0 },
          new_values: { amount_paid: finalRes.newAmountPaid, mode: remainder > 0 ? `Wallet+${editWalletRemainderMode}` : 'Wallet', amount: totalCollected },
        }).catch(() => {});
        refetchCustomerWallets?.();
        showToast({
          message: fullyPaid
            ? (remainder > 0
                ? `Debt cleared — ₦${fmt(walletPay)} from ${editWallet.customer_name}'s wallet + ₦${fmt(remainder)} ${editWalletRemainderMode}`
                : `Debt cleared from ${editWallet.customer_name}'s wallet`)
            : `₦${fmt(totalCollected)} applied -- ₦${fmt(stillOwed)} still owed`,
          type: fullyPaid ? 'success' : 'warning',
        });
        if (viewingDetail && viewingDetail.id === editingTx.id) {
          setViewingDetail({ ...viewingDetail, mode: fullyPaid ? 'Debt Paid' : 'Debt', raw: settled });
        }
        resetEditWalletState();
        return;
      }
      const walletId = editingTx.wallet_id;
      const walletDeduction = editingTx.wallet_deduction_amount;
      const finalMode = editingTx.mode;
      const finalBank = editingTx.bank;

      // Details fields (name, route, pieces, weight, etc.) are edited as
      // discrete fields, but `detail` is the composed string the rest of the
      // app (ledger rows, receipts) displays -- rebuild it here so the
      // optimistic local update stays consistent with what a refetch from
      // Supabase will later reconstruct (see EHIApp.tsx's fetchInitial).
      const finalTx: Transaction = { ...editingTx, pieces, kg, amount, mode: finalMode, bank: finalBank, wallet_id: walletId, wallet_deduction_amount: walletDeduction };
      finalTx.editedBy = user.name;
      finalTx.editedAt = new Date().toISOString();
      if (finalTx.type === 'cargo') {
        const rawAwb = (editingTx.airline_awb || '').trim();
        if (rawAwb) {
          if (!isValidAirlineAwb(rawAwb)) {
            showToast({ message: "Airline AWB must be 11 digits (e.g. 072-12345678)", type: "error" });
            return;
          }
          finalTx.airline_awb = formatAirlineAwb(rawAwb);
        } else {
          finalTx.airline_awb = null;
        }
      }
      if (finalTx.type === 'cargo') {
        finalTx.sizeInches = sizeTierContentTypeNames.has(finalTx.contentType || '') && sizeInchesInput
          ? (Math.round(parseFloat(sizeInchesInput)) || undefined)
          : undefined;
      }
      // Resolve the "Other" content-type/contents free-text input (see
      // editCustomContentType/editCustomContents above) into the actually-
      // saved value, mirroring CargoForm.tsx/PackageForm.tsx's own
      // actualContentType/actualContents pattern -- without this, picking
      // "Other" here would save the literal string "Other" with no way to
      // tell what it actually was. Left as "Other" if the free-text field
      // was never filled in, rather than saving a blank content type.
      if (finalTx.type === 'cargo' && finalTx.contentType === 'Other' && editCustomContentType.trim()) {
        finalTx.contentType = editCustomContentType.trim();
      }
      if (finalTx.type === 'package' && finalTx.contents === 'Other' && editCustomContents.trim()) {
        finalTx.contents = editCustomContents.trim();
      }
      if (finalTx.type === 'cargo') {
        finalTx.detail = `${finalTx.airline || ''} · ${pieces}pcs · ${kg}kg · ${finalTx.route || ''} · ${finalTx.contentType || ''}`;
      } else if (finalTx.type === 'baggage') {
        finalTx.detail = `${finalTx.flight || ''} · ${finalTx.destination || ''} · ${pieces}pcs · +${finalTx.excessKg || 0}kg excess`;
      } else if (finalTx.type === 'marketing') {
        finalTx.detail = `${finalTx.route || ''} · ${bb}BB ${mb}MB ${sb}SB`;
        (finalTx as any)._bb = bb;
        (finalTx as any)._mb = mb;
        (finalTx as any)._sb = sb;
      } else if (finalTx.type === 'package') {
        finalTx.detail = `${finalTx.destination || ''} · ${finalTx.contentType || 'Package'} · ${pieces}pcs · ${kg}kg${finalTx.contents ? ` · ${finalTx.contents}` : ''}`;
      }
      onUpdateTx(finalTx);
      setEditingTx(null);
      setEditWallet(null);
      setEditOriginalMode(null);
      setEditOriginalWalletDeduction(0);
      setEditWalletRemainderMode('Cash');
      setEditWalletRemainderBank('');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleReprintReceipt = async (width: '58mm' | '80mm') => {
    if (!viewingDetail || !viewingDetail.raw) return;
    const tx = viewingDetail.raw;
    if (tx.type !== 'cargo' && tx.type !== 'package') return;

    try {
      // printViaBluetooth connects to the printer FIRST, before this
      // callback (which compiles the receipt -- loading logo images,
      // drawing canvas, generating a QR code) ever runs, so compiling
      // can't burn through the click's Bluetooth permission window.
      const { printViaBluetooth } = await import('../../lib/escpos');
      await printViaBluetooth(async () => {
        if (tx.type === 'cargo') {
          const { compileCargoReceiptStream } = await import('../../lib/escposCargoReceiptPrinting');
          return await compileCargoReceiptStream({
            entryRef: tx.id,
            serialNumber: 0,
            date: txDisplayDateTime(tx.created_at, tx.time),
            hubName: tx.hub || user.hub,
            agentName: tx.enteredByName || user.name,
            airline: tx.airline || "Unknown",
            consignee: tx.consignee || tx.name,
            awbTagNumber: tx.awb_tag_number || "N/A",
            pieces: tx.pieces || 1,
            kg: tx.kg || 1,
            route: tx.route || "Unknown",
            contentType: tx.contentType || tx.detail?.split(" · ")[4] || "General Goods",
            amount: tx.amount,
            paymentMode: formatPaymentModeDisplay(tx.mode, tx.wallet_deduction_amount, tx.amount),
            bankName: tx.bank,
            pickupPin: tx.pickupPin,
            trackingUrl: `https://app.haulwey.com/track/${tx.id}`,
            retrievedAmount: (tx as any).raw?.retrieved_amount || 0,
          }, width);
        } else if (tx.type === 'package') {
          const { compilePackageReceiptStream } = await import('../../lib/escposPackagePrinting');
          return await compilePackageReceiptStream({
            entryRef: tx.entryRef || tx.id,
            date: txDisplayDateTime(tx.created_at, tx.time),
            agentName: tx.enteredByName || user.name,
            customerName: tx.name,
            phone: tx.consigneePhone,
            destination: tx.destination || tx.route || 'Destination',
            contentType: tx.contentType || 'Package',
            pieces: tx.pieces || 1,
            kg: tx.kg || 0,
            contents: (tx as any).contents,
            amount: tx.amount,
            paymentMode: formatPaymentModeDisplay(tx.mode, tx.wallet_deduction_amount, tx.amount),
            paymentNarration: tx.paymentNarration,
            bankName: tx.bank,
            trackingUrl: `https://app.haulwey.com/track/${tx.id}`,
            retrievedAmount: (tx as any).raw?.retrieved_amount || 0,
          }, width);
        }
      });
    } catch (error: any) {
      console.error('Error printing receipt:', error);
      showToast({ message: error?.message || 'Error connecting to Bluetooth printer. Ensure it is paired and on.', type: 'error' });
    }
  };

  const handlePrint80mmLedger = async () => {
    if (filteredEntries.length === 0) {
      showToast({ message: 'No ledger entries to print.', type: 'error' });
      return;
    }
    // A retrieved debt (goods already picked up, whether the balance is
    // still open or not) shouldn't show up on a printed debt-collection
    // list -- staff use this printout to chase people down in person, and
    // there's nothing left to chase once the goods are gone. Only affects
    // Debt-mode entries; every other print (Cash/Transfer/All/etc.) is
    // unaffected. Same retrieved_amount check already used by this file's
    // own "Retrieved" mode-filter branch above.
    const printEntries = filteredEntries.filter(e =>
      !(e.mode === 'Debt' && ((e.raw as any)?.raw?.retrieved_amount > 0))
    );
    if (printEntries.length === 0) {
      showToast({ message: 'No ledger entries to print.', type: 'error' });
      return;
    }
    // displayTotals is DELIBERATELY a whole-period aggregate that ignores
    // modeFilter (see its own comment above) -- correct for the on-screen
    // KPI tiles, wrong for a printout, where "TOTAL REVENUE" must equal
    // the sum of the AMOUNT column actually itemized on the same receipt.
    // Computed fresh from printEntries (not kpis' totalAmount either --
    // kpis deliberately zeroes out Debt-mode entries from Total for the
    // on-screen tile's cash-basis accounting, which would print "TOTAL
    // REVENUE: N0" on a debt list).
    const printTotals = printEntries.reduce((acc, e) => {
      const sign = e.source === 'expense' ? -1 : 1;
      acc.total += sign * e.amount;
      if (e.mode === 'Cash') acc.cash += sign * e.amount;
      if (e.mode === 'Transfer') acc.transfer += sign * e.amount;
      if (e.mode === 'POS') acc.pos += sign * e.amount;
      if (e.mode === 'Debt') acc.debt += sign * e.amount;
      const ded = e.raw?.wallet_deduction_amount || (e.mode === 'Wallet' ? e.amount : 0);
      acc.wallet += ded;
      return acc;
    }, { total: 0, cash: 0, transfer: 0, pos: 0, debt: 0, wallet: 0 });
    try {
      const { printViaBluetooth } = await import('../../lib/escpos');
      await printViaBluetooth(async () => {
        const { compileLedger80mmStream } = await import('../../lib/escposLedgerPrinting');
        return await compileLedger80mmStream(
          printEntries as any,
          {
            hubName: user.hub || 'Station Hub',
            hubCode: userHubCode || 'ORIGIN',
            shiftDate: new Date().toLocaleDateString('en-GB'),
            agentName: user.name || 'Staff',
            printedAt: `${new Date().toLocaleDateString('en-GB')} ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`,
            totalAmount: printTotals.total,
            cashAmount: printTotals.cash,
            transferAmount: printTotals.transfer,
            posAmount: printTotals.pos,
            debtAmount: printTotals.debt,
            walletAmount: printTotals.wallet,
          }
        );
      });
    } catch (error: any) {
      console.error('Error printing 80mm ledger summary:', error);
      showToast({ message: error?.message || 'Error connecting to Bluetooth printer. Ensure it is paired and turned on.', type: 'error' });
    }
  };

  const handleReprintTag = async (_width?: '58mm' | '80mm') => {
    // Change: use wired PDF tag printing (opens PDF in new tab / OS print dialog)
    if (!viewingDetail || !viewingDetail.raw) return;
    // Open the tab synchronously, in direct response to the click --
    // window.open() called after the awaits below (dynamic import, QR
    // generation, PDF rendering) loses the user-gesture context that
    // mobile browsers require, and gets silently blocked. Skipped
    // entirely in an installed/standalone PWA though: window.open() there
    // hands off to a separate browser process immediately (see
    // isStandalonePWA's comment in helpers.ts) -- that hand-off IS the
    // "jumps out to the browser" bug, and closing the window afterward
    // once openPdfOrDownload detects standalone mode doesn't undo it.
    const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
    try {
      const tx = { ...viewingDetail.raw };

      if (tx.type === 'package') {
        const { printPackageTagPDF } = await import('./PackageTagPDF');
        const data = {
          id: tx.awb_tag_number || tx.entryRef || tx.id,
          name: tx.name,
          destination: tx.destination || tx.route || 'Destination',
          contentType: tx.contentType || 'Package',
          pieces: tx.pieces || 1,
          kg: tx.kg || 0,
          contents: (tx as any).contents,
          hubName: user?.hub || 'Station',
          date: txDisplayDateTime(tx.created_at, tx.time),
        };

        await printPackageTagPDF(data, preOpenedWindow);

        try {
          await supabase.from('tag_print_log').insert({
            cargo_ref: tx.id,
            awb_tag_number: data.id,
            printed_by: user.id,
            printed_by_name: user.name,
            hub_id: user.hub_id,
            hub_name: user.hub || 'Unknown',
            print_method: 'pdf',
            pieces_printed: tx.pieces || 1,
          });
        } catch (err) {
          console.error('Failed to log tag print', err);
        }
        return;
      }

      const { printCargoTagPDF } = await import('./CargoTagPDF');
      const route = tx.route || (tx.detail ? tx.detail.split(' · ')[3] : 'Unknown') || 'Unknown';
      const data = {
        id: tx.awb_tag_number || tx.entryRef || tx.id,
        name: tx.name,
        route: route || 'Unknown',
        pieces: tx.pieces || 1,
        weight: tx.kg || 0,
        airline: tx.airline,
        hubName: user?.hub || 'Air Cargo Hub',
        date: txDisplayDateTime(tx.created_at, tx.time),
        contentType: tx.contentType || (tx.detail ? tx.detail.split(' · ')[4] : undefined),
      };

      await printCargoTagPDF(data, preOpenedWindow);

      try {
        await supabase.from('tag_print_log').insert({
          cargo_ref: tx.id,
          awb_tag_number: data.id,
          printed_by: user.id,
          printed_by_name: user.name,
          hub_id: user.hub_id,
          hub_name: user.hub || 'Unknown',
          print_method: 'pdf',
          pieces_printed: tx.pieces || 1,
        });
      } catch (err) {
        console.error('Failed to log tag print', err);
      }
    } catch (error) {
      console.error('Error opening tag PDF:', error);
      preOpenedWindow?.close();
      showToast({ message: 'Failed to open tag PDF for printing', type: 'error' });
    }
  };

  const toggleConfirm = async (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (e.source !== 'transaction') return;
    // Maker-checker: whoever logged the sale can't be the one confirming
    // the money actually came in. PaymentValidation.tsx's Transfer confirm
    // already enforced this; Cash/Transfer are unified here now, so both
    // get the same rule.
    if (!e.raw.paymentConfirmed && e.raw.enteredByName && e.raw.enteredByName === user.name) {
      showToast({ message: "You can't confirm a payment you personally logged.", type: 'warning' });
      return;
    }
    // Per-row in-flight lock -- a fast double-click previously fired two
    // confirmPayment() RPC calls for the same entry with no reconciliation
    // between the two responses.
    if (confirmingIds.has(e.raw.id)) return;
    setConfirmingIds(prev => new Set(prev).add(e.raw.id));
    try {
      const nextConfirmed = !e.raw.paymentConfirmed;
      // State-wide-authorized RPC does the real write (the generic onUpdateTx
      // path below is hub-locked to an exact match, unlike this table's own
      // sibling-hub read policy -- see confirmPayment's own comment).
      const result = await confirmPayment(e.raw.type as PaymentEntryType, {
        id: e.raw.id,
        confirmed: nextConfirmed,
        loggedBy: user.name || 'Unknown',
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to confirm payment.', type: 'error' });
        return;
      }
      const updated = { ...e.raw };
      if (nextConfirmed) {
        updated.paymentConfirmed = true;
        updated.confirmedAt = new Date().toISOString();
        updated.confirmedBy = user.name;
      } else {
        updated.paymentConfirmed = false;
        updated.confirmedAt = undefined;
        updated.confirmedBy = undefined;
      }
      onUpdateTx(updated);
    } finally {
      setConfirmingIds(prev => { const n = new Set(prev); n.delete(e.raw.id); return n; });
    }
  };

  const savePosCode = async (e: Entry, evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (e.source !== 'transaction') return;
    if (!posCodeInput.code.trim()) return;
    if (confirmingIds.has(e.raw.id)) return;
    setConfirmingIds(prev => new Set(prev).add(e.raw.id));
    try {
      const code = posCodeInput.code.trim();
      // Same state-wide-authorized RPC as toggleConfirm.
      const result = await confirmPayment(e.raw.type as PaymentEntryType, {
        id: e.raw.id,
        confirmed: true,
        posApprovalCode: code,
        loggedBy: user.name || 'Unknown',
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to save POS code.', type: 'error' });
        return;
      }
      const updated = { ...e.raw };
      updated.posApprovalCode = code;
      updated.paymentConfirmed = true;
      updated.confirmedAt = new Date().toISOString();
      updated.confirmedBy = user.name;
      onUpdateTx(updated);
      setPosCodeInput({ id: '', code: '' });
    } finally {
      setConfirmingIds(prev => { const n = new Set(prev); n.delete(e.raw.id); return n; });
    }
  };

  // Jumps from a debt-clearance row's COLLECTION badge to the original debt
  // it cleared, using related_tx_id (set when the clearance was created).
  // The original may not be in `entries` if it falls outside the current
  // date range/filters -- in that case this can't silently do nothing, so
  // it tells the user why instead of looking broken.
  const handleJumpToOriginalDebt = (relatedTxId: string | undefined, evt?: React.MouseEvent) => {
    if (evt) evt.stopPropagation();
    if (!relatedTxId) return;
    const original = entries.find(e => e.id === relatedTxId);
    if (original) {
      setViewingDetail(original);
    } else {
      showToast({ message: 'Original debt entry is outside the current date range/filters -- widen them to view it.', type: 'warning' });
    }
  };

  // Secondary line under a debt row's amount so the ORIGINAL entry shows its
  // own settlement state without cross-referencing the separate DC-
  // collection rows: "₦9,000 paid · ₦6,000 owed" while still owing, or
  // "Cleared · ₦9,000 Wallet + ₦6,000 Cash" once fully settled. Returns null
  // for anything that isn't a part/fully-settled debt (incl. DC- rows).
  const renderDebtSettleLine = (e: Entry) => {
    if (e.source !== 'transaction' || (e.raw as any)?.is_debt_clearance) return null;
    if (e.mode !== 'Debt' && e.mode !== 'Debt Paid') return null;
    const paid = roundMoney(e.raw?.amountPaid || 0);
    if (paid <= 0) return null;
    const owed = Math.max(0, roundMoney((e.amount || 0) - paid - ((e.raw as any)?.raw?.retrieved_amount || 0)));
    const parts = summarisePaymentHistory(e.raw?.paymentHistory);
    const n = (e.raw?.paymentHistory || []).length;
    const tip = n > 0
      ? `${n} collection${n === 1 ? '' : 's'} on this debt — open the row for the full breakdown; each also shows as a COLLECTION row.`
      : undefined;
    return owed > 0 ? (
      <div className="text-[10px] font-mono text-[var(--color-accent-amber)]" title={tip}>
        ₦{fmt(paid)} paid · ₦{fmt(owed)} owed{n > 0 ? ` · ↳${n}` : ''}
      </div>
    ) : (
      <div className="text-[10px] font-mono text-[var(--color-success)]" title={tip}>
        Cleared{parts ? ` · ${parts}` : ''}
      </div>
    );
  };

  // Opens the mode/bank picker instead of clearing immediately -- previously
  // this went straight to a generic yes/no confirm() and hardcoded
  // paymentMode: 'Cash', so the resulting DC- collection entry always
  // claimed Cash no matter how the debt was actually paid off.
  const openClearDebt = (e: Entry, evt?: React.MouseEvent) => {
    if (evt) evt.stopPropagation();
    if (e.source !== 'transaction') return;
    const tx = e.raw as Transaction;
    const remaining = tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0);
    if (remaining <= 0) return;
    setClearDebtMode('Cash');
    setClearDebtBank('');
    setClearDebtWallet(null);
    setClearDebtRemainderMode('Cash');
    refetchCustomerWallets?.();
    setClearDebtEntry(e);
  };

  const confirmClearDebt = async () => {
    if (!clearDebtEntry || clearingDebt) return;
    const tx = clearDebtEntry.raw as Transaction;
    // Subtract retrieved_amount too (matches DebtorsTab.tsx's balance
    // formula) -- a cargo entry that's been partially retrieved has a
    // smaller true remaining balance than amount - amountPaid alone, and
    // clear_cargo_debt's own guard rejects a payment larger than that --
    // computing it the same way here keeps the two in agreement.
    const remaining = roundMoney(tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0));
    if (remaining <= 0) { setClearDebtEntry(null); return; }
    if (clearDebtMode === 'Transfer' && !clearDebtBank) {
      showToast({ message: 'Select a bank before clearing via Transfer.', type: 'warning' });
      return;
    }
    if (clearDebtMode === 'Wallet') {
      if (!clearDebtWallet) {
        showToast({ message: 'Select a customer wallet to charge.', type: 'warning' });
        return;
      }
      const wp = Math.min(remaining, clearDebtWallet.balance);
      if (wp <= 0) {
        showToast({ message: `${clearDebtWallet.customer_name}'s wallet has no balance to apply.`, type: 'warning' });
        return;
      }
      const rem = roundMoney(remaining - wp);
      if (rem > 0 && (clearDebtRemainderMode === 'Transfer' || clearDebtRemainderMode === 'POS') && !clearDebtBank.trim()) {
        showToast({ message: `Enter the bank/terminal for the ₦${fmt(rem)} ${clearDebtRemainderMode} remainder.`, type: 'warning' });
        return;
      }
    }

    setClearingDebt(true);
    try {
      const loggedBy = user.name || 'Unknown';

      // Settle from wallet: leg 1 debits the wallet via clear_*_debt(p_wallet_id),
      // leg 2 collects whatever the wallet couldn't cover by the chosen
      // Cash/Transfer/POS method. Two guarded calls, not atomic -- a failed
      // leg 2 leaves a normal partial debt for the remainder to retry, never
      // a double charge.
      if (clearDebtMode === 'Wallet' && clearDebtWallet) {
        const walletPay = Math.min(remaining, clearDebtWallet.balance);
        const rem = roundMoney(remaining - walletPay);

        const l1 = await clearDebt({
          type: tx.type as DebtEntryType,
          id: tx.id,
          paymentAmount: walletPay,
          paymentMode: 'Wallet',
          walletId: clearDebtWallet.id,
          loggedBy,
          expectedRemaining: remaining,
        });
        if (!l1.ok) {
          showToast({ message: l1.error || 'Failed to settle this debt from the wallet. Nothing was charged.', type: 'error' });
          return;
        }
        const walletHist = {
          amount: walletPay, mode: 'Wallet' as const, by: loggedBy, at: new Date().toISOString(),
          ...(l1.walletTxnId ? { wallet_txn_id: l1.walletTxnId } : {}),
        };

        let l2: Awaited<ReturnType<typeof clearDebt>> | null = null;
        if (rem > 0) {
          l2 = await clearDebt({
            type: tx.type as DebtEntryType,
            id: tx.id,
            paymentAmount: rem,
            paymentMode: clearDebtRemainderMode,
            bank: clearDebtRemainderMode !== 'Cash' ? clearDebtBank.trim() : undefined,
            loggedBy,
            expectedRemaining: l1.remainingBalance,
          });
        }

        if (rem > 0 && (!l2 || !l2.ok)) {
          const partial: Transaction = {
            ...tx,
            amountPaid: l1.newAmountPaid ?? ((tx.amountPaid || 0) + walletPay),
            paymentHistory: [...(tx.paymentHistory || []), walletHist],
            mode: 'Debt',
          };
          onUpdateTx(partial);
          writeAuditLog({
            user_id: user.id, user_name: loggedBy, action: 'DEBT_COLLECTION',
            table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
            description: `₦${fmt(walletPay)} collected against ${tx.name}'s debt via Customer Wallet (₦${fmt(rem)} ${clearDebtRemainderMode} remainder did NOT record)`,
            hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
            old_values: { amount_paid: tx.amountPaid || 0 },
            new_values: { amount_paid: l1.newAmountPaid, mode: 'Wallet', amount: walletPay },
          }).catch(() => {});
          refetchCustomerWallets?.();
          showToast({
            message: `₦${fmt(walletPay)} taken from ${clearDebtWallet.customer_name}'s wallet, but the ₦${fmt(rem)} ${clearDebtRemainderMode} leg didn't record${l2?.error ? ` (${l2.error})` : ''} -- clear the remaining ₦${fmt(rem)} again from the ledger.`,
            type: 'error',
          });
          if (viewingDetail && viewingDetail.id === tx.id) {
            setViewingDetail({ ...viewingDetail, mode: 'Debt', raw: partial });
          }
          setClearDebtEntry(null);
          return;
        }

        const finalRes = l2 && l2.ok ? l2 : l1;
        const totalCollected = walletPay + rem;
        const stillOwed = finalRes.remainingBalance ?? 0;
        const fullyPaid = finalRes.fullyPaid ?? (stillOwed <= 0);
        const updated: Transaction = {
          ...tx,
          amountPaid: finalRes.newAmountPaid ?? ((tx.amountPaid || 0) + totalCollected),
          paymentHistory: [
            ...(tx.paymentHistory || []),
            walletHist,
            ...(rem > 0 ? [{ amount: rem, mode: clearDebtRemainderMode, by: loggedBy, at: new Date().toISOString() }] : []),
          ],
          // See the editingTx wallet-settle flow's identical comment above.
          mode: fullyPaid ? (finalRes.newMode || 'Debt Paid') : 'Debt',
          paymentConfirmed: fullyPaid,
          confirmedBy: fullyPaid ? loggedBy : tx.confirmedBy,
          confirmedAt: fullyPaid ? new Date().toISOString() : tx.confirmedAt,
          ...(tx.type === 'package' && fullyPaid ? { debtPaid: true, debtPaidAt: new Date().toISOString() } : {}),
        };
        onUpdateTx(updated);
        writeAuditLog({
          user_id: user.id, user_name: loggedBy, action: 'DEBT_COLLECTION',
          table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
          description: `₦${fmt(totalCollected)} collected against ${tx.name}'s debt — ₦${fmt(walletPay)} Customer Wallet${rem > 0 ? ` + ₦${fmt(rem)} ${clearDebtRemainderMode}` : ''}${stillOwed > 0 ? ` (₦${fmt(stillOwed)} still owed)` : ' (fully cleared)'}`,
          hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
          old_values: { amount_paid: tx.amountPaid || 0 },
          new_values: { amount_paid: finalRes.newAmountPaid, mode: rem > 0 ? `Wallet+${clearDebtRemainderMode}` : 'Wallet', amount: totalCollected },
        }).catch(() => {});
        refetchCustomerWallets?.();
        showToast({
          message: fullyPaid
            ? (rem > 0
                ? `Debt cleared — ₦${fmt(walletPay)} from ${clearDebtWallet.customer_name}'s wallet + ₦${fmt(rem)} ${clearDebtRemainderMode}`
                : `Debt cleared from ${clearDebtWallet.customer_name}'s wallet`)
            : `₦${fmt(totalCollected)} applied -- ₦${fmt(stillOwed)} still owed`,
          type: fullyPaid ? 'success' : 'warning',
        });
        if (viewingDetail && viewingDetail.id === tx.id) {
          setViewingDetail({ ...viewingDetail, mode: fullyPaid ? 'Debt Paid' : 'Debt', raw: updated });
        }
        setClearDebtEntry(null);
        return;
      }

      const result = await clearDebt({
        type: tx.type as DebtEntryType,
        id: tx.id,
        paymentAmount: remaining,
        paymentMode: clearDebtMode,
        bank: clearDebtMode === 'Transfer' ? clearDebtBank : undefined,
        loggedBy: user.name || 'Unknown',
        // Server re-validates this against the just-locked row and rejects
        // the call if it's changed -- catches a double-click/retry (or two
        // staff clearing the same debt near-simultaneously) that would
        // otherwise both independently pass the RPC's own "doesn't exceed
        // remaining" check and double-clear the debt.
        expectedRemaining: remaining,
      });

      if (!result.ok) {
        showToast({ message: result.error || 'Failed to clear debt.', type: 'error' });
        return;
      }

      // Trust the RPC's own returned state rather than assuming full
      // settlement -- this call always requests payment of the full
      // `remaining` balance, so fullyPaid should be true, but reflecting
      // what the server actually recorded (rather than what the client
      // assumed) means a future formula change on either side can't
      // silently desync the ledger's displayed mode from the real balance.
      const stillOwed = result.remainingBalance ?? 0;
      const fullyPaid = result.fullyPaid ?? (stillOwed <= 0);

      const historyEntry = {
        amount: remaining,
        mode: clearDebtMode,
        by: user.name || 'Unknown',
        at: new Date().toISOString()
      };

      const updated: Transaction = {
        ...tx,
        // Use clear_cargo_debt's own returned total, not tx.amount -- for an
        // entry with a prior partial retrieval, the correct fully-paid value
        // is amount - retrieved_amount, not the full original amount (the RPC
        // already computes this correctly server-side). onUpdateTx below still
        // fires a redundant client-side write on top of the RPC's own -- using
        // the RPC's real value here makes that write idempotent instead of
        // overwriting a correct DB row with an inflated amount_paid, which
        // previously produced a negative "remaining balance" on every later
        // computation for any entry that had been partially retrieved.
        amountPaid: result.newAmountPaid ?? tx.amount,
        paymentHistory: [...(tx.paymentHistory || []), historyEntry],
        // Same idempotency fix as amountPaid just above, for mode: trust
        // the RPC's own returned final mode (result.newMode) instead of
        // assuming 'Debt Paid'. Without this, onUpdateTx's redundant write
        // right after this RPC call overwrote a same-shift Individual
        // reclassification (receipt_mode/payment_mode rewritten to the real
        // payment mode, e.g. 'Transfer') back to plain 'Debt' a moment
        // after 20260947's clear_*_debt set it correctly -- see
        // 20260948_clear_debt_return_final_mode.sql.
        mode: fullyPaid ? (result.newMode || 'Debt Paid') : 'Debt',
        paymentConfirmed: fullyPaid,
        confirmedBy: fullyPaid ? (user.name || 'Unknown') : tx.confirmedBy,
        confirmedAt: fullyPaid ? new Date().toISOString() : tx.confirmedAt,
        ...(tx.type === 'package' && fullyPaid ? {
          debtPaid: true,
          debtPaidAt: new Date().toISOString()
        } : {})
      };

      onUpdateTx(updated);

      if (!fullyPaid) {
        showToast({ message: `Payment recorded, but ₦${fmt(stillOwed)} still remains on this debt -- check with the server before assuming it's fully cleared.`, type: 'warning' });
      }

      // Record this collection in the audit trail. Previously this spot
      // inserted a visible "DC-..." shadow transaction into the same
      // department table as the original sale, so today's ledger/EOD could
      // see where the cash came from -- but that meant one physical payment
      // showed as two rows in the ledger (the original sale, now "Debt
      // Paid", plus a synthetic second "sale"), which is exactly the
      // double-entry confusion staff/accountants flagged. EOD/Analytics/
      // Reports/AccountingConsole now derive "collected today" straight
      // from the payment_history entry just appended to the ORIGINAL entry
      // above (see src/lib/debt.ts), so no second row is needed here -- the
      // Debt Collection & Retrieval Log view reads the same payment_history
      // for its own display. hubNames resolves the debt's real hub_id to
      // its real name (tx.hub is unreliable -- see the historical comment
      // this replaced) so a super_admin clearing a sibling branch's debt
      // still attributes it correctly.
      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'DEBT_COLLECTION',
        table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
        description: `₦${fmt(remaining)} collected against ${tx.name}'s debt via ${clearDebtMode}${stillOwed > 0 ? ` (₦${fmt(stillOwed)} still owed)` : ' (fully cleared)'}`,
        hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
        old_values: { amount_paid: tx.amountPaid || 0 },
        new_values: { amount_paid: result.newAmountPaid, mode: clearDebtMode, amount: remaining },
      }).catch(() => {});

      if (fullyPaid) {
        showToast({ message: 'Debt cleared successfully', type: 'success' });
      }
      if (viewingDetail && viewingDetail.id === tx.id) {
        setViewingDetail({
          ...viewingDetail,
          mode: fullyPaid ? 'Debt Paid' : 'Debt',
          raw: updated
        });
      }
      setClearDebtEntry(null);
    } finally {
      setClearingDebt(false);
    }
  };

  // Both batch actions below require a single customer per batch -- a
  // combined receipt only makes sense under one name, and batch-clearing
  // several unrelated customers' debts in one click is exactly the
  // accidental-mass-clear risk per-customer batching is meant to avoid.
  // Shared so "not the same customer" is reported identically either way.
  const notifySameCustomerRequired = (selected: Entry[]): boolean => {
    if (new Set(selected.map(e => e.name)).size > 1) {
      showToast({ message: 'Selected transactions are not for the same customer -- batch print/clear requires everything selected to belong to one customer.', type: 'warning' });
      return false;
    }
    return true;
  };

  // Clears every currently-selected Debt entry for its full remaining
  // balance in one action -- one customer with several outstanding
  // routes/shipments previously meant opening Clear Debt separately per
  // row. Same RPC/audit-log shape as confirmClearDebt's non-Wallet branch
  // above, just looped -- Wallet mode isn't offered here (see
  // selectedDebtIds' own declaration comment). Non-Debt rows in the
  // current selection (batch selection now spans every mode, for
  // printing) are silently skipped rather than erroring -- only Debt rows
  // are ever clearable.
  const handleBatchClearDebts = async () => {
    if (batchClearingDebts || selectedDebtIds.size === 0) return;
    // Belt-and-suspenders on top of the button's own disabled state -- the
    // mode is required, not defaulted, specifically so a batch clear can
    // never go through without a staff member consciously picking it.
    if (!batchDebtMode) {
      showToast({ message: 'Select a payment mode before clearing.', type: 'warning' });
      return;
    }
    const selectedEntries = displayEntries.filter((e): e is Entry => e.source === 'transaction' && selectedDebtIds.has(e.id));
    if (!notifySameCustomerRequired(selectedEntries)) return;
    if (batchDebtMode === 'Transfer' && !batchDebtBank.trim()) {
      showToast({ message: 'Select the bank for this transfer payment.', type: 'warning' });
      return;
    }
    const withRemaining = selectedEntries
      .filter(e => e.mode === 'Debt')
      .map(e => {
        const tx = e.raw as Transaction;
        const remaining = roundMoney(tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0));
        return { tx, remaining };
      })
      .filter(x => x.remaining > 0);
    if (withRemaining.length === 0) return;
    const total = withRemaining.reduce((s, x) => s + x.remaining, 0);
    const ok = await confirm({
      title: 'Clear selected debts?',
      message: `This clears ${withRemaining.length} debt${withRemaining.length === 1 ? '' : 's'} totalling ₦${fmt(total)} via ${batchDebtMode}. This cannot be undone.`,
      confirmLabel: `Clear ${withRemaining.length} Debt${withRemaining.length === 1 ? '' : 's'}`,
      tone: 'danger',
    });
    if (!ok) return;

    setBatchClearingDebts(true);
    try {
      const results = await Promise.all(withRemaining.map(async ({ tx, remaining }) => {
        const result = await clearDebt({
          type: tx.type as DebtEntryType,
          id: tx.id,
          paymentAmount: remaining,
          paymentMode: batchDebtMode,
          bank: batchDebtMode === 'Transfer' ? batchDebtBank : undefined,
          loggedBy: user.name || 'Unknown',
          expectedRemaining: remaining,
        });
        return { tx, remaining, result };
      }));

      let cleared = 0;
      let clearedTotal = 0;
      let failed = 0;
      results.forEach(({ tx, remaining, result }) => {
        if (!result.ok) { failed++; return; }
        const fullyPaid = result.fullyPaid ?? true;
        const historyEntry = { amount: remaining, mode: batchDebtMode, by: user.name || 'Unknown', at: new Date().toISOString() };
        const updated: Transaction = {
          ...tx,
          amountPaid: result.newAmountPaid ?? tx.amount,
          paymentHistory: [...(tx.paymentHistory || []), historyEntry],
          mode: fullyPaid ? (result.newMode || 'Debt Paid') : 'Debt',
          paymentConfirmed: fullyPaid,
          confirmedBy: fullyPaid ? (user.name || 'Unknown') : tx.confirmedBy,
          confirmedAt: fullyPaid ? new Date().toISOString() : tx.confirmedAt,
          ...(tx.type === 'package' && fullyPaid ? { debtPaid: true, debtPaidAt: new Date().toISOString() } : {}),
        };
        onUpdateTx(updated);
        writeAuditLog({
          user_id: user.id, user_name: user.name || 'Unknown', action: 'DEBT_COLLECTION',
          table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
          description: `₦${fmt(remaining)} collected against ${tx.name}'s debt via ${batchDebtMode} (batch clear)${fullyPaid ? ' (fully cleared)' : ''}`,
          hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
          old_values: { amount_paid: tx.amountPaid || 0 },
          new_values: { amount_paid: result.newAmountPaid, mode: batchDebtMode, amount: remaining },
        }).catch(() => {});
        cleared++;
        clearedTotal += remaining;
      });

      setSelectedDebtIds(new Set());
      if (failed === 0) {
        showToast({ message: `${cleared} debt${cleared === 1 ? '' : 's'} cleared (₦${fmt(clearedTotal)}).`, type: 'success' });
      } else {
        showToast({ message: `${cleared} of ${withRemaining.length} debts cleared (₦${fmt(clearedTotal)}). ${failed} failed -- their balances may have changed, refresh and retry.`, type: 'warning' });
      }
    } finally {
      setBatchClearingDebts(false);
    }
  };

  // Independent of handleBatchClearDebts -- printable before or after
  // clearing. Combines every selected debt into ONE receipt (one customer
  // name, every route/ref listed, a single total) instead of printing one
  // mini-receipt per debt.
  const handleBatchPrintReceipt = async () => {
    const selected = displayEntries.filter((e): e is Entry => e.source === 'transaction' && selectedDebtIds.has(e.id));
    if (selected.length === 0) return;
    // Same requirement as clearing -- a receipt claiming a payment was
    // made needs to say how, not a vague placeholder.
    if (!batchDebtMode) {
      showToast({ message: 'Select a payment mode before printing.', type: 'warning' });
      return;
    }
    if (!notifySameCustomerRequired(selected)) return;
    const items = selected.map(e => {
      const tx = e.raw as Transaction;
      // retrieved_amount only offsets an outstanding Debt balance -- for an
      // already-paid Cash/Transfer/POS/Wallet entry it tracks goods pickup,
      // not money owed, so subtracting it here understated what the
      // customer actually paid whenever that entry also had a retrieval.
      let amount = tx.amount;
      if (e.mode === 'Debt') {
        const remaining = roundMoney(tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0));
        amount = remaining > 0 ? remaining : tx.amount;
      }
      const created = tx.created_at && !isNaN(new Date(tx.created_at).getTime())
        ? new Date(tx.created_at)
        : null;
      return {
        ref: tx.id,
        route: (tx.type === 'baggage' || tx.type === 'package') ? (tx.destination || '') : (tx.route || ''),
        type: tx.type,
        amount,
        tagNumber: tx.awb_tag_number,
        pieces: tx.pieces,
        kg: tx.kg,
        date: created ? created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : undefined,
        time: tx.time,
        contentType: tx.contentType,
        contents: tx.contents,
      };
    });
    try {
      const { downloadBatchDebtReceipt } = await import("./BatchDebtReceipt");
      await downloadBatchDebtReceipt({
        batchRef: `BATCH-${Date.now()}`,
        date: txDisplayDateTime(new Date().toISOString(), ''),
        agentName: user.name || 'Unknown',
        customerName: selected[0].name,
        customerPhone: (selected[0].raw as Transaction).consigneePhone,
        items,
        totalAmount: items.reduce((s, i) => s + i.amount, 0),
        // Guaranteed non-empty by the guard above.
        paymentMode: batchDebtMode,
        bankName: batchDebtMode === 'Transfer' ? batchDebtBank : undefined,
      });
    } catch (err: any) {
      showToast({ message: err?.message || 'Failed to generate batch receipt.', type: 'error' });
    }
  };

  // Reverses the most recent debt-collection payment via reopen_*_debt --
  // same any-staff, audited policy as Clear Debt above (see the comment on
  // the Reopen Debt button). Undoes the LAST payment_history entry only
  // (not the whole balance), matching Unretrieve's "undo the last action"
  // shape rather than resetting the entry to a fully-unpaid state, since a
  // debt may have had legitimate partial payments before the clearance
  // being corrected.
  const confirmReopenDebt = async (entry: Entry) => {
    if (entry.source !== 'transaction' || reopeningDebt) return;
    const tx = entry.raw as Transaction;
    const lastPayment = (tx.paymentHistory || [])[(tx.paymentHistory || []).length - 1];
    const reverseAmount = lastPayment?.amount ?? (tx.amountPaid || 0);
    const ok = await confirm({
      title: 'Reopen this debt?',
      message: `This undoes the most recent payment recorded against ${tx.name}'s debt (₦${fmt(reverseAmount)}${lastPayment ? ` via ${lastPayment.mode}` : ''}) and marks the entry as Debt again. Use this only to correct a mistaken clearance.`,
      confirmLabel: 'Reopen Debt',
      tone: 'danger',
    });
    if (!ok) return;

    setReopeningDebt(true);
    try {
      const result = await reopenDebt({
        type: tx.type as DebtEntryType,
        id: tx.id,
        loggedBy: user.name || 'Unknown',
        expectedAmountPaid: tx.amountPaid,
      });

      if (!result.ok) {
        showToast({ message: result.error || 'Failed to reopen debt.', type: 'error' });
        return;
      }

      const updated: Transaction = {
        ...tx,
        amountPaid: result.newAmountPaid ?? 0,
        paymentHistory: (tx.paymentHistory || []).slice(0, -1),
        mode: 'Debt',
        paymentConfirmed: false,
        confirmedBy: undefined,
        confirmedAt: undefined,
        ...(tx.type === 'package' ? { debtPaid: false, debtPaidAt: undefined } : {}),
      };
      onUpdateTx(updated);

      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'DEBT_REOPENED',
        table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
        description: `₦${fmt(result.reversedAmount ?? reverseAmount)} payment reversed on ${tx.name}'s debt -- entry reopened`,
        hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
        old_values: { amount_paid: tx.amountPaid || 0 },
        new_values: { amount_paid: result.newAmountPaid, mode: 'Debt' },
      }).catch(() => {});

      showToast({ message: 'Debt reopened', type: 'success' });
      if (viewingDetail && viewingDetail.id === tx.id) {
        setViewingDetail({ ...viewingDetail, mode: 'Debt', raw: updated });
      }
    } finally {
      setReopeningDebt(false);
    }
  };

  // Permanently removes a transaction. Unlike every other action on this
  // screen (Clear Debt, Reopen Debt, Unretrieve, Refund to Wallet), this
  // one IS role-gated -- see the Delete Transaction button below -- because
  // it's the only action here that isn't correctable afterward: the others
  // all leave a row that can be edited/reopened/unretrieved again, this
  // just removes it. delete_transaction refuses (rather than silently
  // reversing) if the entry is wallet-paid, already retrieved, or a
  // debt-collection shadow row -- see deleteTransaction.ts.
  const confirmDeleteTransaction = async (entry: Entry) => {
    if (entry.source !== 'transaction' || deletingTx) return;
    const tx = entry.raw as Transaction;
    const ok = await confirm({
      title: 'Delete this transaction?',
      message: `This permanently deletes the ₦${fmt(tx.amount)} entry for ${tx.name}. This cannot be undone -- the record will not appear anywhere in the ledger again.`,
      confirmLabel: 'Delete Permanently',
      tone: 'danger',
    });
    if (!ok) return;

    setDeletingTx(true);
    try {
      const result = await deleteTransaction({
        type: tx.type as DebtEntryType,
        id: tx.id,
        loggedBy: user.name || 'Unknown',
      });

      if (!result.ok) {
        showToast({ message: result.error || 'Failed to delete transaction.', type: 'error' });
        return;
      }

      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'DELETE',
        table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
        description: `Deleted ${tx.type} entry: ${tx.name} -- ₦${fmt(tx.amount)} (${tx.mode})`,
        hub: hubNames[tx.hub_id || ''] || tx.hub, hub_id: tx.hub_id,
        old_values: {
          name: tx.name, amount: tx.amount, amount_paid: tx.amountPaid || 0, mode: tx.mode,
          created_at: tx.created_at, awb_tag_number: (tx as any).awb_tag_number,
        },
      }).catch(() => {});

      onDeleteTx(tx.type, tx.id);
      setViewingDetail(null);
      showToast({ message: 'Transaction deleted', type: 'success' });
    } finally {
      setDeletingTx(false);
    }
  };

  const handleMarkRetrievedAndDeposit = (entry: Entry) => {
    setRetrievalModalEntry(entry);
  };

  const handleUnretrieve = async () => {
    if (!viewingDetail || viewingDetail.source !== 'transaction') return;
    const tx = viewingDetail.raw as Transaction;
    // tx (=viewingDetail.raw) is the Transaction; the true DB row with
    // retrieved_amount is one level deeper, at tx.raw -- same mistake
    // already fixed once elsewhere in this file (see handleClearDebt's
    // own comment on this exact Entry -> Transaction -> raw DB row chain).
    const reversedAmount = (tx.raw as any)?.retrieved_amount || 0;
    const ok = await confirm({
      title: 'Undo this retrieval?',
      message: `This resets the retrieval record on ${tx.name}'s entry (${fmt(reversedAmount)} previously marked retrieved). If that retrieval credited a wallet, this will automatically claw the credit back out of the wallet too -- it'll fail with an error instead if the customer has already spent it, so you can resolve that with the customer/accounting first.`,
      confirmLabel: 'Undo Retrieval',
      tone: 'danger',
    });
    if (!ok) return;

    const result = await unretrieveEntry(tx.type as RetrievalEntryType, {
      entryRef: tx.id,
      loggedBy: user.name || 'Unknown',
    });
    if (!result.ok) {
      showToast({ message: result.error || 'Failed to undo retrieval.', type: 'error' });
      return;
    }
    const walletReversed = result.walletReversed || 0;

    const updated: Transaction = {
      ...tx,
      retrieved: false,
      retrievalNote: `Retrieval reversed by ${user.name || 'Unknown'}`,
      status: 'Intake',
      raw: { ...(tx.raw || {}), retrieved: false, retrieved_amount: 0, retrieved_pieces: 0, retrieved_kg: 0, status: 'Intake', retrieval_approved: false, retrieval_approved_by: null, retrieval_approved_at: null },
    };
    onUpdateTx(updated);
    // Retrieval/unretrieve previously wrote nothing to audit_log at all --
    // called directly here (not routed through EHIApp.tsx's handleUpdateTx,
    // whose isGenuineEdit/PAYMENT_CONFIRM gates key off dedicated marker
    // fields like editedBy/paymentConfirmed that this action has no
    // equivalent of).
    writeAuditLog({
      user_id: user.id, user_name: user.name || 'Unknown', action: 'UNRETRIEVE',
      table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
      description: `Retrieval reversed for ${tx.name} (was ${fmt(reversedAmount)} retrieved${walletReversed > 0 ? `, ${fmt(walletReversed)} clawed back from wallet` : ''})`,
      hub: user.hub, hub_id: user.hub_id,
      old_values: { retrieved_amount: reversedAmount },
      new_values: { retrieved_amount: 0, wallet_reversed: walletReversed },
    }).catch(() => {});
    showToast({
      message: walletReversed > 0 ? `Retrieval undone -- ${fmt(walletReversed)} clawed back from wallet` : 'Retrieval undone',
      type: 'success',
    });
    setViewingDetail({ ...viewingDetail, raw: updated });
  };

  const executeRetrieval = async (data: { isPartial: boolean, retrievedValue: number, retrievedPieces: number, retrievedKg: number }) => {
    if (!retrievalModalEntry || processingRetrieval) return;
    setProcessingRetrieval(true);
    try {
      const entry = retrievalModalEntry;
      const customerName = entry.name;

      // process_<type>_retrieval locks the entry, rejects a refund that
      // would push cumulative retrieved_amount past the entry's original
      // amount, updates retrieval tracking, and credits the wallet -- all in
      // one atomic call. See
      // supabase/migrations/20260902_multi_department_retrieval_and_wallet_cashout.sql.
      const result = await processRetrieval(entry.type as RetrievalEntryType, {
        entryRef: entry.id,
        isPartial: data.isPartial,
        retrievedValue: data.retrievedValue,
        retrievedPieces: data.retrievedPieces,
        retrievedKg: data.retrievedKg,
        customerName,
        hubId: user.hub_id,
        loggedBy: user.name,
        // Entry.raw is the Transaction, which only carries camelCase
        // consigneePhone -- the snake_case DB column lives one level
        // deeper, at Entry.raw.raw (Transaction.raw is the true DB row).
        customerPhone: (retrievalModalEntry?.raw as any)?.raw?.consignee_phone,
      });

      if (!result.ok) {
        showToast({ message: 'Failed to complete retrieval deposit: ' + result.error, type: 'error' });
        return;
      }

      // entry.raw is the Transaction (see the `entries` useMemo above, which
      // sets `raw: t` on every row) -- the real cargo_entries DB row one level
      // further down is Transaction.raw, set at EHIApp.tsx's fetch. Reading
      // retrieved_amount off entry.raw directly always resolved to undefined,
      // so the just-completed retrieval was invisible (e.g. in DebtorsTab,
      // which reads t.raw?.retrieved_amount) until the next full refetch.
      const priorRaw = (entry.raw as any)?.raw || {};
      const entryAmount = (entry.raw as any)?.amount ?? priorRaw.amount ?? 0;
      const priorRetrievedAmount = priorRaw.retrieved_amount || 0;
      const newRetrievedAmount = priorRetrievedAmount + data.retrievedValue;
      const fullyRetrieved = newRetrievedAmount >= entryAmount;
      const newStatus = fullyRetrieved ? 'Retrieved' : priorRaw.status;

      // Flight Radar integration: a FULL retrieval means this shipment
      // isn't going out on whatever flight it had attached -- clear the
      // link so it drops off the board, and record why on the entry
      // itself. Partial retrievals leave the flight alone (the
      // un-retrieved remainder is still assumed to be flying). Computed
      // here (before the optimistic update below) so the local UI and the
      // follow-up DB write agree on the same table/column/note.
      const missedFlightNumber = (entry.raw as any)?.flight;
      const missedFlight = fullyRetrieved && !!missedFlightNumber;
      const table = RETRIEVAL_TABLE_NAME[entry.type as RetrievalEntryType];
      const flightCol = table === 'manifests' ? 'flight_no' : 'flight_number';
      const missedNote = missedFlight
        ? `Missed flight ${missedFlightNumber}${(entry.raw as any)?.airline ? ` (${(entry.raw as any).airline})` : ''} -- retrieved by ${user.name} at ${new Date().toLocaleString('en-NG')}.`
        : '';
      const priorNote = priorRaw.retrieval_note || '';
      const newNote = missedFlight ? (priorNote ? `${priorNote}\n${missedNote}` : missedNote) : priorNote;

      onUpdateTx({
        ...(entry.raw as any),
        raw: {
          ...priorRaw,
          retrieved_amount: newRetrievedAmount,
          retrieved_pieces: (priorRaw.retrieved_pieces || 0) + data.retrievedPieces,
          retrieved_kg: (priorRaw.retrieved_kg || 0) + data.retrievedKg,
          retrieved: fullyRetrieved,
          status: newStatus,
          ...(missedFlight ? { [flightCol]: null, retrieval_note: newNote } : {}),
        },
        retrieved: fullyRetrieved,
        retrievedAt: new Date().toISOString(),
        retrievedBy: user.name,
        status: newStatus,
        flight: missedFlight ? undefined : (entry.raw as any)?.flight,
      });

      // Deliberately a small, separate follow-up write rather than
      // touching process_*_retrieval itself -- that RPC is finance-critical
      // (debt/wallet accounting) and this has nothing to do with money. A
      // failure here must never undo the retrieval that already succeeded
      // above, hence its own try/catch with only a soft warning toast.
      if (missedFlight) {
        try {
          const idCol = table === 'manifests' ? 'transaction_id' : 'entry_ref';
          const { error: missedFlightError } = await supabase
            .from(table)
            .update({ [flightCol]: null, retrieval_note: newNote })
            .eq(idCol, entry.id);
          if (missedFlightError) throw missedFlightError;
        } catch (err: any) {
          showToast({ message: `Retrieval saved, but couldn't clear the flight link: ${err?.message || 'unknown error'}`, type: 'warning' });
        }
      }

      // Report what the RPC actually did, not the full retrieved value --
      // an unpaid-debt or already-paid-in-full retrieval can send ₦0 (or
      // less than the full amount) to the wallet, with the rest clearing debt.
      // Goods are released and debt is cleared immediately either way; the
      // wallet refund itself now always lands as a pending
      // wallet_transactions row (see process_*_retrieval) awaiting a
      // separate accountant/admin/super_admin approval, so the customer's
      // balance doesn't reflect it until then -- CustomerWallets.tsx's
      // "Pending Wallet Approvals" queue is where that happens.
      const refund = result.walletRefund ?? 0;
      const debtCleared = result.debtReduction ?? 0;
      const message = refund > 0 && debtCleared > 0
        ? `₦${fmt(debtCleared)} debt cleared for ${customerName}. ₦${fmt(refund)} wallet refund is pending approval.`
        : refund > 0
          ? `Goods released. ₦${fmt(refund)} wallet refund for ${customerName} is pending approval.`
          : `₦${fmt(debtCleared)} debt cleared for ${customerName}. No wallet refund was due.`;

      // Same audit_log gap fix as handleUnretrieve above.
      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'RETRIEVAL',
        table_name: RETRIEVAL_TABLE_NAME[entry.type as RetrievalEntryType], record_id: entry.id,
        description: `${data.isPartial ? 'Partial' : 'Full'} retrieval processed for ${customerName} -- ₦${fmt(data.retrievedValue)} (₦${fmt(debtCleared)} debt cleared, ₦${fmt(refund)} to wallet)`,
        hub: user.hub, hub_id: user.hub_id,
        old_values: { retrieved_amount: priorRetrievedAmount },
        new_values: { retrieved_amount: newRetrievedAmount, retrieved_by: user.name, retrieved_at: new Date().toISOString() },
      }).catch(() => {});

      showToast({ message, type: 'success' });
      setViewingDetail(null);
      setRetrievalModalEntry(null);
    } finally {
      setProcessingRetrieval(false);
    }
  };

  const canApproveRetrievals = user.role === 'super_admin' || user.can_approve_retrievals === true;

  const handleApproveRetrieval = async () => {
    if (!viewingDetail || viewingDetail.source !== 'transaction') return;
    const tx = viewingDetail.raw as Transaction;
    const ok = await confirm({
      title: 'Approve this retrieval?',
      message: `Marks ${tx.name}'s retrieval as reviewed/approved. This does not re-trigger any wallet or debt movement -- it's a review stamp only.`,
      confirmLabel: 'Approve',
      tone: 'default',
    });
    if (!ok) return;

    const result = await approveRetrieval(tx.type as RetrievalEntryType, {
      entryRef: tx.id,
      approvedBy: user.name || 'Unknown',
    });
    if (!result.ok) {
      showToast({ message: result.error || 'Failed to approve retrieval.', type: 'error' });
      return;
    }

    const approvedAt = new Date().toISOString();
    const updated: Transaction = {
      ...tx,
      retrievalApproved: true,
      retrievalApprovedBy: user.name,
      retrievalApprovedAt: approvedAt,
      raw: { ...(tx.raw || {}), retrieval_approved: true, retrieval_approved_by: user.name, retrieval_approved_at: approvedAt },
    };
    onUpdateTx(updated);
    writeAuditLog({
      user_id: user.id, user_name: user.name || 'Unknown', action: 'RETRIEVAL_APPROVE',
      table_name: RETRIEVAL_TABLE_NAME[tx.type as RetrievalEntryType], record_id: tx.id,
      description: `Retrieval approved for ${tx.name}`,
      hub: user.hub, hub_id: user.hub_id,
      new_values: { retrieval_approved: true, retrieval_approved_by: user.name },
    }).catch(() => {});
    showToast({ message: 'Retrieval approved', type: 'success' });
    setViewingDetail({ ...viewingDetail, raw: updated });
  };

  // Edit allowed only when not view-only AND user has can_edit_ledger or is super_admin.
  // Split from can_print_ledger (which now gates reprint/print only, see
  // TransactionLedger's Printing & Documents section below) -- previously
  // one flag controlled both, so a super_admin couldn't grant one without
  // the other. See 20260933_edit_ledger_permission.sql.
  // No role whitelist here (mirrors canEditRemarks below) -- a prior version
  // additionally required role to be accountant/admin/super_admin, but
  // Staff Management's toggle doesn't check the target's role before
  // allowing it to be granted, so a super_admin could switch this on for
  // any staffer and have it silently do nothing except leave Remarks
  // editable (canEditRemarks has no role gate). The flag itself is now
  // authoritative.
  const canEdit = !viewOnly && (user.role === 'super_admin' || user.can_edit_ledger === true);

  const isAccountantOrAdmin = canEdit;
  const canEditRemarks = user.role === 'super_admin' || user.can_edit_remarks === true;
  // Separate from canEdit -- PIN visibility is admin/super_admin/
  // accountant regardless of the can_edit_ledger flag, which is a
  // different, edit-specific permission.
  const canSeePin = ['admin', 'super_admin', 'accountant'].includes(user.role);

  // unverifiedCash/unconfirmedTransfer/unconfirmedPOS (POS sits unconfirmed
  // until a staff member manually enters the approval code via savePosCode)
  // are computed inside the kpis useMemo below, not here -- see its comment.

  const selectAllCash = async () => {
    if (bulkConfirming) return;
    setBulkConfirming(true);
    try {
      let skipped = 0;
      let failed = 0;
      const toConfirm: Entry[] = [];
      unverifiedCash.forEach(e => {
        if (e.source !== 'transaction') return;
        // Same maker-checker rule as toggleConfirm -- skip rows the current
        // user logged themselves rather than aborting the whole batch.
        if (e.raw.enteredByName && e.raw.enteredByName === user.name) {
          skipped++;
          return;
        }
        toConfirm.push(e);
      });
      // Same state-wide-authorized RPC as toggleConfirm -- this bulk action is
      // exactly the workflow a state-wide accountant would use across
      // multiple sibling hubs at once, so it needs the same fix.
      const results = await Promise.all(toConfirm.map(e => confirmPayment(e.raw.type as PaymentEntryType, {
        id: e.raw.id,
        confirmed: true,
        loggedBy: user.name || 'Unknown',
      })));
      results.forEach((result, i) => {
        if (!result.ok) { failed++; return; }
        const e = toConfirm[i];
        const updated = { ...e.raw };
        updated.paymentConfirmed = true;
        updated.confirmedAt = new Date().toISOString();
        updated.confirmedBy = user.name;
        onUpdateTx(updated);
      });
      if (skipped > 0) {
        showToast({ message: `Skipped ${skipped} entr${skipped === 1 ? 'y' : 'ies'} you personally logged.`, type: 'warning' });
      }
      if (failed > 0) {
        showToast({ message: `Failed to confirm ${failed} entr${failed === 1 ? 'y' : 'ies'}.`, type: 'error' });
      }
    } finally {
      setBulkConfirming(false);
    }
  };

  // totalAmount/cashAmount (excluding 'Debt Paid' -- see the kpis useMemo's
  // comment on why) are computed inside the kpis useMemo below.

  // Insert shift start/end markers into the visible array. `shifts` (all of
  // today's, open or closed) is preferred so both "Day started" and "Day
  // ended" markers show and survive a shift closing (activeShift alone goes
  // back to null the moment a shift ends, which would erase the marker);
  // falls back to just the single open shift if a caller doesn't pass the
  // fuller list.
  //
  // Memoized -- as a plain `const`, the `[activeShift]`/`[]` branches built
  // a BRAND NEW array literal on every single render whenever `shifts` was
  // empty/falsy (the normal case for the EHIApp "History" portal and the
  // More.tsx Master Ledger, both of which pass activeShift without always
  // passing a matching shifts array). That fed straight into displayEntries'
  // own dependency array below, so displayEntries recomputed -- and
  // returned a new array reference -- on every render regardless of whether
  // filteredEntries had actually changed, defeating its memoization
  // entirely. At Current Shift's small row counts this churn was cheap
  // enough to go unnoticed; once All Time engaged with a few hundred rows,
  // every one of those wasted recomputes fed the row/card virtualizers a
  // "new" items array, triggering another measure/resize pass, which
  // triggered another render, which built yet another new shiftsToMark
  // array -- a self-sustaining loop that is exactly what threw React's
  // "Maximum update depth exceeded" (error #185) the moment a large All
  // Time page landed, not merely a case of "too many rows to measure once."
  const shiftsToMark = useMemo(
    () => (shifts && shifts.length > 0 ? shifts : (activeShift ? [activeShift] : [])),
    [shifts, activeShift]
  );
  const displayEntries = useMemo(() => {
    let result = [...filteredEntries];
    // Only display shift start/end markers in the normal, unfiltered timeline for the current shift.
    // When searching, filtering, or when no transactions match, suppress synthetic shift markers
    // so they do not clutter the results or mask the "No entries found matching filters" empty state.
    const hasActiveSearchOrFilter =
      searchQuery.trim() !== '' ||
      modeFilter !== 'All' ||
      destFilter !== 'All' ||
      timeFilter !== 'All' ||
      debtClassFilter !== 'All' ||
      shiftFilter === 'all';

    if (!hasActiveSearchOrFilter && filteredEntries.length > 0) {
      shiftsToMark.forEach((s: any) => {
        const startDate = s.started_at ? new Date(s.started_at) : null;
        if (startDate && !isNaN(startDate.getTime())) {
          result.push({
            id: `shift-start-${s.id}`,
            time: startDate.toISOString().split('T')[1].slice(0, 5),
            type: 'shift-marker',
            name: 'SHIFT STARTED',
            detail: `Day started at ${startDate.toLocaleString()}`,
            amount: 0,
            mode: '',
            status: '',
            source: 'transaction',
            raw: s,
          });
        }
        const endDate = s.ended_at ? new Date(s.ended_at) : null;
        if (endDate && !isNaN(endDate.getTime())) {
          result.push({
            id: `shift-end-${s.id}`,
            time: endDate.toISOString().split('T')[1].slice(0, 5),
            type: 'shift-marker',
            name: 'SHIFT ENDED',
            detail: `Day ended at ${endDate.toLocaleString()}`,
            amount: 0,
            mode: '',
            status: '',
            source: 'transaction',
            raw: s,
          });
        }
      });
    }
    return result;
  }, [filteredEntries, shiftsToMark, searchQuery, modeFilter, destFilter, timeFilter, debtClassFilter, shiftFilter]);

  // Feeds the Batch Select/Print bar's "Select All" -- batch PRINTING works
  // across every payment mode (a customer paying Cash for several routes
  // wants one combined receipt too, not just a debt settlement), so this is
  // every real transaction row, not Debt-only. Batch CLEARING still only
  // makes sense for Debt rows -- see handleBatchClearDebts, which filters
  // the current selection down to Debt entries itself rather than
  // restricting what can be selected in the first place.
  const debtEntriesInView = useMemo(
    () => displayEntries.filter((e): e is Entry => e.source === 'transaction'),
    [displayEntries]
  );
  // Gates the "Clear N Debts" button -- printing accepts any mode, but
  // clearing only ever applies to Debt rows (see handleBatchClearDebts).
  const selectedAreAllDebt = useMemo(() => {
    if (selectedDebtIds.size === 0) return false;
    const selected = debtEntriesInView.filter(e => selectedDebtIds.has(e.id));
    return selected.length > 0 && selected.every(e => e.mode === 'Debt');
  }, [debtEntriesInView, selectedDebtIds]);

  const [isMobileView, setIsMobileView] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 640;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 639px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileView(e.matches);
    };
    handleMediaChange(mql);
    mql.addEventListener('change', handleMediaChange);
    return () => mql.removeEventListener('change', handleMediaChange);
  }, []);

  const tableRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 72,
    overscan: 4, // reduced from 10 — fewer off-screen rows rendered per frame
  });
  // Separate instance for the mobile card list below (same displayEntries,
  // same scroll container) -- card height genuinely varies (badges, PIN,
  // is_debt_clearance styling) unlike the desktop table's uniform 72px
  // rows, so this one measures actual rendered height via measureElement
  // instead of trusting a single fixed estimate.
  const cardVirtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 190,
    overscan: 4,
    measureElement: (el) => {
      // Guard against measuring 0-height elements (e.g. during display:none or off-screen layout)
      // which collapses TanStack Virtual into infinite resizeItem(index, 0) loops (React error #185)
      const height = el.getBoundingClientRect().height;
      return height > 20 ? height : 190;
    },
  });

  const measureCard = useCallback((node: HTMLDivElement | null) => {
    if (node && node.offsetHeight > 0) {
      cardVirtualizer.measureElement(node);
    }
  }, [cardVirtualizer]);

  // ─── KPI Math ─────────────────────────────────────────────────────────────
  // All five reduce passes are wrapped in a single useMemo so they only run
  // when filteredEntries actually changes, not on every render (e.g. typing,
  // modal open, checkbox tick). Each pass used to block the main thread for
  // 20–80ms on a 1000-5000 row ledger.
  const kpis = useMemo(() => {
    let transfer = 0, pos = 0, debt = 0, wallet = 0, debtCount = 0, officeDebt = 0, individualDebt = 0;
    // total/cash and the three unconfirmed-payment lists used to be separate
    // unmemoized `.filter()`/`.reduce()` passes over filteredEntries, run
    // fresh on every render (including every scroll-triggered re-render
    // from the row virtualizers) -- folded into this same single pass for
    // the same reason the comment above already gives.
    let total = 0, cash = 0;
    const unverifiedCashArr: Entry[] = [];
    const unconfirmedTransferArr: Entry[] = [];
    const unconfirmedPOSArr: Entry[] = [];
    for (const e of filteredEntries) {
      const sign = e.source === 'expense' ? -1 : 1;
      if (e.mode === 'Transfer') transfer += sign * e.amount;
      if (e.mode === 'POS') pos += sign * e.amount;
      if (e.mode === 'Debt') {
        const tx = e.raw as Transaction;
        const balance = Math.max(0, (tx.amount || 0) - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0));
        debt += balance;
        debtCount++;
        if (isOfficeWorkEntry(e)) officeDebt += balance; else individualDebt += balance;
      }
      const ded = e.raw?.wallet_deduction_amount || (e.mode === 'Wallet' ? e.amount : 0);
      wallet += ded;

      // Full cash-basis: a Debt-mode sale (open OR fully paid -- 'Debt'
      // and 'Debt Paid' are both client-derived labels for the same
      // underlying receipt_mode/payment_mode = 'Debt' row, see
      // clear_cargo_debt's own comment) contributes NOTHING to Total until
      // it's actually collected. What replaces it is the debt-collection
      // row itself (see 20260941_debt_collection_events.sql) -- its own
      // `mode` is the real payment mode from that specific event, never
      // 'Debt'/'Debt Paid', so it passes this filter and counts on ITS OWN
      // date instead. This is also what stops the old double-count this
      // exclusion was originally built for (summing a 'Debt Paid' row's
      // full amount AND its shadow row) -- now there's exactly one place
      // the money is ever counted, on the date it was actually collected.
      if (e.mode !== 'Debt' && e.mode !== 'Debt Paid') total += sign * e.amount;
      if (e.mode === 'Cash') {
        cash += sign * e.amount;
        if (!e.raw.paymentConfirmed) unverifiedCashArr.push(e);
      }
      if (e.mode === 'Transfer' && !e.raw.paymentConfirmed) unconfirmedTransferArr.push(e);
      if (e.mode === 'POS' && !e.raw.paymentConfirmed) unconfirmedPOSArr.push(e);
    }
    return {
      transferAmount: transfer, posAmount: pos, debtAmount: debt, walletAmount: wallet,
      unpaidDebtCount: debtCount, officeDebtAmount: officeDebt, individualDebtAmount: individualDebt,
      totalAmount: total, cashAmount: cash,
      unverifiedCash: unverifiedCashArr, unconfirmedTransfer: unconfirmedTransferArr, unconfirmedPOS: unconfirmedPOSArr,
    };
  }, [filteredEntries]);

  const {
    transferAmount, posAmount, debtAmount, walletAmount, unpaidDebtCount, officeDebtAmount, individualDebtAmount,
    totalAmount, cashAmount, unverifiedCash, unconfirmedTransfer, unconfirmedPOS,
  } = kpis;

  // True only for the FIRST All Time fetch (allTimeEngaged still false) --
  // switching back to All Time after it's already been engaged once reuses
  // the cached allTimeTotals/allTimeTxRows with no new fetch, so there's
  // nothing to show a loading state for the second time. Drives the KPI
  // tiles' and the table's own loading branches below, replacing the old
  // behavior of silently showing stale Current-Shift figures / a flash of
  // unscoped rows for the whole duration of that first fetch (the actual
  // "All Time click feels like it hangs" complaint -- the click itself was
  // never slow, nothing was telling the user their click had registered).
  const allTimeFirstLoadInFlight = shiftFilter === 'all' && loadingAllTimeFirst;

  // While All Time is engaged, the KPI tiles show the server-computed
  // aggregate (allTimeTotals, reflecting every matching row across the
  // whole table, not just loaded pages) instead of the client-computed
  // `kpis` above (which only ever reduces over filteredEntries -- whatever
  // happens to be loaded). unverifiedCash/unconfirmedTransfer/unconfirmedPOS
  // (used for row badges, not the tiles) intentionally keep coming from
  // `kpis` -- there's no equivalent server aggregate for "which specific
  // rows are unconfirmed," and those only ever need to reflect loaded rows.
  const displayTotals = useMemo(() => {
    if (shiftFilter === 'all' && allTimeEngaged && allTimeTotals) {
      return {
        totalAmount: allTimeTotals.totalAmount, cashAmount: allTimeTotals.cashAmount,
        transferAmount: allTimeTotals.transferAmount, posAmount: allTimeTotals.posAmount,
        debtAmount: allTimeTotals.debtAmount, walletAmount: allTimeTotals.walletAmount,
        unpaidDebtCount: allTimeTotals.unpaidDebtCount, officeDebtAmount: allTimeTotals.officeDebtAmount,
        individualDebtAmount: allTimeTotals.individualDebtAmount,
      };
    }
    return { totalAmount, cashAmount, transferAmount, posAmount, debtAmount, walletAmount, unpaidDebtCount, officeDebtAmount, individualDebtAmount };
  }, [shiftFilter, allTimeEngaged, allTimeTotals, totalAmount, cashAmount, transferAmount, posAmount, debtAmount, walletAmount, unpaidDebtCount, officeDebtAmount, individualDebtAmount]);

  // Server totals above only account for search/type/terminal/office-work/
  // debt-class -- timeFilter/vjFlightFilter/vjDestFilter/destFilter and
  // modeFilter's pseudo-values have no server equivalent (see
  // allTimeFilterParams' comment) and only narrow the on-screen ROWS, not
  // displayTotals. True whenever one of those is active so the tiles can
  // flag the mismatch instead of silently looking wrong.
  const allTimeTotalsExcludeSomeActiveFilters =
    shiftFilter === 'all' && allTimeEngaged && (
      timeFilter !== 'All' || vjFlightFilter !== 'All' || vjDestFilter !== 'All' || destFilter !== 'All' ||
      (modeFilter !== 'All' && !RAW_MODE_VALUES.includes(modeFilter))
    );

  const { hasNonDefaultFilters, activeFilterCount } = useMemo(() => {
    const hasNDF =
      normalizeType(typeFilter) !== normalizeType(defaultTypeFilter) ||
      modeFilter !== "All" ||
      timeFilter !== "All" ||
      searchQuery.trim() !== "" ||
      vjFlightFilter !== "All" ||
      vjDestFilter !== "All" ||
      destFilter !== "All" ||
      debtClassFilter !== "All";
    const count =
      (normalizeType(typeFilter) !== normalizeType(defaultTypeFilter) ? 1 : 0) +
      (modeFilter !== "All" ? 1 : 0) +
      (timeFilter !== "All" ? 1 : 0) +
      (searchQuery.trim() !== "" ? 1 : 0) +
      (vjFlightFilter !== "All" ? 1 : 0) +
      (vjDestFilter !== "All" ? 1 : 0) +
      (destFilter !== "All" ? 1 : 0) +
      (debtClassFilter !== "All" ? 1 : 0);
    return { hasNonDefaultFilters: hasNDF, activeFilterCount: count };
  }, [typeFilter, defaultTypeFilter, modeFilter, timeFilter, searchQuery, vjFlightFilter, vjDestFilter, destFilter, debtClassFilter, normalizeType]);

  const resetAllFilters = () => {
    setTypeFilter(normalizeType(defaultTypeFilter));
    setModeFilter("All");
    setTimeFilter("All");
    setTimeStart("");
    setTimeEnd("");
    setSearchInput("");
    setSearchQuery("");
    setVjFlightFilter("All");
    setVjDestFilter("All");
    setDestFilter("All");
    setDebtClassFilter("All");
  };

  const vjFlights = useMemo(() => {
    if (defaultTypeFilter !== 'baggage') return [];
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.source === 'transaction' && e.raw.type === 'baggage' && e.raw.flight) {
        set.add(e.raw.flight);
      }
    });
    return Array.from(set).sort();
  }, [entries, defaultTypeFilter]);

  const vjDests = useMemo(() => {
    if (defaultTypeFilter !== 'baggage') return [];
    const set = new Set<string>();
    entries.forEach(e => {
      if (e.source === 'transaction' && e.raw.type === 'baggage' && e.raw.destination) {
        set.add(e.raw.destination);
      }
    });
    return Array.from(set).sort();
  }, [entries, defaultTypeFilter]);

  // Destination filter's own option list -- seeded with routes (from
  // useHubRoutes(), always current/canonical) so a destination is
  // selectable even before any entry going there has loaded this session,
  // then union'd with whatever's actually stored on loaded entries (keyed
  // by cleanRoute() to dedupe against a canonical route already listed).
  // CargoForm's intake route picker has a free-text "Other" escape hatch
  // this Ledger's own edit modal doesn't offer, so a stored route/
  // destination isn't guaranteed to be a member of `routes` -- without
  // this union, an entry carrying one of those outlier values would have
  // no way to be isolated by this filter at all.
  const allDests = useMemo(() => {
    const seen = new Set(routes.map(r => cleanRoute(r)));
    const extra: string[] = [];
    entries.forEach(e => {
      if (e.source !== 'transaction') return;
      const raw = e.raw as any;
      const val = (e.type === 'cargo' || e.type === 'marketing') ? raw.route : raw.destination;
      if (!val || seen.has(cleanRoute(val))) return;
      seen.add(cleanRoute(val));
      extra.push(val);
    });
    return [...routes, ...extra.sort()];
  }, [routes, entries]);

  // Type Quick-Filter Chips' per-chip counts -- previously ran a fresh
  // entries.filter(...).length scan inline inside that bar's render .map(),
  // for 6 of its 7 chips, on every render (that bar is always visible, not
  // gated behind an open dropdown). Computed once here instead, keyed only
  // on entries (the pre-filter array these counts are meant to reflect).
  const typeChipCounts = useMemo(() => {
    let cargo = 0, legacy = 0, pkg = 0, expense = 0, officeWork = 0;
    for (const e of entries) {
      if (e.type === 'cargo') cargo++;
      if (e.type === 'baggage' || e.type === 'marketing' || e.type === 'legacy') legacy++;
      if (e.type === 'package') pkg++;
      if (e.type === 'expense') expense++;
      if (isOfficeWorkEntry(e)) officeWork++;
    }
    const counts: Record<string, number> = {
      All: entries.length,
      Cargo: cargo,
      Package: pkg,
      Expense: expense,
      'Office Work': officeWork,
    };
    if (legacy > 0) {
      counts['Legacy'] = legacy;
    }
    return counts;
  }, [entries]);

  // Extracted so the two render sites below (standalone when
  // showPrintHistory hides everything else, or as the first section inside
  // the unified glass panel with KPI/chips/manifest otherwise) share the
  // exact same content instead of duplicating it.
  const shiftBarContent = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full ${activeShift ? 'bg-[var(--color-success)] animate-pulse' : 'bg-[var(--color-muted)]'}`} />
        <span className="text-[12px] font-sans text-[var(--color-muted)] truncate">
          {activeShift
            ? `${shiftLabel ? shiftLabel + ' shift' : 'Shift'} open · started ${new Date(activeShift.started_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}, ${new Date(activeShift.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`
            : shiftLabel ? `No open ${shiftLabel} shift` : 'No open shift'}
        </span>
      </div>
      {/* Cargo/Package run on a fixed 18:00-18:00 business day now -- see
          EHIApp.tsx's autoRollShift -- so there's nothing left for staff to
          resolve by clicking Start/End Day; the boundary is always
          automatic. Every other department keeps the buttons, gated on
          viewOnly. */}
      {shiftAutoManaged || viewOnly ? null : !activeShift ? (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: shiftLabel ? `Start ${shiftLabel} day?` : 'Start the day?',
              message: shiftLabel
                ? `This will open the ${shiftLabel} desk's shift, tracking all new ${shiftLabel} sales under this shift until you close it.`
                : "This will officially open the station's shift, tracking all new sales under this shift until you close it.",
              confirmLabel: 'Yes, start day',
              tone: 'default',
            });
            if (ok) onStartShift && onStartShift();
          }}
          className="min-h-[44px] h-11 px-5 rounded-full bg-white text-black font-semibold text-[13px] hover:bg-neutral-200 flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 shadow-sm"
        >
          Start day
        </button>
      ) : (
        <button
          onClick={async () => {
            const ok = await confirm({
              title: shiftLabel ? `End ${shiftLabel} day?` : 'End the day?',
              message: shiftLabel
                ? `This will close the ${shiftLabel} desk's current shift and generate its final sales analysis.`
                : 'This will close the current shift and generate the final sales analysis.',
              confirmLabel: 'Yes, end day',
              tone: 'danger',
            });
            if (ok) onEndShift && onEndShift();
          }}
          className="min-h-[44px] h-11 px-5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-error)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0"
        >
          End day
        </button>
      )}
    </>
  );

  const handleExportExcel = async (exportAllHistorical: boolean = false) => {
    setShowExportOptions(false);

    if (!exportAllHistorical) {
      // Fast in-memory export of whatever is currently on screen (0 extra queries, 0 egress)
      const { downloadDailyExcel } = await import('../../lib/excelExport');
      const txs = filteredEntries
        .filter(e => e.source === 'transaction')
        .map(e => e.raw as Transaction);
      const exps = filteredEntries
        .filter(e => e.source === 'expense')
        .map(e => e.raw as Expense);
      await downloadDailyExcel(defaultTypeFilter || 'mixed', txs, user.hub || 'Hub', undefined, exps);
      showToast({ message: `Exported ${txs.length} entries to Excel.`, type: 'success' });
      return;
    }

    // Complete All-Time export from day one till now (on-demand single action, zero background egress)
    try {
      setIsExportingAll(true);
      showToast({ message: 'Fetching complete historical records from day one for Excel export...', type: 'info' });
      const { downloadDailyExcel } = await import('../../lib/excelExport');

      const { transactions: allTxs, expenses: allExps } = await fetchAllLedgerRowsForExport(
        allTimeFilterParams,
        allTimeProfileLookupRef.current,
      );

      let finalTxs = allTxs;
      if (destFilter !== 'All') {
        finalTxs = finalTxs.filter(t => cleanRoute(t.route || t.destination) === cleanRoute(destFilter));
      }

      if (dateRange?.start && dateRange?.end) {
        const startBound = parseLocalDateBoundary(dateRange.start);
        const endBound = parseLocalDateBoundary(dateRange.end);
        endBound.setDate(endBound.getDate() + 1);
        finalTxs = finalTxs.filter(t => {
          const tTime = t.created_at ? new Date(t.created_at) : null;
          return tTime && tTime >= startBound && tTime < endBound;
        });
      }

      const today = dateInputValue(new Date());
      const hubTag = (user.hub || 'Hub').replace(/\s+/g, '_');
      const streamTag = defaultTypeFilter || 'Master_Ledger';
      const filename = `Haulwey_${streamTag}_Complete_All_Time_${hubTag}_${today}.xlsx`;

      await downloadDailyExcel(defaultTypeFilter || 'mixed', finalTxs, user.hub || 'Hub', filename, allExps);
      showToast({ message: `Successfully exported complete ledger history (${finalTxs.length} entries) to Excel!`, type: 'success' });
    } catch (err: any) {
      showToast({ message: `Failed to export all-time ledger: ${err.message || err}`, type: 'error' });
    } finally {
      setIsExportingAll(false);
    }
  };

  const [headerSlots, setHeaderSlots] = useState<{ left: Element | null; right: Element | null }>({
    left: null,
    right: null,
  });

  useEffect(() => {
    const leftNodes = document.querySelectorAll('[data-ehi-header-left-slot]');
    const rightNodes = document.querySelectorAll('[data-ehi-header-right-slot]');
    const left = leftNodes.length > 0 ? leftNodes[leftNodes.length - 1] : null;
    const right = rightNodes.length > 0 ? rightNodes[rightNodes.length - 1] : null;
    setHeaderSlots({ left, right });
  }, []);

  const ledgerHeaderLeft = (
    <div className="flex items-center gap-2.5 min-w-0">
      <BackButton onClick={onBack} label="Back" />
      <div className="min-w-0">
        <h1 className="text-[15px] sm:text-[16px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
          {formatLedgerTitle(defaultTypeFilter)}
        </h1>
        <div className="text-[12px] font-sans text-[var(--color-muted)] leading-tight mt-0.5 truncate">
          {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
          {viewOnly && <span className="ml-1.5 opacity-60">· read only</span>}
        </div>
      </div>
    </div>
  );

  const ledgerHeaderRight = (
    <div className="flex items-center gap-2 flex-wrap justify-end min-w-0">
      {defaultTypeFilter === 'baggage' && (
        <>
          <select
            value={vjFlightFilter}
            onChange={e => setVjFlightFilter(e.target.value)}
            className="min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-full text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
          >
            <option value="All">All flights</option>
            {vjFlights.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={vjDestFilter}
            onChange={e => setVjDestFilter(e.target.value)}
            className="min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-full text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
          >
            <option value="All">All destinations</option>
            {vjDests.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </>
      )}

      {/* Grouped Export Dropdown Menu (Excel Current View, Excel All-Time, Airline Manifest Excel) */}
      <div className="relative" ref={exportMenuRef}>
        <button
          type="button"
          title="Export options"
          disabled={isExportingAll}
          onClick={() => setShowExportOptions(prev => !prev)}
          className={`min-h-[44px] h-11 px-3.5 flex items-center gap-2 bg-[var(--color-surface-1)] border rounded-full font-sans text-[12px] font-medium transition-all cursor-pointer ${
            isExportingAll
              ? 'border-[var(--color-warning)] text-[var(--color-warning)] animate-pulse'
              : showExportOptions
              ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] text-[var(--color-foreground)]'
              : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          {isExportingAll ? <Loader2 size={14} className="animate-spin shrink-0" /> : <Download size={14} className="shrink-0 text-[var(--color-muted)]" />}
          <span>{isExportingAll ? 'Exporting…' : 'Export'}</span>
          <ChevronDown size={13} className={`shrink-0 text-[var(--color-muted)] transition-transform duration-200 ${showExportOptions ? 'rotate-180' : ''}`} />
        </button>

        {showExportOptions && (
          <div className="absolute right-0 top-full mt-1.5 w-64 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl shadow-xl p-1.5 z-50 flex flex-col gap-1 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-3 py-1.5 text-[11px] font-sans text-[var(--color-muted)] border-b border-[var(--color-border)]">
              Export options
            </div>
            <button
              type="button"
              onClick={() => {
                setShowExportOptions(false);
                handleExportExcel(false);
              }}
              className="flex flex-col items-start px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-hover)] text-left transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                  Excel (current view)
                </span>
                <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  {filteredEntries.length} rows
                </span>
              </div>
              <span className="text-[11px] text-[var(--color-muted)] mt-0.5">
                Fast export of currently filtered entries.
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowExportOptions(false);
                handleExportExcel(true);
              }}
              className="flex flex-col items-start px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-hover)] text-left transition-colors cursor-pointer group border-t border-[var(--color-border)]"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)] flex items-center gap-1">
                  Excel (all time)
                </span>
                <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                  {allTimeTotals?.rowCount ? `${allTimeTotals.rowCount}` : 'Complete'}
                </span>
              </div>
              <span className="text-[11px] text-[var(--color-muted)] mt-0.5">
                Full database history from day 1 till now.
              </span>
            </button>

            {airlineManifestSummary.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowExportOptions(false);
                  import('../../lib/excelExport').then(async ({ downloadAirlineManifestExcel }) => {
                    const txs = filteredEntries
                      .filter(e => e.source === 'transaction')
                      .map(e => e.raw as Transaction);
                    await downloadAirlineManifestExcel(txs, user.hub || 'Hub');
                    showToast({ message: 'Exported airline weight manifest to Excel.', type: 'success' });
                  });
                }}
                className="flex flex-col items-start px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-hover)] text-left transition-colors cursor-pointer group border-t border-[var(--color-border)]"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                    Airline manifest (Excel)
                  </span>
                  <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)]">
                    {airlineManifestSummary.length} airlines
                  </span>
                </div>
                <span className="text-[11px] text-[var(--color-muted)] mt-0.5">
                  Breakdown by carrier, pieces, weight, and revenue.
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grouped Print Dropdown Menu (80mm Thermal Summary + Print Logs History) */}
      <div className="relative" ref={printMenuRef}>
        <button
          type="button"
          title="Print options"
          onClick={() => setShowPrintOptions(prev => !prev)}
          className={`min-h-[44px] h-11 px-3.5 flex items-center gap-2 bg-[var(--color-surface-1)] border rounded-full font-sans text-[12px] font-medium transition-colors cursor-pointer ${
            showPrintHistory || showPrintOptions
              ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-hover)] text-[var(--color-foreground)]'
              : 'border-[var(--color-border)] text-[var(--color-foreground)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]'
          }`}
        >
          <Printer size={14} className="shrink-0 text-[var(--color-muted)]" />
          <span>Print</span>
          <ChevronDown size={13} className={`shrink-0 text-[var(--color-muted)] transition-transform duration-200 ${showPrintOptions ? 'rotate-180' : ''}`} />
        </button>

        {showPrintOptions && (
          <div className="absolute right-0 top-full mt-1.5 w-64 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-1.5 z-50 flex flex-col gap-1 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-3 py-1.5 text-[11px] font-sans text-[var(--color-muted)] border-b border-[var(--color-border)]">
              Print options
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPrintOptions(false);
                handlePrint80mmLedger();
              }}
              className="flex flex-col items-start px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-hover)] text-left transition-colors cursor-pointer group"
            >
              <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)] flex items-center gap-1.5">
                <Receipt size={13} className="shrink-0 text-[var(--color-muted)]" /> 80mm receipt
              </span>
              <span className="text-[11px] text-[var(--color-muted)] mt-0.5">
                Print compact 80mm shift summary receipt.
              </span>
            </button>

            {(user.role === 'super_admin' || user.role === 'admin' || user.role === 'accountant' || user.role === 'auditor') && (
              <button
                type="button"
                onClick={() => {
                  setShowPrintOptions(false);
                  setShowPrintHistory(prev => !prev);
                }}
                className="flex flex-col items-start px-3 py-2.5 rounded-xl hover:bg-[var(--color-surface-hover)] text-left transition-colors cursor-pointer group border-t border-[var(--color-border)]"
              >
                <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                  {showPrintHistory ? '← Back to ledger' : 'Tag print history'}
                </span>
                <span className="text-[11px] text-[var(--color-muted)] mt-0.5">
                  {showPrintHistory ? 'Close print logs and return to rows.' : 'Inspect printed tag audit history.'}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Debt & Retrievals Shortcut */}
      {canAccessTab(user, 'More:DebtCollectionLog', []) && (
        <button
          type="button"
          title="Debt collection log"
          onClick={() => { onBack(); navigate('/more/debt-collection-log'); }}
          className="min-h-[44px] h-11 px-3.5 flex items-center gap-2 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full text-[var(--color-foreground)] font-sans text-[12px] font-medium transition-colors cursor-pointer"
        >
          <HandCoins size={14} className="text-[var(--color-muted)]" />
          <span>Debt collection log</span>
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-row h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] relative">
      <div className="flex-1 flex flex-col h-full min-w-0">
        {headerSlots.left && headerSlots.right ? (
          <>
            {createPortal(ledgerHeaderLeft, headerSlots.left)}
            {createPortal(ledgerHeaderRight, headerSlots.right)}
          </>
        ) : (
          /* Fallback inline Top Bar if Header slots are not mounted */
          <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap shrink-0 bg-[var(--color-surface-1)] border-b border-[var(--color-border)]">
            {ledgerHeaderLeft}
            {ledgerHeaderRight}
          </div>
        )}

        {showPrintHistory && (onStartShift || onEndShift || shiftAutoManaged) && (
          <div className="mx-3 mt-2.5 px-4 py-2.5 rounded-2xl bg-[var(--color-surface-1)] border border-[var(--color-border)] flex items-center justify-between gap-3 shrink-0 relative z-10">
            {shiftBarContent}
          </div>
        )}

        {showPrintHistory ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 md:p-6 relative z-10">
            <TagPrintHistory user={user} />
          </div>
        ) : (
          <>
            {/* ── TIER 2: Collapsible KPI Ribbon & Progressive Disclosure Drawer ── */}
            <div className="shrink-0 bg-[var(--color-surface-1)] border-b border-[var(--color-border)] relative">
              {/* Slim Always-Visible KPI Strip (Pinned) */}
              <div className="sticky top-0 z-20 bg-[var(--color-surface-1)] border-b border-[var(--color-border)] px-3 py-2 flex items-center justify-between gap-2 flex-nowrap">
                <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  {/* Total Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter('All')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'All'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">Total</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.totalAmount)}`}
                    </span>
                  </button>

                  {/* Cash Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter(modeFilter === 'Cash' ? 'All' : 'Cash')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'Cash'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">Cash</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.cashAmount)}`}
                    </span>
                    {isAccountantOrAdmin && unverifiedCash.length > 0 && (
                      <span className="text-[10px] font-mono tabular-nums font-semibold bg-[var(--color-warning)]/15 text-[var(--color-warning)] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                        <AlertTriangle size={9} />
                        <span>{unverifiedCash.length}</span>
                      </span>
                    )}
                  </button>

                  {/* Transfer Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter(modeFilter === 'Transfer' ? 'All' : 'Transfer')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'Transfer'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">Transfer</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.transferAmount)}`}
                    </span>
                    {isAccountantOrAdmin && unconfirmedTransfer.length > 0 && (
                      <span className="text-[10px] font-mono tabular-nums font-semibold bg-[var(--color-warning)]/15 text-[var(--color-warning)] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                        <AlertTriangle size={9} />
                        <span>{unconfirmedTransfer.length}</span>
                      </span>
                    )}
                  </button>

                  {/* POS Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter(modeFilter === 'POS' ? 'All' : 'POS')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'POS'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">POS</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.posAmount)}`}
                    </span>
                    {isAccountantOrAdmin && unconfirmedPOS.length > 0 && (
                      <span className="text-[10px] font-mono tabular-nums font-semibold bg-[var(--color-warning)]/15 text-[var(--color-warning)] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                        <AlertTriangle size={9} />
                        <span>{unconfirmedPOS.length}</span>
                      </span>
                    )}
                  </button>

                  {/* Debt Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter(modeFilter === 'Debt' ? 'All' : 'Debt')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'Debt'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">Debt</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.debtAmount)}`}
                    </span>
                    {displayTotals.unpaidDebtCount > 0 && (
                      <span className="text-[10px] font-mono tabular-nums font-semibold bg-[var(--color-error)]/15 text-[var(--color-error)] px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5">
                        <span>{displayTotals.unpaidDebtCount}</span>
                      </span>
                    )}
                  </button>

                  {/* Wallet Pill */}
                  <button
                    type="button"
                    onClick={() => setModeFilter(modeFilter === 'Wallet' ? 'All' : 'Wallet')}
                    className={`shrink-0 min-h-[44px] h-11 px-3.5 rounded-full border flex items-center gap-2 font-sans text-[12px] transition-all cursor-pointer ${
                      modeFilter === 'Wallet'
                        ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)] text-[var(--color-foreground)] font-semibold shadow-sm'
                        : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                    }`}
                  >
                    <span className="text-[var(--color-muted)] font-medium">Wallet</span>
                    <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">
                      {allTimeFirstLoadInFlight ? '…' : `₦${fmt(displayTotals.walletAmount)}`}
                    </span>
                  </button>
                </div>

                {/* Right-side Toggle Button for Progressive Disclosure Drawer */}
                <button
                  type="button"
                  onClick={toggleSummaryExpanded}
                  className="shrink-0 min-h-[44px] h-11 px-3.5 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] font-sans text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ml-auto"
                >
                  <span>{isSummaryExpanded ? 'Hide breakdown' : 'Breakdown & manifest'}</span>
                  {isSummaryExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>

              {/* Compact Shift Bar when Drawer is Collapsed */}
              {!isSummaryExpanded && (onStartShift || onEndShift || shiftAutoManaged) && (
                <div className="px-3 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-1)]/60 flex items-center justify-between gap-3">
                  {shiftBarContent}
                </div>
              )}

              {/* Progressive Disclosure Expanded Drawer */}
              {isSummaryExpanded && (
                <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-1)]/40 space-y-3 animate-in fade-in duration-200">
                  {(onStartShift || onEndShift || shiftAutoManaged) && (
                    <div className="px-3 py-2 rounded-xl bg-[var(--color-surface-card)] border border-[var(--color-border)] flex items-center justify-between gap-3">
                      {shiftBarContent}
                    </div>
                  )}

                  {/* Office Work (B2B) vs Individual Debt Split */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      onClick={() => {
                        const next = debtClassFilter === 'Office' ? 'All' : 'Office';
                        setDebtClassFilter(next);
                        if (next !== 'All') setModeFilter('Debt');
                      }}
                      className={`rounded-2xl p-3 border flex items-center justify-between text-left transition-all cursor-pointer ${
                        debtClassFilter === 'Office'
                          ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)]'
                          : 'bg-[var(--color-surface-card)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                          <Building2 size={15} className="text-[var(--color-muted)]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-sans text-[var(--color-muted)]">Office debt (B2B)</div>
                          <div className="text-[14px] font-semibold font-mono tabular-nums text-[var(--color-foreground)] leading-tight">
                            {allTimeFirstLoadInFlight ? <Loader2 size={12} className="animate-spin" /> : `₦${fmt(displayTotals.officeDebtAmount)}`}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-[var(--color-muted)]" />
                    </button>

                    <button
                      onClick={() => {
                        const next = debtClassFilter === 'Individual' ? 'All' : 'Individual';
                        setDebtClassFilter(next);
                        if (next !== 'All') setModeFilter('Debt');
                      }}
                      className={`rounded-2xl p-3 border flex items-center justify-between text-left transition-all cursor-pointer ${
                        debtClassFilter === 'Individual'
                          ? 'bg-[var(--color-surface-hover)] border-[var(--color-border-strong)]'
                          : 'bg-[var(--color-surface-card)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
                          <UserIcon size={15} className="text-[var(--color-muted)]" />
                        </div>
                        <div>
                          <div className="text-[11px] font-sans text-[var(--color-muted)]">Individual debt</div>
                          <div className="text-[14px] font-semibold font-mono tabular-nums text-[var(--color-foreground)] leading-tight">
                            {allTimeFirstLoadInFlight ? <Loader2 size={12} className="animate-spin" /> : `₦${fmt(displayTotals.individualDebtAmount)}`}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-[var(--color-muted)]" />
                    </button>
                  </div>

                  {/* Airline Weight Manifest Summary */}
                  {airlineManifestSummary.length > 0 && (
                    <div className="pt-1 overflow-x-auto">
                      <div className="flex items-center gap-2 flex-nowrap min-w-max">
                        <span className="text-[11px] font-sans font-medium text-[var(--color-muted)] shrink-0">
                          Airline weight manifest:
                        </span>
                        {airlineManifestSummary.map((a) => (
                          <div
                            key={a.airline}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-surface-card)] border border-[var(--color-border)] shrink-0 text-[11px]"
                            title={`${a.entries} entries`}
                          >
                            <span className="font-sans font-semibold text-[var(--color-foreground)]">{a.airline}</span>
                            <span className="font-mono tabular-nums text-[var(--color-muted)]">{a.kg.toFixed(0)} kg</span>
                            <span className="font-mono tabular-nums text-[var(--color-muted)]">{a.pieces} pc</span>
                            <span className="font-mono tabular-nums text-[var(--color-foreground)] font-semibold">₦{fmt(a.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── TIER 3: Pinned / Sticky Ledger Controller (Category Tabs + Compact Filter Bar) ── */}
            <div className="shrink-0 sticky top-0 z-30 bg-[var(--color-canvas)]/95 backdrop-blur-md border-b border-[var(--color-border)] px-4 py-2.5 space-y-2.5">
              {/* Row 1: Category Quick-Filter Tabs + Active Filter Reset */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                  {([
                    { label: 'All', value: 'All' },
                    { label: 'Cargo', value: 'Cargo' },
                    { label: 'Package', value: 'Package' },
                    { label: 'Expense', value: 'Expense' },
                    { label: 'Office work', value: 'Office Work' },
                    ...((typeChipCounts['Legacy'] ?? 0) > 0 ? [{ label: 'Legacy', value: 'Legacy' }] : []),
                  ]).map(({ label, value }) => {
                    const count = typeChipCounts[value] ?? 0;
                    const isActive = normalizeType(typeFilter) === value;
                    return (
                      <button
                        key={value}
                        onClick={() => setTypeFilter(value)}
                        className={`shrink-0 min-h-[44px] px-3.5 py-2 rounded-full text-[12px] font-sans transition-all cursor-pointer flex items-center gap-2 border ${
                          isActive
                            ? 'bg-white text-black font-semibold border-white shadow-sm'
                            : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-foreground)]'
                        }`}
                      >
                        <span>{label}</span>
                        <span className={`text-[11px] font-mono tabular-nums px-1.5 py-0.2 rounded-full min-w-[16px] text-center ${
                          isActive ? 'bg-black/10 text-black' : 'bg-[var(--color-surface-2)] text-[var(--color-muted)]'
                        }`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Inline Filter Status & Reset */}
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  {shiftFilter === 'current' && !hasNonDefaultFilters && (
                    <span className="hidden lg:inline-flex items-center gap-1 text-[11px] font-sans text-[var(--color-muted)]">
                      <Clock size={12} />
                      <span>Current shift</span>
                    </span>
                  )}
                  {hasNonDefaultFilters && (
                    <div className="flex items-center gap-2 font-sans text-[11px]">
                      <span className="text-[var(--color-foreground)] flex items-center gap-1 font-medium">
                        <Filter size={11} className="text-[var(--color-muted)]" />
                        <span>{activeFilterCount} active</span>
                      </span>
                      <button
                        onClick={resetAllFilters}
                        className="min-h-[44px] px-3.5 py-1.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] font-medium transition-colors cursor-pointer border border-[var(--color-border)]"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Unified Search + Shift Toggle + Date / Mode / Time Filters */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                {/* Search + Shift Scope */}
                <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                  <div className="flex-1 relative group">
                    <button
                      type="button"
                      onClick={() => commitSearch(searchInput)}
                      aria-label="Search"
                      title="Search"
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 p-0.5 bg-transparent border-none cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
                    >
                      <Search size={15} />
                    </button>
                    <input
                      id="ledger-search"
                      name="search"
                      type="text"
                      placeholder="Search name, amount, tag, AWB…"
                      value={searchInput}
                      onChange={(e) => handleSearchInputChange(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(searchInput); }}
                      className="w-full min-h-[44px] h-11 pl-10 pr-10 bg-[var(--color-surface-1)] border border-[var(--color-border)] focus:border-[var(--color-border-strong)] rounded-full text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none transition-all placeholder-[var(--color-muted)]"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={clearSearch}
                        aria-label="Clear search"
                        title="Clear search"
                        className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Shift scope pills */}
                  <div className="flex items-center gap-1 p-1 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-full shrink-0">
                    {(['current', 'all'] as const).map((scope) => (
                      <button
                        key={scope}
                        onClick={() => {
                          setShiftFilter(scope);
                          if (scope === 'all' && !allTimeEngaged) {
                            fetchAllTimeFirstPage();
                          }
                        }}
                        className={`min-h-[44px] h-11 px-4 rounded-full text-[12px] font-sans font-medium transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                          shiftFilter === scope
                            ? 'bg-[var(--color-surface-hover)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)] shadow-sm'
                            : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                        }`}
                      >
                        {scope === 'all' && allTimeFirstLoadInFlight && <Loader2 size={12} className="animate-spin" />}
                        {scope === 'current' ? 'Current shift' : 'All time'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter Dropdowns (Destination, Date Range, Mode, Time) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Destination filter */}
                  <div className="relative flex items-center min-h-[44px] h-11 pl-3.5 pr-7 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full font-sans text-[12px] text-[var(--color-foreground)] transition-colors">
                    <MapPin size={13} className="text-[var(--color-muted)] mr-2 shrink-0" />
                    <select
                      value={destFilter}
                      onChange={e => setDestFilter(e.target.value)}
                      title="Filter by destination"
                      className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full appearance-none pr-1 font-medium"
                    >
                      <option value="All" className="bg-[var(--color-surface-card)]">All destinations</option>
                      {allDests.map(r => <option key={r} value={r} className="bg-[var(--color-surface-card)]">{r}</option>)}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
                  </div>

                  {/* Date range */}
                  {dateRange && onDateRangeChange && (
                    <div
                      className="flex items-center gap-1.5 min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full font-sans text-[12px] text-[var(--color-foreground)] transition-colors"
                      title="Select date range"
                    >
                      <Calendar size={13} className="text-[var(--color-muted)] shrink-0" />
                      <input
                        id="ledger-date-start"
                        name="date-start"
                        type="date"
                        value={dateRange.start}
                        max={dateRange.end || undefined}
                        onChange={(e) => {
                          const newStart = e.target.value;
                          if (shiftFilter === 'current') {
                            setShiftFilter('all');
                            if (!allTimeEngaged) fetchAllTimeFirstPage();
                          }
                          onDateRangeChange({ ...dateRange, start: newStart });
                        }}
                        className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[105px] font-mono tabular-nums text-[11px] cursor-pointer"
                      />
                      <span className="text-[var(--color-muted)] font-sans">→</span>
                      <input
                        id="ledger-date-end"
                        name="date-end"
                        type="date"
                        value={dateRange.end}
                        min={dateRange.start || undefined}
                        onChange={(e) => {
                          const newEnd = e.target.value;
                          if (shiftFilter === 'current') {
                            setShiftFilter('all');
                            if (!allTimeEngaged) fetchAllTimeFirstPage();
                          }
                          onDateRangeChange({ ...dateRange, end: newEnd });
                        }}
                        className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[105px] font-mono tabular-nums text-[11px] cursor-pointer"
                      />
                      {(dateRange.start || dateRange.end) && (
                        <button
                          title="Clear date range"
                          onClick={() => {
                            onDateRangeChange({ start: '', end: '' });
                            if (shiftFilter === 'current') {
                              setShiftFilter('all');
                              if (!allTimeEngaged) fetchAllTimeFirstPage();
                            }
                          }}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors p-1 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Mode filter */}
                  <div className="relative flex items-center min-h-[44px] h-11 pl-3.5 pr-7 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full font-sans text-[12px] text-[var(--color-foreground)] transition-colors">
                    <HandCoins size={13} className="text-[var(--color-muted)] mr-2 shrink-0" />
                    <select
                      value={modeFilter}
                      onChange={(e) => setModeFilter(e.target.value)}
                      className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full appearance-none pr-1 font-medium"
                    >
                      <option value="All" className="bg-[var(--color-surface-card)]">All modes</option>
                      <option value="Revenue" className="bg-[var(--color-surface-card)]">Revenue only</option>
                      <option value="Expense" className="bg-[var(--color-surface-card)]">Expense only</option>
                      <option value="Cash" className="bg-[var(--color-surface-card)]">Cash</option>
                      <option value="Transfer" className="bg-[var(--color-surface-card)]">Transfer</option>
                      <option value="POS" className="bg-[var(--color-surface-card)]">POS</option>
                      <option value="Wallet" className="bg-[var(--color-surface-card)]">Wallet</option>
                      <option value="Debt" className="bg-[var(--color-surface-card)]">Debt</option>
                      <option value="Unverified" className="bg-[var(--color-surface-card)]">Unverified</option>
                      <option value="Retrieved" className="bg-[var(--color-surface-card)]">Retrieved</option>
                      <option value="Debt Paid" className="bg-[var(--color-surface-card)]">Debt cleared</option>
                      <option value="Debt Clearance" className="bg-[var(--color-surface-card)]">Debt clearance</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
                  </div>

                  {/* Time filter */}
                  <div className="relative flex items-center min-h-[44px] h-11 pl-3.5 pr-7 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full font-sans text-[12px] text-[var(--color-foreground)] transition-colors">
                    <Clock size={13} className="text-[var(--color-muted)] mr-2 shrink-0" />
                    <select
                      value={timeFilter}
                      onChange={(e) => setTimeFilter(e.target.value as any)}
                      className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none cursor-pointer h-full appearance-none pr-1 font-medium"
                    >
                      <option value="All" className="bg-[var(--color-surface-card)]">All hours</option>
                      <option value="Morning" className="bg-[var(--color-surface-card)]">Morning (06–12)</option>
                      <option value="Afternoon" className="bg-[var(--color-surface-card)]">Afternoon (12–17)</option>
                      <option value="Evening" className="bg-[var(--color-surface-card)]">Evening (17–24)</option>
                      <option value="Custom" className="bg-[var(--color-surface-card)]">Custom…</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none" />
                  </div>

                  {/* Custom Time range */}
                  {timeFilter === "Custom" && (
                    <div className="flex items-center gap-1.5 min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full font-mono text-[11px] text-[var(--color-foreground)] transition-colors">
                      <input
                        id="ledger-time-start"
                        name="time-start"
                        type="time"
                        value={timeStart}
                        onChange={(e) => setTimeStart(e.target.value)}
                        className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[72px] cursor-pointer"
                      />
                      <span className="text-[var(--color-muted)] font-sans">–</span>
                      <input
                        id="ledger-time-end"
                        name="time-end"
                        type="time"
                        value={timeEnd}
                        onChange={(e) => setTimeEnd(e.target.value)}
                        className="bg-transparent text-[var(--color-foreground)] border-none focus:outline-none h-full w-[72px] cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>

              {allTimeTotalsExcludeSomeActiveFilters && (
                <div className="text-[10px] font-mono text-[var(--color-muted)] flex items-center gap-1">
                  <AlertTriangle size={10} className="text-[var(--color-accent-amber)]" />
                  <span>Totals above don't account for Time/Flight/Dest filters or this Mode filter yet — they only narrow what's currently loaded on screen.</span>
                </div>
              )}
            </div>

            {/* ── Bulk Cash Verification Banner ─────────────── */}
            {modeFilter === 'Cash' && unverifiedCash.length > 0 && isAccountantOrAdmin && (
              <div className="px-4 py-2.5 bg-[var(--color-surface-1)] border-b border-[var(--color-border)] flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={bulkConfirming ? undefined : selectAllCash}
                  disabled={bulkConfirming}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--color-accent-amber)] hover:opacity-80 transition-opacity cursor-pointer disabled:opacity-50"
                  aria-label="Select all unverified cash entries"
                >
                  <CheckSquare size={16} />
                </button>
                <span className="text-[12px] font-sans text-[var(--color-foreground)] flex-1">
                  <span className="font-semibold font-mono tabular-nums">{unverifiedCash.length}</span> unverified cash {unverifiedCash.length === 1 ? 'entry' : 'entries'}
                </span>
                <button
                  onClick={selectAllCash}
                  disabled={bulkConfirming}
                  className="min-h-[44px] px-5 rounded-full bg-white text-black hover:bg-neutral-200 text-[12px] font-sans font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {bulkConfirming ? 'Confirming…' : 'Confirm all'}
                </button>
              </div>
            )}

            {/* ── Batch Select/Print Bar -- every mode; Clear is Debt-only ── */}
            {debtEntriesInView.length > 0 && (
              <div className="px-4 py-2.5 bg-[var(--color-surface-1)] border-b border-[var(--color-border)] flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
                <label className="flex items-center gap-2 min-h-[44px] px-2 text-[12px] font-sans font-medium text-[var(--color-foreground)] cursor-pointer select-none shrink-0">
                  <input
                    type="checkbox"
                    checked={selectedDebtIds.size > 0 && selectedDebtIds.size === debtEntriesInView.length}
                    onChange={(e) => setSelectedDebtIds(e.target.checked ? new Set(debtEntriesInView.map(x => x.id)) : new Set())}
                    className="w-4 h-4 cursor-pointer accent-white"
                  />
                  <span>Select all (<span className="font-mono tabular-nums">{debtEntriesInView.length}</span>)</span>
                </label>
                {selectedDebtIds.size > 0 && (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <span className="text-[12px] font-sans font-semibold text-[var(--color-foreground)]">
                      <span className="font-mono tabular-nums">{selectedDebtIds.size}</span> selected
                    </span>
                    <select
                      value={batchDebtMode}
                      onChange={e => setBatchDebtMode(e.target.value as any)}
                      className={`min-h-[44px] h-11 px-3 bg-[var(--color-surface-card)] border rounded-full text-[12px] font-sans focus:outline-none ${
                        batchDebtMode === '' ? 'border-[var(--color-error)] text-[var(--color-error)]' : 'border-[var(--color-border)] text-[var(--color-foreground)]'
                      }`}
                    >
                      <option value="" disabled>Select mode…</option>
                      <option value="Cash">Cash</option>
                      <option value="Transfer">Transfer</option>
                      <option value="POS">POS</option>
                    </select>
                    {batchDebtMode === 'Transfer' && (
                      <select
                        value={batchDebtBank}
                        onChange={e => setBatchDebtBank(e.target.value)}
                        className="min-h-[44px] h-11 px-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-full text-[12px] font-sans text-[var(--color-foreground)] focus:outline-none"
                      >
                        <option value="">Select bank</option>
                        {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        onClick={handleBatchPrintReceipt}
                        disabled={!batchDebtMode}
                        title={!batchDebtMode ? 'Select a payment mode first' : undefined}
                        className="min-h-[44px] h-11 px-4 flex items-center gap-1.5 bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full text-[12px] font-sans font-medium transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Printer size={13} /> Print receipt
                      </button>
                      {selectedAreAllDebt && (
                        <button
                          onClick={handleBatchClearDebts}
                          disabled={batchClearingDebts || !batchDebtMode || (batchDebtMode === 'Transfer' && !batchDebtBank.trim())}
                          title={!batchDebtMode ? 'Select a payment mode first' : undefined}
                          className="min-h-[44px] h-11 px-5 bg-white text-black hover:bg-neutral-200 rounded-full text-[12px] font-sans font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {batchClearingDebts ? 'Clearing…' : `Clear ${selectedDebtIds.size} debt${selectedDebtIds.size === 1 ? '' : 's'}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── TIER 4: Bounded Virtualized Table / Mobile Cards Container ── */}
            <div ref={tableRef} className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 pr-11 sm:pr-12 pb-4 relative">
              {allTimeFirstLoadInFlight && (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20"
                  style={{ background: 'var(--color-overlay, rgba(0,0,0,0.55))', backdropFilter: 'blur(2px)' }}
                >
                  <Loader2 size={22} className="animate-spin text-[var(--color-foreground)]" />
                  <span className="text-[12px] font-mono text-[var(--color-foreground)]">Loading full history…</span>
                </div>
              )}
              {/* Mobile Card List View (Visible on < 640px) */}
              {isMobileView && (
              <div className="block sm:hidden">
                {displayEntries.length === 0 ? (
                  <div className="py-8 text-center text-[var(--color-muted)] text-[12px] font-mono">
                    No entries found matching filters.
                  </div>
                ) : (
                  <div style={{ position: 'relative', height: cardVirtualizer.getTotalSize() }}>
                  {cardVirtualizer.getVirtualItems().map((virtualRow) => {
                    const e = displayEntries[virtualRow.index];
                    const wrapperStyle: React.CSSProperties = {
                      position: 'absolute', top: 0, left: 0, width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: 10,
                    };
                    if (e.type === 'shift-marker') {
                      return (
                        <div key={e.id} data-index={virtualRow.index} ref={measureCard} style={wrapperStyle}>
                          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl p-3 text-center font-sans font-medium text-[var(--color-foreground)] text-[12px]">
                            {e.name} — {e.detail}
                          </div>
                        </div>
                      );
                    }

                    const displayDate = (e as any).displayDateMobile || 'Unknown';
                    const displayTime = (e as any).displayTime || e.time;

                    const statusColor = statusChipClass(e.status);

                    return (
                      <div key={e.id} data-index={virtualRow.index} ref={measureCard} style={wrapperStyle}>
                      <div
                        onClick={() => e.raw?.is_debt_clearance ? handleJumpToOriginalDebt(e.raw?.related_tx_id) : setViewingDetail(e)}
                        className={`ehi-card p-3.5 rounded-2xl border border-[var(--color-border)] hover:border-[var(--color-border-strong)] transition-all cursor-pointer space-y-2.5 ${
                          (e.raw?.retrieved || e.raw?.is_debt_clearance) ? 'opacity-50' : ''
                        } ${e.raw?.is_debt_clearance ? 'bg-[rgba(59,130,246,0.05)]' : ''}`}
                      >
                        {/* Top header row */}
                        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {e.source === 'transaction' && (
                              <label
                                onClick={(evt) => evt.stopPropagation()}
                                className="min-w-[44px] min-h-[44px] -ml-2 -my-2 flex items-center justify-center cursor-pointer shrink-0"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedDebtIds.has(e.id)}
                                  onChange={(evt) => {
                                    setSelectedDebtIds(prev => {
                                      const next = new Set(prev);
                                      if (evt.target.checked) next.add(e.id); else next.delete(e.id);
                                      return next;
                                    });
                                  }}
                                  className="w-4 h-4 cursor-pointer accent-white"
                                />
                              </label>
                            )}
                            <div className="w-6 h-6 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] flex items-center justify-center shrink-0">
                              {e.type === 'cargo' && <Package size={12} />}
                              {(e.type === 'baggage' || e.type === 'marketing' || e.type === 'legacy') && <Archive size={12} />}
                              {e.type === 'package' && <Truck size={12} />}
                              {e.source === 'expense' && <Minus size={12} />}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-mono tabular-nums font-semibold text-[12px] text-[var(--color-foreground)] truncate">{e.id}</span>
                              {e.type === 'cargo' && (e.airline_awb || e.raw?.airline_awb) && (
                                <span className="font-mono tabular-nums text-[10px] text-[var(--color-muted)] truncate">AWB: {e.airline_awb || e.raw?.airline_awb}</span>
                              )}
                            </div>
                            {canSeePin && e.raw.pickupPin && (
                              <span className="font-mono tabular-nums text-[10px] text-[var(--color-foreground)] bg-[var(--color-surface-2)] border border-[var(--color-border)] px-1.5 py-0.5 rounded-full shrink-0">PIN: {e.raw.pickupPin}</span>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-sans font-medium border ${statusColor}`}>
                              {e.source === 'expense' ? 'Expense' : formatEntryTypeLabel(e.status || 'Intake')}
                            </span>
                            <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)] mt-0.5">{displayDate} {displayTime}</div>
                          </div>
                        </div>

                        {/* Customer & Detail */}
                        <div>
                          <div className="flex items-center flex-wrap gap-1.5">
                            <span className={`font-sans font-semibold text-[13px] ${e.raw?.is_debt_clearance ? 'italic' : ''} ${e.source === "expense" ? "text-[var(--color-error)]" : "text-[var(--color-foreground)]"}`}>
                              {e.name}
                            </span>
                            {(e.raw as any)?.airline && (() => {
                              const c = airlineBadgeColors((e.raw as any).airline);
                              return (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium border"
                                  style={{ background: c.bg, color: c.text, borderColor: c.border }}
                                >
                                  {(e.raw as any).airline}
                                </span>
                              );
                            })()}
                            {(() => {
                              const raw = e.raw as any;
                              const dest = raw ? ((e.type === 'cargo' || e.type === 'marketing') ? raw.route : raw.destination) : null;
                              const shortDest = shortenDestination(dest);
                              return dest ? (
                                <span
                                  title={dest}
                                  className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]"
                                >
                                  {shortDest || dest}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <div className={`text-[12px] text-[var(--color-muted)] line-clamp-2 mt-1 font-sans ${e.raw?.is_debt_clearance ? 'italic' : ''}`}>
                            {stripBadgedFieldsFromDetail(
                              e.detail,
                              (e.raw as any)?.airline,
                              (e.type === 'cargo' || e.type === 'marketing') ? (e.raw as any)?.route : (e.raw as any)?.destination
                            )}
                          </div>
                        </div>

                        {/* Badges */}
                        <div className="flex flex-wrap gap-1.5">
                          {e.raw?.is_debt_clearance && (
                            <span
                              title="Tap this row to view the original debt this collection cleared"
                              className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[rgba(59,130,246,0.12)] text-[var(--color-accent-cobalt)] border border-[rgba(59,130,246,0.25)]"
                            >
                              Collection →
                            </span>
                          )}
                          {e.raw?.retrieved && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[rgba(239,68,68,0.12)] text-[var(--color-error)] border border-[rgba(239,68,68,0.25)] line-through">
                              Retrieved
                            </span>
                          )}
                          {!e.raw?.retrieved && ((e.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                              Partial: <span className="font-mono tabular-nums">₦{fmt((e.raw as any).raw.retrieved_amount)}</span>
                            </span>
                          )}
                          {(e.raw?.wallet_id || (!(e.raw as any)?.is_debt_clearance && (e.raw?.paymentHistory || []).some((p: any) => p?.mode === 'Wallet'))) && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                              Wallet
                            </span>
                          )}
                        </div>

                        {/* Bottom Row: Mode & Amount & Quick Actions */}
                        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-2.5 mt-1">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const badge = getPaymentBadgeClasses(e.mode, Boolean(e.raw?.paymentConfirmed), Number(e.raw?.wallet_deduction_amount || 0));
                              return (
                                <span className={`px-2.5 py-1 rounded-full font-sans text-[11px] font-medium border ${badge.className}`}>
                                  {badge.label}
                                </span>
                              );
                            })()}

                            {e.mode === "Debt" && (
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  openClearDebt(e, evt);
                                }}
                                className="min-h-[44px] px-3.5 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border)] text-[11px] font-sans font-medium flex items-center gap-1.5 cursor-pointer"
                              >
                                <HandCoins size={13} /> Clear
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Quick-copy reference */}
                            <button
                              onClick={(evt) => {
                                evt.stopPropagation();
                                navigator.clipboard?.writeText(e.id)
                                  .then(() => showToast({ message: `Copied ${e.id}`, type: 'info' }))
                                  .catch(() => {});
                              }}
                              title="Copy Reference"
                              aria-label="Copy reference"
                              className="h-11 w-11 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer shrink-0"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                            </button>
                            {/* QR code */}
                            {e.source === 'transaction' && (
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  setViewingQrTx(e);
                                }}
                                title="Show QR Code"
                                aria-label="Show QR code"
                                className="h-11 w-11 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer shrink-0"
                              >
                                <QrCode size={13} />
                              </button>
                            )}
                            <div className="text-right">
                              <div className={`font-mono tabular-nums font-semibold text-[13px] ${e.source === "expense" ? "text-[var(--color-error)]" : "text-[var(--color-foreground)]"}`}>
                                {e.source === "expense" ? "-" : ""}₦{fmt(e.source === "expense" ? e.amount : Math.max(0, e.amount - ((e.raw as any)?.raw?.retrieved_amount || 0)))}
                              </div>
                              {((e.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                                <div className="text-[10px] font-mono tabular-nums text-[var(--color-muted)] line-through">
                                  ₦{fmt(e.amount)}
                                </div>
                              )}
                              {renderDebtSettleLine(e)}
                            </div>
                          </div>
                        </div>

                      </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
              )}

              {/* Desktop Virtualized Table (Visible on >= 640px) with Sticky Header */}
              {!isMobileView && (
              <div className="hidden sm:block ehi-card shadow-sm border border-[var(--color-border)] rounded-2xl overflow-hidden bg-[var(--color-surface-card)]">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left border-collapse table-fixed">
            <thead className="sticky top-0 z-10 bg-[var(--color-surface-card)] shadow-[0_1px_0_var(--color-border)]">
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)] font-sans text-[11px] font-medium">
                <th className={`${density.tableRowPadding} w-[36px] text-center`} title="Select all entries for batch actions">
                  <label className="min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label="Select all transactions"
                      checked={displayEntries.length > 0 && displayEntries.filter(e => e.source === 'transaction').length > 0 && displayEntries.filter(e => e.source === 'transaction').every(e => selectedDebtIds.has(e.id))}
                      onChange={(evt) => {
                        const txEntries = displayEntries.filter(e => e.source === 'transaction');
                        if (evt.target.checked) {
                          setSelectedDebtIds(new Set(txEntries.map(e => e.id)));
                        } else {
                          setSelectedDebtIds(new Set());
                        }
                      }}
                      className="w-4 h-4 cursor-pointer accent-white"
                    />
                  </label>
                </th>
                {(isAccountantOrAdmin || !viewOnly) && (
                  <th className={`${density.tableRowPadding} w-[36px] text-center`} title="Confirm payment">
                    <span className="sr-only">Confirm payment</span>
                    <CheckSquare size={13} className="mx-auto text-[var(--color-muted)]" />
                  </th>
                )}
                {canSeePin && <th className={`${density.tableRowPadding} w-[52px]`}>Pin</th>}
                <th className={`${density.tableRowPadding} w-[114px]`}>Tag / Waybill</th>
                <th className={`${density.tableRowPadding} w-[74px]`}>Date</th>
                <th className={`${density.tableRowPadding} w-[160px]`}>Customer / detail</th>
                <th className={`${density.tableRowPadding} w-[74px] text-center`}>Status</th>
                <th className={`${density.tableRowPadding} w-[88px] text-right`}>Amount</th>
                <th className={`${density.tableRowPadding} w-[72px] text-center`}>Mode</th>
                <th className={`${density.tableRowPadding} w-[24px] text-center`}>
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* See the mobile card list's matching comment above -- not
                  gated on allTimeFirstLoadInFlight, for the same reason. */}
              {displayEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={8 + ((isAccountantOrAdmin || !viewOnly) ? 1 : 0) + (canSeePin ? 1 : 0)}
                    className="py-12 text-center text-[var(--color-muted)] font-sans text-[13px]"
                  >
                    No entries found matching filters.
                  </td>
                </tr>
              ) : (
                <>
                  {rowVirtualizer.getVirtualItems().length > 0 && (
                    <tr style={{ height: rowVirtualizer.getVirtualItems()[0].start }}>
                      <td colSpan={8 + ((isAccountantOrAdmin || !viewOnly) ? 1 : 0) + (canSeePin ? 1 : 0)} />
                    </tr>
                  )}
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const e = displayEntries[virtualRow.index];
                    if (e.type === 'shift-marker') {
                      return (
                        <tr key={e.id} className="bg-[var(--color-surface-1)] border-b border-[var(--color-border)]">
                          <td colSpan={8 + ((isAccountantOrAdmin || !viewOnly) ? 1 : 0) + (canSeePin ? 1 : 0)} className="py-2.5 px-4 text-center font-sans font-medium text-[var(--color-foreground)] text-[12px]">
                            {e.name} — {e.detail}
                          </td>
                        </tr>
                      );
                    }
                    
                    const displayDate = (e as any).displayDate || 'Unknown date';
                    const displayTime = (e as any).displayTime || e.time;

                  // Status colour -- shared canonical mapping (src/lib/status.ts)
                  const statusColor = statusChipClass(e.status);

                  return (
                  <tr
                    key={e.id}
                    data-index={virtualRow.index}
                    onClick={() => e.raw?.is_debt_clearance ? handleJumpToOriginalDebt(e.raw?.related_tx_id) : setViewingDetail(e)}
                    className={`border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group ${
                      (e.raw?.retrieved || e.raw?.is_debt_clearance) ? 'opacity-50' : ''
                    } ${
                      e.raw?.is_debt_clearance ? 'bg-[rgba(59,130,246,0.05)]' : ''
                    }`}
                  >
                    {/* Batch select */}
                    <td className={`${density.tableRowPadding} text-center`} onClick={(evt) => evt.stopPropagation()}>
                      {e.source === 'transaction' && (
                        <label className="min-w-[44px] min-h-[44px] -my-2 flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            aria-label={`Select entry ${e.id}`}
                            checked={selectedDebtIds.has(e.id)}
                            onChange={(evt) => {
                              setSelectedDebtIds(prev => {
                                const next = new Set(prev);
                                if (evt.target.checked) next.add(e.id); else next.delete(e.id);
                                return next;
                              });
                            }}
                            className="w-4 h-4 cursor-pointer accent-white"
                          />
                        </label>
                      )}
                    </td>
                    {(isAccountantOrAdmin || !viewOnly) && (
                      <td className={density.tableRowPadding}>
                        {(e.mode === 'Cash' || e.mode === 'POS' || e.mode === 'Transfer') && isAccountantOrAdmin && !e.raw?.is_debt_clearance && (
                          <div onClick={(evt) => evt.stopPropagation()} className="flex items-center justify-center">
                            {e.mode === 'POS' && !e.posApprovalCode ? (
                              posCodeInput.id === e.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    id={`pos-code-${e.id}`}
                                    name={`pos-code-${e.id}`}
                                    autoFocus
                                    type="text"
                                    className="w-16 bg-[var(--color-surface-1)] border border-[var(--color-border-strong)] rounded-md px-1.5 py-1 font-mono tabular-nums text-[11px] text-[var(--color-foreground)] outline-none"
                                    placeholder="Code"
                                    value={posCodeInput.code}
                                    onChange={evt => setPosCodeInput({ id: e.id, code: evt.target.value })}
                                    onKeyDown={evt => { if(evt.key === 'Enter') savePosCode(e, evt as any); }}
                                  />
                                  <button disabled={confirmingIds.has(e.id)} onClick={(evt) => savePosCode(e, evt)} className="min-w-[32px] min-h-[32px] flex items-center justify-center text-[var(--color-success)] disabled:opacity-50 cursor-pointer"><Check size={14}/></button>
                                </div>
                              ) : (
                                <button
                                  onClick={(evt) => { evt.stopPropagation(); setPosCodeInput({ id: e.id, code: '' }); }}
                                  className="min-h-[44px] flex items-center text-[var(--color-foreground)] hover:underline whitespace-nowrap text-[11px] font-sans font-medium cursor-pointer"
                                >
                                  Enter code
                                </button>
                              )
                            ) : (
                              <button
                                disabled={confirmingIds.has(e.id)}
                                onClick={(evt) => toggleConfirm(e, evt)}
                                aria-label="Confirm payment"
                                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 cursor-pointer transition-colors"
                              >
                                {e.raw.paymentConfirmed ? (
                                  <div className="w-5 h-5 bg-[var(--color-success)] rounded-md flex items-center justify-center">
                                    <Check size={13} className="text-white" strokeWidth={3} />
                                  </div>
                                ) : (
                                  <div className="w-5 h-5 border border-[var(--color-border-strong)] rounded-md hover:border-[var(--color-foreground)] transition-colors" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    {canSeePin && (
                      <td className={`${density.tableRowPadding} font-mono tabular-nums text-[11px] tracking-wider ${e.raw.pickupPin ? 'font-semibold text-[var(--color-foreground)]' : 'text-[var(--color-text-disabled)]'}`}>
                        {e.raw.pickupPin || '—'}
                      </td>
                    )}
                    {/* ID */}
                    <td className={`${density.tableRowPadding} text-[var(--color-foreground)]`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] flex items-center justify-center shrink-0">
                          {e.type === 'cargo' && <Package size={11} />}
                          {(e.type === 'baggage' || e.type === 'marketing' || e.type === 'legacy') && <Archive size={11} />}
                          {e.type === 'package' && <Truck size={11} />}
                          {e.source === 'expense' && <Minus size={11} />}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate min-w-0 font-mono tabular-nums text-[12px] font-semibold" title={e.id}>
                            {e.id.length > 20 ? `${e.id.slice(0, 6)}…${e.id.slice(-6)}` : e.id}
                          </span>
                          {e.type === 'cargo' && (e.airline_awb || e.raw?.airline_awb) && (
                            <span className="font-mono tabular-nums text-[10px] text-[var(--color-muted)] truncate block" title={e.airline_awb || e.raw?.airline_awb}>
                              AWB: {e.airline_awb || e.raw?.airline_awb}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {/* Date + Time */}
                    <td className={`${density.tableRowPadding} whitespace-nowrap`}>
                      <div className="text-[11px] font-sans text-[var(--color-foreground)] font-medium">{displayDate}</div>
                      <div className="text-[10px] font-mono tabular-nums text-[var(--color-muted)] mt-0.5">{displayTime}</div>
                    </td>
                    {/* Customer + Detail */}
                    <td className={density.tableRowPadding}>
                      <div className="flex flex-wrap gap-1.5 mb-1">
                        {e.raw?.is_debt_clearance && (
                          <span
                            title="Click this row to view the original debt this collection cleared"
                            className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[rgba(59,130,246,0.12)] text-[var(--color-accent-cobalt)] border border-[rgba(59,130,246,0.25)]"
                          >
                            Collection →
                          </span>
                        )}
                        {e.raw?.retrieved && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[rgba(239,68,68,0.12)] text-[var(--color-error)] border border-[rgba(239,68,68,0.25)] line-through">
                            Retrieved
                          </span>
                        )}
                        {!e.raw?.retrieved && ((e.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]"
                            title={`Partially retrieved: ${(e.raw as any).raw.retrieved_kg || 0} KG · ${(e.raw as any).raw.retrieved_pieces || 0} PCS`}
                          >
                            Partial: {(e.raw as any).raw.retrieved_kg || 0}kg · {(e.raw as any).raw.retrieved_pieces || 0}pcs · <span className="font-mono tabular-nums">₦{fmt((e.raw as any).raw.retrieved_amount)}</span>
                          </span>
                        )}
                        {isOfficeWorkEntry(e) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                            Office work
                          </span>
                        )}
                        {isUnlinkedOffice(e) && (
                          <span
                            title="Consignee matches a corporate client but this entry isn't linked — reconcile it in Office Work Reconciliation."
                            className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[rgba(251,191,36,0.15)] text-[var(--color-accent-amber)] border border-[rgba(251,191,36,0.3)]"
                          >
                            Unlinked office
                          </span>
                        )}
                        {e.raw?.wallet_id && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                            Wallet
                          </span>
                        )}
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5">
                        <span className={`font-sans font-semibold text-[13px] leading-snug ${e.raw?.is_debt_clearance ? 'italic' : ''} ${e.source === "expense" ? "text-[var(--color-error)]" : "text-[var(--color-foreground)]"}`}>
                          {e.name}
                        </span>
                        {(e.raw as any)?.airline && (() => {
                          const c = airlineBadgeColors((e.raw as any).airline);
                          return (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium border"
                              style={{ background: c.bg, color: c.text, borderColor: c.border }}
                            >
                              {(e.raw as any).airline}
                            </span>
                          );
                        })()}
                        {(() => {
                          const raw = e.raw as any;
                          const dest = raw ? ((e.type === 'cargo' || e.type === 'marketing') ? raw.route : raw.destination) : null;
                          const shortDest = shortenDestination(dest);
                          return dest ? (
                            <span
                              title={dest}
                              className="px-2 py-0.5 rounded-full text-[10px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]"
                            >
                              {shortDest || dest}
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div className={`text-[11px] font-sans text-[var(--color-muted)] mt-1 leading-snug line-clamp-2 ${e.raw?.is_debt_clearance ? 'italic' : ''}`}>
                        {stripBadgedFieldsFromDetail(
                          e.detail,
                          (e.raw as any)?.airline,
                          (e.type === 'cargo' || e.type === 'marketing') ? (e.raw as any)?.route : (e.raw as any)?.destination
                        )}
                      </div>
                      {e.raw.remarks && (
                        <div className="text-[11px] font-sans italic mt-1 leading-snug text-[var(--color-muted)]">
                          Remarks: {e.raw.remarks}
                        </div>
                      )}
                      {(() => {
                        const raw = e.raw as any;
                        if (!raw) return null;
                        const lastPayment = Array.isArray(raw.paymentHistory) && raw.paymentHistory.length > 0
                          ? raw.paymentHistory[raw.paymentHistory.length - 1]
                          : null;
                        const candidates: { label: string; at: number }[] = [];
                        if (raw.editedBy && raw.editedAt) {
                          candidates.push({ label: `Edited by ${raw.editedBy}`, at: new Date(raw.editedAt).getTime() });
                        }
                        if (raw.confirmedBy && raw.confirmedAt) {
                          candidates.push({ label: `Confirmed by ${raw.confirmedBy}`, at: new Date(raw.confirmedAt).getTime() });
                        }
                        if (lastPayment?.by && lastPayment?.at) {
                          candidates.push({ label: `Confirmed by ${lastPayment.by}`, at: new Date(lastPayment.at).getTime() });
                        }
                        candidates.sort((a, b) => b.at - a.at);
                        const agentLabel = candidates[0]?.label
                          || (raw.enteredByName ? `By ${raw.enteredByName}` : null);
                        if (!agentLabel) return null;
                        return (
                          <div className="text-[10px] text-[var(--color-muted)] font-mono tabular-nums mt-1 leading-snug">
                            {agentLabel}
                          </div>
                        );
                      })()}
                    </td>
                    {/* Status */}
                    <td className={`${density.tableRowPadding} text-center`}>
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-sans font-medium whitespace-nowrap border ${
                        (e.raw?.is_debt_clearance || e.id?.startsWith('DC-'))
                          ? 'text-[var(--color-accent-cobalt)] bg-[rgba(59,130,246,0.12)] border-[rgba(59,130,246,0.25)]'
                          : statusColor
                      }`}>
                        {e.source === 'expense' ? 'Expense' : (e.raw?.is_debt_clearance || e.id?.startsWith('DC-')) ? 'Collection' : formatEntryTypeLabel(e.status || 'Intake')}
                      </span>
                    </td>
                    {/* Amount */}
                    <td className={`${density.tableRowPadding} text-right font-mono tabular-nums text-[12px] whitespace-nowrap ${e.source === "expense" ? "text-[var(--color-error)] font-semibold" : "text-[var(--color-foreground)] font-semibold"}`}>
                      <div>{e.source === "expense" ? "-" : ""}₦{fmt(e.source === "expense" ? e.amount : Math.max(0, e.amount - ((e.raw as any)?.raw?.retrieved_amount || 0)))}</div>
                      {((e.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                        <div className="text-[10px] font-mono tabular-nums text-[var(--color-muted)] line-through">
                          ₦{fmt(e.amount)}
                        </div>
                      )}
                      {e.raw?.wallet_deduction_amount > 0 && e.mode !== 'Wallet' && (
                        <div className="text-[10px] text-[var(--color-muted)] font-normal">
                          ₦{fmt(Math.max(0, e.amount - e.raw.wallet_deduction_amount))} {e.mode} · ₦{fmt(e.raw.wallet_deduction_amount)} Wallet
                        </div>
                      )}
                      {renderDebtSettleLine(e)}
                    </td>
                    {/* Mode */}
                    <td className={`${density.tableRowPadding} text-center`} onClick={(evt) => evt.stopPropagation()}>
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1.5 justify-center">
                          {(() => {
                            const badge = getPaymentBadgeClasses(e.mode, Boolean(e.raw?.paymentConfirmed), Number(e.raw?.wallet_deduction_amount || 0));
                            return (
                              <span className={`px-2 py-0.5 rounded-full font-sans text-[11px] font-medium flex items-center gap-1 border ${badge.className}`}>
                                {badge.label}
                                {e.raw.paymentConfirmed && e.mode !== 'Debt' && e.mode !== 'Expense' && e.mode !== 'Debt Paid' && (
                                  <Check size={11} strokeWidth={2.5} className="text-current opacity-80" />
                                )}
                                {!e.raw.paymentConfirmed && e.mode !== 'Debt' && e.mode !== 'Expense' && e.mode !== 'Debt Paid' && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
                                )}
                              </span>
                            );
                          })()}

                          {e.mode === "Debt" && (
                            <button
                              onClick={(evt) => {
                                evt.stopPropagation();
                                openClearDebt(e, evt);
                              }}
                              className="min-h-[44px] px-3 rounded-full bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border)] transition-colors focus:outline-none flex items-center gap-1 cursor-pointer font-sans text-[11px] font-medium"
                              title="Clear Outstanding Debt"
                            >
                              <HandCoins size={12} /> Clear
                            </button>
                          )}
                        </div>
                        {e.mode === 'POS' && e.posApprovalCode && (
                          <span className="text-[10px] font-mono tabular-nums text-[var(--color-muted)]">**{e.posApprovalCode.slice(-4)}</span>
                        )}
                      </div>
                    </td>
                    {/* Chevron */}
                    <td className={`${density.tableRowPadding} text-center`}>
                      <ChevronRight size={14} className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-colors ml-auto" />
                    </td>
                  </tr>
                  );
                  })}
                  {(() => {
                    const items = rowVirtualizer.getVirtualItems();
                    const lastItem = items[items.length - 1];
                    const paddingBottom = rowVirtualizer.getTotalSize() - (lastItem ? lastItem.end : 0);
                    return paddingBottom > 0 ? (
                      <tr style={{ height: paddingBottom }}><td colSpan={(isAccountantOrAdmin || !viewOnly) ? (canSeePin ? 9 : 8) : (canSeePin ? 8 : 7)} /></tr>
                    ) : null;
                  })()}
                </>
              )}
            </tbody>
          </table>
          </div>
        </div>
        )}

        {/* All Time pagination footer -- sits after both the mobile card
            list and desktop table above (both always mounted, one hidden
            via CSS per breakpoint) so it shows regardless of viewport.
            Explicit "Load More" button rather than scroll-proximity
            auto-fetch -- the button appears at the bottom the moment the
            first page renders (allTimeHasMore is already known from that
            page's own response), giving an obvious, always-reachable way
            to pull in more history on demand instead of an automatic
            fetch a user can't easily control or predict. */}
        {shiftFilter === 'all' && allTimeEngaged && (
          <div className="py-4 text-center">
            {loadingAllTimeMore ? (
              <div className="flex items-center justify-center gap-1.5 text-[12px] font-sans text-[var(--color-muted)]">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading more…</span>
              </div>
            ) : allTimeHasMore ? (
              <button
                onClick={fetchAllTimeNextPage}
                className="min-h-[44px] h-11 px-5 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full text-[12px] font-sans font-semibold text-[var(--color-foreground)] transition-colors cursor-pointer"
              >
                Load more
              </button>
            ) : (allTimeTxRows.length + allTimeExpenseRows.length) > 0 ? (
              <div className="text-[12px] font-sans text-[var(--color-muted)]">— End of results —</div>
            ) : null}
          </div>
        )}

        {/* Current Shift / date-range footer -- appears only when
            EHIApp.tsx's fetchInitial actually hit its per-table row cap
            for the currently loaded window (ledgerRowsTruncated). This is
            a separate mechanism from the All Time footer above: it re-runs
            the same date-range-bounded fetch with a higher cap rather than
            paging through the ledger_search_page RPC, so it's hidden while
            shiftFilter === 'all' (All Time already has its own loading
            state/pagination and never sets ledgerRowsTruncated). */}
        {shiftFilter !== 'all' && ledgerRowsTruncated && (
          <div className="py-4 text-center">
            {ledgerRowsLoadingMore ? (
              <div className="flex items-center justify-center gap-1.5 text-[12px] font-sans text-[var(--color-muted)]">
                <Loader2 size={14} className="animate-spin" />
                <span>Loading more…</span>
              </div>
            ) : onLoadMoreLedgerRows ? (
              <button
                onClick={onLoadMoreLedgerRows}
                className="min-h-[44px] h-11 px-5 bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-full text-[12px] font-sans font-semibold text-[var(--color-foreground)] transition-colors cursor-pointer"
                title="More entries exist in this date range than are currently loaded"
              >
                Load more
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Detail Popup Overlay */}
      </>)}
      {viewingDetail && createPortal(
        <div
          className="fixed inset-0 z-[60] ehi-scrim flex items-end sm:items-center justify-center animate-in fade-in"
          onClick={() => setViewingDetail(null)}
        >
          <div 
            className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] sm:max-h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-4"
            onClick={evt => evt.stopPropagation()}
          >
            {/* Handle bar for mobile */}
            <div className="w-full flex justify-center py-2.5 sm:hidden shrink-0">
              <div className="w-12 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>

            <div className="p-4 sm:p-5 flex justify-between items-start shrink-0 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] flex items-center justify-center shrink-0 border border-[var(--color-border)]">
                  {viewingDetail.type === 'cargo' && <Package size={18} />}
                  {(viewingDetail.type === 'baggage' || viewingDetail.type === 'marketing' || viewingDetail.type === 'legacy') && <Archive size={18} />}
                  {viewingDetail.type === 'package' && <Truck size={18} />}
                  {viewingDetail.source === 'expense' && <Minus size={18} />}
                </div>
                <div>
                  <h3 className="font-mono tabular-nums text-[15px] font-semibold text-[var(--color-foreground)]">{viewingDetail.id}</h3>
                  {viewingDetail.type === 'cargo' && (viewingDetail.airline_awb || viewingDetail.raw?.airline_awb) && (
                    <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)]">
                      Airline AWB: {viewingDetail.airline_awb || viewingDetail.raw?.airline_awb}
                    </div>
                  )}
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">
                    {(viewingDetail.type === 'marketing' || viewingDetail.type === 'baggage' || viewingDetail.type === 'legacy') ? 'Legacy shipment' : `${formatEntryTypeLabel(viewingDetail.type)} transaction`}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setViewingDetail(null)}
                aria-label="Close details"
                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* Customer Section */}
              <section>
                <h4 className="text-[12px] font-sans font-medium text-[var(--color-muted)] mb-2">Details</h4>
                <div className="bg-[var(--color-surface-1)] rounded-xl p-4 border border-[var(--color-border)]">
                  <div className={`font-sans font-semibold text-base mb-1 ${viewingDetail.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
                    {viewingDetail.name}
                  </div>
                  <div className="text-[13px] font-sans text-[var(--color-muted)] leading-relaxed">
                    {viewingDetail.detail}
                  </div>
                  {viewingDetail.raw.phone && (
                    <div className="text-[12px] text-[var(--color-foreground)] mt-2 font-mono tabular-nums">
                      📞 {viewingDetail.raw.phone}
                    </div>
                  )}
                  {viewingDetail.raw.remarks && (
                    <div className="mt-3 pt-2.5 border-t border-[var(--color-border)] flex flex-col gap-0.5">
                      <span className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Remarks</span>
                      <span className="text-[13px] text-[var(--color-foreground)] italic font-sans">{viewingDetail.raw.remarks}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Payment Section */}
              <section>
                <h4 className="text-[12px] font-sans font-medium text-[var(--color-muted)] mb-2">Payment information</h4>
                <div className="bg-[var(--color-surface-1)] rounded-xl p-4 border border-[var(--color-border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-sans text-[var(--color-muted)]">Amount</span>
                    <span className={`text-2xl font-semibold font-mono tabular-nums ${viewingDetail.source === 'expense' ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'}`}>
                      {viewingDetail.source === 'expense' ? '-' : ''}₦{viewingDetail.amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                    <span className="text-[13px] font-sans text-[var(--color-muted)]">Mode</span>
                    <span className="px-2.5 py-0.5 rounded-full font-sans text-[11px] font-medium border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-foreground)]">
                      {viewingDetail.mode === "Debt" ? "Debt" : formatPaymentModeDisplay(viewingDetail.mode, viewingDetail.raw?.wallet_deduction_amount, viewingDetail.amount)}
                    </span>
                  </div>
                  
                  {viewingDetail.mode === 'Transfer' && viewingDetail.raw.bank && (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-sans text-[var(--color-muted)]">Bank</span>
                      <span className="text-[13px] font-sans text-[var(--color-foreground)] font-medium">{viewingDetail.raw.bank}</span>
                    </div>
                  )}
                  {viewingDetail.mode === 'Transfer' && viewingDetail.raw.paymentNarration && (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-sans text-[var(--color-muted)]">Narration reference</span>
                      <span className="text-[11px] font-mono tabular-nums bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2 py-0.5 rounded-full text-[var(--color-foreground)]">{viewingDetail.raw.paymentNarration}</span>
                    </div>
                  )}
                  {viewingDetail.mode === 'POS' && viewingDetail.posApprovalCode && (
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-sans text-[var(--color-muted)]">Approval code</span>
                      <span className="text-[12px] font-mono tabular-nums font-semibold text-[var(--color-foreground)] tracking-wider">{viewingDetail.posApprovalCode}</span>
                    </div>
                  )}

                  <div className="mt-2 pt-3 border-t border-[var(--color-border)]">
                    {viewingDetail.mode === 'Debt' ? (
                      (() => {
                        const paid = roundMoney(viewingDetail.raw?.amountPaid || 0);
                        const owed = Math.max(0, roundMoney((viewingDetail.amount || 0) - paid - ((viewingDetail.raw as any)?.raw?.retrieved_amount || 0)));
                        return paid > 0 ? (
                          <div className="text-[12px] text-[var(--color-accent-amber)] flex items-center gap-1.5 font-sans">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)]" />
                            <span className="font-mono tabular-nums">₦{fmt(paid)}</span> paid · <span className="font-mono tabular-nums">₦{fmt(owed)}</span> still outstanding
                          </div>
                        ) : (
                          <div className="text-[12px] text-[var(--color-error)] flex items-center gap-1.5 font-sans">
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-error)]" />
                            Outstanding — not yet paid
                          </div>
                        );
                      })()
                    ) : viewingDetail.mode === 'Debt Paid' ? (
                      <div className="text-[12px] text-[var(--color-success)] flex items-center gap-1.5 font-medium font-sans">
                        <Check size={14} />
                        Debt cleared by {viewingDetail.raw.confirmedBy || (viewingDetail.raw.paymentHistory && viewingDetail.raw.paymentHistory[viewingDetail.raw.paymentHistory.length - 1]?.by) || 'System'}
                        {summarisePaymentHistory(viewingDetail.raw?.paymentHistory) ? ` · ${summarisePaymentHistory(viewingDetail.raw?.paymentHistory)}` : ''}
                      </div>
                    ) : viewingDetail.raw.paymentConfirmed ? (
                      <div className="text-[12px] text-[var(--color-success)] flex items-center gap-1.5 font-medium font-sans">
                        <Check size={14} />
                        {viewingDetail.mode === 'Transfer' && viewingDetail.raw.bankReference
                          ? `Confirmed via bank alert at ${viewingDetail.raw.confirmedAt || ''}`
                          : viewingDetail.mode === 'POS'
                          ? `Approval code ${viewingDetail.posApprovalCode} verified`
                          : `Verified by ${viewingDetail.raw.confirmedBy || 'system'} at ${viewingDetail.raw.confirmedAt || ''}`
                        }
                      </div>
                    ) : (
                      <div className="text-[12px] text-[var(--color-accent-amber)] flex items-center gap-1.5 font-sans">
                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-amber)] animate-pulse" />
                        {viewingDetail.mode === 'POS' ? "Enter approval code to confirm" :
                         "Pending verification"}
                      </div>
                    )}
                  </div>

                  {/* Debt-collection timeline */}
                  {Array.isArray(viewingDetail.raw?.paymentHistory) && viewingDetail.raw.paymentHistory.length > 0 && (
                    <div className="mt-2 pt-3 border-t border-[var(--color-border)] space-y-1.5">
                      <div className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Payments</div>
                      {viewingDetail.raw.paymentHistory.map((p: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-[12px] font-sans gap-2">
                          <span className="text-[var(--color-muted)] truncate">
                            {p?.at ? new Date(p.at).toLocaleDateString('en-GB') : '—'} · {p?.mode || '—'}{p?.wallet_txn_id ? ' (wallet)' : ''}
                          </span>
                          <span className="text-[var(--color-foreground)] font-mono tabular-nums whitespace-nowrap">₦{fmt(p?.amount || 0)}{p?.by ? ` · ${p.by}` : ''}</span>
                        </div>
                      ))}
                      <div className="text-[11px] font-sans text-[var(--color-muted)] italic pt-0.5">Each also appears as a collection row in the ledger.</div>
                    </div>
                  )}
                </div>
              </section>

              {/* Status Section */}
              {viewingDetail.source === 'transaction' && (
                <section>
                  <h4 className="text-[12px] font-sans font-medium text-[var(--color-muted)] mb-2">Status &amp; tracking</h4>
                  <div className="bg-[var(--color-surface-1)] rounded-xl p-4 border border-[var(--color-border)] flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: `var(--color-${statusMeta(viewingDetail.status).tone}-fg)` }}
                      />
                      <span className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">{formatEntryTypeLabel(viewingDetail.status)}</span>
                    </div>
                    {(viewingDetail.raw.hub || viewingDetail.raw.destination) && (
                      <div className="text-[12px] text-[var(--color-muted)] flex items-center gap-1.5 mt-0.5 font-sans">
                        <span>{getHubCode(viewingDetail.raw.hub) || 'Origin'}</span>
                        <ChevronRight size={12} />
                        <span>{getHubCode(viewingDetail.raw.destination) || 'Destination'}</span>
                      </div>
                    )}
                    {((viewingDetail.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                      <div className="text-[12px] font-sans text-[var(--color-foreground)] mt-1">
                        Retrieved: {(viewingDetail.raw as any).raw.retrieved_kg || 0} kg · {(viewingDetail.raw as any).raw.retrieved_pieces || 0} pcs · <span className="font-mono tabular-nums">₦{fmt((viewingDetail.raw as any).raw.retrieved_amount || 0)}</span>
                        {' · '}Balance: <span className="font-mono tabular-nums">₦{fmt((viewingDetail.raw.amount || 0) - ((viewingDetail.raw as any).raw.retrieved_amount || 0))}</span>
                      </div>
                    )}
                    {((viewingDetail.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                      <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)]">
                        Retrieved by {(viewingDetail.raw as any)?.retrievedBy || (viewingDetail.raw as any)?.raw?.retrieved_by || 'Unknown'}
                        {(viewingDetail.raw as any)?.raw?.retrieved_at ? ` at ${new Date((viewingDetail.raw as any).raw.retrieved_at).toLocaleString('en-NG')}` : ''}
                      </div>
                    )}
                    {(viewingDetail.raw as any)?.raw?.retrieval_approved && (
                      <div className="text-[11px] font-mono tabular-nums text-[var(--color-success)]">
                        ✓ Approved by {(viewingDetail.raw as any)?.raw?.retrieval_approved_by || 'Unknown'}
                        {(viewingDetail.raw as any)?.raw?.retrieval_approved_at ? ` at ${new Date((viewingDetail.raw as any).raw.retrieval_approved_at).toLocaleString('en-NG')}` : ''}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Timestamps */}
              <section className="text-[11px] font-mono tabular-nums text-[var(--color-muted)] space-y-1 pb-2">
                <div>Logged at: {txDisplayDateTime(viewingDetail.raw.created_at, viewingDetail.time)} {viewingDetail.raw.enteredByName ? `by ${viewingDetail.raw.enteredByName}` : (viewingDetail.raw.loggedBy ? `by ${viewingDetail.raw.loggedBy}` : '')}</div>
                {viewingDetail.mode === 'Debt Paid' && (
                  <div>Cleared by: {viewingDetail.raw.confirmedBy || (viewingDetail.raw.paymentHistory && viewingDetail.raw.paymentHistory[viewingDetail.raw.paymentHistory.length - 1]?.by) || 'System'} {viewingDetail.raw.confirmedAt ? `at ${new Date(viewingDetail.raw.confirmedAt).toLocaleString('en-NG')}` : ''}</div>
                )}
                {viewingDetail.raw.paymentConfirmed && viewingDetail.raw.confirmedAt && viewingDetail.mode !== 'Debt Paid' && (
                  <div>Confirmed at: {viewingDetail.raw.confirmedAt}</div>
                )}
              </section>

              {/* Activity History */}
              {viewingDetail.source === 'transaction' && (
                <section className="pb-4 border-t border-[var(--color-border)] pt-3">
                  <div className="text-[12px] font-sans font-medium text-[var(--color-muted)] mb-2.5">Activity history</div>
                  {txHistoryLoading ? (
                    <div className="text-[12px] font-sans text-[var(--color-muted)]">Loading…</div>
                  ) : txHistory.length === 0 ? (
                    <div className="text-[12px] font-sans text-[var(--color-muted)]">No recorded activity yet.</div>
                  ) : (
                    <div className="space-y-2.5">
                      {txHistory.map((h: any) => (
                        <div key={h.id} className="flex items-start gap-2.5 text-[12px]">
                          <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${
                            h.action === 'UNRETRIEVE' || h.action === 'DEBT_REOPENED' ? 'bg-[var(--color-error)]' :
                            h.action === 'DEBT_COLLECTION' || h.action === 'PAYMENT_CONFIRM' ? 'bg-[var(--color-success)]' :
                            'bg-[var(--color-accent-amber)]'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[var(--color-foreground)] font-sans">
                              <span className="font-semibold">{ACTION_LABELS[h.action as string] || h.action}</span>
                              {' — '}{h.description}
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)] mt-0.5">
                              {h.user_name || 'Unknown'} · {new Date(h.created_at).toLocaleString('en-NG')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Actions Footer */}
            <div className="p-4 bg-[var(--color-surface-card)] border-t border-[var(--color-border)] flex flex-col gap-3 shrink-0">
              {viewingDetail.source === 'transaction' && (
                <>
                  {/* Primary Operations Row */}
                  <div className="space-y-2">
                    <div className="text-[12px] font-sans font-medium text-[var(--color-muted)]">Operations</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <button
                        onClick={() => setViewingQrTx(viewingDetail)}
                        className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-full transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[12px] font-sans font-medium cursor-pointer"
                      >
                        <QrCode size={14} /> Scan QR
                      </button>

                      {viewingDetail.mode === 'Debt' && (
                        <button
                          onClick={(evt) => openClearDebt(viewingDetail, evt)}
                          className="min-h-[44px] px-4 flex items-center justify-center gap-1.5 bg-white text-black hover:bg-neutral-200 rounded-full transition-colors border-none text-[12px] font-sans font-semibold cursor-pointer"
                        >
                          <CheckSquare size={14} /> Clear debt
                        </button>
                      )}

                      {viewingDetail.mode === 'Debt Paid' && (
                        <button
                          onClick={() => confirmReopenDebt(viewingDetail)}
                          disabled={reopeningDebt}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[var(--color-error)] hover:text-white text-[var(--color-error)] rounded-full transition-colors border border-[rgba(239,68,68,0.25)] text-[12px] font-sans font-medium disabled:opacity-50 cursor-pointer"
                          title="Undo the most recent debt-clearing payment on this entry"
                        >
                          <Undo2 size={14} /> Reopen debt
                        </button>
                      )}

                      {viewingDetail.mode !== 'Debt' && !viewingDetail.raw.paymentConfirmed && isAccountantOrAdmin && (
                        <button
                          disabled={confirmingIds.has(viewingDetail.id)}
                          onClick={(evt) => toggleConfirm(viewingDetail, evt)}
                          className="min-h-[44px] px-4 flex items-center justify-center gap-1.5 bg-white text-black hover:bg-neutral-200 rounded-full transition-colors border-none text-[12px] font-sans font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          <CheckSquare size={14} /> Confirm payment
                        </button>
                      )}

                      {(['cargo', 'baggage', 'marketing', 'package'] as const).includes(viewingDetail.type as RetrievalEntryType) && !viewingDetail.raw?.retrieved && (
                        <button
                          onClick={() => handleMarkRetrievedAndDeposit(viewingDetail)}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-full transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[12px] font-sans font-medium cursor-pointer"
                          title="Deposit retrieved refund directly into customer credit wallet"
                        >
                          <HandCoins size={14} /> Refund to wallet
                        </button>
                      )}

                      {((viewingDetail.raw as any)?.raw?.retrieved_amount || 0) > 0 && (
                        <button
                          onClick={handleUnretrieve}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[rgba(239,68,68,0.08)] hover:bg-[var(--color-error)] hover:text-white text-[var(--color-error)] rounded-full transition-colors border border-[rgba(239,68,68,0.25)] text-[12px] font-sans font-medium cursor-pointer"
                          title="Undo this entry's retrieval record"
                        >
                          <Undo2 size={14} /> Unretrieve
                        </button>
                      )}

                      {canApproveRetrievals && ((viewingDetail.raw as any)?.raw?.retrieved_amount || 0) > 0 && !(viewingDetail.raw as any)?.raw?.retrieval_approved && (
                        <button
                          onClick={handleApproveRetrieval}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[rgba(16,185,129,0.1)] hover:bg-[var(--color-success)] hover:text-white text-[var(--color-success)] rounded-full transition-colors border border-[rgba(16,185,129,0.25)] text-[12px] font-sans font-medium cursor-pointer"
                          title="Mark this retrieval as reviewed and approved"
                        >
                          <ShieldCheck size={14} /> Approve
                        </button>
                      )}

                      {(canEdit || canEditRemarks) && !viewingDetail.raw?.is_debt_clearance && (
                        <button
                          onClick={(evt) => handleEditClick(viewingDetail, evt)}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] rounded-full transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[12px] font-sans font-medium cursor-pointer"
                        >
                          <Edit2 size={14} /> Edit
                        </button>
                      )}

                      {user.role === 'super_admin' && (
                        <button
                          onClick={() => confirmDeleteTransaction(viewingDetail)}
                          disabled={deletingTx}
                          className="min-h-[44px] px-3.5 flex items-center justify-center gap-1.5 bg-[var(--color-error)] hover:brightness-110 text-white rounded-full transition-colors border-none text-[12px] font-sans font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Document Printing & PDF Row */}
                  {(user.can_print_ledger || user.role === 'super_admin') && (
                    <div className="space-y-2 pt-2.5 border-t border-[var(--color-border)]">
                      <div className="text-[12px] font-sans font-medium text-[var(--color-muted)]">Printing &amp; documents</div>
                      <div className="grid grid-cols-2 gap-2">
                        {(viewingDetail.raw.type === 'cargo' || viewingDetail.raw.type === 'package') && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleReprintReceipt('80mm')}
                              className="min-h-[44px] px-3.5 flex items-center justify-center gap-2 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-foreground)] rounded-full transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[12px] font-sans font-medium cursor-pointer"
                            >
                              <Receipt size={14} className="shrink-0 text-[var(--color-muted)]" />
                              <span>80mm receipt</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReprintTag('80mm')}
                              className="min-h-[44px] px-3.5 flex items-center justify-center gap-2 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] text-[var(--color-foreground)] rounded-full transition-colors border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[12px] font-sans font-medium cursor-pointer"
                              title="Print USB tag label (100×80mm)"
                            >
                              <Tag size={14} className="shrink-0 text-[var(--color-muted)]" />
                              <span>USB tag print</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edit Modal Dialog */}
      {editingTx && createPortal(
        <div className="fixed inset-0 z-[60] ehi-scrim flex items-center justify-center p-4 select-none animate-in fade-in" onClick={() => setEditingTx(null)}>
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 sm:p-5 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)] shrink-0">
              <h3 className="font-semibold font-sans text-[16px] text-[var(--color-foreground)]">
                Edit transaction
              </h3>
              <button
                onClick={() => setEditingTx(null)}
                aria-label="Close edit modal"
                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              <div className="text-[12px] font-mono tabular-nums text-[var(--color-muted)] bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3 rounded-xl">
                Tag:{" "}
                <span className="text-[var(--color-foreground)] font-semibold">
                  {editingTx.id}
                </span>
              </div>

              <h4 className="text-[12px] font-sans font-medium text-[var(--color-muted)] -mb-2">
                Details
              </h4>

              {editingTx.type === 'cargo' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Consignee name
                    </label>
                    <input
                      id="edit-tx-cargo-name"
                      name="edit-tx-cargo-name"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Airline
                    </label>
                    <select
                      id="edit-tx-airline"
                      name="edit-tx-airline"
                      disabled={!canEdit}
                      value={editingTx.airline || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, airline: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    >
                      <option value="">Select airline</option>
                      {/* Guard against the entry's current airline having fallen out of the
                          canonical list (e.g. renamed/removed since this entry was created) --
                          without this, a stale value with no matching <option> would silently
                          fall back to whatever option the browser picks first on save. */}
                      {editingTx.airline && !editAirlines.includes(editingTx.airline) && (
                        <option value={editingTx.airline}>{editingTx.airline}</option>
                      )}
                      {editAirlines.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Flight number (optional)
                      </label>
                      <input
                        id="edit-tx-flight-number"
                        name="edit-tx-flight-number"
                        type="text"
                        disabled={!canEdit}
                        value={editingTx.flight || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, flight: e.target.value.toUpperCase() })}
                        placeholder="e.g. W3 331"
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Airline AWB (optional)
                      </label>
                      <input
                        id="edit-tx-airline-awb"
                        name="edit-tx-airline-awb"
                        type="text"
                        disabled={!canEdit}
                        value={editingTx.airline_awb || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, airline_awb: e.target.value })}
                        placeholder="e.g. 072-12345678"
                        maxLength={12}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Route
                      </label>
                      <select
                        id="edit-tx-cargo-route"
                        name="edit-tx-cargo-route"
                        disabled={!canEdit}
                        value={editingTx.route || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, route: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      >
                        <option value="">Select route</option>
                        {routes.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Content type
                      </label>
                      <select
                        id="edit-tx-content-type"
                        name="edit-tx-content-type"
                        disabled={!canEdit}
                        value={editingTx.contentType || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, contentType: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      >
                        <option value="">Select content type</option>
                        {/* Guard against the entry's current content type having fallen out of
                            the canonical list (e.g. deleted via ContentTypes.tsx since this entry
                            was created) -- same stale-value guard as the Airline select above. */}
                        {editingTx.contentType && !contentTypes.includes(editingTx.contentType) && (
                          <option value={editingTx.contentType}>{editingTx.contentType}</option>
                        )}
                        {contentTypes.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {editingTx.contentType === 'Other' && (
                        <input
                          id="edit-tx-custom-content-type"
                          name="edit-tx-custom-content-type"
                          type="text"
                          disabled={!canEdit}
                          value={editCustomContentType}
                          onChange={(e) => setEditCustomContentType(e.target.value.toUpperCase())}
                          placeholder="Enter content type"
                          className="w-full min-h-[44px] h-11 px-3.5 mt-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                        />
                      )}
                    </div>
                  </div>
                  {sizeTierContentTypeNames.has(editingTx.contentType || '') && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Screen size (inches)
                      </label>
                      <input
                        id="edit-tx-size-inches"
                        name="edit-tx-size-inches"
                        type="number"
                        min="1"
                        disabled={!canEdit}
                        value={sizeInchesInput}
                        onChange={(e) => setSizeInchesInput(e.target.value)}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Pieces
                      </label>
                      <input
                        id="edit-tx-pieces"
                        name="edit-tx-pieces"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={pieceInput}
                        onChange={(e) => setPieceInput(e.target.value)}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Weight (kg)
                      </label>
                      <input
                        id="edit-tx-kg"
                        name="edit-tx-kg"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={kgInput}
                        onChange={(e) => setKgInput(e.target.value)}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Remarks
                    </label>
                    <textarea
                      id="edit-tx-remarks"
                      name="edit-tx-remarks"
                      rows={2}
                      disabled={!(canEdit || canEditRemarks)}
                      value={editingTx.remarks || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, remarks: e.target.value.toUpperCase() })}
                      className="w-full px-3.5 py-2.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] resize-none disabled:opacity-60"
                      placeholder="e.g. Sent by road"
                    />
                  </div>
                  {editingTx.awb_tag_number && (
                    <div className="text-[11px] font-mono tabular-nums text-[var(--color-muted)] bg-[var(--color-surface-2)] border border-[var(--color-border)] p-2.5 rounded-xl">
                      AWB / tag:{" "}
                      <span className="text-[var(--color-foreground)] font-semibold">{editingTx.awb_tag_number}</span>
                    </div>
                  )}
                </>
              )}

              {editingTx.type === 'baggage' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Customer name
                    </label>
                    <input
                      id="edit-tx-baggage-name"
                      name="edit-tx-baggage-name"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Flight
                      </label>
                      <input
                        id="edit-tx-flight"
                        name="edit-tx-flight"
                        type="text"
                        disabled={!canEdit}
                        value={editingTx.flight || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, flight: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Destination
                      </label>
                      <select
                        id="edit-tx-destination"
                        name="edit-tx-destination"
                        disabled={!canEdit}
                        value={editingTx.destination || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, destination: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      >
                        <option value="">Select destination</option>
                        {routes.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {editingTx.type === 'marketing' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Customer name
                    </label>
                    <input
                      id="edit-tx-marketing-name"
                      name="edit-tx-marketing-name"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Route
                    </label>
                    <select
                      id="edit-tx-marketing-route"
                      name="edit-tx-marketing-route"
                      disabled={!canEdit}
                      value={editingTx.route || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, route: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    >
                      <option value="">Select route</option>
                      {routes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Airline
                    </label>
                    <select
                      id="edit-tx-marketing-airline"
                      name="edit-tx-marketing-airline"
                      disabled={!canEdit}
                      value={editingTx.airline || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, airline: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    >
                      <option value="">Select airline</option>
                      {editingTx.airline && !editAirlines.includes(editingTx.airline) && (
                        <option value={editingTx.airline}>{editingTx.airline}</option>
                      )}
                      {editAirlines.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Big bags
                      </label>
                      <input
                        id="edit-tx-bb"
                        name="edit-tx-bb"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={editBagCounts.bb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, bb: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] text-center focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Medium bags
                      </label>
                      <input
                        id="edit-tx-mb"
                        name="edit-tx-mb"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={editBagCounts.mb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, mb: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] text-center focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Small bags
                      </label>
                      <input
                        id="edit-tx-sb"
                        name="edit-tx-sb"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={editBagCounts.sb}
                        onChange={(e) => setEditBagCounts({ ...editBagCounts, sb: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] text-center focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                </>
              )}

              {editingTx.type === 'package' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Customer name
                    </label>
                    <input
                      id="edit-tx-package-name"
                      name="edit-tx-package-name"
                      type="text"
                      disabled={!canEdit}
                      value={editingTx.name}
                      onChange={(e) => setEditingTx({ ...editingTx, name: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Destination
                      </label>
                      <select
                        id="edit-tx-package-destination"
                        name="edit-tx-package-destination"
                        disabled={!canEdit}
                        value={editingTx.destination || ''}
                        onChange={(e) => setEditingTx({ ...editingTx, destination: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      >
                        <option value="">Select destination</option>
                        {routes.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Content type
                      </label>
                      <select
                        id="edit-tx-package-content-type"
                        name="edit-tx-package-content-type"
                        disabled={!canEdit}
                        value={editingTx.contentType || 'Package'}
                        onChange={(e) => setEditingTx({ ...editingTx, contentType: e.target.value })}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      >
                        <option value="Package">Package</option>
                        <option value="Parcel">Parcel</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Pieces
                      </label>
                      <input
                        id="edit-tx-package-pcs"
                        name="edit-tx-package-pcs"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={pieceInput}
                        onChange={(e) => setPieceInput(e.target.value)}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Weight (kg)
                      </label>
                      <input
                        id="edit-tx-package-kg"
                        name="edit-tx-package-kg"
                        type="number"
                        min="0"
                        disabled={!canEdit}
                        value={kgInput}
                        onChange={(e) => setKgInput(e.target.value)}
                        className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Contents
                    </label>
                    <select
                      id="edit-tx-package-contents"
                      name="edit-tx-package-contents"
                      disabled={!canEdit}
                      value={editingTx.contents || contentTypes[0]}
                      onChange={(e) => setEditingTx({ ...editingTx, contents: e.target.value })}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                    >
                      {contentTypes.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {editingTx.contents === 'Other' && (
                      <input
                        id="edit-tx-package-custom-contents"
                        name="edit-tx-package-custom-contents"
                        type="text"
                        disabled={!canEdit}
                        value={editCustomContents}
                        onChange={(e) => setEditCustomContents(e.target.value.toUpperCase())}
                        placeholder="Enter content type"
                        className="w-full min-h-[44px] h-11 px-3.5 mt-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Remarks
                    </label>
                    <textarea
                      id="edit-tx-package-remarks"
                      name="edit-tx-package-remarks"
                      rows={2}
                      disabled={!(canEdit || canEditRemarks)}
                      value={editingTx.remarks || ''}
                      onChange={(e) => setEditingTx({ ...editingTx, remarks: e.target.value.toUpperCase() })}
                      className="w-full px-3.5 py-2.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] resize-none disabled:opacity-60"
                      placeholder="e.g. Sent by road"
                    />
                  </div>
                </>
              )}

              <h4 className="text-[11px] font-sans font-medium text-[var(--color-muted)] -mb-2 pt-2 border-t border-[var(--color-border)]">
                Payment
              </h4>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Amount (₦)
                </label>
                <input
                  id="edit-tx-amount"
                  name="edit-tx-amount"
                  type="number"
                  min="0"
                  disabled={!canEdit}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-mono tabular-nums text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Payment mode
                </label>
                <select
                  disabled={!canEdit}
                  value={editingTx.mode}
                  onChange={(e) => {
                    const nextMode = e.target.value as any;
                    setEditingTx({ ...editingTx, mode: nextMode });
                    if (nextMode !== 'Wallet') {
                      setEditWallet(null);
                      setEditWalletRemainderMode('Cash');
                      setEditWalletRemainderBank('');
                    }
                  }}
                  className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                >
                  <option value="Cash">Cash</option>
                  <option value="Transfer">Bank transfer</option>
                  <option value="POS">POS / card</option>
                  <option value="Debt" disabled={editOriginalMode === 'Debt Paid'}>Debt</option>
                  <option value="Wallet" disabled={editFullySettled}>Customer wallet</option>
                </select>
                {editFullySettled && (
                  <p className="text-[10px] font-sans text-[var(--color-muted)] mt-1">
                    Already settled — use “Reopen Debt” to change how it was paid.
                  </p>
                )}
              </div>

              {editingTx.mode === 'Wallet' && editOriginalMode !== 'Wallet' && !editFullySettled && (() => {
                const debtRemaining = roundMoney(
                  (editingTx.amount || 0) - (editingTx.amountPaid || 0) - ((editingTx.raw as any)?.retrieved_amount || 0)
                );
                const walletPay = editWallet ? Math.min(debtRemaining, editWallet.balance) : 0;
                const remainder = roundMoney(Math.max(0, debtRemaining - walletPay));
                return (
                  <div className="space-y-1">
                    <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                      Settle debt from wallet{' '}
                      {editWallet
                        ? remainder > 0
                          ? `(₦${fmt(walletPay)} wallet + ₦${fmt(remainder)} ${editWalletRemainderMode} on save)`
                          : `(deducts ₦${fmt(walletPay)} on save)`
                        : ''}
                    </label>
                    <CustomerWalletPicker
                      wallets={customerWallets}
                      selectedWallet={editWallet}
                      onSelectWallet={setEditWallet}
                      currentCustomerName={editingTx.name}
                    />
                    {editWallet && remainder > 0 && (
                      <WalletRemainderSelector
                        walletName={editWallet.customer_name}
                        coverage={walletPay}
                        remainder={remainder}
                        mode={editWalletRemainderMode}
                        bank={editWalletRemainderBank}
                        onModeChange={setEditWalletRemainderMode}
                        onBankChange={setEditWalletRemainderBank}
                        banks={banks}
                      />
                    )}
                  </div>
                );
              })()}

              {editingTx.mode === "Transfer" && (
                <div className="space-y-1">
                  <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                    Bank
                  </label>
                  <select
                    disabled={!canEdit}
                    value={editingTx.bank || ""}
                    onChange={(e) =>
                      setEditingTx({ ...editingTx, bank: e.target.value })
                    }
                    className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                  >
                    <option value="">Select bank</option>
                    {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Status
                </label>
                <select
                  disabled={!canEdit}
                  value={editingTx.status}
                  onChange={(e) =>
                    setEditingTx({
                      ...editingTx,
                      status: e.target.value as any,
                    })
                  }
                  className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] focus:bg-[var(--color-surface-hover)] disabled:opacity-60"
                >
                  <option value="Intake">Intake</option>
                  <option value="Dispatched">Dispatched</option>
                  <option value="Delivered">Delivered</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-3 justify-end shrink-0">
              <button
                type="button"
                onClick={() => setEditingTx(null)}
                disabled={savingEdit}
                className="min-h-[44px] h-11 px-5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] font-sans text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit || (() => {
                  if (editingTx.mode !== 'Wallet' || editOriginalMode === 'Wallet' || editFullySettled || !editWallet) return false;
                  const debtRemaining = roundMoney(
                    (editingTx.amount || 0) - (editingTx.amountPaid || 0) - ((editingTx.raw as any)?.retrieved_amount || 0)
                  );
                  const remainder = roundMoney(Math.max(0, debtRemaining - Math.min(debtRemaining, editWallet.balance)));
                  return remainder > 0
                    && (editWalletRemainderMode === 'Transfer' || editWalletRemainderMode === 'POS')
                    && !editWalletRemainderBank.trim();
                })()}
                className="min-h-[44px] h-11 px-6 rounded-full bg-white text-black hover:bg-neutral-200 font-sans text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {savingEdit ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Check size={15} /> Save changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* QR Code Modal Dialog */}
      {retrievalModalEntry && (
        <PartialRetrievalModal
          entry={retrievalModalEntry.raw}
          onClose={() => setRetrievalModalEntry(null)}
          onConfirm={executeRetrieval}
          busy={processingRetrieval}
        />
      )}

      {/* Clear Debt: mode/bank picker */}
      {clearDebtEntry && (() => {
        const tx = clearDebtEntry.raw as Transaction;
        const remaining = roundMoney(tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0));
        const walletPay = clearDebtWallet ? Math.min(remaining, clearDebtWallet.balance) : 0;
        const walletRem = roundMoney(Math.max(0, remaining - walletPay));
        const walletShort = clearDebtMode === 'Wallet' && !!clearDebtWallet && walletRem > 0;
        const confirmDisabled =
          clearingDebt ||
          (clearDebtMode === 'Transfer' && !clearDebtBank) ||
          (clearDebtMode === 'Wallet' && (
            !clearDebtWallet ||
            (walletShort && (clearDebtRemainderMode === 'Transfer' || clearDebtRemainderMode === 'POS') && !clearDebtBank.trim())
          ));
        return createPortal(
          <div className="fixed inset-0 z-[70] ehi-scrim flex items-center justify-center p-4" onClick={() => !clearingDebt && setClearDebtEntry(null)}>
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-5 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-[var(--color-foreground)] font-sans">Clear debt</h3>
                <button onClick={() => !clearingDebt && setClearDebtEntry(null)} className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"><X size={16} /></button>
              </div>
              <div className="p-4 sm:p-5 space-y-3.5">
                <p className="text-[13px] font-sans text-[var(--color-muted)] leading-relaxed">
                  Mark the remaining debt of <span className="font-semibold font-mono tabular-nums text-[var(--color-foreground)]">₦{fmt(remaining)}</span> for <span className="font-semibold text-[var(--color-foreground)]">{tx.name}</span> as fully paid. How was it paid?
                </p>
                <div className="space-y-1.5">
                  <label className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">Payment mode</label>
                  <select
                    disabled={clearingDebt}
                    value={clearDebtMode}
                    onChange={(e) => {
                      const m = e.target.value as 'Cash' | 'Transfer' | 'POS' | 'Wallet';
                      setClearDebtMode(m);
                      if (m !== 'Wallet') { setClearDebtWallet(null); setClearDebtRemainderMode('Cash'); }
                    }}
                    className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] disabled:opacity-60"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Transfer">Bank transfer</option>
                    <option value="POS">POS / card</option>
                    <option value="Wallet">Customer wallet</option>
                  </select>
                </div>
                {clearDebtMode === 'Transfer' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">Bank</label>
                    <select
                      disabled={clearingDebt}
                      value={clearDebtBank}
                      onChange={(e) => setClearDebtBank(e.target.value)}
                      className="w-full min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-[var(--color-foreground)] font-sans text-[14px] focus:outline-none focus:border-[var(--color-border-strong)] disabled:opacity-60"
                    >
                      <option value="">Select bank</option>
                      {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                )}
                {clearDebtMode === 'Wallet' && (
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                      Customer wallet{' '}
                      {clearDebtWallet
                        ? walletRem > 0
                          ? `(₦${fmt(walletPay)} wallet + ₦${fmt(walletRem)} ${clearDebtRemainderMode})`
                          : `(deducts ₦${fmt(walletPay)})`
                        : ''}
                    </label>
                    <CustomerWalletPicker
                      wallets={customerWallets}
                      selectedWallet={clearDebtWallet}
                      onSelectWallet={setClearDebtWallet}
                      currentCustomerName={tx.name}
                    />
                    {clearDebtWallet && walletRem > 0 && (
                      <WalletRemainderSelector
                        walletName={clearDebtWallet.customer_name}
                        coverage={walletPay}
                        remainder={walletRem}
                        mode={clearDebtRemainderMode}
                        bank={clearDebtBank}
                        onModeChange={setClearDebtRemainderMode}
                        onBankChange={setClearDebtBank}
                        banks={banks}
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="p-4 sm:p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setClearDebtEntry(null)}
                  disabled={clearingDebt}
                  className="flex-1 min-h-[44px] h-11 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] text-[13px] font-sans font-medium disabled:opacity-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmClearDebt}
                  disabled={confirmDisabled}
                  className="flex-1 min-h-[44px] h-11 flex items-center justify-center gap-2 rounded-full bg-white text-black hover:bg-neutral-200 text-[13px] font-sans font-semibold disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {clearingDebt ? <Loader2 size={14} className="animate-spin" /> : <CheckSquare size={14} />}
                  Clear debt
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {viewingQrTx && createPortal(
        <div className="fixed inset-0 z-[60] ehi-scrim flex items-center justify-center p-4 animate-in fade-in" onClick={() => setViewingQrTx(null)}>
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 sm:p-5 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-surface-card)]">
              <h3 className="font-semibold font-sans text-[15px] text-[var(--color-foreground)]">
                Scan QR code
              </h3>
              <button
                onClick={() => setViewingQrTx(null)}
                aria-label="Close QR code"
                className="min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center space-y-4 bg-[var(--color-surface-1)]">
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-[var(--color-border)]">
                <QRCode id={viewingQrTx.id} size={200} />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-semibold font-mono tabular-nums text-[var(--color-foreground)] mb-1">
                  {viewingQrTx.id}
                </p>
                <p className="text-[12px] font-sans text-[var(--color-muted)]">
                  {viewingQrTx.name}
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      </div>
      <LiveCreditFeed
        wallets={wallets}
        transactions={transactions}
        searchQuery={searchQuery}
        onFilterByCustomer={(name) => commitSearch(name)}
      />
    </div>
  );
};
