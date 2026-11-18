import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { User } from '../../lib/types';
import { lagosBusinessDate } from '../../lib/helpers';
import { useToast } from '../../lib/ToastContext';
import { useDensity } from '../../lib/useDensity';
import { EmptyState } from './EmptyState';
import { Modal } from '../Modal';
import { Spinner } from '../ui';
import { getAirportCoordinate } from '../../lib/airportCoordinates';
import { Radar, RefreshCw, Plane, Package2, Search, X, ArrowLeft } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
  FlightStatus,
  BoardEntry,
  CachedStatus,
  BoardFlight,
  NationalFlight,
  effectiveStatus,
  fmtFlightTime,
  fmtFlightDateTime,
  formatDelayMinutes,
  getFlightStatusMeta,
  groupFlights,
  groupNationalFlights,
  timelineStepIndex,
  isStatusInterrupted,
  formatRouteDisplay,
} from '../../lib/flightRadarLogic';

// Leaflet default marker icons fix for Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

async function authedFetch(path: string, init?: RequestInit) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

const TIMELINE_STEPS: { key: FlightStatus; label: string }[] = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'boarding', label: 'Boarding' },
  { key: 'departed', label: 'Departed' },
  { key: 'landed', label: 'Landed' },
];

function FlightStatusBadge({ status }: { status: FlightStatus | string }) {
  const meta = getFlightStatusMeta(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-sans font-medium whitespace-nowrap shrink-0 ${meta.bgClass} ${meta.borderClass} ${meta.textClass}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
      <span>{meta.label}</span>
    </span>
  );
}

function FlightTimeline({ status }: { status: FlightStatus }) {
  const interrupted = isStatusInterrupted(status);
  const meta = getFlightStatusMeta(status);
  const stepIndex = timelineStepIndex(status);
  const known = status !== 'unknown';

  return (
    <div className="space-y-3">
      {interrupted && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-sans font-medium ${meta.bgClass} ${meta.borderClass} ${meta.textClass}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
          <span>{meta.label}</span>
        </div>
      )}
      <div className="flex items-center pt-1">
        {TIMELINE_STEPS.map((step, i) => {
          const isReached = known && i <= stepIndex;
          const isCurrent = known && i === stepIndex;
          const dotColorClass = interrupted
            ? meta.dotClass
            : isReached
            ? 'bg-emerald-500'
            : 'bg-zinc-300 dark:bg-zinc-700';

          return (
            <div key={step.key} className={`flex items-center ${i < TIMELINE_STEPS.length - 1 ? 'flex-1' : 'shrink-0'}`}>
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                  isCurrent
                    ? 'ring-2 ring-white/20 dark:ring-white/30 ' + (interrupted ? meta.borderClass : 'border-emerald-500')
                    : isReached
                    ? 'border-transparent'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
                }`}
              >
                {isReached && !isCurrent && (
                  <span className={`w-full h-full rounded-full flex items-center justify-center text-white text-[10px] font-bold ${dotColorClass}`}>
                    ✓
                  </span>
                )}
                {isCurrent && (
                  <div className={`w-2.5 h-2.5 rounded-full ${dotColorClass}`} />
                )}
                {!isReached && (
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                )}
              </div>
              {i < TIMELINE_STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-1 transition-colors ${
                    i < stepIndex
                      ? interrupted
                        ? meta.dotClass
                        : 'bg-emerald-500'
                      : 'bg-zinc-200 dark:bg-zinc-800'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] font-sans">
        {TIMELINE_STEPS.map((step, i) => (
          <div
            key={step.key}
            className={`text-center flex-1 ${
              i === stepIndex
                ? interrupted
                  ? meta.textClass + ' font-semibold'
                  : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                : 'text-[var(--color-muted)] font-normal'
            }`}
          >
            {step.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlightRouteMap({
  departureIata,
  arrivalIata,
  status,
}: {
  departureIata: string | null;
  arrivalIata: string | null;
  status: FlightStatus;
}) {
  const origin = getAirportCoordinate(departureIata);
  const dest = getAirportCoordinate(arrivalIata);
  if (!origin || !dest) return null;

  const bounds: [number, number][] = [
    [origin.lat, origin.lng],
    [dest.lat, dest.lng],
  ];

  const lineColor = status === 'landed' ? '#22c55e' : isStatusInterrupted(status) ? '#ef4444' : '#38bdf8';

  return (
    <div className="h-44 rounded-xl overflow-hidden border border-[var(--color-border)]">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [28, 28] }}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Polyline positions={bounds} color={lineColor} weight={3} opacity={0.85} dashArray="6 6" />
        <Marker position={[origin.lat, origin.lng]}>
          <Popup>
            <div className="text-[12px] font-bold font-sans">{departureIata}</div>
            <div className="text-[10px] text-zinc-500">{origin.name}</div>
          </Popup>
        </Marker>
        <Marker position={[dest.lat, dest.lng]}>
          <Popup>
            <div className="text-[12px] font-bold font-sans">{arrivalIata}</div>
            <div className="text-[10px] text-zinc-500">{dest.name}</div>
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}

function FlightCard({
  flight,
  onOpen,
  isCompact,
}: {
  flight: BoardFlight;
  onOpen: () => void;
  isCompact: boolean;
}) {
  const es = effectiveStatus(flight.status);
  const delayStr = formatDelayMinutes(flight.status?.delay_minutes);
  const routeStr = formatRouteDisplay(flight.route);

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-hover)] transition-all min-h-[44px] flex items-center gap-3.5 sm:gap-4 ${
        isCompact ? 'p-3 sm:p-3.5' : 'p-4 sm:p-4.5'
      }`}
    >
      <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] flex items-center justify-center shrink-0">
        <Plane size={18} className="text-[var(--color-muted)]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] sm:text-[15px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight">
            {flight.flightNumber}
          </span>
          {flight.airline && (
            <span className="text-[13px] font-sans font-normal text-[var(--color-muted)]">
              {flight.airline}
            </span>
          )}
        </div>

        <div className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5 flex items-center gap-2 flex-wrap tabular-nums">
          {routeStr && <span>{routeStr}</span>}
          <span>· {flight.entries.length} {flight.entries.length === 1 ? 'shipment' : 'shipments'}</span>
          {flight.status?.scheduled_departure && (
            <span>· {fmtFlightDateTime(flight.status.scheduled_departure)}</span>
          )}
          {delayStr && (
            <span className="text-amber-600 dark:text-amber-400 font-medium">· {delayStr}</span>
          )}
        </div>
      </div>

      <FlightStatusBadge status={es} />
    </button>
  );
}

