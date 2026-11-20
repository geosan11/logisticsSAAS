import { db } from './db';
import { supabase } from './supabase';

export const DEFAULT_TAG_PREFIX = 'HWY';
export const TAG_PREFIX_REGEX = /^[A-Z]{3,5}$/;

let memoryPrefixOverride: string | null = null;

/**
 * Validates that a company tag prefix is strictly 3 to 5 uppercase letters (A-Z).
 */
export function isValidTagPrefix(prefix: unknown): boolean {
  if (typeof prefix !== 'string') return false;
  return TAG_PREFIX_REGEX.test(prefix.trim());
}

/**
 * Returns the tenant-configured tag/AWB prefix for NEW numbers,
 * falling back to "HWY" (Haulwey neutral fallback) if not set.
 */
export function getTenantTagPrefix(): string {
  if (memoryPrefixOverride !== null) {
    return memoryPrefixOverride || DEFAULT_TAG_PREFIX;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('ehi_tag_prefix');
      if (stored && stored.trim()) {
        const sanitized = stored.trim().toUpperCase().replace(/[^A-Z]/g, '');
        if (isValidTagPrefix(sanitized)) {
          return sanitized;
        }
      }
    }
  } catch {}
  return DEFAULT_TAG_PREFIX;
}

/**
 * Persists the tenant's chosen prefix for new numbers.
 */
export function setTenantTagPrefix(prefix: string | null): void {
  if (!prefix || !prefix.trim()) {
    memoryPrefixOverride = null;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('ehi_tag_prefix');
      }
    } catch {}
    return;
  }
  const sanitized = prefix.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!isValidTagPrefix(sanitized)) {
    return;
  }
  memoryPrefixOverride = sanitized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ehi_tag_prefix', sanitized);
    }
  } catch {}
}

export interface BuildTagNumberOptions {
  prefix?: string | null;
  hubCode: string;
  contentCode?: string;
  contentTypeCode?: string;
  sequence: number | string;
}

/**
 * Centralized builder function for every new tag / tracking number.
 * Format: PREFIX-STATE-CONTENT-NNNNNN
 * e.g. RED-LOS-CG-001234
 */
