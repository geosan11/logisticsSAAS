// Flight Radar's own status vocabulary (src/components/views/FlightRadar.tsx)
// -- deliberately separate from the cargo/baggage/marketing/package
// Transaction.status strings (Intake/Dispatched/Arrived/Delivered/...)
// used elsewhere, which have their own color mapping duplicated across
// Dashboard.tsx/TransactionLedger.tsx/App.tsx. Not unifying those here --
// different vocabulary, different domain, and touching those existing,
// already-working call sites is out of scope for this feature.
export type FlightStatus =
  | 'scheduled' | 'boarding' | 'departed' | 'delayed'
  | 'diverted' | 'returned' | 'cancelled' | 'landed' | 'unknown';

const FLIGHT_STATUS_META: Record<FlightStatus, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Scheduled', color: 'var(--color-muted)', bg: 'var(--color-neutral-bg)' },
  boarding: { label: 'Boarding', color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
  departed: { label: 'En Route', color: 'var(--color-info)', bg: 'var(--color-info-bg)' },
  delayed: { label: 'Delayed', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  diverted: { label: 'Diverted', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
  // Special case: a diversion whose landing airport is the same one the
  // flight departed from -- flagged separately by the caller (see
  // FlightRadar.tsx's normalizeCachedStatus) rather than inferred here,
  // since this component has no airport data to compare.
  returned: { label: 'Returned to Origin', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
  cancelled: { label: 'Cancelled', color: 'var(--color-error)', bg: 'var(--color-error-bg)' },
  landed: { label: 'Landed', color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  unknown: { label: 'Not Tracked', color: 'var(--color-muted)', bg: 'var(--color-neutral-bg)' },
};

export function flightStatusMeta(status: string): { label: string; color: string; bg: string } {
  return FLIGHT_STATUS_META[status as FlightStatus] || FLIGHT_STATUS_META.unknown;
}

export function StatusBadge({ status, size = 'md' }: { status: string; size?: 'sm' | 'md' }) {
  const meta = flightStatusMeta(status);
  const padding = size === 'sm' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? 9 : 11;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding, borderRadius: 999,
        background: meta.bg, color: meta.color,
        fontSize, fontWeight: 600, fontFamily: 'monospace',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
      {meta.label}
    </span>
  );
}
