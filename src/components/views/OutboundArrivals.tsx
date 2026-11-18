import { useState, useEffect, useMemo, useCallback } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useDensity } from '../../lib/useDensity';
import { BackButton } from '../BackButton';
import { Spinner } from '../ui';
import {
  RefreshCw,
  CheckCircle2,
  Search,
  X,
  Download,
  Copy,
  Check,
} from 'lucide-react';
import {
  timeSince,
  formatOutboundSpecs,
  formatAwbDisplay,
  formatDestinationLabel,
  filterOutboundArrivals,
  calculateOutboundMetrics,
  formatOutboundTelemetry,
  generateOutboundCsv,
  OutboundArrivalItem,
  OutboundSourceFilter,
} from '../../lib/outboundLogic';

export const OutboundArrivals = ({ user, onBack }: { user: User; onBack?: () => void }) => {
  const [rows, setRows] = useState<OutboundArrivalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<OutboundSourceFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { isCompact } = useDensity();

  const fetchArrivals = async () => {
    setLoading(true);
    try {
      const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);
      const addHubFilter = (q: any) => (!isAdmin && user.hub_id) ? q.eq('hub_id', user.hub_id) : q;

      const [cargoRes, mktRes, pkgRes] = await Promise.all([
        addHubFilter(
          supabase.from('cargo_entries')
            .select('id, entry_ref, consignee_name, route, awb_tag_number, total_pcs, total_kg, content_type, airline, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
        addHubFilter(
          supabase.from('marketing_entries')
            .select('id, entry_ref, customer_name, route, awb_tag_number, qty_big_bag, qty_med_bag, qty_small_bag, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
        addHubFilter(
          supabase.from('package_entries')
            .select('id, entry_ref, customer_name, destination, content_type, contents, total_pcs, total_kg, hub_id, status, created_at')
            .eq('status', 'Arrived')
        ).order('created_at', { ascending: false }).limit(200),
      ]);

      let errorCount = 0;
      const merged: OutboundArrivalItem[] = [];

      if (cargoRes.error) {
        console.error('Outbound arrivals (cargo) fetch error:', cargoRes.error);
        errorCount++;
      } else {
        for (const c of cargoRes.data || []) {
          merged.push({
            key: `Cargo-${c.id}`,
            source: 'Cargo',
            entryRef: c.entry_ref,
            customerName: c.consignee_name,
            destinationLabel: c.route || '—',
            pcs: c.total_pcs,
            kg: c.total_kg,
            awb: c.awb_tag_number,
            airline: c.airline,
            contentType: c.content_type,
            createdAt: c.created_at,
          });
        }
      }

      if (mktRes.error) {
        console.error('Outbound arrivals (marketing) fetch error:', mktRes.error);
        errorCount++;
      } else {
        for (const m of mktRes.data || []) {
          const bags = (m.qty_big_bag || 0) + (m.qty_med_bag || 0) + (m.qty_small_bag || 0);
          merged.push({
            key: `Legacy-${m.id}`,
            source: 'Legacy',
            entryRef: m.entry_ref,
            customerName: m.customer_name,
            destinationLabel: m.route || '—',
            pcs: bags || undefined,
            awb: m.awb_tag_number,
            createdAt: m.created_at,
          });
        }
      }

      if (pkgRes.error) {
        console.error('Outbound arrivals (package) fetch error:', pkgRes.error);
        errorCount++;
      } else {
        for (const p of pkgRes.data || []) {
          merged.push({
            key: `Package-${p.id}`,
            source: 'Package',
            entryRef: p.entry_ref,
            customerName: p.customer_name,
            destinationLabel: p.destination || '—',
            pcs: p.total_pcs,
            kg: p.total_kg,
            contentType: p.content_type || p.contents,
            createdAt: p.created_at,
          });
        }
      }

      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRows(merged);

      if (errorCount === 3) {
        showToast({ message: 'Failed to load outbound arrivals. Please try again.', type: 'error' });
      } else if (errorCount > 0) {
        showToast({ message: 'Some outbound arrivals failed to load. Showing what succeeded.', type: 'error' });
      }
    } catch (err) {
      console.error('Outbound arrivals fetch error:', err);
      showToast({ message: 'Failed to load outbound arrivals. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArrivals();
  }, [user.hub_id]);

  const filteredRows = useMemo(() => {
    return filterOutboundArrivals(rows, searchQuery, sourceFilter);
  }, [rows, searchQuery, sourceFilter]);

  const totalMetrics = useMemo(() => {
    return calculateOutboundMetrics(rows);
  }, [rows]);

  const filteredMetrics = useMemo(() => {
    return calculateOutboundMetrics(filteredRows);
  }, [filteredRows]);

  const isFiltered = Boolean(searchQuery.trim() || sourceFilter !== 'all');

  const telemetry = useMemo(() => {
    return formatOutboundTelemetry(
      filteredRows.length,
      rows.length,
      isFiltered ? filteredMetrics.totalPieces : totalMetrics.totalPieces,
      isFiltered ? filteredMetrics.totalWeight : totalMetrics.totalWeight,
      isFiltered
    );
  }, [filteredRows.length, rows.length, filteredMetrics, totalMetrics, isFiltered]);

  const handleCopyIdentifier = useCallback((text: string, id: string) => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text);
      }
      setCopiedId(id);
      showToast({ message: `Copied ${text}`, type: 'success' });
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showToast({ message: text, type: 'info' });
    }
  }, [showToast]);

  const handleExportCsv = () => {
    if (filteredRows.length === 0) {
      showToast({ message: 'No confirmed arrivals to export', type: 'info' });
      return;
    }
    try {
      const csv = generateOutboundCsv(filteredRows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const hubSlug = (user.hub || 'hub').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      link.setAttribute('download', `outbound-arrivals-${hubSlug}-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast({ message: `Exported ${filteredRows.length} confirmed arrivals`, type: 'success' });
    } catch (err) {
      console.error('Failed to export CSV:', err);
      showToast({ message: 'Failed to export arrivals CSV', type: 'error' });
    }
  };

  return (
    <div className="flex flex-col min-h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] select-none">
      {/* ── 1. Unified Quiet Header Toolbar (Sticky) ────────────────────── */}
      <header className={`sticky top-0 z-20 border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)]/95 backdrop-blur-md ${isCompact ? 'py-2.5' : 'py-3'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && <BackButton onClick={onBack} />}
            <div className="min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
                Outbound Arrivals
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                Shipments dispatched from{' '}
                <strong className="font-medium text-[var(--color-foreground)]">{user.hub}</strong>
                {' '}confirmed arrived at destination
              </p>
            </div>
          </div>

          {/* Action Toolbar: Search + Refresh + Flat White Pill Primary Action */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
            {/* Search Input with 44px Clear Button */}
            <div className="relative flex-1 sm:w-64 sm:flex-initial">
              <Search
                size={14}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchQuery('');
                    (e.target as HTMLElement).blur();
                  }
                }}
                autoComplete="off"
                spellCheck="false"
                placeholder="Filter outbound arrivals..."
                aria-label="Filter outbound arrivals"
                className="w-full min-h-[44px] h-11 pl-9 pr-11 text-[13px] font-sans rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-0 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={fetchArrivals}
              disabled={loading}
              aria-label="Refresh outbound arrivals"
              className="min-h-[44px] h-11 px-3.5 sm:px-4 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              <RefreshCw size={14} className={`text-[var(--color-muted)] shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Flat White Pill Primary Action Button */}
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={rows.length === 0}
              aria-label="Export confirmed arrivals to CSV"
              className="min-h-[44px] h-11 px-3.5 sm:px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={14} className="shrink-0" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── 2. KPI Summary Telemetry Bar (Sticky) ───────────────────────── */}
      <div className={`sticky top-[57px] sm:top-[69px] z-10 bg-[var(--color-surface-1)]/95 backdrop-blur-md border-b border-[var(--color-border)] px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between text-[12px] font-sans text-[var(--color-muted)] gap-3 shrink-0 ${isCompact ? 'py-2' : 'py-2.5'}`}>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-foreground)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-success)]"></span>
            <span className="tabular-nums font-mono">{telemetry.arrivedText}</span>
          </span>
          <span className="text-[var(--color-border-strong)] hidden sm:inline">·</span>
          <div className="flex items-center gap-1.5">
            <span>{isFiltered ? 'Active:' : 'Total:'}</span>
            <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
              {telemetry.piecesText}
            </span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
              {telemetry.weightText}
            </span>
          </div>
        </div>

        {/* Source Segmented Filters (strict 44px touch targets, mobile scroll-safe) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            type="button"
            onClick={() => setSourceFilter('all')}
            className={`min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              sourceFilter === 'all'
                ? 'bg-[var(--color-foreground)] text-[var(--color-canvas)] font-semibold shadow-xs'
                : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <span>All</span>
            <span className="tabular-nums font-mono text-[12px] opacity-80">({totalMetrics.totalCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('cargo')}
            className={`min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              sourceFilter === 'cargo'
                ? 'bg-[var(--color-foreground)] text-[var(--color-canvas)] font-semibold shadow-xs'
                : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <span>Air Cargo</span>
            <span className="tabular-nums font-mono text-[12px] opacity-80">({totalMetrics.cargoCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceFilter('package')}
            className={`min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              sourceFilter === 'package'
                ? 'bg-[var(--color-foreground)] text-[var(--color-canvas)] font-semibold shadow-xs'
                : 'bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <span>Packages</span>
            <span className="tabular-nums font-mono text-[12px] opacity-80">({totalMetrics.packageCount})</span>
          </button>
        </div>
      </div>

      {/* ── 3. Content Stream (Density Aware) ────────────────────────── */}
      <div className="flex-1">
        <div className={`max-w-7xl mx-auto ${isCompact ? 'p-3 sm:p-4 space-y-2' : 'p-4 sm:p-6 space-y-3.5'}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Spinner size="lg" tone="current" className="text-[var(--color-muted)]" />
              <p className="text-[13px] font-sans text-[var(--color-muted)]">
                Loading outbound arrivals...
              </p>
            </div>
          ) : rows.length === 0 ? (
            /* Empty State: Nothing dispatched has arrived yet */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
                <CheckCircle2 size={22} className="text-[var(--color-muted)]" />
              </div>
              <h3 className="text-[15px] font-sans font-semibold text-[var(--color-foreground)] mb-1">
                No confirmed arrivals yet
              </h3>
              <p className="text-[13px] font-sans text-[var(--color-muted)] max-w-md mb-5">
                Shipments dispatched from{' '}
                <strong className="font-medium text-[var(--color-foreground)]">{user.hub}</strong>
                {' '}will appear here once confirmed arrived at their destination station.
              </p>
              <button
                type="button"
                onClick={fetchArrivals}
                aria-label="Refresh outbound arrivals"
                className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                <span>Refresh list</span>
              </button>
            </div>
          ) : filteredRows.length === 0 ? (
            /* Filter Empty State */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
                <Search size={22} className="text-[var(--color-muted)]" />
              </div>
              <h3 className="text-[15px] font-sans font-semibold text-[var(--color-foreground)] mb-1">
                No matching outbound arrivals
              </h3>
              <p className="text-[13px] font-sans text-[var(--color-muted)] max-w-md mb-5">
                No confirmed arrivals matched your filter. Try adjusting your query or switching categories.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSourceFilter('all');
                }}
                aria-label="Clear filter"
                className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer"
              >
                Clear filter
              </button>
            </div>
          ) : (
            filteredRows.map((r) => {
              const specs = formatOutboundSpecs(r.pcs, r.kg);
              const awbFormatted = formatAwbDisplay(r.awb);
              const destInfo = formatDestinationLabel(r.destinationLabel);
              const isRefCopied = copiedId === `${r.key}-ref`;
              const isAwbCopied = copiedId === `${r.key}-awb`;

              return (
                <div
                  key={r.key}
                  className={`border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)] transition-colors flex flex-col sm:flex-row justify-between items-start sm:items-center ${
                    isCompact ? 'p-3.5 sm:p-4 gap-3' : 'p-4 sm:p-5 gap-4'
                  }`}
                >
                  <div className="space-y-2 min-w-0 flex-1 w-full">
                    {/* Primary Header Row: Customer Name, Source & Airline Badges, and Route/Destination */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-[15px] sm:text-[16px] font-semibold text-[var(--color-foreground)] font-sans tracking-tight truncate">
                          {r.customerName}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]">
                          {r.source === 'Cargo' ? 'Air Cargo' : r.source === 'Package' ? 'Package' : 'Charter'}
                        </span>
                        {r.airline && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                            {r.airline}
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] font-sans font-medium text-[var(--color-foreground)] flex items-center gap-1.5">
                        <span className="text-[var(--color-muted)] text-[12px]">{destInfo.typeLabel}:</span>
                        <span className="truncate">{destInfo.displayText}</span>
                      </div>
                    </div>

                    {/* Identifiers Tier: Tactile 44px Copy Buttons for Entry Ref + AWB Tag */}
                    <div className="flex items-center gap-2 flex-wrap text-[12px] font-sans text-[var(--color-muted)]">
                      {/* Entry Ref with 44px hit target */}
                      <button
                        type="button"
                        onClick={() => handleCopyIdentifier(r.entryRef, `${r.key}-ref`)}
                        title="Click to copy entry reference"
                        aria-label={`Copy entry reference ${r.entryRef}`}
                        className="min-h-[44px] h-11 inline-flex items-center gap-2 px-3.5 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer group"
                      >
                        <span className="text-[11px] font-sans text-[var(--color-muted)]">Ref:</span>
                        <span className="font-mono tabular-nums font-medium text-[13px]">{r.entryRef}</span>
                        {isRefCopied ? (
                          <Check size={14} className="text-[var(--color-success)] shrink-0" />
                        ) : (
                          <Copy size={13} className="text-[var(--color-muted)] opacity-60 group-hover:opacity-100 shrink-0" />
                        )}
                      </button>

                      {/* AWB Tag with 44px hit target if available */}
                      {awbFormatted ? (
                        <button
                          type="button"
                          onClick={() => handleCopyIdentifier(r.awb || '', `${r.key}-awb`)}
                          title="Click to copy AWB tag"
                          aria-label={`Copy AWB tag ${awbFormatted}`}
                          className="min-h-[44px] h-11 inline-flex items-center gap-2 px-3.5 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer group"
                        >
                          <span className="text-[11px] font-sans text-[var(--color-muted)]">AWB:</span>
                          <span className="font-mono tabular-nums font-medium text-[13px]">{awbFormatted}</span>
                          {isAwbCopied ? (
                            <Check size={14} className="text-[var(--color-success)] shrink-0" />
                          ) : (
                            <Copy size={13} className="text-[var(--color-muted)] opacity-60 group-hover:opacity-100 shrink-0" />
                          )}
                        </button>
                      ) : null}
                    </div>

                    {/* Cargo Physical Specs Row: Pieces · Weight · Contents (Zero stutter/repetition) */}
                    <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-muted)] flex-wrap pt-0.5">
                      <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
                        {specs.pcsStr}
                      </span>
                      {r.kg ? (
                        <>
                          <span className="text-[var(--color-border-strong)]">·</span>
                          <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
                            {specs.kgStr}
                          </span>
                        </>
                      ) : null}
                      <span className="text-[var(--color-border-strong)]">·</span>
                      <span className="text-[var(--color-foreground)] font-medium truncate">
                        {r.contentType || 'General Goods'}
                      </span>
                    </div>
                  </div>

                  {/* Status telemetry: High-contrast Arrived badge + relative timestamp */}
                  <div className="shrink-0 flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2 sm:gap-1.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--color-border)]">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[12px] font-sans font-semibold">
                      <CheckCircle2 size={14} className="shrink-0" />
                      <span>Arrived</span>
                    </div>
                    <div className="text-[12px] font-sans text-[var(--color-muted)] tabular-nums">
                      {timeSince(r.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
