import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, RefreshCw, LogIn, ShieldAlert, RotateCcw, Eye, Trash2 } from 'lucide-react';
import type { PendingSyncSummary } from '../lib/deviceSync';
import { Modal } from './Modal';
import { getQuarantinedDetails, discardQuarantinedRecord, type QuarantinedItemDetail } from '../lib/sync';

export interface PendingSyncBannerProps {
  summary: PendingSyncSummary;
  isSyncing?: boolean;
  isSessionExpired?: boolean;
  onSyncNow?: () => Promise<void> | void;
  /** Non-destructive re-auth (renew session). Omit on the login screen: the form is the action. */
  onSignIn?: () => void;
  /** Admins only: re-queue quarantined records. When omitted, quarantined records say "needs admin". */
  onRequeueQuarantined?: () => Promise<void> | void;
  className?: string;
}

export const PendingSyncBanner: React.FC<PendingSyncBannerProps> = ({
  summary,
  isSyncing = false,
  isSessionExpired = false,
  onSyncNow,
  onSignIn,
  onRequeueQuarantined,
  className = '',
}) => {
  const { pending_total, quarantined_count, pending_by_table } = summary;
  const [showModal, setShowModal] = useState(false);
  const [quarantinedList, setQuarantinedList] = useState<QuarantinedItemDetail[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadQuarantined = async () => {
    const list = await getQuarantinedDetails();
    setQuarantinedList(list);
  };

  useEffect(() => {
    if (showModal) {
      loadQuarantined();
    }
  }, [showModal]);

  const handleDiscard = async (table: string, id: string) => {
    const ok = await discardQuarantinedRecord(table, id);
    if (ok) {
      await loadQuarantined();
    }
  };

  if (pending_total <= 0 && quarantined_count <= 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className={`w-full shrink-0 ${className}`}
        style={{ zIndex: 30 }}
      >
        {pending_total > 0 && (
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(217,119,6,0.10) 100%)',
            borderBottom: '1px solid rgba(251,191,36,0.35)',
            boxShadow: 'var(--shadow-xs)',
          }}
          className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          {/* Information & Counts */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(251,191,36,0.2)',
                color: 'var(--color-accent-amber)',
              }}
            >
              <AlertTriangle size={15} />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 min-w-0">
              <span className="text-[12px] font-sans font-bold text-[var(--color-foreground)]">
                {pending_total} {pending_total === 1 ? 'record' : 'records'} waiting to sync on this device
              </span>

              {/* Table breakdown preview on larger screens */}
              {pending_by_table && Object.keys(pending_by_table).length > 0 && (
                <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-mono text-[var(--color-muted)]">
                  (
                  {Object.entries(pending_by_table)
                    .map(([tbl, cnt]) => `${tbl.replace('_entries', '')}: ${cnt}`)
                    .join(', ')}
                  )
                </span>
              )}
            </div>
          </div>

          {/* Action Button: Sync now OR Sign in to sync */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            {isSessionExpired ? (
              !onSignIn ? (
                <span className="text-[11px] font-sans font-bold text-[var(--color-accent-amber)]">Sign in below to sync</span>
              ) : <button
                type="button"
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95 shadow-sm"
                style={{
                  background: 'var(--color-accent-amber)',
                  color: 'var(--color-on-accent)',
                }}
              >
                <LogIn size={13} />
                <span>Renew session</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onSyncNow}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 shadow-sm"
                style={{
                  background: 'var(--color-accent-amber)',
                  color: 'var(--color-on-accent)',
                }}
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? 'Syncing...' : 'Sync now'}</span>
              </button>
            )}
          </div>
        </div>
        )}
        {quarantined_count > 0 && (
          <div
            className="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            style={{
              background: 'rgba(244,63,94,0.10)',
              borderBottom: '1px solid rgba(244,63,94,0.30)',
            }}
          >
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-sans font-bold"
              style={{ color: '#fb7185' }}
              title="Quarantined records are held locally after a permanent validation/schema rejection and are not retried by Sync now"
            >
              <ShieldAlert size={13} />
              {quarantined_count} quarantined {quarantined_count === 1 ? 'record' : 'records'}
              <span className="font-normal text-[var(--color-muted)]">
                {onRequeueQuarantined ? '— re-queue after the cause is fixed' : '— needs admin'}
              </span>
            </span>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95 bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]"
                title="View quarantined records and conflict errors"
              >
                <Eye size={12} />
                <span>Inspect</span>
              </button>
              {onRequeueQuarantined && (
                <button
                  type="button"
                  onClick={() => onRequeueQuarantined()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-sans font-bold cursor-pointer transition-all active:scale-95"
                  style={{ background: 'rgba(244,63,94,0.2)', color: '#fb7185', border: '1px solid rgba(244,63,94,0.4)' }}
                >
                  <RotateCcw size={12} />
                  <span>Re-queue</span>
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Quarantine Details Modal (Portal to body per Rule 4 and Rule 5) */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Sync Quarantine & Conflicts"
        size="xl"
      >
        <div className="p-4 sm:p-5 flex flex-col gap-4 overflow-y-auto max-h-[70vh]">
          <div className="flex items-center justify-between text-[12px] text-[var(--color-muted)]">
            <span>{quarantinedList.length} quarantined items on this device</span>
            {onRequeueQuarantined && (
              <button
                type="button"
                onClick={async () => {
                  if (onRequeueQuarantined) await onRequeueQuarantined();
                  await loadQuarantined();
                }}
                className="px-3 py-1 rounded bg-[rgba(251,191,36,0.18)] text-[var(--color-accent-amber)] font-bold font-mono text-[11px] border border-[rgba(251,191,36,0.35)]"
              >
                Re-queue All
              </button>
            )}
          </div>

          {quarantinedList.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-[var(--color-muted)] font-mono">
              No quarantined records currently stored in Dexie.
            </div>
          ) : (
            <div className="space-y-3">
              {quarantinedList.map((item) => (
                <div
                  key={`${item.table}-${item.id}`}
                  className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)]">
                        {item.table}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--color-foreground)] ml-2">
                        {item.id}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="text-[10px] font-mono text-[var(--color-muted)] hover:text-[var(--color-foreground)] underline cursor-pointer"
                      >
                        {expandedId === item.id ? 'Hide JSON' : 'View Payload'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscard(item.table, item.id)}
                        title="Discard record from local queue"
                        className="p-1 text-[var(--color-muted)] hover:text-[var(--color-error)] cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {item.error && (
                    <div className="text-[11px] font-mono text-[#fb7185] bg-[rgba(244,63,94,0.08)] p-2 rounded border border-[rgba(244,63,94,0.2)]">
                      {item.error}
                    </div>
                  )}

                  {expandedId === item.id && (
                    <pre className="text-[10px] font-mono p-2.5 rounded bg-[var(--color-surface-2)] overflow-x-auto max-h-48 border border-[var(--color-border)] text-[var(--color-foreground)]">
                      {JSON.stringify(item.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </AnimatePresence>
  );
};
