import { cleanRoute } from './helpers.js';

export type HeatmapLevel = 'low' | 'medium' | 'high';
export const HEATMAP_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type HeatmapWeekday = typeof HEATMAP_WEEKDAYS[number];

export interface RouteHeatmapRow {
  route: string;
  Mon: HeatmapLevel;
  Tue: HeatmapLevel;
  Wed: HeatmapLevel;
  Thu: HeatmapLevel;
  Fri: HeatmapLevel;
  Sat: HeatmapLevel;
  totalCount: number;
  weeklyAverage: number;
}

export interface RawRouteRecord {
  route?: string | null;
  destination?: string | null;
  created_at: string;
}

export interface RouteHeatmapOptions {
  weeks?: number; // default: 8
  maxRoutes?: number; // default: 8
}

export interface HeatmapThresholds {
  lowThreshold: number;
  highThreshold: number;
  min: number;
  max: number;
}

/**
 * Standardize route name across cargo/package desks:
 * Handles trailing Station markers, arrow/dash separators, and casing.
 */
export function normalizeRoute(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = cleanRoute(raw);
  if (!cleaned || cleaned === '—') return '';
  return cleaned.replace(/\s*(?:->|—|–|-)\s*/g, ' - ').trim();
}

/**
 * Calculates a quantile (between 0 and 1) from an already-sorted number array.
 * Uses linear interpolation (R-7 / Excel / NumPy default).
 */
export function calculateQuantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];

  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Computes lower and upper tercile thresholds from distribution values.
 */
export function calculateThresholds(values: number[]): HeatmapThresholds {
  if (values.length === 0) {
    return { lowThreshold: 0, highThreshold: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  if (max === 0 || min === max) {
    return { lowThreshold: min, highThreshold: max, min, max };
  }

  let lowThreshold = calculateQuantile(sorted, 1 / 3);
  let highThreshold = calculateQuantile(sorted, 2 / 3);

  // When low and high collapse due to high zero-inflation
  if (lowThreshold === 0 && highThreshold === 0) {
    highThreshold = max / 2;
  } else if (lowThreshold === max && highThreshold === max) {
    lowThreshold = min + (max - min) / 2;
  }

  return { lowThreshold, highThreshold, min, max };
}

/**
 * Classifies a single cell's average value into low, medium, or high
 * relative to the tenant's distribution.
 */
export function classifyLevel(
  value: number,
  thresholds: HeatmapThresholds
): HeatmapLevel {
  const { lowThreshold, highThreshold, min, max } = thresholds;

  if (max === 0) return 'low';
  if (min === max) return 'medium';

  // Zero-inflated distribution fallback
  if (lowThreshold === 0 && highThreshold > 0) {
    if (value <= 0) return 'low';
    if (value <= highThreshold) return 'medium';
    return 'high';
  }

  if (value <= lowThreshold) return 'low';
  if (value <= highThreshold) return 'medium';
  return 'high';
}

const JS_DAY_TO_WEEKDAY: Record<number, HeatmapWeekday | null> = {
  0: null, // Sunday is excluded from Mon-Sat capacity calendar
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/**
 * Pure function: Groups entries by route and weekday (Mon-Sat),
 * averages per week, and classifies low/medium/high relative to that
 * tenant's own distribution (terciles).
 */
export function buildRouteHeatmap(
  entries: RawRouteRecord[],
  options?: RouteHeatmapOptions
): RouteHeatmapRow[] {
  const weeks = Math.max(1, options?.weeks ?? 8);
  const maxRoutes = Math.max(1, options?.maxRoutes ?? 8);

  const routeTotals: Record<string, number> = {};
  const weekdayCounts: Record<string, Record<HeatmapWeekday, number>> = {};

  for (const entry of entries) {
    const rawRoute = entry.route || entry.destination;
    const route = normalizeRoute(rawRoute);
    if (!route) continue;

    if (!entry.created_at) continue;
    const date = new Date(entry.created_at);
    if (isNaN(date.getTime())) continue;

    // Track total volume for route ranking
    routeTotals[route] = (routeTotals[route] || 0) + 1;

    // Track weekday counts for Mon-Sat
    const weekday = JS_DAY_TO_WEEKDAY[date.getDay()];
    if (weekday) {
      if (!weekdayCounts[route]) {
        weekdayCounts[route] = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
      }
      weekdayCounts[route][weekday] = (weekdayCounts[route][weekday] || 0) + 1;
    }
  }

  // Sort routes by total volume descending and take at most top N routes
  const topRoutes = Object.keys(routeTotals)
    .sort((a, b) => routeTotals[b] - routeTotals[a])
    .slice(0, maxRoutes);

  if (topRoutes.length === 0) {
    return [];
  }

  // Collect weekly averages for all cells of the top routes to compute distribution
  const cellAverages: number[] = [];
  for (const route of topRoutes) {
    const counts = weekdayCounts[route] || { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    for (const day of HEATMAP_WEEKDAYS) {
      cellAverages.push((counts[day] || 0) / weeks);
    }
  }

  const thresholds = calculateThresholds(cellAverages);

  return topRoutes.map((route) => {
    const counts = weekdayCounts[route] || { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
    return {
      route,
      Mon: classifyLevel((counts.Mon || 0) / weeks, thresholds),
      Tue: classifyLevel((counts.Tue || 0) / weeks, thresholds),
      Wed: classifyLevel((counts.Wed || 0) / weeks, thresholds),
      Thu: classifyLevel((counts.Thu || 0) / weeks, thresholds),
      Fri: classifyLevel((counts.Fri || 0) / weeks, thresholds),
      Sat: classifyLevel((counts.Sat || 0) / weeks, thresholds),
      totalCount: routeTotals[route],
      weeklyAverage: routeTotals[route] / weeks,
    };
  });
}
