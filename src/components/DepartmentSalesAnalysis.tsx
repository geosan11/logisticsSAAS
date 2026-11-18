import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, Transaction } from '../lib/types';
import { fmt } from '../lib/helpers';
import { Calendar, Loader2, X, BarChart2 } from 'lucide-react';
import {
  DepartmentSalesAnalysis as DeptAnalysis,
  DepartmentType,
  computeDepartmentSalesAnalysis,
  computeReportDateRange,
  fetchDepartmentSalesTransactions,
} from '../lib/salesAnalysis';
import { fetchAllDebtAndRetrievalEntries, buildShadowRowExclusionCounts, extractPaymentHistoryEvents } from '../lib/debt';

const PRESETS = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'Last 7 days' },
  { id: 'month',     label: 'This month' },
  { id: 'last_month',label: 'Last month' },
  { id: 'quarter',   label: 'This quarter' },
  { id: 'ytd',       label: 'Year to date' },
  { id: 'custom',    label: 'Custom' },
];

// Layer 1 (collective, all agents rolled up) then Layer 2 (per-agent
// detail) -- the big picture before the drill-down. Shared by Reports.tsx's
// admin-facing "X Sales Analysis" report and DepartmentSalesAnalysisModal
// below (each department's own self-serve view), so both render identically.
export const DepartmentSalesAnalysisView = ({ data, deptLabel, routeLabel }: { data: DeptAnalysis; deptLabel: string; routeLabel: string }) => (
  <div className="space-y-4">
    {/* Layer 1 — Collective */}
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-4 space-y-3">
      <div className="text-[12px] text-[var(--color-muted)] font-medium font-sans">
        {deptLabel} · All agents combined
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <div className="text-[11px] text-[var(--color-muted)] font-sans">Total sales</div>
          <div className="text-[16px] font-sans font-bold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.revenue)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-muted)] font-sans">Total collected</div>
          <div className="text-[16px] font-sans font-bold text-[var(--color-success)] tabular-nums">₦{fmt(data.collective.collected)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-muted)] font-sans">Total owed</div>
          <div className={`text-[16px] font-sans font-bold tabular-nums ${data.collective.owed > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>
            ₦{fmt(data.collective.owed)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--color-muted)] font-sans">Agents / Entries</div>
          <div className="text-[16px] font-sans font-bold text-[var(--color-foreground)] tabular-nums">{data.collective.agentCount} / {data.collective.entries}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5 pt-3 border-t border-[var(--color-border)]">
        <div>
          <div className="text-[10px] text-[var(--color-muted)] font-sans">Cash</div>
          <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.cash)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[var(--color-muted)] font-sans">Transfer</div>
          <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.transfer)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[var(--color-muted)] font-sans">POS / Card</div>
          <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.pos)}</div>
        </div>
        {data.collective.transferCash > 0 && (
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans">Transfer→Cash</div>
            <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.transferCash)}</div>
          </div>
        )}
        {data.collective.wallet > 0 && (
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans">Wallet</div>
            <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.wallet)}</div>
          </div>
        )}
        {data.collective.other > 0 && (
          <div>
            <div className="text-[10px] text-[var(--color-muted)] font-sans">Other</div>
            <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(data.collective.other)}</div>
          </div>
        )}
      </div>
    </div>

    {data.agents.length === 0 ? (
      <div className="p-8 text-center bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border)] text-[var(--color-muted)] text-[12px] font-sans">
        No {deptLabel.toLowerCase()} entries in this period.
      </div>
    ) : (
      <div className="space-y-2.5">
        {data.agents.map(s => (
          <div key={s.role} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-3.5 space-y-2.5">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">{s.role}</div>
                <div className="text-[11px] text-[var(--color-muted)] font-sans">{s.entries} {s.entries === 1 ? 'entry' : 'entries'}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-[var(--color-muted)] font-sans">Owed</div>
                <div className={`text-[15px] font-sans font-bold tabular-nums ${s.owed > 0 ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>
                  ₦{fmt(s.owed)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-[var(--color-border)]">
              <div className="flex justify-between">
                <span className="text-[11px] text-[var(--color-muted)] font-sans">Sales value</span>
                <span className="text-[12px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(s.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-[var(--color-muted)] font-sans">Collected</span>
                <span className="text-[12px] font-sans font-semibold text-[var(--color-success)] tabular-nums">₦{fmt(s.collected)}</span>
              </div>
              {s.cash > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Cash</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.cash)}</span>
                </div>
              )}
              {s.transfer > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Transfer</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.transfer)}</span>
                </div>
              )}
              {s.pos > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">POS / Card</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.pos)}</span>
                </div>
              )}
              {s.transferCash > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Transfer→Cash</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.transferCash)}</span>
                </div>
              )}
              {s.wallet > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Wallet</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.wallet)}</span>
                </div>
              )}
              {s.other > 0 && (
                <div className="flex justify-between">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Other</span>
                  <span className="text-[12px] font-sans text-[var(--color-foreground)] tabular-nums">₦{fmt(s.other)}</span>
                </div>
              )}
              {s.topRoute && (
                <div className="flex justify-between col-span-2 pt-1 border-t border-[var(--color-border)]">
                  <span className="text-[11px] text-[var(--color-muted)] font-sans">Top {routeLabel.toLowerCase()}</span>
                  <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">{s.topRoute} ({s.topRouteCount})</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Self-serve entry point for department screens (Cargo/Package) -- lets any agent working that desk pull the same
// collective + per-agent breakdown an admin sees in Reports > "X Sales
// Analysis", without needing access to the Reports screen itself.
export const DepartmentSalesAnalysisModal = ({ user, deptType, deptLabel, routeLabel = 'Route', onClose }: {
  user: User;
  deptType: DepartmentType;
  deptLabel: string;
  routeLabel?: string;
  onClose: () => void;
}) => {
  const [preset, setPreset] = useState('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const dateRange = useMemo(() => computeReportDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    fetchDepartmentSalesTransactions(deptType, user, dateRange)
      .then(data => { if (isMounted) setTxs(data); })
      .catch(err => console.error('Failed to fetch sales analysis', err))
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [deptType, user, dateRange]);

  // Debt-bearing/retrieved entries, unbounded by dateRange -- feeds the
  // payment_history-derived "collected" events below.
  const [debtBearingEntries, setDebtBearingEntries] = useState<Transaction[]>([]);
  useEffect(() => {
    let active = true;
    fetchAllDebtAndRetrievalEntries().then(entries => { if (active) setDebtBearingEntries(entries); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const periodCollectionEvents = useMemo(() => {
    const exclusionCounts = buildShadowRowExclusionCounts(debtBearingEntries);
    const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);
    return extractPaymentHistoryEvents(debtBearingEntries, exclusionCounts).filter(e => {
      if (e.sourceTxType !== deptType) return false;
      if (!isAdmin && user.hub_id && e.sourceHubId && e.sourceHubId !== user.hub_id) return false;
      const at = new Date(e.at);
      return at >= dateRange.from && at <= dateRange.to;
    });
  }, [debtBearingEntries, deptType, dateRange, user]);

  const analysis = useMemo(() => computeDepartmentSalesAnalysis(txs, deptType, periodCollectionEvents), [txs, deptType, periodCollectionEvents]);

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] ehi-scrim flex items-center justify-center sm:p-4 ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className={`bg-[var(--color-surface-card)] border-0 sm:border border-[var(--color-border-strong)] rounded-none sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-xl sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col ${
        isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={16} className="text-[var(--color-muted)]" />
            <h3 className="text-[15px] font-semibold font-sans text-[var(--color-foreground)]">{deptLabel} sales analysis</h3>
          </div>
          <button onClick={handleClose} aria-label="Close" className="min-w-[44px] min-h-[44px] w-11 h-11 -mr-2 flex items-center justify-center hover:bg-[var(--color-surface-hover)] rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer">
            <X size={17} />
          </button>
        </div>

        {/* Period selector */}
        <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-1)] shrink-0 space-y-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[var(--color-muted)]">
            <Calendar size={13} />
            <span>Time period</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-4 gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                className={`min-h-[44px] h-11 px-2.5 py-2 text-[12px] font-sans rounded-xl transition-colors cursor-pointer text-center truncate ${
                  preset === p.id
                    ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)] shadow-xs'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex gap-2 pt-1">
              <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label="Start date" className="min-h-[44px] h-11 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[12px] font-sans flex-1 text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]" />
              <input type="datetime-local" value={customTo}   onChange={e => setCustomTo(e.target.value)} aria-label="End date" className="min-h-[44px] h-11 px-3 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl text-[12px] font-sans flex-1 text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--color-muted)] gap-2">
              <Loader2 size={22} className="animate-spin text-[var(--color-muted)]" />
              <span className="text-[12px] font-sans">Loading sales data…</span>
            </div>
          ) : (
            <DepartmentSalesAnalysisView data={analysis} deptLabel={deptLabel} routeLabel={routeLabel} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
