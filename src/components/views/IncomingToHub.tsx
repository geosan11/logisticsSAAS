import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import {
  timeSince,
  filterIncomingCargo,
  calculateIncomingMetrics,
  IncomingCargoItem,
} from '../../lib/incomingLogic';

export const IncomingToHub = ({ user, onBack }: { user: User; onBack?: () => void }) => {
  const [cargoList, setCargoList] = useState<IncomingCargoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
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

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] overflow-hidden select-none">
      {/* ── 1. Unified Quiet Header Toolbar ──────────────────────────── */}
      <header className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
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
            {/* Search Input */}
            <div className="relative flex-1 sm:w-60 sm:flex-initial">
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
                className="w-full min-h-[44px] h-11 pl-9 pr-9 text-[13px] font-sans rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
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
              className="min-h-[44px] h-11 px-3.5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
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

      {/* ── 2. KPI Summary Telemetry Bar ─────────────────────────────── */}
      <div className="bg-[var(--color-surface-1)] border-b border-[var(--color-border)] px-4 py-2.5 sm:px-6 flex items-center justify-between text-[12px] font-sans text-[var(--color-muted)] flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-foreground)]">
            <span className="w-2 h-2 rounded-full bg-sky-500"></span>
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

        <div className="text-[11px] text-[var(--color-muted)]">
          Destination: <span className="font-medium text-[var(--color-foreground)]">{user.hub}</span>
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
                <Truck size={24} className="text-[var(--color-muted)] opacity-60" />
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
                  className="min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  <span>Check again</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenScanner}
                  className="min-h-[44px] h-11 px-5 rounded-full text-[13px] font-sans font-semibold bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <QrCode size={14} />
                  <span>Open scanner</span>
                </button>
              </div>
            </div>
          ) : filteredCargo.length === 0 ? (
            /* Search Empty State */
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
              <div className="w-12 h-12 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center mb-3">
                <Search size={22} className="text-[var(--color-muted)] opacity-60" />
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
                className="min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] transition-colors cursor-pointer"
              >
                Clear filter
              </button>
            </div>
          ) : (
            filteredCargo.map((c, i) => (
              <div
                key={c.id || c.entry_ref || i}
                className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-4 sm:p-5 hover:border-[var(--color-border-strong)] transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
              >
                {/* Left Column: Consignee & Shipment Details */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] sm:text-[16px] font-semibold text-[var(--color-foreground)] font-sans break-words">
                      {c.consignee_name || 'Unnamed consignee'}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                      In transit
                    </span>
                  </div>

                  {/* Identifiers: Ref, AWB, Airline */}
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
                  </div>

                  {/* Cargo Breakdown: Route, Pieces, Weight, Content Type */}
                  <div className="text-[13px] font-sans text-[var(--color-text-secondary)] flex items-center gap-2 flex-wrap">
                    <span>{c.route || '—'}</span>
                    <span>·</span>
                    <span>
                      <strong className="font-medium font-mono tabular-nums text-[var(--color-foreground)]">
                        {c.total_pcs || '?'}
                      </strong>{' '}
                      pcs
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="font-medium font-mono tabular-nums text-[var(--color-foreground)]">
                        {c.total_kg || '?'}
                      </strong>{' '}
                      kg
                    </span>
                    <span>·</span>
                    <span>{c.content_type || 'Package'}</span>
                  </div>
                </div>

                {/* Right Column: Dispatch telemetry & 44px Action button */}
                <div className="shrink-0 flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-[var(--color-border)]">
                  <div className="text-[12px] font-sans text-[var(--color-muted)]">
                    Dispatched {timeSince(c.created_at)} ago
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenScanner}
                    className="min-h-[44px] h-11 px-4 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                    title="Open scanner to receive this arrival"
                    aria-label="Scan to receive"
                  >
                    <QrCode size={14} className="text-[var(--color-muted)] shrink-0" />
                    <span>Scan to receive</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
