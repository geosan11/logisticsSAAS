import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { db } from './db';
import { User } from './types';
import { matchesDestinationHub } from './incomingLogic';

export interface HubCounts {
  incoming: number;
  outbound: number;
}

export interface ConsignmentItem {
  id?: string;
  status?: string | null;
  route?: string | null;
  destination?: string | null;
  destination_route?: string | null;
  hub_id?: string | null;
}

/**
 * Returns formatted badge text capped at 99+. Returns null when count is 0 or less.
 */
export function formatBadgeCount(count: number): string | null {
  if (count <= 0 || isNaN(count)) return null;
  if (count > 99) return '99+';
  return String(count);
}

/**
 * Returns accessible human-readable ARIA label for screen readers.
 * e.g. "12 incoming" or "5 outbound"
 */
export function getAccessibleBadgeLabel(count: number, type: 'incoming' | 'outbound'): string {
  if (count <= 0 || isNaN(count)) return `0 ${type}`;
  if (count > 99) return `Over 99 ${type}`;
  return `${count} ${type}`;
}

const LOGISTICS_STOP_WORDS = new Set([
  'hub',
  'station',
  'airport',
  'cargo',
  'depot',
  'terminal',
  'air',
  'desk',
  'state',
  'center',
  'centre',
]);

/**
 * Returns significant identifying words for a hub, omitting generic logistics terms like 'hub' or 'station'.
 */
export function getSignificantHubWords(hubName: string): string[] {
  if (!hubName) return [];
  const words = hubName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const filtered = words.filter(w => !LOGISTICS_STOP_WORDS.has(w));
  return filtered.length > 0 ? filtered : words;
}

/**
 * Pure function to check if a destination route matches a given hub name.
 * Uses significant words to prevent false positives on common words like "Hub" or "Station".
 */
export function matchesDestination(destStr: string | null | undefined, hubName: string): boolean {
  if (!destStr || !hubName) return false;
  const dest = destStr.toLowerCase();
  const significant = getSignificantHubWords(hubName);
  return significant.some(w => dest.includes(w));
}

/**
 * Pure counting function for testability and offline/deterministic count derivation.
 * - incoming: In-Transit items with destination matching activeHub.name
 * - outbound: In-Transit items dispatched from activeHub.id (still on the way)
 */
export function computeHubCounts(
  items: ConsignmentItem[],
  activeHub: { id?: string | null; name: string }
): HubCounts {
  let incoming = 0;
  let outbound = 0;

  const hubName = activeHub.name || '';
  const hubId = activeHub.id || '';

  for (const item of items) {
    if (item.status !== 'In-Transit') continue;

    // Outbound: originating at this hub and still on the way
    if (hubId && item.hub_id === hubId) {
      outbound++;
    }

    // Incoming: destined for this hub and currently in-transit
    const dest = item.route || item.destination || item.destination_route || '';
    if (hubName && matchesDestination(dest, hubName)) {
      incoming++;
    }
  }

  return { incoming, outbound };
}

/**
 * Fetch live counts from Supabase using lightweight head/count and small-column queries.
 * Falls back to Dexie when offline or on network failure.
 */
