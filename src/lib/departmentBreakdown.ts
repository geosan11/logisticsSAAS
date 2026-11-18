export type DepartmentKey = 'cargo' | 'package' | 'baggage' | 'marketing' | 'legacy';

export interface RawDepartmentStream {
  key: DepartmentKey;
  name?: string;
  amount: number;
  count: number;
  kg?: number;
}

export interface DepartmentRow {
  key: DepartmentKey;
  name: string;
  amount: number;
  count: number;
  kg?: number;
  isLegacy: boolean;
}

export interface BuildDepartmentRowsOptions {
  cargoLabel?: string;
  packageLabel?: string;
}

/**
 * Builds department stream rows according to Haulwey legacy-stream visibility rules:
 * - Legacy streams ('baggage', 'marketing', 'legacy') are combined under ONE neutral label 'Legacy'.
 * - If total legacy count is 0, the Legacy row is completely omitted.
 * - Active streams ('cargo' and 'package') are always preserved.
 * - The returned grandTotal ALWAYS includes all amounts across all streams (including legacy).
 */
export function buildDepartmentRows(
  streams: RawDepartmentStream[],
  options?: BuildDepartmentRowsOptions
): { rows: DepartmentRow[]; grandTotal: number } {
  const rows: DepartmentRow[] = [];
  let grandTotal = 0;
  let legacyAmount = 0;
  let legacyCount = 0;
  let legacyKg = 0;
  let hasLegacyStream = false;

  for (const stream of streams) {
    const amount = Number(stream.amount) || 0;
    const count = Number(stream.count) || 0;
    grandTotal += amount;

    const isLegacy = stream.key === 'baggage' || stream.key === 'marketing' || stream.key === 'legacy';

    if (isLegacy) {
      hasLegacyStream = true;
      legacyAmount += amount;
      legacyCount += count;
      legacyKg += (Number(stream.kg) || 0);
      continue;
    }

    let name = stream.name;
    if (stream.key === 'cargo') {
      name = name || options?.cargoLabel || 'Air Cargo';
    } else if (stream.key === 'package') {
      name = name || options?.packageLabel || 'Package Desk';
    }

    rows.push({
      key: stream.key,
      name: name || stream.key,
      amount,
      count,
      kg: stream.kg,
      isLegacy: false,
    });
  }

  // Rule: combine legacy rows under ONE neutral label 'Legacy' and omit if count is 0
  if (hasLegacyStream && legacyCount > 0) {
    rows.push({
      key: 'legacy',
      name: 'Legacy',
      amount: legacyAmount,
      count: legacyCount,
      kg: legacyKg,
      isLegacy: true,
    });
  }

  return { rows, grandTotal };
}

/**
 * Convenience helper to compute department rows directly from a transaction array.
 */
export function buildDepartmentRowsFromTransactions(
  transactions: Array<{ type: string; amount?: number; is_debt_clearance?: boolean; kg?: number }>,
  options?: BuildDepartmentRowsOptions
): { rows: DepartmentRow[]; grandTotal: number } {
  const nonClearance = transactions.filter(t => !t.is_debt_clearance);
  const cargoTx = nonClearance.filter(t => t.type === 'cargo');
  const pkgTx = nonClearance.filter(t => t.type === 'package');
  const legacyTx = nonClearance.filter(t => t.type === 'baggage' || t.type === 'marketing' || t.type === 'legacy');

  const streams: RawDepartmentStream[] = [
    {
      key: 'cargo',
      name: options?.cargoLabel || 'Air Cargo',
      amount: cargoTx.reduce((s, t) => s + (t.amount || 0), 0),
      count: cargoTx.length,
      kg: cargoTx.reduce((s, t) => s + (t.kg || 0), 0),
    },
    {
      key: 'package',
      name: options?.packageLabel || 'Package Desk',
      amount: pkgTx.reduce((s, t) => s + (t.amount || 0), 0),
      count: pkgTx.length,
      kg: pkgTx.reduce((s, t) => s + (t.kg || 0), 0),
    },
    {
      key: 'legacy',
      name: 'Legacy',
      amount: legacyTx.reduce((s, t) => s + (t.amount || 0), 0),
      count: legacyTx.length,
      kg: legacyTx.reduce((s, t) => s + (t.kg || 0), 0),
    },
  ];

  return buildDepartmentRows(streams, options);
}
