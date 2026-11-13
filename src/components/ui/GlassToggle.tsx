const SIZES = {
  md: { track: 'w-[52px] h-[28px]', knob: 'w-[22px] h-[22px]', travel: 24 },
  sm: { track: 'w-[34px] h-[18px]', knob: 'w-[14px] h-[14px]', travel: 16 },
};

export const GlassToggle = ({
  checked,
  onChange,
  size = 'md',
}: {
  checked: boolean;
  onChange: () => void;
  size?: keyof typeof SIZES;
}) => {
  const { track, knob, travel } = SIZES[size];
  return (
    <button
      type="button"
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      className={`relative ${track} rounded-full p-0.5 transition-all duration-200 ease-in-out cursor-pointer outline-none shrink-0`}
      style={{
        background: checked
          ? 'var(--color-primary-pill)'
          : 'var(--color-surface-2)',
        border: checked ? '1px solid var(--color-primary-pill)' : '1px solid var(--color-border-strong)',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <span
        className={`block ${knob} rounded-full transition-all duration-200 ease-in-out shadow-sm border`}
        style={{
          transform: checked ? `translateX(${travel}px)` : 'translateX(0)',
          background: checked ? 'var(--color-primary-pill-text)' : 'var(--color-surface-card)',
          borderColor: checked ? 'var(--color-primary-pill-text)' : 'var(--color-border-strong)',
        }}
      />
    </button>
  );
};
