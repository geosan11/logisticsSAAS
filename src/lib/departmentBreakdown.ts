export type DepartmentKey = 'cargo' | 'package' | 'baggage' | 'marketing';

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
 * - Legacy streams ('baggage' and 'marketing') with 0 entries are completely omitted.
 * - Legacy streams with > 0 entries are included and labelled '(legacy)'.
 * - Active streams ('cargo' and 'package') are always preserved.
 * - The returned grandTotal ALWAYS includes all amounts across all streams (including legacy).
 */
export function buildDepartmentRows(
  streams: RawDepartmentStream[],
  options?: BuildDepartmentRowsOptions
): { rows: DepartmentRow[]; grandTotal: number } {
  const rows: DepartmentRow[] = [];
  let grandTotal = 0;

  for (const stream of streams) {
    const amount = Number(stream.amount) || 0;
    const count = Number(stream.count) || 0;
    grandTotal += amount;

    const isLegacy = stream.key === 'baggage' || stream.key === 'marketing';

    // Rule: hide legacy rows entirely when period has 0 entries
    if (isLegacy && count === 0) {
      continue;
    }

    let name = stream.name;
    if (stream.key === 'baggage') {
      name = 'Excess Baggage (legacy)';
    } else if (stream.key === 'marketing') {
      name = 'Marketing (legacy)';
    } else if (stream.key === 'cargo') {
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
      isLegacy,
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
  const vjTx = nonClearance.filter(t => t.type === 'baggage');
  const mktgTx = nonClearance.filter(t => t.type === 'marketing');

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
      key: 'baggage',
      name: 'Excess Baggage (legacy)',
      amount: vjTx.reduce((s, t) => s + (t.amount || 0), 0),
      count: vjTx.length,
      kg: vjTx.reduce((s, t) => s + (t.kg || 0), 0),
    },
    {
      key: 'marketing',
      name: 'Marketing (legacy)',
      amount: mktgTx.reduce((s, t) => s + (t.amount || 0), 0),
      count: mktgTx.length,
      kg: mktgTx.reduce((s, t) => s + (t.kg || 0), 0),
    },
  ];

  return buildDepartmentRows(streams, options);
}
