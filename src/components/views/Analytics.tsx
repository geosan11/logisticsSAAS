import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { User, Transaction, Expense } from '../../lib/types';
import { fmt, getShiftBoundary, sanitizeSpreadsheetRows, lagosBusinessDate } from '../../lib/helpers';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useDensity } from '../../lib/useDensity';
import {
  TrendingUp,
  Package,
  Plane,
  Sparkles,
  ChevronDown,
  AlertCircle,
  Loader2,
  Calendar,
  Download,
  DollarSign,
  Search,
  X,
  FileSpreadsheet,
  CheckCircle2,
  Radar,
  Wallet,
  CreditCard,
  Banknote,
  Building2,
  ArrowLeft,
} from 'lucide-react';

export const Analytics = ({
  user,
  transactions,
  expenses = [],
  setDateRange,
  dataLoading = false,
}: {
  user: User;
  transactions: Transaction[];
  expenses?: Expense[];
  dateRange: { start: string; end: string };
  setDateRange: (range: { start: string; end: string }) => void;
  dataLoading?: boolean;
}) => {
  const [period, setPeriod] = useState<'shift' | 'today' | '7days' | 'month' | 'custom'>('shift');
  const [selectedHub, setSelectedHub] = useState<string>('all');
  const [activeView, setActiveView] = useState<'summary' | 'customers' | 'past_shifts'>('summary');
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();
  const { isCompact } = useDensity();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export dropdown when clicking outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [showExportMenu]);

  // Custom Date Range State
  const defaultShift = useMemo(() => {
    const b = getShiftBoundary((user as any).shift_start_hour ?? 18);
    return {
      start: b.start.toISOString().slice(0, 16),
      end: b.end.toISOString().slice(0, 16),
    };
  }, [user]);
  const [customStart, setCustomStart] = useState(defaultShift.start);
  const [customEnd, setCustomEnd] = useState(defaultShift.end);

  const handlePeriodChange = (newPeriod: typeof period) => {
    setPeriod(newPeriod);
    const now = new Date();

    if (newPeriod === 'today' || newPeriod === 'shift') {
      const start = new Date(now.getTime() - 86400000 * 2).toISOString().split('T')[0];
      const end = now.toISOString().split('T')[0];
      setDateRange({ start, end });
    } else if (newPeriod === '7days') {
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const end = now.toISOString().split('T')[0];
      setDateRange({ start, end });
    } else if (newPeriod === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      setDateRange({ start, end });
    }
  };

  const handleCustomRangeApply = () => {
    const start = customStart.split('T')[0];
    const end = customEnd.split('T')[0];
    setDateRange({ start, end });
  };

  // Load hub list (cached in sessionStorage to avoid refetching on every tab switch)
  const [activeHubs, setActiveHubs] = useState<{ id: string; name: string; code: string; state: string }[]>(() => {
    try {
      const cached = sessionStorage.getItem('ehi_hubs_list');
      if (cached) return JSON.parse(cached);
    } catch {}
    return [{ id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' }];
  });

  useEffect(() => {
    if (activeHubs.length > 1) return;
    supabase
      .from('hubs')
      .select('id, name, code, state')
      .order('name')
      .then(({ data }) => {
        if (data) {
          const list = [
            { id: 'all', name: 'All Hubs & Terminals', code: 'ALL', state: 'Nigeria' },
            ...data.map((h: any) => ({ id: h.id, name: h.name, code: h.code, state: h.state })),
          ];
          setActiveHubs(list);
          try {
            sessionStorage.setItem('ehi_hubs_list', JSON.stringify(list));
          } catch {}
        }
      });
  }, [activeHubs.length]);

  // Flight attention badge (cache-only read)
  const [flightAttentionCount, setFlightAttentionCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(
      supabase
        .from('flight_status_cache')
        .select('status')
        .eq('flight_date', lagosBusinessDate())
        .in('status', ['delayed', 'diverted', 'cancelled'])
    )
      .then(({ data }) => {
        if (!cancelled) setFlightAttentionCount((data || []).length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Past Shifts (only loaded when user clicks "Past Shifts")
  const [pastShifts, setPastShifts] = useState<any[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [selectedPastShift, setSelectedPastShift] = useState<any | null>(null);

  useEffect(() => {
    if (activeView !== 'past_shifts') return;
    let active = true;
    setLoadingShifts(true);
    supabase
      .from('hub_shifts')
      .select('*')
      .eq('status', 'closed')
      .order('ended_at', { ascending: false })
      .limit(40)
      .then(({ data }) => {
        if (active && data) setPastShifts(data);
        if (active) setLoadingShifts(false);
      });
    return () => {
      active = false;
    };
  }, [activeView]);

  const hubIdToState = useMemo(() => {
    const m = new Map<string, string>();
    activeHubs.forEach((h) => {
      if (h.id !== 'all') m.set(h.id, h.state);
    });
    return m;
  }, [activeHubs]);

  const periodBounds = useMemo(() => {
    const now = new Date();
    const shiftBoundary = getShiftBoundary((user as any).shift_start_hour ?? 18);
    if (period === 'shift') return { startMs: shiftBoundary.start.getTime(), endMs: shiftBoundary.end.getTime() };
    if (period === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
      return { startMs: todayStart, endMs: Infinity };
    }
    if (period === '7days') return { startMs: now.getTime() - 7 * 86400000, endMs: Infinity };
    if (period === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0).getTime();
      return { startMs: monthStart, endMs: Infinity };
    }
    if (period === 'custom') {
      return { startMs: new Date(customStart).getTime(), endMs: new Date(customEnd).getTime() };
    }
    return { startMs: 0, endMs: Infinity };
  }, [period, customStart, customEnd, user]);

  // Single-pass filter for transactions in selected hub & time period
  const periodFilteredTxs = useMemo(() => {
    const selectedState = selectedHub === 'all' ? null : hubIdToState.get(selectedHub);
    const q = searchQuery.trim().toLowerCase();
    const { startMs, endMs } = periodBounds;

    return transactions.filter((t) => {
      if (selectedHub !== 'all') {
        const matchesHub =
          t.hub_id === selectedHub ||
          (selectedState != null && t.hub_id != null && hubIdToState.get(t.hub_id) === selectedState);
        if (!matchesHub) return false;
      }
      const txMs = t.created_at ? Date.parse(t.created_at) : Date.now();
      if (txMs < startMs || txMs > endMs) return false;

      if (q) {
        const text = `${t.id} ${t.name} ${t.detail} ${t.mode} ${t.airline || ''} ${t.route || ''} ${t.awb_tag_number || ''}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, selectedHub, hubIdToState, periodBounds, searchQuery]);

  // Filtered expenses in the same period & hub
  const periodFilteredExpenses = useMemo(() => {
    const selectedState = selectedHub === 'all' ? null : hubIdToState.get(selectedHub);
    const { startMs, endMs } = periodBounds;

    return expenses.filter((e) => {
      if (e.status === 'rejected') return false;
      if (selectedHub !== 'all') {
        const matchesHub =
          e.hub_id === selectedHub ||
          (selectedState != null && e.hub_id != null && hubIdToState.get(e.hub_id) === selectedState);
        if (!matchesHub) return false;
      }
      const expMs = e.created_at ? Date.parse(e.created_at) : e.time ? Date.parse(e.time) : Date.now();
      return expMs >= startMs && expMs <= endMs;
    });
  }, [expenses, selectedHub, hubIdToState, periodBounds]);

  // Single-pass summary calculation (fast O(N) over filtered rows)
  const summary = useMemo(() => {
    let collectedTotal = 0;
    let grossBooked = 0;
    let unpaidDebt = 0;
    let debtCount = 0;

    let cashTotal = 0;
    let transferTotal = 0;
    let unconfirmedTransferTotal = 0;
    let posTotal = 0;
    let walletTotal = 0;

    let totalShipments = 0;
    let totalKg = 0;

    const depts = {
      cargo: { label: 'Air Cargo', revenue: 0, count: 0, kg: 0 },
      baggage: { label: 'Excess Baggage (legacy)', revenue: 0, count: 0, kg: 0 },
      marketing: { label: 'Marketing (legacy)', revenue: 0, count: 0, kg: 0 },
      package: { label: 'Package Desk', revenue: 0, count: 0, kg: 0 },
    };

    const customerMap = new Map<
      string,
      { name: string; dept: string; shipments: number; kg: number; paid: number; debt: number }
    >();

    for (const t of periodFilteredTxs) {
      const isDebtClearance = !!t.is_debt_clearance;
      const isRetrieved = !!t.retrieved;
      const isLiquid = (t.mode !== 'Debt' && t.mode !== 'Debt Paid' && !isRetrieved) || isDebtClearance;

      const custName = t.name?.trim() || 'Walk-in Customer';
      let cust = customerMap.get(custName);
      if (!cust) {
        cust = {
          name: custName,
          dept:
            t.type === 'cargo'
              ? 'Cargo'
              : t.type === 'baggage'
                ? 'Baggage'
                : t.type === 'marketing'
                  ? 'Marketing'
                  : 'Package',
          shipments: 0,
          kg: 0,
          paid: 0,
          debt: 0,
        };
        customerMap.set(custName, cust);
      }

      // Count physical shipments (exclude debt-clearance payment rows so shipments aren't counted twice)
      if (!isDebtClearance) {
        totalShipments++;
        totalKg += t.kg || 0;
        grossBooked += t.amount || 0;

        cust.shipments++;
        cust.kg += t.kg || 0;

        const d = depts[t.type as keyof typeof depts];
        if (d) {
          d.count++;
          d.kg += t.kg || 0;
        }

        if (t.mode === 'Debt') {
          const remaining = Math.max(
            0,
            (t.amount || 0) - (t.amountPaid || 0) - ((t.raw as any)?.retrieved_amount || 0)
          );
          if (remaining > 0) {
            unpaidDebt += remaining;
            debtCount++;
            cust.debt += remaining;
          }
        }
      }

      // Count actual collected money (including debt payments collected in this period)
      if (isLiquid) {
        const amt = t.amount || 0;
        collectedTotal += amt;
        cust.paid += amt;

        const d = depts[t.type as keyof typeof depts];
        if (d) d.revenue += amt;

        if (t.mode === 'Cash') {
          cashTotal += amt;
        } else if (t.mode === 'Transfer' || t.mode === 'TransferCash') {
          transferTotal += amt;
          if (!t.paymentConfirmed) unconfirmedTransferTotal += amt;
        } else if (t.mode === 'POS') {
          posTotal += amt;
        } else if (t.mode === 'Wallet' || (t.wallet_deduction_amount && t.wallet_deduction_amount > 0)) {
          walletTotal += t.wallet_deduction_amount || amt;
        }
      }
    }

    const totalExpenses = periodFilteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netCashAfterExpenses = collectedTotal - totalExpenses;

    const topCustomers = Array.from(customerMap.values())
      .sort((a, b) => b.paid + b.debt - (a.paid + a.debt))
      .slice(0, 25);

    return {
      collectedTotal,
      grossBooked,
      unpaidDebt,
      debtCount,
      cashTotal,
      transferTotal,
      unconfirmedTransferTotal,
      posTotal,
      walletTotal,
      totalShipments,
      totalKg,
      totalExpenses,
      expenseCount: periodFilteredExpenses.length,
      netCashAfterExpenses,
      depts,
      topCustomers,
    };
  }, [periodFilteredTxs, periodFilteredExpenses]);

  // Excel Export
  const exportExcelReport = useCallback(async () => {
    try {
      const [XLSX, { autoFitWorksheetColumns }] = await Promise.all([
        import('xlsx'),
        import('../../lib/excelExport'),
      ]);
      const summaryRows = [
        { Metric: 'Total Money Collected', Value: `₦${summary.collectedTotal.toLocaleString()}` },
        { Metric: 'Gross Sales Booked', Value: `₦${summary.grossBooked.toLocaleString()}` },
        { Metric: 'Unpaid Credit / Debt', Value: `₦${summary.unpaidDebt.toLocaleString()}` },
        { Metric: 'Total Expenses', Value: `₦${summary.totalExpenses.toLocaleString()}` },
        { Metric: 'Net Position (Collected - Expenses)', Value: `₦${summary.netCashAfterExpenses.toLocaleString()}` },
        { Metric: 'Total Shipments', Value: summary.totalShipments },
        { Metric: 'Total Weight (KG)', Value: `${summary.totalKg.toLocaleString()} KG` },
      ];

      const customerRows = summary.topCustomers.map((c) => ({
        Customer: c.name,
        Department: c.dept,
        Shipments: c.shipments,
        'Weight (KG)': c.kg,
        'Amount Paid (NGN)': c.paid,
        'Unpaid Debt (NGN)': c.debt,
      }));

      const entryRows = periodFilteredTxs.map((t) => ({
        'Entry Ref': t.id,
        Department: t.type,
        Customer: t.name,
        Airline: t.airline || '',
        Route: t.route || '',
        'AWB Tag': t.awb_tag_number || '',
        'Weight (KG)': t.kg || 0,
        Pieces: t.pieces || 1,
        'Amount (NGN)': t.amount,
        'Payment Mode': t.mode,
        Confirmed: t.paymentConfirmed ? 'YES' : 'NO',
        'Date Time': t.created_at ? new Date(t.created_at).toLocaleString() : '',
        Agent: t.enteredByName || '',
      }));

      const wb = XLSX.utils.book_new();
      const wsSummary = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(summaryRows));
      const wsClients = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(customerRows));
      const wsEntries = XLSX.utils.json_to_sheet(sanitizeSpreadsheetRows(entryRows));
      autoFitWorksheetColumns(wsSummary);
      autoFitWorksheetColumns(wsClients);
      autoFitWorksheetColumns(wsEntries);

      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
      XLSX.utils.book_append_sheet(wb, wsClients, 'Top Customers');
      XLSX.utils.book_append_sheet(wb, wsEntries, 'Transactions');

      XLSX.writeFile(wb, `EHI_Summary_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast({ message: 'Excel report exported!', type: 'success' });
    } catch (err: any) {
      showToast({ message: 'Failed to export Excel: ' + err.message, type: 'error' });
    }
  }, [summary, periodFilteredTxs, period, showToast]);

  const handleDownloadPDF = async () => {
    try {
      if (!periodFilteredTxs.length) {
        showToast({ message: 'No transactions in this period to export.', type: 'warning' });
        return;
      }
      const { downloadAnalyticsPDF } = await import('./AnalyticsPDF');
      await downloadAnalyticsPDF({ period, transactions: periodFilteredTxs });
    } catch (err: any) {
      showToast({ message: 'Error downloading PDF: ' + err.message, type: 'error' });
    }
  };

  return (
    <div
      className={`flex flex-col w-full pb-24 select-none ${
        isCompact ? 'p-3 sm:p-4 space-y-3.5' : 'p-4 md:p-6 space-y-5'
      }`}
    >
      {/* ── 1. Unified Quiet Header & Actions ───────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold font-sans text-[var(--color-foreground)] tracking-tight truncate">
            Sales &amp; Collections
          </h2>
          <p className="text-[12px] text-[var(--color-muted)] mt-0.5 font-sans truncate">
            Shift summary, collection breakdown, and financial reconciliation
          </p>
        </div>

        {/* Quiet secondary toolbar (guaranteed single row) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Hub Selector */}
          <div className="relative shrink-0">
            <select
              value={selectedHub}
              onChange={(e) => setSelectedHub(e.target.value)}
              aria-label="Select hub or terminal"
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] text-[12px] font-sans font-medium min-h-[44px] h-11 pl-3 pr-7 max-w-[160px] truncate rounded-xl border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-border-strong)] appearance-none cursor-pointer transition-colors"
            >
              {activeHubs.map((hub) => (
                <option key={hub.id} value={hub.id}>
                  {hub.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
              size={14}
            />
          </div>

          {/* Flights Radar Shortcut */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'FlightRadar' }))}
            className={`min-h-[44px] h-11 px-3 rounded-xl border text-[12px] font-sans font-medium flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
              flightAttentionCount > 0
                ? 'bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error)] font-semibold'
                : 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
            }`}
            title={
              flightAttentionCount > 0
                ? `${flightAttentionCount} flight(s) delayed, diverted or cancelled`
                : 'Open Flight Radar'
            }
            aria-label="Open Flight Radar"
          >
            <Radar size={15} className={flightAttentionCount > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'} />
            <span>Flights</span>
            {flightAttentionCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-[var(--color-error)]/20 text-[var(--color-error)] border border-[var(--color-error)]/30">
                {flightAttentionCount}
              </span>
            )}
          </button>

          {/* Unified Quiet Export Dropdown Menu (Single Button) */}
          <div className="relative shrink-0" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu(!showExportMenu)}
              aria-expanded={showExportMenu}
              aria-haspopup="true"
              aria-label="Export options"
              className="min-h-[44px] h-11 px-3 text-[12px] font-sans font-medium text-[var(--color-foreground)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] rounded-xl border border-[var(--color-border)] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download size={15} className="text-[var(--color-muted)]" />
              <span>Export</span>
              <ChevronDown
                size={14}
                className={`text-[var(--color-muted)] transition-transform duration-150 ${
                  showExportMenu ? 'rotate-180' : ''
                }`}
              />
            </button>

            {showExportMenu && (
              <div
                className="absolute right-0 top-full mt-1.5 w-52 bg-[var(--color-surface-1)] border border-[var(--color-border-strong)] rounded-xl shadow-lg z-30 py-1 divide-y divide-[var(--color-border)] animate-in fade-in zoom-in-95 duration-100"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowExportMenu(false);
                    exportExcelReport();
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-left text-[12px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <FileSpreadsheet size={16} className="text-[var(--color-muted)] shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold">Excel spreadsheet</span>
                    <span className="text-[10px] text-[var(--color-muted)]">.xlsx with tabs & auto-fit</span>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowExportMenu(false);
                    handleDownloadPDF();
                  }}
                  className="w-full min-h-[44px] px-3.5 py-2.5 text-left text-[12px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Download size={16} className="text-[var(--color-muted)] shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold">PDF summary report</span>
                    <span className="text-[10px] text-[var(--color-muted)]">Printable station manifest</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Filter & Time Period Toolbar ─────────────────────────── */}
      <div
        className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl ${
          isCompact ? 'p-2.5' : 'p-3'
        }`}
      >
        {/* Period Selector & Loading Telemetry */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          {/* Segmented Period Tabs */}
          <div className="flex items-center gap-1 bg-[var(--color-surface-1)] p-1 rounded-xl border border-[var(--color-border)] shrink-0">
            {([
              ['shift', 'Current shift'],
              ['today', 'Today'],
              ['7days', '7 days'],
              ['month', 'This month'],
              ['custom', 'Custom'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => handlePeriodChange(id)}
                className={`min-h-[44px] px-3.5 py-2 text-[12px] font-sans rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  period === id
                    ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)] shadow-xs'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Quiet Loading Telemetry (Outside Pill Group) */}
          {dataLoading && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-sans text-[var(--color-muted)] shrink-0">
              <Loader2 size={13} className="animate-spin text-[var(--color-muted)]" />
              <span>Updating…</span>
            </div>
          )}
        </div>

        {/* Custom Date Range Controls (shown only when Custom is active) */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-muted)] flex-wrap shrink-0">
            <input
              type="datetime-local"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              aria-label="Custom range start"
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] min-h-[44px] h-11 px-3 rounded-xl border border-[var(--color-border)] text-[12px] font-sans focus:outline-none focus:border-[var(--color-border-strong)]"
            />
            <span className="text-[12px] text-[var(--color-muted)]">to</span>
            <input
              type="datetime-local"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              aria-label="Custom range end"
              className="bg-[var(--color-surface-1)] text-[var(--color-foreground)] min-h-[44px] h-11 px-3 rounded-xl border border-[var(--color-border)] text-[12px] font-sans focus:outline-none focus:border-[var(--color-border-strong)]"
            />
            <button
              onClick={handleCustomRangeApply}
              className="min-h-[44px] h-11 px-4 bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] rounded-xl text-[12px] font-semibold cursor-pointer transition-colors"
            >
              Apply
            </button>
          </div>
        )}

        {/* Search input with 44px tap target */}
        <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
          <input
            type="text"
            placeholder="Filter entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[44px] h-11 pl-9 pr-10 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-[13px] font-sans text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
          />
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear filter"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] w-10 h-10 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg cursor-pointer"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ── 3. Four Core Stat Cards (Manager Priority Hierarchy) ────── */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${
          isCompact ? 'gap-2.5' : 'gap-3 sm:gap-4'
        }`}
      >
        {/* Priority 1: Money Collected (Primary cash/liquid in hand) */}
        <div
          className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl flex flex-col justify-between ${
            isCompact ? 'p-3.5' : 'p-4 sm:p-5'
          }`}
        >
          <div className="text-[12px] font-medium text-[var(--color-muted)] font-sans">
            Money collected
          </div>
          <div className="text-[24px] sm:text-[26px] font-semibold text-[var(--color-foreground)] tabular-nums my-1.5 tracking-tight font-sans">
            ₦{fmt(summary.collectedTotal)}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)] font-sans">
            {summary.totalShipments.toLocaleString()} shipments · {summary.totalKg.toLocaleString()} KG
          </div>
        </div>

        {/* Priority 2: Unpaid Credit (Debt attention - Color ONLY when problem exists) */}
        <div
          className={`border rounded-2xl flex flex-col justify-between transition-colors ${
            isCompact ? 'p-3.5' : 'p-4 sm:p-5'
          } ${
            summary.unpaidDebt > 0
              ? 'bg-[var(--color-error-bg)] border-[var(--color-error-border)]'
              : 'bg-[var(--color-surface-card)] border-[var(--color-border)]'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={`text-[12px] font-medium font-sans ${
                summary.unpaidDebt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'
              }`}
            >
              Unpaid credit
            </span>
            {summary.unpaidDebt > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-error)]/15 text-[var(--color-error)] font-sans shrink-0">
                Needs collection
              </span>
            )}
          </div>
          <div
            className={`text-[24px] sm:text-[26px] font-semibold tabular-nums my-1.5 tracking-tight font-sans ${
              summary.unpaidDebt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'
            }`}
          >
            ₦{fmt(summary.unpaidDebt)}
          </div>
          <div
            className={`text-[11px] font-sans ${
              summary.unpaidDebt > 0 ? 'text-[var(--color-error)]/80' : 'text-[var(--color-text-secondary)]'
            }`}
          >
            {summary.debtCount} unpaid {summary.debtCount === 1 ? 'entry' : 'entries'}
          </div>
        </div>

        {/* Priority 3: Net After Expenses (Liquid Net Position) */}
        <div
          className={`border rounded-2xl flex flex-col justify-between transition-colors ${
            isCompact ? 'p-3.5' : 'p-4 sm:p-5'
          } ${
            summary.netCashAfterExpenses < 0
              ? 'bg-[var(--color-error-bg)] border-[var(--color-error-border)]'
              : 'bg-[var(--color-surface-card)] border-[var(--color-border)]'
          }`}
        >
          <div
            className={`text-[12px] font-medium font-sans ${
              summary.netCashAfterExpenses < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'
            }`}
          >
            Net after expenses
          </div>
          <div
            className={`text-[24px] sm:text-[26px] font-semibold tabular-nums my-1.5 tracking-tight font-sans ${
              summary.netCashAfterExpenses < 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'
            }`}
          >
            ₦{fmt(summary.netCashAfterExpenses)}
          </div>
          <div
            className={`text-[11px] font-sans ${
              summary.netCashAfterExpenses < 0
                ? 'text-[var(--color-error)]/80'
                : 'text-[var(--color-text-secondary)]'
            }`}
          >
            Expenses: ₦{fmt(summary.totalExpenses)} ({summary.expenseCount})
          </div>
        </div>

        {/* Priority 4: Total Sales Booked (Gross volume: paid + credit) */}
        <div
          className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl flex flex-col justify-between ${
            isCompact ? 'p-3.5' : 'p-4 sm:p-5'
          }`}
        >
          <div className="text-[12px] font-medium text-[var(--color-muted)] font-sans">
            Total sales booked
          </div>
          <div className="text-[24px] sm:text-[26px] font-semibold text-[var(--color-foreground)] tabular-nums my-1.5 tracking-tight font-sans">
            ₦{fmt(summary.grossBooked)}
          </div>
          <div className="text-[11px] text-[var(--color-text-secondary)] font-sans">
            Paid sales plus credit bookings
          </div>
        </div>
      </div>

      {/* ── 4. View Switcher Tabs ──────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2.5 overflow-x-auto no-scrollbar">
        {([
          ['summary', 'Breakdown', DollarSign],
          ['customers', `Top customers (${summary.topCustomers.length})`, Building2],
          ['past_shifts', 'Closed shifts', Calendar],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setActiveView(id)}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-sans font-medium flex items-center gap-2 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              activeView === id
                ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-transparent'
            }`}
          >
            <Icon size={15} className="shrink-0 text-[var(--color-muted)]" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ── View 1: Department & Payment Method Breakdown ──────────── */}
      {activeView === 'summary' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Sales by Department */}
          <div
            className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl space-y-3.5 ${
              isCompact ? 'p-3.5' : 'p-4 sm:p-5'
            }`}
          >
            <div className="border-b border-[var(--color-border)] pb-2.5">
              <h3 className="text-[14px] font-semibold font-sans text-[var(--color-foreground)]">
                Money collected by department
              </h3>
              <p className="text-[11px] text-[var(--color-muted)] mt-0.5 font-sans">
                Paid revenue across station operational desks
              </p>
            </div>

            <div className="space-y-2.5">
              {([
                { key: 'cargo', icon: Package },
                { key: 'package', icon: Sparkles },
                { key: 'baggage', icon: Plane },
                { key: 'marketing', icon: TrendingUp },
              ] as const)
                .filter(({ key }) => {
                  if (key === 'baggage' || key === 'marketing') {
                    return summary.depts[key].count > 0;
                  }
                  return true;
                })
                .map(({ key, icon: Icon }) => {
                const d = summary.depts[key];
                const pct = summary.collectedTotal > 0 ? Math.round((d.revenue / summary.collectedTotal) * 100) : 0;
                return (
                  <div
                    key={key}
                    className="p-3.5 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2.5 text-[13px] font-medium text-[var(--color-foreground)] font-sans">
                        <Icon size={16} className="text-[var(--color-muted)]" />
                        <span>{d.label}</span>
                      </span>
                      <span className="text-[14px] font-semibold text-[var(--color-foreground)] tabular-nums font-sans">
                        ₦{fmt(d.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)] font-sans">
                      <span>
                        {d.count} {d.count === 1 ? 'entry' : 'entries'}
                        {d.kg > 0 ? ` · ${d.kg.toLocaleString()} KG` : ''}
                      </span>
                      <span>{pct}% of total</span>
                    </div>
                    <div className="w-full bg-[var(--color-border)] h-1.5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--color-foreground)]/40 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: How Customers Paid (Monochrome & Consistent) */}
          <div
            className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl space-y-3.5 ${
              isCompact ? 'p-3.5' : 'p-4 sm:p-5'
            }`}
          >
            <div className="border-b border-[var(--color-border)] pb-2.5">
              <h3 className="text-[14px] font-semibold font-sans text-[var(--color-foreground)]">
                How customers paid
              </h3>
              <p className="text-[11px] text-[var(--color-muted)] mt-0.5 font-sans">
                Collection method breakdown and unconfirmed deposits
              </p>
            </div>

            <div className="space-y-2.5 text-[13px]">
              {/* Cash */}
              <div className="flex items-center justify-between p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)]">
                <span className="flex items-center gap-2.5 text-[var(--color-foreground)] font-medium font-sans">
                  <Banknote size={16} className="text-[var(--color-muted)]" />
                  <span>Cash</span>
                </span>
                <span className="text-[14px] font-semibold text-[var(--color-foreground)] tabular-nums font-sans">
                  ₦{fmt(summary.cashTotal)}
                </span>
              </div>

              {/* Bank Transfer */}
              <div className="flex items-center justify-between p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)]">
                <div>
                  <div className="flex items-center gap-2.5 text-[var(--color-foreground)] font-medium font-sans">
                    <CheckCircle2 size={16} className="text-[var(--color-muted)]" />
                    <span>Bank transfer</span>
                  </div>
                  {summary.unconfirmedTransferTotal > 0 && (
                    <div className="text-[11px] text-[var(--color-warning)] font-medium mt-0.5 font-sans">
                      ₦{fmt(summary.unconfirmedTransferTotal)} awaiting bank confirmation
                    </div>
                  )}
                </div>
                <span className="text-[14px] font-semibold text-[var(--color-foreground)] tabular-nums font-sans">
                  ₦{fmt(summary.transferTotal)}
                </span>
              </div>

              {/* POS Terminal */}
              <div className="flex items-center justify-between p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)]">
                <span className="flex items-center gap-2.5 text-[var(--color-foreground)] font-medium font-sans">
                  <CreditCard size={16} className="text-[var(--color-muted)]" />
                  <span>POS terminal</span>
                </span>
                <span className="text-[14px] font-semibold text-[var(--color-foreground)] tabular-nums font-sans">
                  ₦{fmt(summary.posTotal)}
                </span>
              </div>

              {/* Customer Wallet */}
              <div className="flex items-center justify-between p-3.5 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)]">
                <span className="flex items-center gap-2.5 text-[var(--color-foreground)] font-medium font-sans">
                  <Wallet size={16} className="text-[var(--color-muted)]" />
                  <span>Customer wallet</span>
                </span>
                <span className="text-[14px] font-semibold text-[var(--color-foreground)] tabular-nums font-sans">
                  ₦{fmt(summary.walletTotal)}
                </span>
              </div>

              {/* Unpaid Credit (Debt) - Signals Problem Only If > 0 */}
              <div
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-colors ${
                  summary.unpaidDebt > 0
                    ? 'bg-[var(--color-error-bg)] border-[var(--color-error-border)]'
                    : 'bg-[var(--color-surface-1)] border-[var(--color-border)]'
                }`}
              >
                <span
                  className={`flex items-center gap-2.5 font-sans font-medium ${
                    summary.unpaidDebt > 0 ? 'text-[var(--color-error)] font-semibold' : 'text-[var(--color-foreground)]'
                  }`}
                >
                  <AlertCircle
                    size={16}
                    className={summary.unpaidDebt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}
                  />
                  <span>Unpaid credit (debt owed)</span>
                </span>
                <span
                  className={`text-[14px] font-semibold tabular-nums font-sans ${
                    summary.unpaidDebt > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)]'
                  }`}
                >
                  ₦{fmt(summary.unpaidDebt)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── View 2: Top Customers Table ────────────────────────────── */}
      {activeView === 'customers' && (
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[var(--color-border)]">
            <h3 className="text-[15px] font-semibold text-[var(--color-foreground)] font-sans">
              Top customers in selected period
            </h3>
            <p className="text-[12px] text-[var(--color-muted)] mt-0.5 font-sans">
              Ranked by total business volume (paid sales plus outstanding credit)
            </p>
          </div>
          {summary.topCustomers.length === 0 ? (
            <div className="py-16 px-4 text-center space-y-2">
              <Building2 size={28} className="mx-auto text-[var(--color-muted)] opacity-30" />
              <div className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">
                No customer records found
              </div>
              <p className="text-[12px] font-sans text-[var(--color-muted)] max-w-sm mx-auto">
                No transactions recorded for the selected hub and period.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-sans text-[13px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--color-surface-1)] text-[var(--color-muted)] border-b border-[var(--color-border)] text-[11px] font-medium">
                    <th className="py-3 px-3.5 w-12 text-center">#</th>
                    <th className="py-3 px-3.5">Customer</th>
                    <th className="py-3 px-3.5">Department</th>
                    <th className="py-3 px-3.5 text-center">Shipments</th>
                    <th className="py-3 px-3.5 text-right">Weight</th>
                    <th className="py-3 px-3.5 text-right">Paid</th>
                    <th className="py-3 px-3.5 text-right">Unpaid debt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {summary.topCustomers.map((c, i) => (
                    <tr
                      key={c.name}
                      className="hover:bg-[var(--color-surface-hover)] transition-colors min-h-[44px]"
                    >
                      <td className="py-3 px-3.5 text-center text-[var(--color-muted)] text-[12px] tabular-nums">
                        {i + 1}
                      </td>
                      <td
                        className="py-3 px-3.5 font-medium text-[var(--color-foreground)] truncate max-w-[180px] sm:max-w-xs"
                        title={c.name}
                      >
                        {c.name}
                      </td>
                      <td className="py-3 px-3.5 text-[var(--color-muted)] text-[12px]">
                        {c.dept}
                      </td>
                      <td className="py-3 px-3.5 text-center text-[var(--color-foreground)] tabular-nums">
                        {c.shipments}
                      </td>
                      <td className="py-3 px-3.5 text-right text-[var(--color-foreground)] tabular-nums">
                        {c.kg.toLocaleString()} KG
                      </td>
                      <td className="py-3 px-3.5 text-right font-medium text-[var(--color-foreground)] tabular-nums">
                        ₦{fmt(c.paid)}
                      </td>
                      <td
                        className={`py-3 px-3.5 text-right tabular-nums ${
                          c.debt > 0
                            ? 'font-semibold text-[var(--color-error)]'
                            : 'text-[var(--color-muted)]'
                        }`}
                      >
                        {c.debt > 0 ? `₦${fmt(c.debt)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── View 3: Past Closed Shifts ─────────────────────────────── */}
      {activeView === 'past_shifts' && (
        <div className="space-y-4">
          {selectedPastShift ? (
            <div className="space-y-4">
              <button
                onClick={() => setSelectedPastShift(null)}
                className="inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-[13px] font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-xl cursor-pointer transition-colors"
              >
                <ArrowLeft size={16} />
                <span>Back to closed shifts</span>
              </button>

              <div
                className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl space-y-4 ${
                  isCompact ? 'p-4' : 'p-5'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
                  <div>
                    <h3 className="text-[16px] font-semibold text-[var(--color-foreground)] flex items-center gap-2.5 font-sans">
                      <span>Shift summary</span>
                      {selectedPastShift.department && selectedPastShift.department !== 'all' && (
                        <span className="text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)]">
                          {selectedPastShift.department}
                        </span>
                      )}
                    </h3>
                    <div className="text-[12px] font-sans text-[var(--color-muted)] mt-1">
                      {new Date(selectedPastShift.started_at).toLocaleString()} —{' '}
                      {new Date(selectedPastShift.ended_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[12px] font-sans text-[var(--color-muted)]">
                    Opened by {selectedPastShift.opened_by} · Closed by {selectedPastShift.closed_by}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3.5 rounded-xl">
                    <div className="text-[11px] text-[var(--color-muted)] font-medium font-sans">Total sales</div>
                    <div className="text-[16px] font-semibold text-[var(--color-foreground)] tabular-nums mt-1 font-sans">
                      ₦{fmt(selectedPastShift.sales_summary?.totalSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3.5 rounded-xl">
                    <div className="text-[11px] text-[var(--color-muted)] font-medium font-sans">Cash</div>
                    <div className="text-[16px] font-medium text-[var(--color-foreground)] tabular-nums mt-1 font-sans">
                      ₦{fmt(selectedPastShift.sales_summary?.cashSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3.5 rounded-xl">
                    <div className="text-[11px] text-[var(--color-muted)] font-medium font-sans">Transfer</div>
                    <div className="text-[16px] font-medium text-[var(--color-foreground)] tabular-nums mt-1 font-sans">
                      ₦{fmt(selectedPastShift.sales_summary?.transferSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3.5 rounded-xl">
                    <div className="text-[11px] text-[var(--color-muted)] font-medium font-sans">POS</div>
                    <div className="text-[16px] font-medium text-[var(--color-foreground)] tabular-nums mt-1 font-sans">
                      ₦{fmt(selectedPastShift.sales_summary?.posSales || 0)}
                    </div>
                  </div>
                  <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] p-3.5 rounded-xl">
                    <div className="text-[11px] text-[var(--color-muted)] font-medium font-sans">Entries</div>
                    <div className="text-[16px] font-medium text-[var(--color-foreground)] tabular-nums mt-1 font-sans">
                      {selectedPastShift.sales_summary?.totalTxCount || 0}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : loadingShifts ? (
            <div className="flex justify-center p-12">
              <Loader2 className="animate-spin text-[var(--color-muted)]" size={24} />
            </div>
          ) : pastShifts.length === 0 ? (
            <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl py-16 px-4 text-center space-y-2">
              <Calendar size={28} className="mx-auto text-[var(--color-muted)] opacity-30" />
              <div className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">
                No closed shifts found
              </div>
              <p className="text-[12px] font-sans text-[var(--color-muted)] max-w-sm mx-auto">
                Closed station shifts and reconciliation summaries will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pastShifts.map((s, i) => (
                <div
                  key={s.id || i}
                  onClick={() => setSelectedPastShift(s)}
                  className="bg-[var(--color-surface-card)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] rounded-2xl p-4 cursor-pointer transition-colors min-h-[44px]"
                >
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
                    <span className="text-[13px] font-semibold text-[var(--color-foreground)] font-sans">
                      {new Date(s.started_at).toLocaleDateString()}
                    </span>
                    {s.department && s.department !== 'all' && (
                      <span className="text-[10px] font-sans font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)]">
                        {s.department}
                      </span>
                    )}
                  </div>
                  <div className="text-[18px] font-semibold text-[var(--color-foreground)] tabular-nums">
                    ₦{fmt(s.sales_summary?.totalSales || 0)}
                  </div>
                  <div className="text-[12px] font-sans text-[var(--color-muted)] mt-1">
                    {s.sales_summary?.totalTxCount || 0} entries · Closed by {s.closed_by}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
