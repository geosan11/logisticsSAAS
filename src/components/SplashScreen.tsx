import ehiLogo from '../assets/branding/ehi-logo.png';

// Shown full-screen whenever the app has nothing else to show yet (auth
// session check on boot, etc). Pure CSS vars for color -- inherits
// whichever theme class is already on <html> (set synchronously before
// React even mounts, see index.html's inline script), so this never
// flashes the wrong theme the way a hardcoded-color screen would.
export const SplashScreen = ({ label = 'Loading your workspace' }: { label?: string }) => {
  return (
    <div
      className="flex flex-col items-center justify-center overflow-y-auto"
      style={{
        // Fixed height, not minHeight -- html/body are `position: fixed;
        // overflow: hidden` globally (src/index.css), so a div that's only
        // bottom-bounded (minHeight) can grow past the viewport on a short
        // screen with the overflow silently clipped by body and no way to
        // scroll to it. See LoginScreen.tsx for the fuller version of this.
        height: '100dvh',
        width: '100%',
        background: 'var(--color-obsidian)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <img
        src={ehiLogo}
        alt="Haulwey"
        className="ehi-splash-logo"
        style={{
          width: 'clamp(96px, 30vw, 160px)',
          height: 'auto',
          objectFit: 'contain',
        }}
      />

      <div className="flex items-center gap-1.5 mt-7" aria-hidden="true">
        <span className="ehi-splash-dot" style={{ animationDelay: '0ms' }} />
        <span className="ehi-splash-dot" style={{ animationDelay: '160ms' }} />
        <span className="ehi-splash-dot" style={{ animationDelay: '320ms' }} />
      </div>

      <div
        role="status"
        aria-live="polite"
        className="mt-4 text-[11px] font-mono uppercase tracking-widest text-center px-6"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </div>
    </div>
  );
};
