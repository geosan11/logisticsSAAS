import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, X } from 'lucide-react';
import { fmt } from '../../lib/helpers';

interface ReviewEntryModalProps {
  title: string;
  details: { label: string; value: string | number }[];
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  isSubmitting?: boolean;
}

export const ReviewEntryModal: React.FC<ReviewEntryModalProps> = ({
  title,
  details,
  onConfirm,
  onCancel,
  confirmText = 'Confirm & log entry',
  isSubmitting = false
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!isSubmitting) firedRef.current = false;
  }, [isSubmitting]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const handleClose = (action: () => void) => {
    if (isClosing || isSubmitting) return;
    setIsClosing(true);
    setTimeout(() => {
      action();
    }, 200);
  };

  const handleConfirmClick = () => {
    if (firedRef.current || isSubmitting || isClosing) return;
    firedRef.current = true;
    onConfirm();
  };

  // Portaled directly into document.body -- not nested inside whatever
  // page/tab/form wrapper happens to render this component. Any ancestor
  // that sets transform/filter/will-change/perspective silently turns
  // itself into a CSS containing block for this modal's own
  // `position: fixed`, breaking its centering.
  return createPortal(
    <div
      className={`fixed inset-0 w-screen h-screen ehi-scrim z-[999999] flex items-center justify-center p-3 sm:p-4 select-none ${
        isClosing ? 'animate-modal-backdrop-out' : 'animate-modal-backdrop-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose(onCancel);
      }}
    >
      <div
        className={`bg-[var(--color-surface-card)] border border-[var(--color-border-strong)] rounded-2xl w-full max-w-md h-auto max-h-[85vh] flex flex-col overflow-hidden shadow-2xl ${
          isClosing ? 'animate-modal-slide-out' : 'animate-modal-slide-in'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
          <h3 className="text-[15px] font-semibold font-sans text-[var(--color-foreground)]">
            {title}
          </h3>
          <button
            onClick={() => handleClose(onCancel)}
            disabled={isSubmitting}
            aria-label="Close"
            className="p-1.5 hover:bg-[var(--color-surface-hover)] rounded-lg text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-2 overflow-y-auto flex-1 min-h-0 divide-y divide-[var(--color-border)]">
          {details.map((detail, idx) => (
            <div key={idx} className="flex justify-between items-center py-3">
              <span className="text-[12px] font-sans font-medium text-[var(--color-muted)] shrink-0">{detail.label}</span>
              <span className={`text-[13px] font-sans font-semibold text-right truncate max-w-[65%] ml-2 ${
                detail.label.toLowerCase().includes('amount') ? 'text-[var(--color-foreground)] tabular-nums' : 'text-[var(--color-foreground)]'
              }`}>
                {detail.label.toLowerCase().includes('amount') && typeof detail.value === 'number' ? `₦${fmt(detail.value)}` : detail.value}
              </span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-3 shrink-0">
          <button
            onClick={() => handleClose(onCancel)}
            disabled={isSubmitting}
            className="flex-1 min-h-[44px] h-11 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[13px] font-medium hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={isSubmitting}
            className="flex-1 min-h-[44px] h-11 flex items-center justify-center gap-2 rounded-full text-[13px] font-semibold transition-colors bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 disabled:opacity-40 cursor-pointer shadow-xs"
          >
            {isSubmitting ? (
              <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 size={16} />
                <span>{confirmText}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
