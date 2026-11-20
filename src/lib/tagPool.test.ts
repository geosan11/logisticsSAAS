import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db';
import { supabase } from './supabase';
import { getNextTag, refillPoolIfLow } from './tagPool';

describe('Tag Number Allocation & Pool Concurrency', () => {
  let originalTransaction: any;
  let originalTagPools: any;
  let originalRpc: any;
  let poolStore: Array<{ id: number; pool_key: string; number: number }>;
  let currentId: number;

  beforeEach(() => {
    poolStore = [];
    currentId = 1;

    // Save originals
    originalTransaction = (db as any).transaction;
    originalTagPools = (db as any).tag_pools;
    originalRpc = (supabase as any).rpc;

    // Mutex to simulate Dexie read-write transactions in node
    let lockPromise: Promise<void> = Promise.resolve();
    (db as any).transaction = async (_mode: string, _table: any, fn: () => Promise<any>) => {
      const currentLock = lockPromise;
      let releaseLock: () => void;
      lockPromise = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      await currentLock;
      try {
        return await fn();
      } finally {
        releaseLock!();
      }
    };

    (db as any).tag_pools = {
      where: (field: string) => ({
        equals: (key: string) => ({
          sortBy: async (col: string) => {
            const matches = poolStore
              .filter((r: any) => r[field] === key)
              .sort((a: any, b: any) => a[col] - b[col]);
            return matches;
          },
          count: async () => poolStore.filter((r: any) => r[field] === key).length,
        }),
      }),
      delete: async (id: number) => {
        const idx = poolStore.findIndex((r) => r.id === id);
        if (idx !== -1) {
          poolStore.splice(idx, 1);
        }
      },
      bulkAdd: async (rows: Array<{ pool_key: string; number: number }>) => {
        for (const row of rows) {
          poolStore.push({ id: currentId++, pool_key: row.pool_key, number: row.number });
        }
      },
    };
  });

  afterEach(() => {
    (db as any).transaction = originalTransaction;
    (db as any).tag_pools = originalTagPools;
    (supabase as any).rpc = originalRpc;
  });

  test('pops available tags sequentially in ascending order', async () => {
    // Seed pool with 3 numbers
    await db.tag_pools.bulkAdd([
      { pool_key: 'LOS', number: 100 },
      { pool_key: 'LOS', number: 101 },
      { pool_key: 'LOS', number: 102 },
    ]);

    const tag1 = await getNextTag('LOS', 'HWY-LOS-CG');
    const tag2 = await getNextTag('LOS', 'HWY-LOS-CG');
    const tag3 = await getNextTag('LOS', 'HWY-LOS-CG');

    assert.strictEqual(tag1, 'HWY-LOS-CG-000100');
    assert.strictEqual(tag2, 'HWY-LOS-CG-000101');
    assert.strictEqual(tag3, 'HWY-LOS-CG-000102');

    // Pool should now be empty
    const remaining = await db.tag_pools.where('pool_key').equals('LOS').count();
    assert.strictEqual(remaining, 0);
  });

  test('no duplicate tag allocation under 50 concurrent pops', async () => {
    // Pre-fill pool with 50 numbers
    const prefill = Array.from({ length: 50 }, (_, i) => ({
      pool_key: 'ABV',
      number: 5000 + i,
    }));
    await db.tag_pools.bulkAdd(prefill);

    // Concurrently trigger 50 pops at once
    const popPromises = Array.from({ length: 50 }, () =>
      getNextTag('ABV', 'HWY-ABV-CG')
    );

    const results = await Promise.all(popPromises);

    // Verify all 50 tags are returned
    assert.strictEqual(results.length, 50);

    // Verify zero duplicates
    const uniqueSet = new Set(results);
    assert.strictEqual(
      uniqueSet.size,
      50,
      `Expected 50 unique tags, but found duplicate! Unique count: ${uniqueSet.size}`
    );

    // Verify pool is completely depleted
    const remaining = await db.tag_pools.where('pool_key').equals('ABV').count();
    assert.strictEqual(remaining, 0);
  });

  test('pool empty fallback uses sequential seed counter when offline', async () => {
    // Ensure pool is empty
    const remaining = await db.tag_pools.where('pool_key').equals('KAN').count();
    assert.strictEqual(remaining, 0);

    // Mock RPC failure (simulating offline / network error)
    (supabase as any).rpc = async () => ({
      data: null,
      error: { message: 'Failed to fetch (offline)' },
    });

    // Request multiple fallback tags
    const fallback1 = await getNextTag('KAN', 'HWY-KAN-PKG');
    const fallback2 = await getNextTag('KAN', 'HWY-KAN-PKG');

    assert.match(fallback1, /^HWY-KAN-PKG-\d{6}$/);
    assert.match(fallback2, /^HWY-KAN-PKG-\d{6}$/);
    assert.notStrictEqual(fallback1, fallback2, 'Emergency fallback tags must not collide on the same device');
  });

  test('refillPoolIfLow invokes reserve_awb_block when pool count is below threshold', async () => {
    let rpcCalled = false;
    let requestedCount = 0;

    (supabase as any).rpc = async (rpcName: string, params: any) => {
      if (rpcName === 'reserve_awb_block') {
        rpcCalled = true;
        requestedCount = params.p_count;
        return { data: 9000, error: null };
      }
      return { data: null, error: null };
    };

    // Pool count is 0 (< default threshold 5)
    refillPoolIfLow('PHC', 5, 20);

    // Wait a brief microtask tick for the fire-and-forget promise to execute
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(rpcCalled, true, 'reserve_awb_block RPC should have been called');
    assert.strictEqual(requestedCount, 20, 'Requested refill batch size should match');
  });
});