export function buildTagNumber(options: BuildTagNumberOptions): string;
export function buildTagNumber(hubCode: string, contentCode: string, sequence: number | string, prefix?: string | null): string;
export function buildTagNumber(
  optionsOrHub: BuildTagNumberOptions | string,
  contentCodeParam?: string,
  sequenceParam?: number | string,
  prefixParam?: string | null
): string {
  let rawPrefix: string | null | undefined;
  let rawHub: string;
  let rawContent: string;
  let rawSeq: number | string;

  if (typeof optionsOrHub === 'object' && optionsOrHub !== null) {
    rawPrefix = optionsOrHub.prefix;
    rawHub = optionsOrHub.hubCode;
    rawContent = optionsOrHub.contentCode || optionsOrHub.contentTypeCode || 'CG';
    rawSeq = optionsOrHub.sequence;
  } else {
    rawHub = typeof optionsOrHub === 'string' ? optionsOrHub : '';
    rawContent = contentCodeParam || 'CG';
    rawSeq = sequenceParam != null ? sequenceParam : 0;
    rawPrefix = prefixParam;
  }

  const effectivePrefix = (rawPrefix && rawPrefix.trim())
    ? rawPrefix.trim().toUpperCase().replace(/[^A-Z]/g, '')
    : getTenantTagPrefix();

  const finalPrefix = isValidTagPrefix(effectivePrefix) ? effectivePrefix : DEFAULT_TAG_PREFIX;

  // Clean hub and content codes
  const cleanHub = (rawHub || 'LOS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cleanContent = (rawContent || 'CG').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  const numVal = typeof rawSeq === 'string' ? parseInt(rawSeq, 10) : rawSeq;
  const seqStr = isNaN(numVal) ? String(rawSeq).padStart(6, '0') : String(numVal).padStart(6, '0');

  return `${finalPrefix}-${cleanHub}-${cleanContent}-${seqStr}`;
}

export interface ParsedTag {
  prefix: string;
  hubCode: string;
  stream: string;
  sequence: number;
  raw: string;
  isLegacyEhi: boolean;
}

/**
 * Parses and validates any tag / AWB number (new tenant prefix 3-5 letters and legacy EHI- numbers).
 */
export function parseTagNumber(tag: string): ParsedTag | null {
  if (!tag || typeof tag !== 'string') return null;
  const trimmed = tag.trim().toUpperCase();
  // Matches RED-LOS-CG-001234, HWY-LOS-PKG-000512, EHI-LOS-CG-001042, etc. (3 to 5 letter prefixes, 6-digit sequence)
  const match = trimmed.match(/^([A-Z]{3,5})-([A-Z]{2,4})(?:-([A-Z]{2,3}))?-(\d{6})$/);
  if (!match) return null;
  const [, prefix, hubCode, streamOrNull, seqStr] = match;
  return {
    prefix,
    hubCode,
    stream: streamOrNull || '',
    sequence: parseInt(seqStr, 10),
    raw: trimmed,
    isLegacyEhi: prefix === 'EHI',
  };
}

export function isValidTagNumber(tag: string): boolean {
  return parseTagNumber(tag) !== null;
}

/**
 * Validates an Airline AWB (the airline's own 11-digit IATA air waybill).
 * Format: NNN-NNNNNNNN, validate loosely: digits plus an optional dash, 11 digits total.
 */
export function isValidAirlineAwb(awb: unknown): boolean {
  if (!awb || typeof awb !== 'string') return false;
  const trimmed = awb.trim();
  const digitsOnly = trimmed.replace(/-/g, '');
  if (!/^\d{11}$/.test(digitsOnly)) return false;
  return /^[\d-]+$/.test(trimmed);
}

/**
 * Formats an 11-digit airline AWB string into standard IATA format: NNN-NNNNNNNN.
 */
export function formatAirlineAwb(awb: unknown): string {
  if (!awb || typeof awb !== 'string') return '';
  const trimmed = awb.trim();
  const digitsOnly = trimmed.replace(/-/g, '');
  if (digitsOnly.length === 11) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3)}`;
  }
  return trimmed;
}

/**
 * Checks whether the tenant has already issued any tags.
 * Once at least one tag has been issued, the company prefix becomes locked.
 */
export async function hasTenantIssuedTags(tenantId?: string | null): Promise<boolean> {
  // Check local test / override flag first
  try {
    if (typeof localStorage !== 'undefined') {
      const lockFlag = localStorage.getItem('ehi_tag_prefix_locked');
      if (lockFlag === 'true') return true;
      if (lockFlag === 'false') return false;
    }
  } catch {}

  // Check Dexie local database first (instant offline check)
  try {
    if (db.cargo_entries) {
      const localCargo = await db.cargo_entries.count();
      if (localCargo > 0) return true;
    }
    if (db.package_entries) {
      const localPkg = await db.package_entries.count();
      if (localPkg > 0) return true;
    }
  } catch {}

  // Check Supabase if online (bounded timeout to avoid hanging when offline)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    const checkRemote = async () => {
      let cargoQuery = supabase.from('cargo_entries').select('id', { count: 'exact', head: true });
      if (tenantId) cargoQuery = cargoQuery.eq('tenant_id', tenantId);
      const { count: cargoCount, error: cargoErr } = await cargoQuery;
      if (!cargoErr && typeof cargoCount === 'number' && cargoCount > 0) return true;

      let pkgQuery = supabase.from('package_entries').select('id', { count: 'exact', head: true });
      if (tenantId) pkgQuery = pkgQuery.eq('tenant_id', tenantId);
      const { count: pkgCount, error: pkgErr } = await pkgQuery;
      if (!pkgErr && typeof pkgCount === 'number' && pkgCount > 0) return true;

      return false;
    };

    const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000));
    return await Promise.race([checkRemote(), timeoutPromise]);
  } catch {}

  return false;
}
