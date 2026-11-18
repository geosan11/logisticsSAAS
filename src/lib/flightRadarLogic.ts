/**
 * Pure business logic and formatting helpers for Flight Radar (Grok UI).
 * Decouples presentation from flight status calculations, grouping, search, and formatting.
 */

import { lagosBusinessDate } from './helpers';

export type FlightStatus =
  | 'scheduled'
  | 'boarding'
  | 'departed'
  | 'delayed'
  | 'diverted'
  | 'returned'
  | 'cancelled'
  | 'landed'
  | 'unknown';

export interface BoardEntry {
  type: string;
  id: string;
  awb?: string;
  name?: string;
}

export interface CachedStatus {
  status: string;
  scheduled_departure: string | null;
  actual_departure: string | null;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  delay_minutes: number | null;
  departure_airport: string | null;
  arrival_airport: string | null;
  diverted_airport: string | null;
  fetched_at?: string;
}

export interface BoardFlight {
  flightNumber: string;
  airline: string | null;
  route: string | null;
  entries: BoardEntry[];
  status: CachedStatus | null;
}

export interface NationalFlight {
  flightNumber: string | null;
  airline: string | null;
  destinationIata: string | null;
  originIata: string;
  scheduledDeparture: string | null;
  status: string;
}

/**
 * Status categories for attention vs en route.
 */
export const ATTENTION_STATUSES: FlightStatus[] = ['cancelled', 'returned', 'diverted', 'delayed'];
export const ENROUTE_STATUSES: FlightStatus[] = ['departed', 'boarding'];

/**
 * Determines effective status, mapping flights diverted back to departure airport to 'returned'.
 */
export function effectiveStatus(s: CachedStatus | null | undefined): FlightStatus {
  if (!s || !s.status) return 'unknown';
  const raw = s.status.toLowerCase().trim();
  if (
    raw === 'diverted' &&
    s.diverted_airport &&
    s.departure_airport &&
    s.diverted_airport.toUpperCase() === s.departure_airport.toUpperCase()
  ) {
    return 'returned';
  }
  const validStatuses: FlightStatus[] = [
    'scheduled',
    'boarding',
    'departed',
    'delayed',
    'diverted',
    'returned',
    'cancelled',
    'landed',
  ];
  return validStatuses.includes(raw as FlightStatus) ? (raw as FlightStatus) : 'unknown';
}

/**
 * Normalizes search tokens by stripping non-alphanumeric characters.
 */
export function normalizeSearchToken(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches a search query against flight number, airline name, optional route, and optional entries.
 * Supports multi-token searches where every token must match across flight attributes.
 */
export function matchesFlightSearch(
  query: string,
  flightNumber: string | null | undefined,
  airline: string | null | undefined,
  route?: string | null | undefined,
  entries?: BoardEntry[] | null | undefined
): boolean {
  if (!query || !query.trim()) return true;
  const rawTokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return true;

  const fn = (flightNumber || '').toLowerCase();
  const al = (airline || '').toLowerCase();
  const rt = (route || '').toLowerCase();
  const entStr = (entries || [])
    .map(e => `${e.awb || ''} ${e.id || ''} ${e.name || ''}`)
    .join(' ')
    .toLowerCase();

  const fnClean = normalizeSearchToken(flightNumber);
  const alClean = normalizeSearchToken(airline);
  const rtClean = normalizeSearchToken(route);

  const haystack = `${fn} ${fnClean} ${al} ${alClean} ${rt} ${rtClean} ${entStr}`;

  return rawTokens.every(tok => {
    const cleanTok = normalizeSearchToken(tok);
    return haystack.includes(tok) || (cleanTok.length > 0 && haystack.includes(cleanTok));
  });
}

/**
 * Formats time in Lagos timezone (HH:mm).
 */
export function fmtFlightTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Lagos',
    });
  } catch {
    return '—';
  }
}

/**
 * Formats date and time in Lagos timezone (DD MMM, HH:mm).
 */
export function fmtFlightDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const date = d.toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Lagos',
    });
    const time = d.toLocaleTimeString('en-NG', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Africa/Lagos',
    });
    return `${date}, ${time}`;
  } catch {
    return '—';
  }
}

/**
 * Formats delay minutes as "+45m" or empty string.
 */
export function formatDelayMinutes(delay: number | null | undefined): string {
  if (typeof delay !== 'number' || isNaN(delay) || delay <= 0) return '';
  return `+${Math.round(delay)}m`;
}

/**
 * Metadata for flight status presentation (color classes and sentence-case labels).
 */
export interface FlightStatusPresentation {
  label: string;
  badgeTone: 'neutral' | 'info' | 'warning' | 'error' | 'success';
  bgClass: string;
  borderClass: string;
  textClass: string;
  dotClass: string;
}

