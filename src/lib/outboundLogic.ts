/**
 * Pure business logic and formatting helpers for Outbound Arrivals (Grok UI).
 * Keeps presentation decoupled from calculations, permissions, and CSV generation.
 */

export interface OutboundArrivalItem {
  key: string;
  source: 'Cargo' | 'Legacy' | 'Package';
  entryRef: string;
  customerName: string;
  destinationLabel: string;
  pcs?: number;
  kg?: number;
  awb?: string;
  airline?: string;
  contentType?: string;
  createdAt: string;
}

export type OutboundSourceFilter = 'all' | 'cargo' | 'package';

/**
 * Calculates human-readable relative time (e.g. "2h ago", "1d ago").
 */
export function timeSince(dateString: string, nowMs = Date.now()): string {
  const timestamp = new Date(dateString).getTime();
  if (isNaN(timestamp)) return '—';
  const diffMs = Math.max(0, nowMs - timestamp);
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / 60000));
    return `${mins}m ago`;
  }
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Formats physical cargo specifications (pieces and weight) into clean tabular strings.
 */
export function formatOutboundSpecs(
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
 * Formats AWB tag numbers cleanly, avoiding double-prefix stutters.
 */
export function formatAwbDisplay(tag: string | null | undefined): string {
  if (!tag) return '';
  const trimmed = tag.trim();
  if (!trimmed) return '';

  // Avoid "AWB-AWB-..." stutter
  if (/^awb[-_\s]/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^awb/i.test(trimmed)) {
    return `AWB-${trimmed.slice(3).trim()}`.toUpperCase();
  }
  return `AWB ${trimmed}`.toUpperCase();
}

/**
 * Replaces ASCII arrows with clean typographic arrows (→) in routes.
 */
export function formatRouteDisplay(route: string | null | undefined): string {
  if (!route) return 'Direct route';
  const trimmed = route.trim();
  if (!trimmed) return 'Direct route';

  // Replace ASCII arrows: ->, -->, =>
  let formatted = trimmed.replace(/\s*--?>\s*|\s*=>\s*/g, ' → ');
  // Replace standalone "to" (e.g. Lagos to Abuja)
  formatted = formatted.replace(/\s+to\s+/gi, ' → ');

  return formatted;
}

/**
 * Detects whether a destination string represents an origin-destination route (contains an arrow)
 * or a specific station / destination drop-point, returning the appropriate semantic type label.
 */
export function formatDestinationLabel(destination: string | null | undefined): {
  isRoute: boolean;
  displayText: string;
  typeLabel: string;
} {
  const formatted = formatRouteDisplay(destination);
  const isRoute = formatted.includes('→');
  return {
    isRoute,
    displayText: formatted,
    typeLabel: isRoute ? 'Route' : 'Destination',
  };
}

/**
 * Filters outbound arrivals in-memory across search query and source filter.
 * Uses a tokenized multi-field search engine so operators can search across multiple
 * facets (e.g. "dangote kano" or "air peace abuja").
 */
export function filterOutboundArrivals(
  items: OutboundArrivalItem[],
  query: string,
  sourceFilter: OutboundSourceFilter
): OutboundArrivalItem[] {
  const raw = query.trim().toLowerCase();
  const tokens = raw ? raw.split(/\s+/).filter(Boolean) : [];

  return items.filter((item) => {
    // 1. Source filter
    if (sourceFilter === 'cargo' && item.source !== 'Cargo') return false;
    if (sourceFilter === 'package' && item.source !== 'Package') return false;

    // 2. Query filter (multi-token search)
    if (tokens.length === 0) return true;

    const haystack = [
      item.customerName || '',
      item.entryRef || '',
      item.destinationLabel || '',
      item.awb || '',
      item.airline || '',
      item.contentType || '',
    ]
      .join(' ')
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

/**
 * Aggregates outbound arrival metrics (totals and breakdown).
 */
export function calculateOutboundMetrics(items: OutboundArrivalItem[]): {
  totalCount: number;
  totalPieces: number;
  totalWeight: number;
  cargoCount: number;
  packageCount: number;
  legacyCount: number;
} {
  let totalPieces = 0;
  let totalWeight = 0;
  let cargoCount = 0;
  let packageCount = 0;
  let legacyCount = 0;

  for (const item of items) {
    if (item.source === 'Cargo') cargoCount++;
    else if (item.source === 'Package') packageCount++;
    else if (item.source === 'Legacy') legacyCount++;

    const p = typeof item.pcs === 'number' ? item.pcs : parseFloat(String(item.pcs || 0));
    if (!isNaN(p) && p > 0) totalPieces += p;

    const w = typeof item.kg === 'number' ? item.kg : parseFloat(String(item.kg || 0));
    if (!isNaN(w) && w > 0) totalWeight += w;
  }

  return {
    totalCount: items.length,
    totalPieces: Math.round(totalPieces),
    totalWeight: Math.round(totalWeight * 10) / 10,
    cargoCount,
    packageCount,
    legacyCount,
  };
}

/**
 * Formats telemetry metrics cleanly for the top KPI bar.
 * When filtered, displays matching pieces and weight for the active filter.
 */
export function formatOutboundTelemetry(
  filteredCount: number,
  totalCount: number,
  activePieces: number,
  activeWeight: number,
  isFiltered = false
): {
  arrivedText: string;
  piecesText: string;
  weightText: string;
} {
  const arrivedText = isFiltered
    ? `${filteredCount} of ${totalCount} confirmed`
    : `${totalCount} confirmed arrived`;
  const piecesText = `${activePieces.toLocaleString()} pcs`;
  const weightText = `${activeWeight.toLocaleString()} kg`;

  return { arrivedText, piecesText, weightText };
}

/**
 * Generates CSV content from outbound arrivals for counter station auditing and reports.
 */
export function generateOutboundCsv(items: OutboundArrivalItem[]): string {
  const headers = [
    'Entry Ref',
    'Source',
    'Customer / Consignee',
    'Destination',
    'Pieces',
    'Weight (kg)',
    'AWB Tag',
    'Airline',
    'Content Type',
    'Confirmed At',
  ];

  const escapeCsv = (val: string | number | undefined | null): string => {
    if (val === undefined || val === null) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = items.map((r) => [
    escapeCsv(r.entryRef),
    escapeCsv(r.source),
    escapeCsv(r.customerName),
    escapeCsv(r.destinationLabel),
    escapeCsv(r.pcs || 0),
    escapeCsv(r.kg || 0),
    escapeCsv(r.awb || ''),
    escapeCsv(r.airline || ''),
    escapeCsv(r.contentType || ''),
    escapeCsv(r.createdAt),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
}

/**
 * Checks role access for Outbound Arrivals according to EHI permissions matrix.
 */
export function canAccessOutboundRole(role: string): boolean {
  const allowed = [
    'super_admin',
    'admin',
    'cargo_agent',
    'baggage_agent',
    'marketing_agent',
    'driver',
    'accountant',
    'auditor',
    'office_work',
  ];
  return allowed.includes(role);
}
