/**
 * Pure logic and utility functions for the Outbound Arrivals view.
 * Kept pure and deterministic for instant performance and unit test verification.
 */

export type OutboundSource = 'Cargo' | 'Legacy' | 'Package';

export interface OutboundArrivalItem {
  key: string;
  source: OutboundSource;
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
 * Calculates human-readable elapsed time since a given ISO timestamp.
 * Returns sentence-case relative format, e.g. "2h ago", "15m ago", "1d ago".
 */
export function timeSince(dateStr: string, nowMs = Date.now()): string {
  const timestamp = new Date(dateStr).getTime();
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

  if (/^awb[\s\-:]+/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  if (/^awb[0-9]/i.test(trimmed)) {
    return `AWB-${trimmed.slice(3).toUpperCase()}`;
  }
  return `AWB ${trimmed}`;
}

/**
 * Normalizes route strings, replacing ASCII arrows (->, -->) with clean typographic arrows (→).
 */
export function formatRouteDisplay(route: string | null | undefined): string {
  if (!route || !route.trim()) return 'Direct route';
  return route
    .replace(/\s*(?:->|-->|\s+to\s+)\s*/gi, ' → ')
    .trim();
}

/**
 * Filters outbound arrivals in-memory across search query and source filter.
 * Supports multi-token searching so queries like "Dangote Kano" or "Air Peace Cargo" match across fields.
 */
export function filterOutboundArrivals(
  items: OutboundArrivalItem[],
  query: string,
  sourceFilter: OutboundSourceFilter = 'all'
): OutboundArrivalItem[] {
  let list = items;

  if (sourceFilter === 'cargo') {
    list = list.filter((item) => item.source === 'Cargo');
  } else if (sourceFilter === 'package') {
    list = list.filter((item) => item.source === 'Package');
  }

  const raw = query.trim().toLowerCase();
  if (!raw) return list;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list;

  return list.filter((item) => {
    const haystack = [
      item.customerName || '',
      item.entryRef || '',
      item.awb || '',
      item.destinationLabel || '',
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
 */
export function formatOutboundTelemetry(
  filteredCount: number,
  totalCount: number,
  totalPieces: number,
  totalWeight: number,
  isFiltered = false
): {
  arrivedText: string;
  piecesText: string;
  weightText: string;
} {
  const arrivedText = isFiltered
    ? `${filteredCount} of ${totalCount} confirmed`
    : `${totalCount} confirmed arrived`;
  const piecesText = `${totalPieces.toLocaleString()} pcs`;
  const weightText = `${totalWeight.toLocaleString()} kg`;

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
