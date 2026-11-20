import { db } from './db';
import { supabase } from './supabase';
import { appLogger } from './logger';
import {
  buildTagNumber,
  getTenantTagPrefix,
  setTenantTagPrefix,
  parseTagNumber,
  isValidTagNumber,
  isValidTagPrefix,
  isValidAirlineAwb,
  formatAirlineAwb,
  hasTenantIssuedTags,
  DEFAULT_TAG_PREFIX,
  TAG_PREFIX_REGEX,
  type ParsedTag,
  type BuildTagNumberOptions,
} from './tagNumber';

export {
  buildTagNumber,
  getTenantTagPrefix,
  setTenantTagPrefix,
  parseTagNumber,
  isValidTagNumber,
  isValidTagPrefix,
  isValidAirlineAwb,
  formatAirlineAwb,
  hasTenantIssuedTags,
  DEFAULT_TAG_PREFIX,
  TAG_PREFIX_REGEX,
  type ParsedTag,
  type BuildTagNumberOptions,
};

const DEFAULT_THRESHOLD = 5;
const DEFAULT_REFILL_SIZE = 20;

function isOnline(): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  } catch {
    return true;
  }
}

// Atomic pop: read the lowest reserved number for this pool and delete it
// in one Dexie transaction, so two forms/tabs popping concurrently never
// hand out the same locally-pooled number.
async function popFromPool(poolKey: string): Promise<number | null> {
  return db.transaction('rw', db.tag_pools, async () => {
    const row = await db.tag_pools.where('pool_key').equals(poolKey).sortBy('number').then(rows => rows[0]);
    if (!row) return null;
    await db.tag_pools.delete(row.id!);
    return row.number;
  });
}

async function poolCount(poolKey: string): Promise<number> {
  return db.tag_pools.where('pool_key').equals(poolKey).count();
}

function getDeviceFallbackSeed(): number {
  const KEY = 'ehi_tag_fallback_device_seed';
  try {
    const existing = Number(localStorage.getItem(KEY));
    if (existing && !isNaN(existing)) return existing;
    const seed = Math.floor(Math.random() * 900000);
    localStorage.setItem(KEY, String(seed));
    return seed;
  } catch {
    return Math.floor(Math.random() * 900000);
  }
}

function nextFallbackCounter(): number {
  const KEY = 'ehi_tag_fallback_counter';
  try {
    const next = (Number(localStorage.getItem(KEY)) || 0) + 1;
    localStorage.setItem(KEY, String(next));
    return next;
  } catch {
    return Math.floor(Math.random() * 1000);
  }
}

async function reserveBlock(poolKey: string, count: number): Promise<void> {
  try {
    const { data: blockStart, error } = await supabase.rpc('reserve_awb_block', {
      p_hub_code: poolKey,
      p_count: count,
    });
    if (error || blockStart == null) {
      appLogger.log('ERROR', 'SYNC', `reserve_awb_block failed for ${poolKey}: ${error?.message || 'no data returned'}`);
      return;
    }
    const rows = Array.from({ length: count }, (_, i) => ({ pool_key: poolKey, number: blockStart + i }));
    await db.tag_pools.bulkAdd(rows);
  } catch (err) {
    appLogger.log('ERROR', 'NETWORK', `reserve_awb_block exception for ${poolKey}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function refillPoolIfLow(
  poolKey: string,
  threshold: number = DEFAULT_THRESHOLD,
  refillSize: number = DEFAULT_REFILL_SIZE
): void {
  if (!isOnline()) return;
  poolCount(poolKey).then(count => {
    if (count < threshold) {
      void reserveBlock(poolKey, refillSize);
    }
  }).catch(() => { /* non-critical */ });
}

function formatFinalTag(sequence: number, displayPrefix?: string, poolKey?: string): string {
  if (displayPrefix) {
    const parts = displayPrefix.split('-');
    if (parts.length >= 3) {
      return buildTagNumber({
        prefix: parts[0],
        hubCode: parts[1],
        contentCode: parts[2],
        sequence,
      });
    }
    if (parts.length === 2) {
      return buildTagNumber({
        prefix: parts[0],
        hubCode: parts[1],
        contentCode: 'CG',
        sequence,
      });
    }
  }
  const poolParts = (poolKey || 'LOS').split('-');
  const hub = poolParts[0] || 'LOS';
  const content = poolParts[1] || 'CG';
  return buildTagNumber({
    prefix: getTenantTagPrefix(),
    hubCode: hub,
    contentCode: content,
    sequence,
  });
}

/**
 * Returns a fully-formatted tag string (e.g. "RED-LOS-CG-001042").
 * Centralized via buildTagNumber in src/lib/tagNumber.ts.
 */
export async function getNextTag(poolKey: string, displayPrefix?: string): Promise<string> {
  const pooled = await popFromPool(poolKey);
  if (pooled != null) {
    refillPoolIfLow(poolKey);
    return formatFinalTag(pooled, displayPrefix, poolKey);
  }

  if (isOnline()) {
    try {
      const { data: seq, error } = await supabase.rpc('next_awb_number', { p_hub_code: poolKey });
      if (!error && seq != null) {
        refillPoolIfLow(poolKey);
        return formatFinalTag(seq, displayPrefix, poolKey);
      } else {
        appLogger.log('ERROR', 'SYNC', `next_awb_number fallback failed for ${poolKey}: ${error?.message || 'no data returned'}`);
      }
    } catch (err) {
      appLogger.log('ERROR', 'NETWORK', `next_awb_number fallback exception for ${poolKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  refillPoolIfLow(poolKey);
  const seed = getDeviceFallbackSeed();
  const counter = nextFallbackCounter();
  const fallbackNum = ((seed + counter * 97) % 900000) + 100000;
  return formatFinalTag(fallbackNum, displayPrefix, poolKey);
}
