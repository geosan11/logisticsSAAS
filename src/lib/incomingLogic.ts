/**
 * Pure logic and utility functions for the Incoming to Hub view.
 * Kept pure and deterministic for instant performance and unit test verification.
 */

export interface IncomingCargoItem {
  id?: string;
  entry_ref?: string | null;
  consignee_name?: string | null;
  route?: string | null;
  total_pcs?: number | string | null;
  total_kg?: number | string | null;
  content_type?: string | null;
  airline?: string | null;
  awb_tag_number?: string | null;
  created_at: string;
  status?: string | null;
}

/**
 * Calculates human-readable elapsed time since a given ISO timestamp.
 */
export function timeSince(dateStr: string, nowMs = Date.now()): string {
  const timestamp = new Date(dateStr).getTime();
  if (isNaN(timestamp)) return '—';
  const diffMs = Math.max(0, nowMs - timestamp);
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    return `${mins}m`;
  }
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Formats physical cargo specifications (pieces and weight) into a clean tabular string.
 */
export function formatCargoSpecs(
  pieces: number | string | null | undefined,
  weight: number | string | null | undefined
): { pcsStr: string; kgStr: string } {
  const p = typeof pieces === 'number' ? pieces : parseFloat(String(pieces || ''));
  const w = typeof weight === 'number' ? weight : parseFloat(String(weight || ''));

  return {
    pcsStr: !isNaN(p) && p > 0 ? `${p} pcs` : '— pcs',
    kgStr: !isNaN(w) && w > 0 ? `${Math.round(w * 10) / 10} kg` : '— kg',
  };
}

/**
 * Formats AWB tag numbers cleanly, avoiding double-prefix stutters like "AWB AWB-LOS-89102".
 */
export function formatAwbDisplay(tag: string | null | undefined): string {
  if (!tag) return '';
  const trimmed = tag.trim();
  if (!trimmed) return '';

  // If already starts with AWB (case-insensitive) followed by non-alphanumeric or space
  if (/^awb[\s\-:]+/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  // If it's "AWB" by itself with an alphanumeric suffix e.g. AWB12345
  if (/^awb[0-9]/i.test(trimmed)) {
    return `AWB-${trimmed.slice(3).toUpperCase()}`;
  }
  return `AWB ${trimmed}`;
}

/**
 * Normalizes route strings, replacing ASCII arrows with clean typographic arrows (→)
 * and extracting origin/destination when available.
 */
export function formatRoutePath(route: string | null | undefined): {
  origin: string;
  destination: string;
  display: string;
} {
  if (!route || !route.trim()) {
    return { origin: '', destination: '', display: 'Direct route' };
  }
  const clean = route.trim();
  // Match separators: "->", "-->", "to", "-" with spaces
  const parts = clean.split(/\s*(?:->|-->|\s+to\s+|-)\s*/i);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    const origin = parts[0].trim();
    const destination = parts.slice(1).join(' - ').trim();
    return {
      origin,
      destination,
      display: `${origin} → ${destination}`,
    };
  }
  return { origin: clean, destination: '', display: clean };
}

/**
 * Formats telemetry metrics cleanly for the top KPI bar without redundant repetition.
 */
export function formatTelemetryMetrics(
  filteredCount: number,
  totalCount: number,
  totalPieces: number,
  totalWeight: number,
  isFiltered = false
): {
  inTransitText: string;
  piecesText: string;
  weightText: string;
} {
  const inTransitText = isFiltered
    ? `${filteredCount} of ${totalCount} in transit`
    : `${totalCount} in transit`;
  const piecesText = `${totalPieces.toLocaleString()} pcs`;
  const weightText = `${totalWeight.toLocaleString()} kg`;

  return { inTransitText, piecesText, weightText };
}

/**
 * Cleans and standardizes route display string.
 */
export function formatRouteDisplay(route: string | null | undefined): string {
  if (!route || !route.trim()) return 'Direct route';
  return formatRoutePath(route).display;
}

/**
 * Checks if a cargo route matches a given destination hub name using
 * fuzzy word tokens (matching scanLogic.ts / isCorrectDestination convention).
 */
export function matchesDestinationHub(route: string | null | undefined, hubName: string): boolean {
  if (!hubName) return true;
  const hubWords = hubName.toLowerCase().split(' ').filter((w) => w.length >= 3);
  if (hubWords.length === 0) return true;
  const dest = (route || '').toLowerCase();
  return hubWords.some((w) => dest.includes(w));
}

/**
 * Filters incoming cargo list by search terms (consignee, entry ref, AWB, route, airline, content type).
 */
export function filterIncomingCargo<T extends IncomingCargoItem>(items: T[], query: string): T[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;

  // Split query into individual search tokens for multi-token search
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  return items.filter((c) => {
    const consignee = (c.consignee_name || '').toLowerCase();
    const ref = (c.entry_ref || c.id || '').toLowerCase();
    const awb = (c.awb_tag_number || '').toLowerCase();
    const route = (c.route || '').toLowerCase();
    const airline = (c.airline || '').toLowerCase();
    const contentType = (c.content_type || '').toLowerCase();

    const searchableText = `${consignee} ${ref} ${awb} ${route} ${airline} ${contentType}`;
    return tokens.every((token) => searchableText.includes(token));
  });
}

/**
 * Aggregates summary KPI telemetry from incoming cargo items.
 */
export function calculateIncomingMetrics<T extends Pick<IncomingCargoItem, 'total_pcs' | 'total_kg'>>(items: T[]): {
  count: number;
  totalPieces: number;
  totalWeight: number;
} {
  let pieces = 0;
  let weight = 0;

  for (const item of items) {
    const p = typeof item.total_pcs === 'number' ? item.total_pcs : parseFloat(String(item.total_pcs || 0));
    const w = typeof item.total_kg === 'number' ? item.total_kg : parseFloat(String(item.total_kg || 0));
    if (!isNaN(p) && p > 0) pieces += p;
    if (!isNaN(w) && w > 0) weight += w;
  }

  return {
    count: items.length,
    totalPieces: pieces,
    totalWeight: Math.round(weight * 10) / 10,
  };
}

/**
 * Permission check: determines if the user role is authorized to view Incoming to Hub.
 */
export function canAccessIncomingRole(role: string): boolean {
  const authorized = ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'driver', 'office_work'];
  return authorized.includes(role);
}