export async function fetchHubCountsFromDb(
  user: { hub: string; hub_id?: string | null; role?: string },
  supabaseClient = supabase
): Promise<HubCounts> {
  // Local-only mock support for testing and visual capture
  if (typeof localStorage !== 'undefined') {
    const mockRaw = localStorage.getItem('ehi_hub_counts_mock');
    if (mockRaw) {
      try {
        const mock = JSON.parse(mockRaw);
        if (typeof mock.incoming === 'number' && typeof mock.outbound === 'number') {
          return mock;
        }
      } catch {}
    }
  }

  const hubName = user?.hub || '';
  const hubId = user?.hub_id || '';

  // 1. Try Supabase live query
  try {
    let outbound = 0;
    if (hubId) {
      const [cargoOut, pkgOut, mktOut] = await Promise.all([
        supabaseClient
          .from('cargo_entries')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('status', 'In-Transit'),
        supabaseClient
          .from('package_entries')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('status', 'In-Transit'),
        supabaseClient
          .from('marketing_entries')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('status', 'In-Transit'),
      ]);

      outbound = (cargoOut.count || 0) + (pkgOut.count || 0) + (mktOut.count || 0);
    }

    let incoming = 0;
    if (hubName) {
      const hubWords = getSignificantHubWords(hubName);

      let qCargo = supabaseClient
        .from('cargo_entries')
        .select('id, route')
        .eq('status', 'In-Transit');

      let qPkg = supabaseClient
        .from('package_entries')
        .select('id, destination')
        .eq('status', 'In-Transit');

      let qMkt = supabaseClient
        .from('marketing_entries')
        .select('id, route')
        .eq('status', 'In-Transit');

      if (hubWords.length > 0) {
        const cargoOr = hubWords.map(w => `route.ilike.%${w}%`).join(',');
        const pkgOr = hubWords.map(w => `destination.ilike.%${w}%`).join(',');
        qCargo = qCargo.or(cargoOr);
        qPkg = qPkg.or(pkgOr);
        qMkt = qMkt.or(cargoOr);
      }

      const [cargoIn, pkgIn, mktIn] = await Promise.all([
        qCargo.limit(200),
        qPkg.limit(200),
        qMkt.limit(200),
      ]);

      const cargoRows = (cargoIn.data || []).filter(c => matchesDestination(c.route, hubName));
      const pkgRows = (pkgIn.data || []).filter(p => matchesDestination(p.destination, hubName));
      const mktRows = (mktIn.data || []).filter(m => matchesDestination(m.route, hubName));

      incoming = cargoRows.length + pkgRows.length + mktRows.length;
    }

    return { incoming, outbound };
  } catch (err) {
    // Offline / Network fallback: compute from local Dexie database
    try {
      const [cargoLocal, pkgLocal, mktLocal] = await Promise.all([
        db.cargo_entries.toArray().catch(() => []),
        db.package_entries.toArray().catch(() => []),
        db.marketing_entries.toArray().catch(() => []),
      ]);

      const items: ConsignmentItem[] = [
        ...cargoLocal.map(c => ({
          status: (c.data?.status as string) || null,
          route: (c.data?.route as string) || null,
          hub_id: (c.data?.hub_id as string) || null,
        })),
        ...pkgLocal.map(p => ({
          status: (p.data?.status as string) || null,
          destination: (p.data?.destination as string) || null,
          hub_id: (p.data?.hub_id as string) || null,
        })),
        ...mktLocal.map(m => ({
          status: (m.data?.status as string) || null,
          route: (m.data?.route as string) || null,
          hub_id: (m.data?.hub_id as string) || null,
        })),
      ];

      return computeHubCounts(items, { id: hubId, name: hubName });
    } catch {
      return { incoming: 0, outbound: 0 };
    }
  }
}

/**
 * Custom React hook for live hub counts with:
 * - 60s background refresh (paused when tab hidden)
 * - Immediate refresh on tab visibility resume
 * - Optimistic decrement on ARRIVE scan and optimistic increment on DEPART scan
 */
export function useHubCounts(user: User) {
  const [counts, setCounts] = useState<HubCounts>({ incoming: 0, outbound: 0 });

  const refreshCounts = useCallback(async () => {
    if (!user || (!user.hub && !user.hub_id)) return;
    const res = await fetchHubCountsFromDb(user);
    setCounts(res);
  }, [user?.hub, user?.hub_id, user?.role]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const runFetch = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      refreshCounts();
    };

    runFetch();

    // 60-second polling cadence while tab is visible
    timer = setInterval(runFetch, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runFetch();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Event listener for instantaneous optimistic updates when a local scan completes
    const handleScanCompleted = (e: Event) => {
      const customEvent = e as CustomEvent<{
        mode: string;
        ref: string;
        hub?: string;
        destination?: string;
      }>;
      const detail = customEvent.detail;
      if (!detail) {
        refreshCounts();
        return;
      }

      if (detail.mode === 'ARRIVE') {
        // Receiving hub scans consignment in -> drop incoming count
        setCounts(prev => ({
          ...prev,
          incoming: Math.max(0, prev.incoming - 1),
        }));
      } else if (detail.mode === 'DEPART') {
        // Sending hub scans consignment out -> increment outbound count
        setCounts(prev => ({
          ...prev,
          outbound: prev.outbound + 1,
        }));
      }

      // Follow up with background DB refresh to sync truth
      setTimeout(refreshCounts, 600);
    };

    window.addEventListener('ehi-scan-completed', handleScanCompleted);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('ehi-scan-completed', handleScanCompleted);
    };
  }, [refreshCounts]);

  return { counts, setCounts, refreshCounts };
}
