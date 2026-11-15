import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { lockBodyScroll, unlockBodyScroll } from '../lib/bodyScrollLock';

interface PrintRangeModalProps {
  totalCount: number;
  itemLabel?: string;
  initialFrom?: number;
  initialTo?: number;
  onConfirm: (range: { from: number; to: number }) => void;
  onCancel: () => void;
}

// Deliberately "dumb" -- hands back a 1-indexed, inclusive {from, to} and
// nothing else. What that range MEANS (slice a plain array, or replace a
// Set-based multi-select) is entirely the caller's business, which is what
// lets CargoForm.tsx's batch and GatPrintQueue.tsx's queue -- two different
// selection models -- share this one component instead of each growing
// their own copy.
export const PrintRangeModal = ({
  totalCount,
  itemLabel = 'items',
  initialFrom = 1,
  initialTo,
  onConfirm,
  onCancel,
}: PrintRangeModalProps) => {
  const [from, setFrom] = useState(String(initialFrom));
  const [to, setTo] = useState(String(initialTo ?? totalCount));
  const [isClosing, setIsClosing] = useState(false);
  // Ref, not the isClosing state -- see ConfirmDialog.tsx's identical
  // comment: the keydown handler below is bound once (deps []), so reading
  // state there would always see its first-render value.
  const closingRef = useRef(false);

  const handleAction = (callback: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    setTimeout(callback, 200);
  };

  useEffect(() => {
    lockBodyScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleAction(onCancel);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlockBodyScroll();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fromNum = parseInt(from, 10);
  const toNum = parseInt(to, 10);
  const invalid =
    !Number.isFinite(fromNum) || !Number.isFinite(toNum) ||
    fromNum < 1 || toNum > totalCount || fromNum > toNum;
  const count = invalid ? 0 : toNum - fromNum + 1;
  const isFullRange = !invalid && fromNum === 1 && toNum === totalCount;

  const handleConfirm = () => {
    if (invalid) return;
    handleAction(() => onConfirm({ from: fromNum, to: toNum }));
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] ehi-scrim flex items-center justify-center p-4 ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Select print range"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleAction(onCancel);
      }}
    >
      <div
        className={`w-full max-w-sm bg-[var(--color-surface-card)] rounded-2xl border border-[var(--color-border-strong)] shadow-2xl overflow-hidden flex flex-col ${
          isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
        }`}
      >
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-[var(--color-muted)]" />
            <h3 className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">
              Select {itemLabel} to print
            </h3>
          </div>
          <button
            type="button"
            onClick={() => handleAction(onCancel)}
            aria-label="Close"
            className="p-1.5 text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <p className="text-[12px] font-sans text-[var(--color-muted)] leading-relaxed">
            {totalCount} {itemLabel} available in order added. Specifying a range replaces your current selection.
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[11px] font-sans font-medium text-[var(--color-muted)] block mb-1.5">From</label>
              <input
                type="number"
                min={1}
                max={totalCount}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full min-h-[44px] h-11 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-[13px] font-sans tabular-nums text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
              />
            </div>
            <div className="text-[var(--color-muted)] pt-6">–</div>
            <div className="flex-1">
              <label className="text-[11px] font-sans font-medium text-[var(--color-muted)] block mb-1.5">To</label>
              <input
                type="number"
                min={1}
                max={totalCount}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full min-h-[44px] h-11 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl text-[13px] font-sans tabular-nums text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setFrom('1'); setTo(String(totalCount)); }}
            className="self-start text-[12px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:underline cursor-pointer"
          >
            Select all ({totalCount} {itemLabel})
          </button>

          {invalid ? (
            <p className="text-[12px] font-sans text-[var(--color-error)]">
              Enter a valid range between 1 and {totalCount}.
            </p>
          ) : (
            <p className="text-[12px] font-sans text-[var(--color-success)]">
              {isFullRange ? `All ${totalCount} ${itemLabel} will print.` : `${count} ${itemLabel} will print (of ${totalCount}).`}
            </p>
          )}
        </div>

        <div className="p-3.5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-2.5">
          <button
            onClick={() => handleAction(onCancel)}
            className="flex-1 min-h-[44px] h-11 text-[13px] font-medium font-sans text-[var(--color-foreground)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] rounded-full transition-colors cursor-pointer border border-[var(--color-border)]"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={invalid}
            className="flex-1 min-h-[44px] h-11 text-[13px] font-semibold font-sans rounded-full cursor-pointer transition-colors bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            Print range
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
