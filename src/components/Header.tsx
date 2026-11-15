import {
  WifiOff,
  LogOut,
  ChevronDown,
  RefreshCw,
  Building2,
  Plane,
  Truck,
  Layers,
} from 'lucide-react';
import { User } from '../lib/types';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Theme } from '../lib/useTheme';
import { getHubCode } from '../lib/helpers';
import { useConfirm } from '../lib/ConfirmContext';
import { useLogisticsMode } from '../lib/modeContext';

import ehiLogo from '../assets/branding/ehi-logo.png';

export const Header = ({
  user,
  isOffline,
  pendingCount,
  onToggleWifi,
  onLogout,
  theme: _theme,
  onToggleTheme: _onToggleTheme,
  onManualSync,
  stateWideView,
  onToggleStateWideView,
  docked = false,
  onCloseOverlay: _onCloseOverlay,
}: {
  user: User;
  isOffline: boolean;
  pendingCount: number;
  onToggleWifi: () => void;
  onLogout: () => void;
  theme?: Theme;
  onToggleTheme?: () => void;
  onManualSync?: () => void;
  stateWideView?: boolean;
  onToggleStateWideView?: () => void;
  docked?: boolean;
  onCloseOverlay?: () => void;
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const confirm = useConfirm();
  const { mode, setMode } = useLogisticsMode();

  const getRoleDisplay = (role: string) => {
    switch (role) {
      case 'cargo_agent': return 'Cargo Agent';
      case 'baggage_agent': return user.assigned_airline ? `${user.assigned_airline} POS` : 'Baggage POS';
      case 'marketing_agent': return 'Marketing';
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Admin';
      case 'accountant': return 'Accountant';
      case 'auditor': return 'Auditor';
      case 'driver': return 'Driver';
      default: return 'Agent';
    }
  };

  const getRoleColor = (role: string): { bg: string; border: string; text: string } => {
    switch (role) {
      case 'super_admin': return { bg: 'var(--color-surface-2)', border: 'var(--color-border-strong)', text: 'var(--color-foreground)' };
      case 'admin': return { bg: 'var(--color-surface-2)', border: 'var(--color-border)', text: 'var(--color-foreground)' };
      case 'cargo_agent': return { bg: 'var(--color-success-bg)', border: 'var(--color-success-border)', text: 'var(--color-success-fg)' };
      case 'baggage_agent': return { bg: 'var(--color-purple-bg)', border: 'var(--color-purple-border)', text: 'var(--color-purple-fg)' };
      case 'accountant': return { bg: 'var(--color-info-bg)', border: 'var(--color-info-border)', text: 'var(--color-info-fg)' };
      case 'auditor': return { bg: 'var(--color-warning-bg)', border: 'var(--color-warning-border)', text: 'var(--color-warning-fg)' };
      case 'driver': return { bg: 'var(--color-neutral-bg)', border: 'var(--color-neutral-border)', text: 'var(--color-neutral-fg)' };
      case 'marketing_agent': return { bg: 'var(--color-success-bg)', border: 'var(--color-success-border)', text: 'var(--color-success-fg)' };
      default: return { bg: 'var(--color-surface-2)', border: 'var(--color-border)', text: 'var(--color-foreground)' };
    }
  };

  return (
    <div className="flex flex-col w-full shrink-0 z-40 relative">
      <div
        className="ehi-header-row flex items-center justify-between gap-2 px-3 sm:px-4 min-h-[52px] h-[52px] flex-nowrap"
        style={{
          background: 'var(--color-nav-bg)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {/* Left Area: Mobile Brand & Dynamic Slot */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <div className="flex md:hidden items-center gap-2 ehi-header-brand shrink-0">
            <img
              src={ehiLogo}
              alt="EHI Multisystems"
              className="rounded-md"
              style={{ height: 26, width: 'auto', objectFit: 'contain' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* Dynamic Slot for Ledger Left Controls (Back button + Title & Entry count) */}
          <div
            data-ehi-header-left-slot
            className="flex items-center gap-2 min-w-0 empty:hidden"
          />
        </div>

        {/* Right controls: Single quiet unified row */}
        <div className="ehi-header-controls flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto justify-end">
          {/* Dynamic Slot for Ledger Secondary Navigation Controls (Filters, Export, Debt Log, 80mm, Manifest) */}
          <div
            data-ehi-header-right-slot
            className="flex items-center gap-1.5 empty:hidden pr-1 border-r border-[var(--color-border)]"
          />

          {/* Logistics Mode Switcher (Air / Road / Intermodal) - Readable text and 44px touch targets */}
          <div
            className="flex items-center p-0.5 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] shrink-0"
            role="group"
            aria-label="Logistics Mode"
          >
            <button
              type="button"
              onClick={() => setMode('air')}
              title="Air Logistics Mode"
              aria-pressed={mode === 'air'}
              className={`min-h-[44px] px-2.5 sm:px-3 rounded-full flex items-center gap-1 font-sans text-[10px] sm:text-[11px] font-semibold tracking-wide transition-all cursor-pointer select-none ${
                mode === 'air'
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-sm'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-transparent'
              }`}
              style={{ minWidth: 44 }}
            >
              <Plane size={12} strokeWidth={mode === 'air' ? 2.5 : 2} className="shrink-0" />
              <span>AIR</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('road')}
              title="Road Logistics Mode"
              aria-pressed={mode === 'road'}
              className={`min-h-[44px] px-2.5 sm:px-3 rounded-full flex items-center gap-1 font-sans text-[10px] sm:text-[11px] font-semibold tracking-wide transition-all cursor-pointer select-none ${
                mode === 'road'
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-sm'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-transparent'
              }`}
              style={{ minWidth: 44 }}
            >
              <Truck size={12} strokeWidth={mode === 'road' ? 2.5 : 2} className="shrink-0" />
              <span>ROAD</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('intermodal')}
              title="Unified Intermodal Mode (Air & Road)"
              aria-pressed={mode === 'intermodal'}
              className={`min-h-[44px] px-2.5 sm:px-3 rounded-full flex items-center gap-1 font-sans text-[10px] sm:text-[11px] font-semibold tracking-wide transition-all cursor-pointer select-none ${
                mode === 'intermodal'
                  ? 'bg-[var(--color-surface-3)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-sm'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-transparent'
              }`}
              style={{ minWidth: 44 }}
            >
              <Layers size={12} strokeWidth={mode === 'intermodal' ? 2.5 : 2} className="shrink-0" />
              <span>ALL</span>
            </button>
          </div>

          {/* Pending Sync Badge (Shows only when records are queued) */}
          {pendingCount > 0 && (
            <button
              onClick={() => {
                if (onManualSync) onManualSync();
              }}
              title="Click to force sync offline entries"
              className="min-h-[44px] px-2.5 py-1 rounded-full flex items-center gap-1 bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] text-[var(--color-warning-fg)] font-mono text-[10px] font-semibold cursor-pointer hover:opacity-90 active:scale-95 transition-all shrink-0"
              style={{ minWidth: 44 }}
            >
              <RefreshCw size={11} className="animate-spin" />
              <span>{pendingCount}</span>
            </button>
          )}

          {/* Quiet Network Status Dot (Ambient telemetry indicator with clear readable label) */}
          <button
            type="button"
            onClick={async () => {
              if (!isOffline) {
                const ok = await confirm({
                  title: 'Switch to Offline Mode?',
                  message: 'Live network sync will pause and new entries will queue locally on this device until you reconnect.',
                  confirmLabel: 'Switch Offline',
                  tone: 'danger',
                });
                if (!ok) return;
              }
              onToggleWifi();
            }}
            title={isOffline ? 'Offline Mode Active — Tap to Reconnect' : 'Live Network Connected — Tap for Offline Simulation'}
            aria-label={isOffline ? 'Offline Mode Active — Tap to Reconnect' : 'Live Network Connected'}
            className={`min-h-[44px] px-2 sm:px-2.5 rounded-full flex items-center gap-1.5 transition-colors cursor-pointer select-none shrink-0 border ${
              isOffline
                ? 'bg-[var(--color-error-bg)] border-[var(--color-error-border)] text-[var(--color-error)]'
                : 'bg-transparent border-transparent hover:bg-[var(--color-surface-hover)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
            style={{ minWidth: 44 }}
          >
            <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              {isOffline ? (
                <span className="inline-flex rounded-full h-2 w-2 bg-[var(--color-error)]" />
              ) : (
                <span className="inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]" />
              )}
            </span>
            <span className="text-[10px] font-mono font-medium tracking-tight">
              {isOffline ? 'Offline' : 'Live'}
            </span>
          </button>

          {/* User Profile Button & Dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setShowDropdown(!showDropdown)}
              title={`${user.name} (${getRoleDisplay(user.role)} · ${getHubCode(user.hub)})`}
              aria-expanded={showDropdown}
              aria-haspopup="true"
              className="group relative min-h-[44px] px-2 rounded-full flex items-center gap-1.5 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors cursor-pointer select-none"
              style={{ minWidth: 44 }}
            >
              <div className="w-7 h-7 rounded-full flex items-center justify-center bg-[var(--color-surface-3)] border border-[var(--color-border-strong)] text-[var(--color-foreground)] font-bold text-[11px] shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>

              <div
                className={`hidden md:flex items-center overflow-hidden whitespace-nowrap transition-all duration-200 ease-out ${
                  showDropdown
                    ? 'max-w-[200px] opacity-100 pl-1 pr-1'
                    : 'max-w-0 opacity-0 pl-0 pr-0 group-hover:max-w-[200px] group-hover:opacity-100 group-hover:pl-1 group-hover:pr-1 group-focus-visible:max-w-[200px] group-focus-visible:opacity-100 group-focus-visible:pl-1 group-focus-visible:pr-1'
                }`}
              >
                <div className="text-left leading-tight mr-1.5">
                  <div className="text-[11px] font-bold text-[var(--color-foreground)] truncate max-w-[130px]">
                    {user.name}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-mono text-[var(--color-muted)]">
                    <span>{getRoleDisplay(user.role)}</span>
                    <span>·</span>
                    <span>{getHubCode(user.hub)}</span>
                  </div>
                </div>
                <ChevronDown
                  size={12}
                  className={`text-[var(--color-muted)] shrink-0 transition-transform duration-200 ${
                    showDropdown ? 'rotate-180 text-[var(--color-foreground)]' : ''
                  }`}
                />
              </div>
            </button>

            {showDropdown && (
              <>
                {createPortal(
                  <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} />,
                  document.body
                )}
                <div
                  style={{
                    position: 'absolute', right: 0, top: 38, width: 220,
                    background: 'var(--color-surface-1)',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-card)',
                    boxShadow: 'var(--shadow-dropdown)',
                    zIndex: 20, overflow: 'hidden',
                  }}
                >
                  <div style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--color-border)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-foreground)' }}>
                      {user.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {getRoleDisplay(user.role)} · {getHubCode(user.hub)}
                    </div>
                  </div>

                  {onToggleStateWideView && (
                    <button
                      onClick={() => { onToggleStateWideView(); setShowDropdown(false); }}
                      className="group hover:bg-[var(--color-surface-hover)] transition-colors"
                      style={{
                        width: '100%', padding: '10px 14px',
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', gap: 10,
                        cursor: 'pointer', textAlign: 'left',
                      }}
                      title={stateWideView ? 'Showing your hub + sibling hubs in your state. Click to scope to your own hub only.' : 'Showing only your own hub. Click to include sibling hubs in your state.'}
                    >
                      <Building2 size={15} strokeWidth={1.8} className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] shrink-0" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-foreground)' }}>
                          {stateWideView ? 'State-wide view' : 'My hub only'}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-muted)', marginTop: 1 }}>
                          {stateWideView ? 'Tap to scope to your own hub' : 'Tap to include sibling hubs'}
                        </div>
                      </div>
                    </button>
                  )}

                  <button
                    onClick={() => { setShowDropdown(false); onLogout(); }}
                    className="group hover:bg-[var(--color-error-bg)] transition-colors"
                    style={{
                      width: '100%', padding: '10px 14px',
                      background: 'transparent', border: 'none',
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer', color: 'var(--color-error)',
                    }}
                  >
                    <LogOut size={15} strokeWidth={1.8} className="text-[var(--color-error)] shrink-0" />
                    <span className="text-[var(--color-error)]" style={{ fontSize: 12, fontWeight: 600 }}>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Offline banner */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              background: 'rgba(239,68,68,0.1)',
              borderTop: '1px solid rgba(239,68,68,0.2)',
              color: 'var(--color-error)',
              fontSize: 11, fontWeight: 600,
              textAlign: 'center', padding: '6px 16px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 6,
            }}
          >
            <WifiOff size={12} className="text-[var(--color-error)] opacity-80" />
            Offline — entries queued for sync
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