export function getFlightStatusMeta(status: FlightStatus | string): FlightStatusPresentation {
  const s = status as FlightStatus;
  switch (s) {
    case 'landed':
      return {
        label: 'Landed',
        badgeTone: 'success',
        bgClass: 'bg-emerald-500/10 dark:bg-emerald-500/15',
        borderClass: 'border-emerald-500/25',
        textClass: 'text-emerald-700 dark:text-emerald-400',
        dotClass: 'bg-emerald-500',
      };
    case 'departed':
      return {
        label: 'En route',
        badgeTone: 'info',
        bgClass: 'bg-sky-500/10 dark:bg-sky-500/15',
        borderClass: 'border-sky-500/25',
        textClass: 'text-sky-700 dark:text-sky-400',
        dotClass: 'bg-sky-500',
      };
    case 'boarding':
      return {
        label: 'Boarding',
        badgeTone: 'info',
        bgClass: 'bg-sky-500/10 dark:bg-sky-500/15',
        borderClass: 'border-sky-500/25',
        textClass: 'text-sky-700 dark:text-sky-400',
        dotClass: 'bg-sky-500',
      };
    case 'delayed':
      return {
        label: 'Delayed',
        badgeTone: 'warning',
        bgClass: 'bg-amber-500/10 dark:bg-amber-500/15',
        borderClass: 'border-amber-500/25',
        textClass: 'text-amber-700 dark:text-amber-400',
        dotClass: 'bg-amber-500',
      };
    case 'returned':
      return {
        label: 'Returned to origin',
        badgeTone: 'error',
        bgClass: 'bg-rose-500/10 dark:bg-rose-500/15',
        borderClass: 'border-rose-500/25',
        textClass: 'text-rose-700 dark:text-rose-400',
        dotClass: 'bg-rose-500',
      };
    case 'diverted':
      return {
        label: 'Diverted',
        badgeTone: 'error',
        bgClass: 'bg-rose-500/10 dark:bg-rose-500/15',
        borderClass: 'border-rose-500/25',
        textClass: 'text-rose-700 dark:text-rose-400',
        dotClass: 'bg-rose-500',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        badgeTone: 'error',
        bgClass: 'bg-rose-500/10 dark:bg-rose-500/15',
        borderClass: 'border-rose-500/25',
        textClass: 'text-rose-700 dark:text-rose-400',
        dotClass: 'bg-rose-500',
      };
    case 'scheduled':
      return {
        label: 'Scheduled',
        badgeTone: 'neutral',
        bgClass: 'bg-zinc-500/10 dark:bg-zinc-500/15',
        borderClass: 'border-zinc-500/25',
        textClass: 'text-zinc-700 dark:text-zinc-300',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
      };
    default:
      return {
        label: 'Not tracked',
        badgeTone: 'neutral',
        bgClass: 'bg-zinc-500/10 dark:bg-zinc-500/15',
        borderClass: 'border-zinc-500/25',
        textClass: 'text-zinc-600 dark:text-zinc-400',
        dotClass: 'bg-zinc-400 dark:bg-zinc-500',
      };
  }
}

export interface FlightGroup<T> {
  id: 'attention' | 'enroute' | 'scheduled' | 'landed';
  title: string;
  items: T[];
}

/**
 * Partitions board flights into 4 logical groups (Needs attention, En route, Scheduled, Landed).
 */
export function groupFlights(flights: BoardFlight[], search = ''): FlightGroup<BoardFlight>[] {
  const searched = flights.filter(f =>
    matchesFlightSearch(search, f.flightNumber, f.airline, f.route, f.entries)
  );

  const attention = searched.filter(f => ATTENTION_STATUSES.includes(effectiveStatus(f.status)));
  const enroute = searched.filter(f => ENROUTE_STATUSES.includes(effectiveStatus(f.status)));
  const scheduled = searched.filter(
    f => effectiveStatus(f.status) === 'scheduled' || effectiveStatus(f.status) === 'unknown'
  );
  const landed = searched.filter(f => effectiveStatus(f.status) === 'landed');

  return [
    { id: 'attention', title: 'Needs attention', items: attention },
    { id: 'enroute', title: 'En route', items: enroute },
    { id: 'scheduled', title: 'Scheduled', items: scheduled },
    { id: 'landed', title: 'Landed', items: landed },
  ];
}

/**
 * Partitions national flights into 4 logical groups.
 */
export function groupNationalFlights(flights: NationalFlight[], search = ''): FlightGroup<NationalFlight>[] {
  const searched = flights.filter(f => {
    const route = f.destinationIata ? `${f.originIata} ${f.destinationIata}` : f.originIata;
    return matchesFlightSearch(search, f.flightNumber, f.airline, route);
  });

  const attention = searched.filter(f => ATTENTION_STATUSES.includes(f.status.toLowerCase() as FlightStatus));
  const enroute = searched.filter(f => ENROUTE_STATUSES.includes(f.status.toLowerCase() as FlightStatus));
  const scheduled = searched.filter(
    f => {
      const s = f.status.toLowerCase();
      return s === 'scheduled' || s === 'unknown' || !s;
    }
  );
  const landed = searched.filter(f => f.status.toLowerCase() === 'landed');

  return [
    { id: 'attention', title: 'Needs attention', items: attention },
    { id: 'enroute', title: 'En route', items: enroute },
    { id: 'scheduled', title: 'Scheduled', items: scheduled },
    { id: 'landed', title: 'Landed', items: landed },
  ];
}

/**
 * Determines step progress for linear timeline (0 to 3).
 */
export function timelineStepIndex(status: FlightStatus): number {
  switch (status) {
    case 'scheduled':
    case 'cancelled':
      return 0;
    case 'boarding':
    case 'delayed':
      return 1;
    case 'departed':
    case 'diverted':
    case 'returned':
      return 2;
    case 'landed':
      return 3;
    default:
      return 0;
  }
}

/**
 * Checks if a flight is in an interrupted/attention state.
 */
export function isStatusInterrupted(status: FlightStatus): boolean {
  return ATTENTION_STATUSES.includes(status);
}

/**
 * Cleans route string into a readable origin -> destination format.
 */
export function formatRouteDisplay(route: string | null | undefined): string {
  if (!route) return '';
  return route.replace(/->/g, '→').replace(/\s+/g, ' ').trim();
}
