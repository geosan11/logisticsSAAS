import { fmt } from '../lib/helpers';

// Shown only when a wallet is selected but its balance is LESS than the amount
// due. Lets staff pick how the leftover is collected. Controlled by the parent.
export const WalletRemainderSelector = ({
  walletName, coverage, remainder, mode, bank, onModeChange, onBankChange, banks = [],
}: {
  walletName: string;
  coverage: number;
  remainder: number;
  mode: 'Cash' | 'Transfer' | 'POS';
  bank: string;
  onModeChange: (m: 'Cash' | 'Transfer' | 'POS') => void;
  onBankChange: (b: string) => void;
  banks?: string[];
}) => (
  <div className="mt-2 p-3.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] space-y-3">
    <div className="text-[12px] font-sans text-[var(--color-foreground)]">
      <span>{walletName}&apos;s wallet covers </span>
      <span className="font-semibold text-[var(--color-success)] tabular-nums">₦{fmt(coverage)}</span>.
      <span> Collect remaining </span>
      <span className="font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(remainder)}</span>
      <span> by:</span>
    </div>
    <div className="flex gap-2">
      {(['Cash', 'Transfer', 'POS'] as const).map(m => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          className={`flex-1 min-h-[44px] h-11 rounded-full text-[12px] font-sans font-medium transition-colors cursor-pointer select-none flex items-center justify-center ${
            mode === m
              ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)] shadow-xs'
              : 'bg-[var(--color-surface-1)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
    {(mode === 'Transfer' || mode === 'POS') && (
      banks.length > 0 ? (
        <select
          value={bank}
          onChange={e => onBankChange(e.target.value)}
          aria-label="Select bank or terminal"
          className="w-full min-h-[44px] h-11 px-3 text-[13px] font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
        >
          <option value="">Select bank…</option>
          {banks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      ) : (
        <input
          value={bank}
          onChange={e => onBankChange(e.target.value)}
          placeholder="Bank / POS terminal"
          aria-label="Bank or POS terminal name"
          className="w-full min-h-[44px] h-11 px-3 text-[13px] font-sans rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:border-[var(--color-border-strong)]"
        />
      )
    )}
  </div>
);
