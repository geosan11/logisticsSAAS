import { ScanMode, ScanResultType } from './types';

/**
 * Returns human-readable sentence-case label for scan mode.
 */
export function formatScanModeLabel(mode: ScanMode): string {
  switch (mode) {
    case 'ARRIVE':
      return 'Arrive';
    case 'DEPART':
      return 'Depart';
    case 'DELIVER':
      return 'Deliver';
    default:
      return mode;
  }
}

/**
 * Returns descriptive operational helper text for the active scan mode.
 */
export function getScanModeDescription(mode: ScanMode): string {
  switch (mode) {
    case 'ARRIVE':
      return 'Scan cargo arriving at this hub';
    case 'DEPART':
      return 'Scan cargo departing from this hub';
    case 'DELIVER':
      return 'Capture proof of delivery for recipient';
    default:
      return 'Scan cargo tag or barcode';
  }
}

/**
 * Returns compact sub-label for mode button pills.
 */
export function getScanModeSublabel(mode: ScanMode): string {
  switch (mode) {
    case 'ARRIVE':
      return 'Cargo landed here';
    case 'DEPART':
      return 'Sending to carrier';
    case 'DELIVER':
      return 'Handover to consignee';
    default:
      return '';
  }
}

/**
 * Normalizes and extracts reference code from raw scanner inputs,
 * handling URLs, JSON wrappers, or plain barcode strings.
 */
export function parseScannedReference(rawInput: string): string {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let ref = rawInput.trim();

  // Handle URL format: https://domain.com/track/CRG-12345
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    try {
      const url = new URL(ref);
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        ref = parts[parts.length - 1];
      }
    } catch {
      const lastSlash = ref.lastIndexOf('/');
      if (lastSlash !== -1) {
        ref = ref.slice(lastSlash + 1);
      }
    }
  }

  // Handle JSON payload: {"ref":"AWB-1024", ...}
  if (ref.startsWith('{')) {
    try {
      const parsed = JSON.parse(ref);
      if (parsed.ref || parsed.id || parsed.awb) {
        ref = String(parsed.ref || parsed.id || parsed.awb);
      }
    } catch {
      // not valid JSON, proceed with raw string
    }
  }

  return ref.trim().toUpperCase();
}

/**
 * Maps a scan outcome type to a clean display label and Grok status tone.
 */
export function formatScanResultBadge(
  resultType: ScanResultType | string,
  mode?: ScanMode
): { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' } {
  if (resultType === 'SUCCESS_ARRIVE') {
    return { label: 'Arrived', tone: 'success' };
  }
  if (resultType === 'SUCCESS_DEPART') {
    return { label: 'Departed', tone: 'info' };
  }
  if (resultType === 'SUCCESS_DELIVER') {
    return { label: 'Delivered', tone: 'success' };
  }
  if (resultType.startsWith('SUCCESS')) {
    return {
      label: mode ? formatScanModeLabel(mode) : 'Logged',
      tone: 'success',
    };
  }
  if (resultType === 'WRONG_DESTINATION') {
    return { label: 'Wrong station', tone: 'error' };
  }
  if (resultType === 'ALREADY_PROCESSED') {
    return { label: 'Already logged', tone: 'warning' };
  }
  if (resultType === 'NOT_LOGGED_IN') {
    return { label: 'Arrive first', tone: 'warning' };
  }
  if (resultType === 'NOT_FOUND') {
    return { label: 'Not found', tone: 'error' };
  }
  if (resultType === 'ERROR') {
    return { label: 'Scan error', tone: 'error' };
  }
  return { label: resultType.replace(/_/g, ' '), tone: 'neutral' };
}

/**
 * Calculates session or batch scan counters.
 */
export function calculateBatchMetrics(
  items: Array<{ result: string }>
): {
  total: number;
  successCount: number;
  alertCount: number;
} {
  let successCount = 0;
  let alertCount = 0;

  for (const item of items) {
    if (item.result.startsWith('SUCCESS')) {
      successCount++;
    } else if (item.result !== 'ALREADY_PROCESSED') {
      alertCount++;
    }
  }

  return {
    total: items.length,
    successCount,
    alertCount,
  };
}

/**
 * Checks whether an item with given ref and mode is already queued in batchQueue.
 */
export function isDuplicateInBatch(
  queue: Array<{ ref: string; mode: ScanMode }>,
  ref: string,
  mode: ScanMode
): boolean {
  const normRef = ref.trim().toUpperCase();
  return queue.some(
    (item) => item.ref.trim().toUpperCase() === normRef && item.mode === mode
  );
}

/**
 * Formats a scan timestamp consistently for tables and lists.
 */
export function formatScanTimestamp(date: string | Date | number): string {
  try {
    const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return `${d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

/**
 * Verifies role authorization for the QR Scanner tab per EHI permissions.
 */
export function canAccessScannerRole(role: string): boolean {
  const allowed = [
    'super_admin',
    'admin',
    'cargo_agent',
    'baggage_agent',
    'marketing_agent',
    'accountant',
    'auditor',
    'driver',
    'office_work',
  ];
  return allowed.includes(role);
}