function NationalFlightCard({
  flight,
  onOpen,
  isCompact,
}: {
  flight: NationalFlight;
  onOpen: () => void;
  isCompact: boolean;
}) {
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-hover)] transition-all min-h-[44px] flex items-center gap-3.5 sm:gap-4 ${
        isCompact ? 'p-3 sm:p-3.5' : 'p-4 sm:p-4.5'
      }`}
    >
      <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] flex items-center justify-center shrink-0">
        <Plane size={18} className="text-[var(--color-muted)]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] sm:text-[15px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight">
            {flight.flightNumber || '—'}
          </span>
          {flight.airline && (
            <span className="text-[13px] font-sans font-normal text-[var(--color-muted)]">
              {flight.airline}
            </span>
          )}
        </div>

        <div className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5 flex items-center gap-2 flex-wrap tabular-nums">
          <span>{flight.originIata} → {flight.destinationIata || '?'}</span>
          {flight.scheduledDeparture && (
            <span>· {fmtFlightDateTime(flight.scheduledDeparture)}</span>
          )}
        </div>
      </div>

      <FlightStatusBadge status={flight.status} />
    </button>
  );
}

export const FlightRadar = ({ user, onBack }: { user: User; onBack: () => void }) => {
  const { isCompact } = useDensity();
  const [date, setDate] = useState(lagosBusinessDate());
  const [tab, setTab] = useState<'mine' | 'national'>('mine');
  const [flights, setFlights] = useState<BoardFlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BoardFlight | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();
  const canRefreshNational = user.role === 'super_admin' || user.role === 'admin';
  const [search, setSearch] = useState('');

  const [nationalFlights, setNationalFlights] = useState<NationalFlight[]>([]);
  const [nationalLoading, setNationalLoading] = useState(false);
  const [nationalCoverage, setNationalCoverage] = useState<{ total: number; cached: number } | null>(null);
  const [nationalRefreshing, setNationalRefreshing] = useState(false);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const body = await authedFetch(`/api/flight-radar/board?date=${encodeURIComponent(date)}`);
      setFlights(body.flights || []);
    } catch (err: any) {
      showToast({ message: `Failed to load Flight Radar: ${err.message}`, type: 'error' });
    }
    setLoading(false);
  }, [date, showToast]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const fetchNationalBoard = useCallback(async () => {
    setNationalLoading(true);
    try {
      const body = await authedFetch(`/api/flight-radar/national-board?date=${encodeURIComponent(date)}`);
      setNationalFlights(body.flights || []);
      setNationalCoverage({ total: body.airportsTotal || 0, cached: body.airportsCached || 0 });
    } catch (err: any) {
      showToast({ message: `Failed to load Nigeria Today: ${err.message}`, type: 'error' });
    }
    setNationalLoading(false);
  }, [date, showToast]);

  useEffect(() => {
    if (tab === 'national') fetchNationalBoard();
  }, [tab, fetchNationalBoard]);

  const refreshAllAirports = async () => {
    setNationalRefreshing(true);
    try {
      await authedFetch('/api/flight-radar/national-board/refresh', {
        method: 'POST',
        body: JSON.stringify({ date }),
      });
      await fetchNationalBoard();
      showToast({ message: 'All airports refreshed.', type: 'success' });
    } catch (err: any) {
      showToast({ message: `Refresh failed: ${err.message}`, type: 'error' });
    }
    setNationalRefreshing(false);
  };

  const openFlight = async (flight: BoardFlight) => {
    setSelected(flight);
    setDetailLoading(true);
    try {
      const status = await authedFetch(
        `/api/flight-radar/status?flightNumber=${encodeURIComponent(flight.flightNumber)}&date=${encodeURIComponent(date)}`
      );
      setSelected(prev => (prev && prev.flightNumber === flight.flightNumber ? { ...prev, status } : prev));
      setFlights(prev => prev.map(f => (f.flightNumber === flight.flightNumber ? { ...f, status } : f)));
    } catch (err: any) {
      showToast({ message: `Couldn't fetch live status: ${err.message}`, type: 'warning' });
    }
    setDetailLoading(false);
  };

  const openNationalFlight = (nf: NationalFlight) => {
    if (!nf.flightNumber) return;
    openFlight({
      flightNumber: nf.flightNumber,
      airline: nf.airline,
      route: nf.destinationIata ? `${nf.originIata} → ${nf.destinationIata}` : nf.originIata,
      entries: [],
      status: null,
    });
  };

  const refreshSelected = async () => {
    if (!selected) return;
    setRefreshing(true);
    try {
      const status = await authedFetch('/api/flight-radar/refresh', {
        method: 'POST',
        body: JSON.stringify({ flightNumber: selected.flightNumber, date }),
      });
      setSelected(prev => (prev ? { ...prev, status } : prev));
      setFlights(prev => prev.map(f => (f.flightNumber === selected.flightNumber ? { ...f, status } : f)));
      showToast({ message: 'Flight status refreshed.', type: 'success' });
    } catch (err: any) {
      showToast({ message: `Refresh failed: ${err.message}`, type: 'error' });
    }
    setRefreshing(false);
  };

  const groups = groupFlights(flights, search);
  const nationalGroups = groupNationalFlights(nationalFlights, search);

  const selectedStatus = effectiveStatus(selected?.status);

  return (
    <div className="flex flex-col h-full bg-[var(--color-canvas)] text-[var(--color-foreground)] overflow-hidden">
      {/* Top Header & Quiet Toolbar */}
      <header className={`border-b border-[var(--color-border)] px-4 sm:px-6 shrink-0 bg-[var(--color-canvas)] ${isCompact ? 'py-2.5' : 'py-3'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                aria-label="Back"
                className="min-h-[44px] min-w-[44px] h-11 w-11 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center justify-center transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <h1 className="text-lg sm:text-xl font-bold font-sans tracking-tight text-[var(--color-foreground)]">
                Flight Radar
              </h1>
              <p className="text-[12px] font-sans text-[var(--color-muted)]">
                Real-time commercial flight telemetry and cargo tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="Select date"
              className="min-h-[44px] h-11 px-3.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[13px] font-sans text-[var(--color-foreground)] tabular-nums focus:outline-none focus:ring-1 focus:ring-white/20"
            />
            <button
              onClick={tab === 'mine' ? fetchBoard : fetchNationalBoard}
              aria-label="Refresh flights"
              title="Refresh flights"
              className="min-h-[44px] min-w-[44px] h-11 w-11 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] flex items-center justify-center transition-colors"
            >
              <RefreshCw
                size={15}
                className={(tab === 'mine' ? loading : nationalLoading) ? 'animate-spin' : ''}
              />
            </button>
          </div>
        </div>
      </header>

      {/* Sub-bar: Segmented Tabs & Instant Search */}
      <div className={`bg-[var(--color-surface-1)] border-b border-[var(--color-border)] px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0 ${isCompact ? 'py-2' : 'py-2.5'}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-h-[44px] p-1 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] inline-flex items-center gap-1 shrink-0">
            <button
              onClick={() => setTab('mine')}
              className={`min-h-[38px] px-4 rounded-full text-[13px] font-sans font-medium transition-colors ${
                tab === 'mine'
                  ? 'bg-white text-black dark:bg-white dark:text-black shadow-xs font-semibold'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              My shipments
            </button>
            <button
              onClick={() => setTab('national')}
              className={`min-h-[38px] px-4 rounded-full text-[13px] font-sans font-medium transition-colors ${
                tab === 'national'
                  ? 'bg-white text-black dark:bg-white dark:text-black shadow-xs font-semibold'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
              }`}
            >
              Nigeria today
            </button>
          </div>

          {tab === 'national' && nationalCoverage && (
            <span className="text-[12px] font-sans text-[var(--color-muted)] tabular-nums">
              {nationalCoverage.cached} of {nationalCoverage.total} airports cached
            </span>
          )}

          {tab === 'national' && canRefreshNational && (
            <button
              onClick={refreshAllAirports}
              disabled={nationalRefreshing}
              className="min-h-[44px] h-11 px-4 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[12px] font-sans font-medium text-[var(--color-foreground)] flex items-center gap-2 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} className={nationalRefreshing ? 'animate-spin' : ''} />
              <span>{nationalRefreshing ? 'Refreshing…' : 'Refresh all airports'}</span>
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 md:max-w-xs min-w-[200px]">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search flights or airlines..."
            className="w-full min-h-[44px] h-11 pl-10 pr-9 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[13px] font-sans text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-white/20"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {tab === 'mine' ? (
        <div className={`flex-1 overflow-y-auto ${isCompact ? 'p-3 sm:p-4 space-y-4' : 'p-4 sm:p-6 space-y-5'}`}>
          <div className="max-w-5xl mx-auto space-y-5">
            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner size={24} />
              </div>
            ) : flights.length === 0 ? (
              <EmptyState
                icon={<Radar size={36} strokeWidth={1.5} />}
                title="No flights tracked for this date"
                subtext="Add a flight number to an air cargo entry to start tracking it here."
                actions={[
                  {
                    label: 'New cargo entry',
                    onClick: () => window.dispatchEvent(new CustomEvent('ehi-nav', { detail: 'Cargo' })),
                  },
                ]}
              />
            ) : groups.every(g => g.items.length === 0) ? (
              <EmptyState
                icon={<Search size={36} strokeWidth={1.5} />}
                title="No matching flights"
                subtext={`Nothing matches "${search}" for this date.`}
                actions={[{ label: 'Clear search', onClick: () => setSearch('') }]}
              />
            ) : (
              groups
                .filter(g => g.items.length > 0)
                .map(g => (
                  <div key={g.id}>
                    <div className="text-[13px] font-sans font-semibold text-[var(--color-muted)] flex items-center gap-2 mb-2.5">
                      <span>{g.title}</span>
                      <span className="text-[12px] font-normal opacity-70 tabular-nums">({g.items.length})</span>
                    </div>
                    <div className="space-y-2.5">
                      {g.items.map(f => (
                        <FlightCard
                          key={f.flightNumber}
                          flight={f}
                          onOpen={() => openFlight(f)}
                          isCompact={isCompact}
                        />
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto ${isCompact ? 'p-3 sm:p-4 space-y-4' : 'p-4 sm:p-6 space-y-5'}`}>
          <div className="max-w-5xl mx-auto space-y-5">
            {nationalLoading ? (
              <div className="flex justify-center py-16">
                <Spinner size={24} />
              </div>
            ) : nationalFlights.length === 0 ? (
              <EmptyState
                icon={<Radar size={36} strokeWidth={1.5} />}
                title="No cached flights yet"
                subtext={
                  canRefreshNational
                    ? "Nothing has been fetched for these airports today. Tap 'Refresh all airports' above."
                    : "Nothing has been fetched for these airports yet today. Check back later or ask an administrator."
                }
              />
            ) : nationalGroups.every(g => g.items.length === 0) ? (
              <EmptyState
                icon={<Search size={36} strokeWidth={1.5} />}
                title="No matching flights"
                subtext={`Nothing matches "${search}" for this date.`}
                actions={[{ label: 'Clear search', onClick: () => setSearch('') }]}
              />
            ) : (
              nationalGroups
                .filter(g => g.items.length > 0)
                .map(g => (
                  <div key={g.id}>
                    <div className="text-[13px] font-sans font-semibold text-[var(--color-muted)] flex items-center gap-2 mb-2.5">
                      <span>{g.title}</span>
                      <span className="text-[12px] font-normal opacity-70 tabular-nums">({g.items.length})</span>
                    </div>
                    <div className="space-y-2.5">
                      {g.items.map((f, i) => (
                        <NationalFlightCard
                          key={`${f.flightNumber}-${f.originIata}-${i}`}
                          flight={f}
                          onOpen={() => openNationalFlight(f)}
                          isCompact={isCompact}
                        />
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* Flight Detail Modal (Portal rendered via Modal component) */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)}>
        {selected && (
          <div className="flex flex-col max-h-[85vh] text-[var(--color-foreground)] font-sans">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[var(--color-border)] flex justify-between items-center shrink-0">
              <div>
                <div className="text-base sm:text-lg font-bold font-sans tracking-tight text-[var(--color-foreground)]">
                  {selected.flightNumber}
                </div>
                {selected.airline && (
                  <div className="text-[13px] font-sans text-[var(--color-muted)] mt-0.5">
                    {selected.airline}
                  </div>
                )}
              </div>
              <FlightStatusBadge status={selectedStatus} />
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {detailLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner size={22} />
                </div>
              ) : (
                <>
                  <FlightTimeline status={selectedStatus} />

                  {/* Departure & Arrival Card */}
                  <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-sans text-[var(--color-muted)] font-medium">
                          Departure
                        </div>
                        <div className="text-xl sm:text-2xl font-bold font-sans text-[var(--color-foreground)] mt-0.5">
                          {selected.status?.departure_airport || '—'}
                        </div>
                      </div>

                      <div className="flex-1 flex items-center justify-center px-3 relative">
                        <div className="w-full h-px bg-[var(--color-border-strong)]" />
                        <div className="absolute bg-[var(--color-surface-1)] px-2">
                          <Plane size={15} className="text-[var(--color-muted)] rotate-90" />
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[11px] font-sans text-[var(--color-muted)] font-medium">
                          Arrival
                        </div>
                        <div className="text-xl sm:text-2xl font-bold font-sans text-[var(--color-foreground)] mt-0.5">
                          {selected.status?.arrival_airport || '—'}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[12px] font-sans text-[var(--color-muted)] mt-3 pt-3 border-t border-[var(--color-border)] tabular-nums">
                      <div>
                        Sched {fmtFlightTime(selected.status?.scheduled_departure)}
                        {selected.status?.actual_departure && (
                          <span className="ml-1.5 font-medium text-[var(--color-foreground)]">
                            · Actual {fmtFlightTime(selected.status.actual_departure)}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        Sched {fmtFlightTime(selected.status?.scheduled_arrival)}
                        {selected.status?.actual_arrival && (
                          <span className="ml-1.5 font-medium text-[var(--color-foreground)]">
                            · Actual {fmtFlightTime(selected.status.actual_arrival)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Interactive Leaflet Map */}
                  <FlightRouteMap
                    departureIata={selected.status?.departure_airport ?? null}
                    arrivalIata={selected.status?.arrival_airport ?? null}
                    status={selectedStatus}
                  />

                  {selectedStatus === 'unknown' && (
                    <div className="text-[12px] font-sans text-[var(--color-muted)] italic">
                      No live data yet for this flight on this date. Verify the flight number or tap Refresh.
                    </div>
                  )}

                  {/* Shipments on this flight */}
                  {selected.entries && selected.entries.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[12px] font-sans font-semibold text-[var(--color-muted)]">
                        Shipments on this flight ({selected.entries.length})
                      </div>
                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] divide-y divide-[var(--color-border)] overflow-hidden">
                        {selected.entries.map(e => (
                          <div key={e.id} className="p-3 flex items-center justify-between text-[13px] font-sans gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Package2 size={14} className="text-[var(--color-muted)] shrink-0" />
                              <span className="font-semibold text-[var(--color-foreground)] truncate">
                                {e.awb || e.id}
                              </span>
                            </div>
                            {e.name && (
                              <span className="text-[12px] text-[var(--color-muted)] truncate text-right">
                                {e.name}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer: Grok Flat White Pill Button */}
            <div className="p-4 sm:p-5 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-surface-1)]">
              <button
                onClick={refreshSelected}
                disabled={refreshing}
                className="w-full min-h-[44px] h-11 rounded-full bg-white text-black dark:bg-white dark:text-black font-semibold text-[13px] font-sans hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-xs disabled:opacity-50"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                <span>{refreshing ? 'Refreshing…' : 'Refresh live status'}</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
