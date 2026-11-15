import { useState, useEffect } from "react";
import ehiLogo from '../assets/branding/ehi-logo.png';
import {
  Home,
  Package,
  Plane,
  QrCode,
  ArrowDownToLine,
  ArrowUpToLine,
  Settings,
  Truck,
  LogOut,
  Radar,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { User, TabView, ExcessBaggageAirline } from "../lib/types";
import { Theme } from "../lib/useTheme";
import { getAllowedTabs } from "../lib/permissions";
import { useLogisticsMode } from "../lib/modeContext";
import { getHubCode } from "../lib/helpers";

const getRoleDisplay = (role: string) => {
  switch (role) {
    case 'cargo_agent': return 'Cargo Agent';
    case 'baggage_agent': return 'Baggage POS';
    case 'marketing_agent': return 'Marketing';
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Admin';
    case 'accountant': return 'Accountant';
    case 'auditor': return 'Auditor';
    case 'driver': return 'Driver';
    default: return 'Agent';
  }
};

// Icon lookup for the static views
const VIEW_ICON: Record<string, any> = {
  Tower: Home,
  Cargo: Plane,
  Packages: Package,
  Dispatch: Truck,
  Fleet: Truck,
  FlightRadar: Radar,
  Scan: QrCode,
  Incoming: ArrowDownToLine,
  OutboundArrivals: ArrowUpToLine,
  MyTrips: Truck,
  More: Settings,
};

const VIEW_LABEL: Record<string, string> = {
  Tower: "Dashboard",
  Cargo: "Air Cargo",
  Packages: "Package Desk",
  Dispatch: "Dispatch",
  Fleet: "Fleet & Fuel",
  FlightRadar: "Flight Radar",
  Incoming: "Incoming to Hub",
  OutboundArrivals: "Outbound Arrivals",
  MyTrips: "My Trips",
  Scan: "QR Scanner",
  More: "Settings",
};

const VIEW_COMPACT_LABEL: Record<string, string> = {
  Tower: "Dashboard",
  Cargo: "Air Cargo",
  Packages: "Packages",
  Dispatch: "Dispatch",
  Fleet: "Fleet",
  FlightRadar: "Radar",
  Incoming: "Incoming",
  OutboundArrivals: "Outbound",
  MyTrips: "My Trips",
  Scan: "Scanner",
  More: "Settings",
};

export const SideNav = ({
  user,
  currentTab,
  onChangeTab,
  onLogout,
  theme: _theme,
  onToggleTheme: _onToggleTheme,
  excessBaggageAirlines = [],
  docked = false,
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  onLogout: () => void;
  theme?: Theme;
  onToggleTheme?: () => void;
  excessBaggageAirlines?: ExcessBaggageAirline[];
  // Full-screen overlays (the Master Ledger's stream view) portal to
  // document.body with their own fixed inset-0 z-50 layer. `docked` renders
  // a second, in-flow instance inside that overlay.
  docked?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const effectiveExpanded = docked ? false : isExpanded;

  useEffect(() => {
    if (docked) return;
    // Check local storage or window size for initial state.
    // Default to expanded on >= 1024px screens (e.g. CF-31 1024x768 touchscreen)
    // so counter staff always see clear labels out of the box.
    const updateExpand = () => {
      const saved = localStorage.getItem("ehi_sidebar_expanded");
      if (saved !== null) {
        setIsExpanded(saved === "true");
      } else {
        setIsExpanded(window.innerWidth >= 1024);
      }
    };
    updateExpand();
    window.addEventListener("resize", updateExpand);
    return () => window.removeEventListener("resize", updateExpand);
  }, [docked]);

  const handleToggleExpand = () => {
    if (docked) return;
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    localStorage.setItem("ehi_sidebar_expanded", String(nextState));
  };

  useEffect(() => {
    if (docked) return;
    const width = effectiveExpanded ? 200 : 72;
    document.documentElement.style.setProperty("--sidenav-offset", `${width}px`);
  }, [effectiveExpanded, docked]);

  const { mode, isAir, isRoad } = useLogisticsMode();
  const allowedTabs = getAllowedTabs(user, excessBaggageAirlines, mode);
  const allowedSet = new Set(allowedTabs);

  const toEntries = (ids: TabView[]) =>
    ids
      .filter((id) => allowedSet.has(id))
      .map((id) => ({
        id,
        icon: VIEW_ICON[id] || Package,
        label: VIEW_LABEL[id] || id,
        compactLabel: VIEW_COMPACT_LABEL[id] || id,
      }));

  const airPrimary: TabView[] = ["Cargo", "FlightRadar"];
  const roadPrimary: TabView[] = ["Packages", "Dispatch", "Fleet"];

  const visibleTabs = [
    ...toEntries(["Tower"]),
    ...(isAir ? toEntries(airPrimary) : []),
    ...(isRoad ? toEntries(roadPrimary) : []),
    ...toEntries(["Incoming", "OutboundArrivals", "MyTrips", "Scan", "More"]),
  ];

  return (
    <aside
      className={`ehi-sidenav ${effectiveExpanded ? "expanded" : "collapsed"} ${docked ? "docked" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: docked ? 72 : (effectiveExpanded ? 200 : 72),
        position: docked ? "relative" : "fixed",
        top: docked ? undefined : 0,
        left: docked ? undefined : 0,
        zIndex: docked ? undefined : 30,
        background: "var(--color-surface-card)",
        border: "none",
        borderRight: "1px solid var(--color-border)",
        borderRadius: 0,
        boxShadow: "none",
        flexShrink: 0,
        height: docked ? "100%" : "var(--app-height)",
        overflowY: "auto",
        overflowX: "hidden",
        transition: docked ? undefined : "width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: effectiveExpanded ? "12px 12px 8px" : "12px 0 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: effectiveExpanded ? "flex-start" : "center",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          flexShrink: 0,
        }}
      >
        <div
          className={`flex items-center select-none ${docked ? "" : "cursor-pointer hover:opacity-85"} ${effectiveExpanded ? "gap-2.5 px-1" : "justify-center w-full"}`}
          style={{ minHeight: 44 }}
          title={docked ? undefined : (effectiveExpanded ? "Collapse sidebar rail" : "Expand sidebar rail")}
          onClick={docked ? undefined : handleToggleExpand}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-input)",
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-border)",
              boxShadow: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <img
              src={ehiLogo}
              alt="EHI"
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = document.createElement('span');
                fallback.textContent = 'EHI';
                fallback.style.cssText = "font-family:'JetBrains Mono',monospace;font-weight:800;font-size:12px;color:var(--color-foreground);";
                (e.target as HTMLImageElement).parentElement?.appendChild(fallback);
              }}
            />
          </div>

          <div
            className="ehi-sidebar-brand"
            style={{
              opacity: effectiveExpanded ? 1 : 0,
              width: effectiveExpanded ? "auto" : 0,
              overflow: "hidden",
              transition: "opacity 0.2s ease, width 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 12,
                fontWeight: 700,
                color: "var(--color-foreground)",
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
              }}
            >
              MULTISYSTEMS
            </div>
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                color: "var(--color-muted)",
                letterSpacing: "0.02em",
                marginTop: 2,
              }}
            >
              {getRoleDisplay(user.role)} · {getHubCode(user.hub_code || user.hub)}
            </div>
          </div>
        </div>
      </div>

      {/* Primary Navigation Rail */}
      <nav
        aria-label="Sidebar Navigation"
        style={{
          flex: 1,
          padding: effectiveExpanded ? "6px 8px" : "6px 4px",
          display: "flex",
          flexDirection: "column",
          gap: effectiveExpanded ? 3 : 4,
          minHeight: 0,
        }}
      >
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
              className="group select-none"
              style={{
                width: "100%",
                minHeight: effectiveExpanded ? 44 : 48,
                minWidth: 44,
                display: "flex",
                flexDirection: effectiveExpanded ? "row" : "column",
                alignItems: "center",
                justifyContent: effectiveExpanded ? "flex-start" : "center",
                gap: effectiveExpanded ? 10 : 2,
                padding: effectiveExpanded ? "6px 10px" : "6px 2px",
                background: isActive ? "var(--color-surface-3)" : "transparent",
                border: isActive ? "1px solid var(--color-border-strong)" : "1px solid transparent",
                borderRadius: effectiveExpanded ? "var(--radius-pill)" : "12px",
                cursor: "pointer",
                transition: "background-color 0.15s ease, border-color 0.15s ease",
                textAlign: effectiveExpanded ? "left" : "center",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-surface-hover)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <div
                style={{
                  width: effectiveExpanded ? 26 : 20,
                  height: effectiveExpanded ? 26 : 20,
                  borderRadius: "var(--radius-pill)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                }}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2.2 : 1.8}
                  style={{ flexShrink: 0, transition: "color 0.15s ease" }}
                  className={
                    isActive
                      ? "text-[var(--color-foreground)]"
                      : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)]"
                  }
                />
              </div>

              {effectiveExpanded ? (
                <div
                  style={{
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    flex: 1,
                  }}
                >
                  <span
                    className={`${isActive ? "text-[var(--color-foreground)] font-semibold" : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] font-medium"} transition-colors`}
                    style={{ fontSize: 12 }}
                  >
                    {tab.label}
                  </span>
                </div>
              ) : (
                <span
                  className={`truncate max-w-[62px] ${isActive ? "text-[var(--color-foreground)] font-bold" : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] font-medium"} transition-colors`}
                  style={{
                    fontSize: 9,
                    lineHeight: 1,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {tab.compactLabel}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sidebar Controls & Footer */}
      <div
        style={{
          padding: effectiveExpanded ? "8px 10px" : "8px 4px",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          flexShrink: 0,
        }}
      >
        {/* Rail Expand/Collapse Button (Hidden if docked) */}
        {!docked && (
          <button
            onClick={handleToggleExpand}
            title={effectiveExpanded ? "Collapse rail (Icon + Micro-label)" : "Expand rail (Full Labels)"}
            aria-label={effectiveExpanded ? "Collapse sidebar rail" : "Expand sidebar rail"}
            className="group hover:bg-[var(--color-surface-hover)] transition-colors select-none text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
            style={{
              width: "100%",
              minHeight: 44,
              padding: effectiveExpanded ? "6px 10px" : "6px 2px",
              justifyContent: effectiveExpanded ? "flex-start" : "center",
              background: "transparent",
              border: "1px solid transparent",
              display: "flex",
              flexDirection: effectiveExpanded ? "row" : "column",
              alignItems: "center",
              gap: effectiveExpanded ? 8 : 2,
              cursor: "pointer",
              borderRadius: effectiveExpanded ? "var(--radius-pill)" : "12px",
            }}
          >
            {effectiveExpanded ? (
              <>
                <ChevronLeft size={15} strokeWidth={2} className="shrink-0" />
                <span style={{ fontSize: 11, fontWeight: 500 }}>Collapse rail</span>
              </>
            ) : (
              <>
                <ChevronRight size={15} strokeWidth={2} className="shrink-0" />
                <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: "-0.01em" }}>Expand</span>
              </>
            )}
          </button>
        )}

        {/* Sign Out Button */}
        <button
          onClick={onLogout}
          title="Sign Out"
          aria-label="Sign Out"
          className="group hover:bg-[var(--color-error-bg)] transition-colors select-none"
          style={{
            width: "100%",
            minHeight: 44,
            padding: effectiveExpanded ? "6px 10px" : "6px 2px",
            justifyContent: effectiveExpanded ? "flex-start" : "center",
            background: "transparent",
            border: "1px solid transparent",
            display: "flex",
            flexDirection: effectiveExpanded ? "row" : "column",
            alignItems: "center",
            gap: effectiveExpanded ? 8 : 2,
            cursor: "pointer",
            borderRadius: effectiveExpanded ? "var(--radius-pill)" : "12px",
          }}
        >
          <LogOut
            size={16}
            className="text-[var(--color-muted)] group-hover:text-[var(--color-error)] transition-colors shrink-0"
          />
          {effectiveExpanded ? (
            <span
              className="text-[var(--color-muted)] group-hover:text-[var(--color-error)] font-medium transition-colors"
              style={{ fontSize: 12 }}
            >
              Sign Out
            </span>
          ) : (
            <span
              className="text-[var(--color-muted)] group-hover:text-[var(--color-error)] font-medium transition-colors"
              style={{ fontSize: 9, letterSpacing: "-0.01em" }}
            >
              Exit
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};
