import { useState, useEffect, useMemo, useCallback } from 'react';
import { User } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../lib/ToastContext';
import { useDensity } from '../../lib/useDensity';
import { BackButton } from '../BackButton';
import { Spinner } from '../ui';
import {
  Truck,
  RefreshCw,
  Search,
  X,
  QrCode,
  Copy,
  Check,
} from 'lucide-react';
import {
  timeSince,
  filterIncomingCargo,
  calculateIncomingMetrics,
  formatCargoSpecs,
  formatRouteDisplay,
  IncomingCargoItem,
} from '../../lib/incomingLogic';

export const IncomingToHub = ({ user, onBack }: { user: User; onBack?: () => void }) => {
  const [cargoList, setCargoList] = useState<IncomingCargoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { showToast } = useToast();
  const { isCompact } = useDensity();

  const fetchIncoming = async () => {
    setLoading(true);
    try {
      const isAdmin = ['super_admin', 'admin', 'accountant', 'auditor'].includes(user.role);

      let q = supabase
        .from('cargo_entries')
        .select('entry_ref, id, consignee_name, route, total_pcs, total_kg, content_type, airline, awb_tag_number, created_at, status')
        .eq('status', 'In-Transit');

      // route is free text (e.g. "Lagos", "Abuja - Zone 2"), not a hub_id
      // foreign key, so there's no clean .eq() to scope this by destination.
      // Applying the same fuzzy-word-match used in scanLogic.ts's
      // isCorrectDestination check server-side via ilike, instead of
      // fetching every in-transit row company-wide and filtering client-side
      // -- that pattern leaked full cross-hub cargo details (consignee
      // names, AWB numbers, routes) in the raw network response, same class
      // of issue as the SupportTickets fix. Admin-tier roles still see
      // everything, matching how the rest of the app scopes visibility.
      if (!isAdmin) {
        const hubWords = user.hub.toLowerCase().split(' ').filter(w => w.length >= 3);
        if (hubWords.length > 0) {
          q = q.or(hubWords.map(w => `route.ilike.%${w}%`).join(','));
        }
      }

      const { data, error } = await q.order('created_at', { ascending: false }).limit(200);

      if (error) {
        console.error('Incoming fetch error:', error);
        showToast({ message: 'Failed to load incoming cargo. Please try again.', type: 'error' });
        return;
      }

      // Belt-and-suspenders: keep the client-side match as a final check too,
      // since ilike is a broader net than the exact substring check below,
      // and this costs nothing now that the server-side query already did
      // the heavy lifting of not shipping cross-hub data over the wire.
      const hubWords = user.hub.toLowerCase().split(' ').filter(w => w.length >= 3);
      const filtered = isAdmin ? (data || []) : (data || []).filter(c => {
        const dest = (c.route || '').toLowerCase();
        return hubWords.some(w => dest.includes(w));
      });

      setCargoList(filtered);
    } catch (err) {
      console.error('Incoming fetch error:', err);
      showToast({ message: 'Failed to load incoming cargo. Please try again.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncoming();
  }, [user.hub]);

  const filteredCargo = useMemo(() => {
    return filterIncomingCargo(cargoList, searchQuery);
  }, [cargoList, searchQuery]);

  const metrics = useMemo(() => {
    return calculateIncomingMetrics(cargoList);
  }, [cargoList]);

  const handleOpenScanner = () => {
    window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'Scan' }));
  };

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

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] overflow-hidden select-none">
      {/* ── 1. Unified Quiet Header Toolbar ──────────────────────────── */}
      <header className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6 shrink-0 bg-[var(--color-canvas)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && <BackButton onClick={onBack} />}
            <div className="min-w-0">
              <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight truncate">
                Incoming to Hub
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                Cargo departed elsewhere heading to{' '}
                <strong className="font-medium text-[var(--color-foreground)]">{user.hub}</strong>
                {' '}— not yet scanned as arrived
              </p>
            </div>
          </div>

          {/* Action Toolbar: Search + Refresh + Scan Primary Pill */}
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
                placeholder="Filter incoming cargo..."
                aria-label="Filter incoming cargo"
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
              onClick={fetchIncoming}
              disabled={loading}
              aria-label="Refresh incoming cargo"
              className="min-h-[44px] h-11 px-3.5 sm:px-4 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
            >
              <RefreshCw size={14} className={`text-[var(--color-muted)] shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Flat White Pill Primary Action Button */}
            <button
              type="button"
              onClick={handleOpenScanner}
              aria-label="Open scanner to receive arrivals"
              className="min-h-[44px] h-11 px-4 sm:px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <QrCode size={15} className="shrink-0" />
              <span>Scan arrivals</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── 2. KPI Summary Telemetry Bar (No Duplication) ─────────────── */}
      <div className="bg-[var(--color-surface-1)] border-b border-[var(--color-border)] px-4 py-2.5 sm:px-6 flex items-center justify-between text-[12px] font-sans text-[var(--color-muted)] flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-foreground)]">
            <span className="w-2 h-2 rounded-full bg-[var(--color-info)]"></span>
            <span className="tabular-nums font-mono">{filteredCargo.length}</span>
            {searchQuery ? `of ${cargoList.length} in transit` : 'in transit'}
          </span>
          <span className="text-[var(--color-border-strong)] hidden sm:inline">·</span>
          <span>
            Total pieces:{' '}
            <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
              {metrics.totalPieces.toLocaleString()}
            </span>{' '}
            pcs
          </span>
          <span className="text-[var(--color-border-strong)] hidden sm:inline">·</span>
          <span>
            Total weight:{' '}
            <span className="tabular-nums font-mono font-medium text-[var(--color-foreground)]">
              {metrics.totalWeight.toLocaleString()}
            </span>{' '}
            kg
          </span>
        </div>

        <div className="text-[11px] text-[var(--color-muted)] flex items-center gap-1.5">
          <span>Live feed</span>
        </div>
      </div>

      {/* ── 3. Cargo Content Stream (Density Aware) ──────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className={`max-w-7xl mx-auto ${isCompact ? 'p-3 sm:p-4 space-y-2.5' : 'p-4 sm:p-6 space-y-3.5'}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Spinner size="lg" tone="current" className="text-[var(--color-muted)]" />
              <p className="text-[13px] font-sans text-[var(--color-muted)]">
                Loading incoming cargo...
              </p>
            </div>
          ) : cargoList.length === 0 ? (
            /* Empty State: No cargo in transit to this hub */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
                <Truck size={22} className="text-[var(--color-muted)]" />
              </div>
              <h3 className="text-[15px] font-sans font-semibold text-[var(--color-foreground)] mb-1">
                No cargo in transit
              </h3>
              <p className="text-[13px] font-sans text-[var(--color-muted)] max-w-md mb-5">
                All incoming shipments destined for{' '}
                <strong className="font-medium text-[var(--color-foreground)]">{user.hub}</strong>
                {' '}have been received and processed. New departures from sibling hubs will appear here automatically.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchIncoming}
                  aria-label="Refresh cargo list"
                  className="min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenScanner}
                  aria-label="Scan arrivals"
                  className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <QrCode size={14} />
                  <span>Scan arrivals</span>
                </button>
              </div>
            </div>
          ) : filteredCargo.length === 0 ? (
            /* Search Empty State */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
                <Search size={22} className="text-[var(--color-muted)]" />
              </div>
              <h3 className="text-[15px] font-sans font-semibold text-[var(--color-foreground)] mb-1">
                No matching shipments
              </h3>
              <p className="text-[13px] font-sans text-[var(--color-muted)] max-w-sm mb-4">
                No incoming shipments match &ldquo;{searchQuery}&rdquo;. Try filtering by consignee, AWB tag, or route.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear filter"
                className="min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer"
              >
                Clear filter
              </button>
            </div>
          ) : (
            filteredCargo.map((c, i) => {
              const itemKey = String(c.id || c.entry_ref || i);
              const { pcsStr, kgStr } = formatCargoSpecs(c.total_pcs, c.total_kg);
              const routeStr = formatRouteDisplay(c.route);

              return (
                <div
                  key={itemKey}
                  className={`bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl hover:border-[var(--color-border-strong)] transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                    isCompact ? 'p-3.5 sm:p-4' : 'p-4 sm:p-5'
                  }`}
                >
                  {/* Left Column: Consignee & Shipment Details */}
                  <div className="space-y-1.5 min-w-0 flex-1 w-full">
                    {/* Consignee Name & Dispatch Age */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[15px] sm:text-[16px] font-semibold text-[var(--color-foreground)] font-sans break-words">
                        {c.consignee_name || 'Unnamed consignee'}
                      </span>
                      <span className="text-[11px] font-sans font-medium text-[var(--color-muted)] bg-[var(--color-surface-2)] border border-[var(--color-border)] px-2.5 py-0.5 rounded-full shrink-0">
                        Dispatched {timeSince(c.created_at)} ago
                      </span>
                    </div>

                    {/* Identifiers: Ref, AWB, Airline + Quick Copy Action */}
                    <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-muted)] flex-wrap">
                      <span className="font-mono tabular-nums font-semibold text-[var(--color-foreground)]">
                        {c.entry_ref || c.id}
                      </span>
                      {c.awb_tag_number && (
                        <span>
                          · AWB{' '}
                          <span className="font-mono tabular-nums text-[var(--color-foreground)]">
                            {c.awb_tag_number}
                          </span>
                        </span>
                      )}
                      {c.airline && <span>· {c.airline}</span>}

                      {/* 44px Quick Copy Action */}
                      <button
                        type="button"
                        onClick={() => handleCopyIdentifier(c.awb_tag_number || c.entry_ref || c.id || '', itemKey)}
                        aria-label="Copy shipment reference"
                        title="Copy reference or AWB tag"
                        className="min-h-[44px] min-w-[44px] -my-2 -ml-1 p-2 rounded-full inline-flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                      >
                        {copiedId === itemKey ? (
                          <Check size={13} className="text-[var(--color-success)]" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>

                    {/* Physical Cargo Breakdown: Pieces, Weight, Route, Content */}
                    <div className="text-[13px] font-sans text-[var(--color-text-secondary)] flex items-center gap-2 flex-wrap pt-0.5">
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums font-medium text-[var(--color-foreground)]">
                        {pcsStr}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums font-medium text-[var(--color-foreground)]">
                        {kgStr}
                      </span>
                      <span>·</span>
                      <span>{routeStr}</span>
                      <span>·</span>
                      <span className="text-[var(--color-muted)]">{c.content_type || 'General cargo'}</span>
                    </div>
                  </div>

                  {/* Right Column: 44px Primary Action Button */}
                  <div className="shrink-0 flex items-center justify-end w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 border-[var(--color-border)]">
                    <button
                      type="button"
                      onClick={handleOpenScanner}
                      aria-label="Scan arrivals"
                      className="min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer w-full md:w-auto justify-center shrink-0"
                      title="Open scanner to receive arrivals"
                    >
                      <QrCode size={14} className="text-[var(--color-muted)] shrink-0" />
                      <span>Scan arrivals</span>
                    </button>
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
