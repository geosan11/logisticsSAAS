import React from 'react';
import { formatBadgeCount, getAccessibleBadgeLabel } from '../lib/hubCounts';

export interface NavBadgeProps {
  count: number;
  type: 'incoming' | 'outbound';
  compact?: boolean;
  className?: string;
}

/**
 * Grok monochrome neutral badge pill for navigation items and screen headers.
 * Design rules:
 * - Neutral monochrome colors: bg-[var(--color-surface-3)], text-[var(--color-foreground)], border-[var(--color-border)]
 * - NEVER gold
 * - 99+ cap
 * - Disappears at 0
 * - Accessible label for screen readers
 */
export const NavBadge: React.FC<NavBadgeProps> = ({
  count,
  type,
  compact = false,
  className = '',
}) => {
  const formatted = formatBadgeCount(count);
  if (!formatted) return null;

  const accessibleLabel = getAccessibleBadgeLabel(count, type);

  if (compact) {
    return (
      <span
        role="status"
        aria-label={accessibleLabel}
        className={`inline-flex items-center justify-center font-mono font-bold text-[9px] min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] tabular-nums shadow-xs select-none pointer-events-none leading-none ${className}`}
      >
        {formatted}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={accessibleLabel}
      className={`inline-flex items-center justify-center font-mono font-semibold text-[10px] min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border)] tabular-nums shadow-xs select-none pointer-events-none leading-none ${className}`}
    >
      {formatted}
    </span>
  );
};
