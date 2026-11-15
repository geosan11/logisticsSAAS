import { useState, useEffect } from 'react';
import { useToast } from '../lib/ToastContext';

export type Terminal = 'MMA2' | 'GAT';
const KEY = 'ehi_active_terminal';

// Persisted per device (not per user/session) -- a GAT agent sets it once
// per shift rather than flipping it on every single entry.
//
// forceValue lets a caller (the dedicated GAT workspace) pin the terminal
// without reading or writing localStorage -- GAT-tab sales always tag GAT
// regardless of what this device's persisted setting says, and leave that
// setting untouched for when the user goes back to a normal Cargo tab.
export function usePersistedTerminal(forceValue?: Terminal): [Terminal, (t: Terminal) => void] {
  const { showToast } = useToast();
  const [terminal, setTerminalState] = useState<Terminal>(() => {
    if (forceValue) return forceValue;
    const v = localStorage.getItem(KEY);
    return v === 'GAT' ? 'GAT' : 'MMA2';
  });
  useEffect(() => {
    if (forceValue) setTerminalState(forceValue);
  }, [forceValue]);
  useEffect(() => {
    if (forceValue) return;
    try { localStorage.setItem(KEY, terminal); } catch { /* ignore */ }
  }, [terminal, forceValue]);
  // Explicit confirmation on every real toggle -- this setting is easy to
  // miss (a small segmented control amid other form fields) and silently
  // submitting under the wrong terminal means an entry never shows up in
  // the GAT print queue at all. No-ops (re-clicking the already-active
  // option) don't re-toast. The comparison happens here against the
  // closure-captured `terminal`, not inside the setState updater -- this
  // app runs in StrictMode, which intentionally double-invokes functional
  // state updaters in development to catch impure ones; a showToast() call
  // inside an updater would fire twice for one real toggle.
  const setTerminal = (t: Terminal) => {
    if (forceValue) return;
    if (terminal !== t) showToast({ message: `Switched to ${t}`, type: 'info' });
    setTerminalState(t);
  };
  return [terminal, setTerminal];
}

// Compact MMA2/GAT segmented control, Grok monochrome style with 44px tap targets.
export const TerminalSwitch = ({ value, onChange }: { value: Terminal; onChange: (t: Terminal) => void }) => (
  <div className="flex items-center p-1 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] shrink-0">
    {(['MMA2', 'GAT'] as const).map(t => (
      <button
        key={t}
        type="button"
        onClick={() => onChange(t)}
        aria-pressed={value === t}
        className={`min-h-[44px] h-11 px-3.5 text-[12px] font-sans font-medium rounded-lg transition-colors cursor-pointer select-none ${
          value === t
            ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)] shadow-xs'
            : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
        }`}
      >
        {t}
      </button>
    ))}
  </div>
);
