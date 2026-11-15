import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface PaymentNarrationBoxProps {
  narrationCode: string;
}

export const PaymentNarrationBox: React.FC<PaymentNarrationBoxProps> = ({ narrationCode }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(narrationCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!narrationCode) return null;

  return (
    <div className="mt-3.5 p-3.5 border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)]">
      <div className="text-[12px] font-sans font-medium text-[var(--color-muted)] mb-2">
        Payment narration — share with customer
      </div>
      <div className="flex items-center justify-between bg-[var(--color-surface-1)] p-3 rounded-xl border border-[var(--color-border)] gap-3">
        <span className="font-mono text-[16px] font-bold text-[var(--color-foreground)] tracking-wider tabular-nums">
          {narrationCode}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy payment narration code"
          className="min-h-[44px] h-11 px-3.5 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] rounded-lg transition-colors text-[12px] font-sans font-medium flex items-center gap-1.5 cursor-pointer border border-[var(--color-border)] shrink-0"
        >
          {copied ? (
            <>
              <Check size={14} className="text-[var(--color-success)]" />
              <span className="text-[var(--color-success)]">Copied</span>
            </>
          ) : (
            <>
              <Copy size={14} className="text-[var(--color-muted)]" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="text-[11px] font-sans text-[var(--color-muted)] mt-2">
        Ask customer to type this code in the transfer narration / description.
      </div>
    </div>
  );
};
