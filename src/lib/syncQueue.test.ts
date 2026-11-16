import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { db, SyncQueueItem } from './db';
import { supabase } from './supabase';
import { _resetDeviceSyncStateForTesting } from './deviceSync';
import {
  writeWithOfflineSupport,
  processSyncQueue,
  requeueQuarantined,
  cleanupOldQueue,
  FK_VIOLATION_MAX_RETRIES,
} from './sync';

describe('Sync Queue (Background Sync, Retry & Deduplication)', () => {
  let originalDb: any;
  let originalSupabaseFrom: any;
  let originalSupabaseAuthGetSession: any;
  let originalSupabaseRpc: any;
  let queueStore: any[];
  let localTables: Record<string, any[]>;
  let nextQueueId: number;

  beforeEach(() => {
    _resetDeviceSyncStateForTesting();
    queueStore = [];
    localTables = {
      cargo_entries: [],
      manifests: [],
      marketing_entries: [],
      package_entries: [],
    };
    nextQueueId = 1;

    originalSupabaseFrom = (supabase as any).from;
    originalSupabaseAuthGetSession = (supabase as any).auth?.getSession;
    originalSupabaseRpc = (supabase as any).rpc;

    if ((supabase as any).auth) {
      (supabase as any).auth.getSession = async () => ({ data: { session: null } });
    }
    (supabase as any).rpc = async () => ({ data: null, error: null });

    // Create a mock table builder for db tables
    const createMockTable = (name: string, isQueue = false) => {
      return {
        put: async (record: any) => {
          const list = isQueue ? queueStore : localTables[name];
          const idx = list.findIndex((r) => r.id === record.id);
          if (idx !== -1) list[idx] = record;
          else list.push(record);
        },
        add: async (record: any) => {
          const item = { ...record, id: isQueue ? nextQueueId++ : record.id };
          const list = isQueue ? queueStore : localTables[name];
          list.push(item);
          return item.id;
        },
        delete: async (id: any) => {
          const list = isQueue ? queueStore : localTables[name];
          const idx = list.findIndex((r) => r.id === id);
          if (idx !== -1) list.splice(idx, 1);
        },
        update: async (id: any, changes: any) => {
          const list = isQueue ? queueStore : localTables[name];
          const item = list.find((r) => r.id === id);
          if (item) Object.assign(item, changes);
        },
        where: (field: string) => {
          return {
            equals: (val: any) => {
              const getFiltered = () => {
                const list = isQueue ? queueStore : localTables[name];
                return list.filter((r) => r[field] === val);
              };
              return {
                toArray: async () => getFiltered(),
                first: async () => getFiltered()[0] || null,
                delete: async () => {
                  const list = isQueue ? queueStore : localTables[name];
                  for (let i = list.length - 1; i >= 0; i--) {
                    if (list[i][field] === val) list.splice(i, 1);
                  }
                },
                modify: async (changes: any) => {
                  const list = isQueue ? queueStore : localTables[name];
                  list.filter((r) => r[field] === val).forEach((r) => Object.assign(r, changes));
                },
              };
            },
            below: (cutoff: string) => ({
              and: (predicate: (item: any) => boolean) => ({
                delete: async () => {
                  const list = isQueue ? queueStore : localTables[name];
                  for (let i = list.length - 1; i >= 0; i--) {
                    if (list[i][field] < cutoff && predicate(list[i])) {
                      list.splice(i, 1);
                    }
                  }
                },
              }),
            }),
          };
        },
      };
    };

    (db as any).sync_queue = createMockTable('sync_queue', true);
    (db as any).cargo_entries = createMockTable('cargo_entries');
    (db as any).manifests = createMockTable('manifests');
    (db as any).marketing_entries = createMockTable('marketing_entries');
    (db as any).package_entries = createMockTable('package_entries');
  });

  afterEach(() => {
    (supabase as any).from = originalSupabaseFrom;
    if ((supabase as any).auth && originalSupabaseAuthGetSession) {
      (supabase as any).auth.getSession = originalSupabaseAuthGetSession;
    }
    (supabase as any).rpc = originalSupabaseRpc;
    _resetDeviceSyncStateForTesting();
  });

  test('writeWithOfflineSupport saves locally first and adds to sync queue', async () => {
    // Mock Supabase failure (e.g. offline)
    (supabase as any).from = () => ({
      upsert: async () => ({ error: { message: 'Network disconnected' } }),
    });

    const payload = { id: 'CARGO-001', consignee_name: 'Alhaji Musa', amount: 45000 };
    const res = await writeWithOfflineSupport('cargo_entries', payload);

    assert.strictEqual(res.offline, true);

    // Verify local mirror table has the row
    const local = localTables.cargo_entries.find((r) => r.id === 'CARGO-001');
    assert.ok(local, 'Local mirror must exist immediately');
    assert.strictEqual(local.synced, 0);

    // Verify sync_queue holds the row
    const queued = queueStore.find((q) => q.record_id === 'CARGO-001');
    assert.ok(queued, 'Must be queued in sync_queue');
    assert.strictEqual(queued.table_name, 'cargo_entries');
    assert.strictEqual(queued.synced, 0);
  });

  test('writeWithOfflineSupport prevents duplicate items in sync_queue for same record_id', async () => {
    (supabase as any).from = () => ({
      upsert: async () => ({ error: { message: 'Offline' } }),
    });

    const payload = { id: 'PKG-100', customer_name: 'Grace Motors', amount: 12000 };

    await writeWithOfflineSupport('package_entries', payload);
    assert.strictEqual(queueStore.length, 1);

    // Re-attempt write for the same record_id
    await writeWithOfflineSupport('package_entries', payload);
    assert.strictEqual(queueStore.length, 1, 'Sync queue must not contain duplicate items for same record_id');
  });

  test('processSyncQueue processes items in FIFO order and marks synced when online', async () => {
    const upsertLog: string[] = [];
    (supabase as any).from = (table: string) => ({
      upsert: async (row: any) => {
        upsertLog.push(row.entry_ref || row.transaction_id || row.id);
        return { error: null };
      },
    });

    // Seed 3 items in FIFO order
    queueStore.push(
      { id: 1, table_name: 'cargo_entries', record_id: 'C-1', payload: { entry_ref: 'C-1', id: 'C-1' }, synced: 0, created_at: '2026-11-16T10:00:00Z' },
      { id: 2, table_name: 'cargo_entries', record_id: 'C-2', payload: { entry_ref: 'C-2', id: 'C-2' }, synced: 0, created_at: '2026-11-16T10:01:00Z' },
      { id: 3, table_name: 'cargo_entries', record_id: 'C-3', payload: { entry_ref: 'C-3', id: 'C-3' }, synced: 0, created_at: '2026-11-16T10:02:00Z' }
    );
    localTables.cargo_entries.push(
      { id: 'C-1', synced: 0 },
      { id: 'C-2', synced: 0 },
      { id: 'C-3', synced: 0 }
    );

    const result = await processSyncQueue();

    assert.strictEqual(result.synced, 3);
    assert.deepStrictEqual(upsertLog, ['C-1', 'C-2', 'C-3'], 'Must process in strict order');
    assert.strictEqual(queueStore.length, 0, 'Sync queue items must be deleted after successful sync');

    // Local mirror rows should now be synced: 1
    assert.strictEqual(localTables.cargo_entries[0].synced, 1);
    assert.strictEqual(localTables.cargo_entries[1].synced, 1);
    assert.strictEqual(localTables.cargo_entries[2].synced, 1);
  });

  test('processSyncQueue increments retryCount on foreign key violation (23503)', async () => {
    (supabase as any).from = () => ({
      upsert: async () => ({ error: { code: '23503', message: 'foreign_key_violation' } }),
    });

    queueStore.push({
      id: 10,
      table_name: 'cargo_entries',
      record_id: 'C-FK',
      payload: { entry_ref: 'C-FK' },
      synced: 0,
      retryCount: 0,
    });
    localTables.cargo_entries.push({ id: 'C-FK', synced: 0 });

    const result = await processSyncQueue();

    assert.strictEqual(result.synced, 0);
    assert.strictEqual(queueStore.length, 1, 'FK violation should remain in queue for retry');
    assert.strictEqual(queueStore[0].retryCount, 1, 'retryCount must be incremented');
    assert.strictEqual(localTables.cargo_entries[0].synced, 0, 'Local record remains unsynced');
  });

  test('processSyncQueue quarantines permanent errors into synced: 2 and deletes from queue', async () => {
    // Unique violation (23505) is in PERMANENT_PG_CODES
    (supabase as any).from = () => ({
      upsert: async () => ({ error: { code: '23505', message: 'unique_violation (duplicate)' } }),
    });

    queueStore.push({
      id: 20,
      table_name: 'cargo_entries',
      record_id: 'C-PERM',
      payload: { entry_ref: 'C-PERM', id: 'C-PERM' },
      synced: 0,
    });
    localTables.cargo_entries.push({ id: 'C-PERM', synced: 0 });

    const result = await processSyncQueue();

    assert.strictEqual(result.synced, 0);
    assert.strictEqual(queueStore.length, 0, 'Quarantined item must be removed from queue to prevent blocking');

    // Local record should be marked quarantined (synced: 2) with sync_error
    const local = localTables.cargo_entries.find((r) => r.id === 'C-PERM');
    assert.strictEqual(local.synced, 2);
    assert.ok(local.sync_error.includes('23505'));
  });

  test('requeueQuarantined recovers synced: 2 rows back to sync_queue', async () => {
    localTables.cargo_entries.push({
      id: 'C-REVIVE',
      synced: 2,
      data: { entry_ref: 'C-REVIVE', consignee_name: 'Revived' },
      sync_error: '23505: duplicate',
    });

    const count = await requeueQuarantined();
    assert.strictEqual(count, 1);

    const requeued = queueStore.find((q) => q.record_id === 'C-REVIVE');
    assert.ok(requeued, 'Must be restored to sync_queue');
    assert.strictEqual(requeued.synced, 0);
  });

  test('cleanupOldQueue deletes only synced: 1 items older than 7 days, preserving unsynced', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - 1 * 86400000).toISOString();

    queueStore.push(
      { id: 1, table_name: 'cargo_entries', record_id: 'OLD-SYNCED', synced: 1, created_at: eightDaysAgo },
      { id: 2, table_name: 'cargo_entries', record_id: 'OLD-UNSYNCED', synced: 0, created_at: eightDaysAgo },
      { id: 3, table_name: 'cargo_entries', record_id: 'RECENT-SYNCED', synced: 1, created_at: oneDayAgo }
    );

    await cleanupOldQueue();

    assert.strictEqual(queueStore.some((q) => q.record_id === 'OLD-SYNCED'), false, 'Old synced item must be pruned');
    assert.strictEqual(queueStore.some((q) => q.record_id === 'OLD-UNSYNCED'), true, 'Old unsynced item must NEVER be pruned');
    assert.strictEqual(queueStore.some((q) => q.record_id === 'RECENT-SYNCED'), true, 'Recent synced item must remain');
  });
});
