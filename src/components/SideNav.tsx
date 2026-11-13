import { useState, useEffect } from "react";
import ehiLogo from '../assets/branding/ehi-logo.png';
import {
  Home,
  Package,
  Plane,
  QrCode,
  ArrowDownToLine,
  ArrowUpToLine,
  MoreHorizontal,
  Truck,
  LogOut,
  Sun,
  Moon,
  Radar,
} from "lucide-react";
import { User, TabView, ExcessBaggageAirline } from "../lib/types";
import { Theme } from "../lib/useTheme";
import { getAllowedTabs } from "../lib/permissions";
import { useLogisticsMode } from "../lib/modeContext";

// Icon/label lookup for the static views -- getAllowedTabs (src/lib/permissions.ts)
// is the single source of truth for WHICH ids a user can see (role default
// or their super-admin-set override); this is purely presentational.
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
  More: MoreHorizontal,
};
const VIEW_LABEL: Record<string, string> = {
  Tower: "Dashboard",
  Cargo: "Air Cargo",
  Packages: "Package & Parcel Desk",
  Dispatch: "Dispatch",
  Fleet: "Fleet & Fuel",
  FlightRadar: "Flight Radar",
  Incoming: "Incoming to Hub",
  OutboundArrivals: "Outbound Arrivals",
  MyTrips: "My Trips",
  Scan: "QR Scanner",
  More: "More",
};
export const SideNav = ({
  user,
  currentTab,
  onChangeTab,
  onLogout,
  theme,
  onToggleTheme,
  excessBaggageAirlines,
  docked = false,
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  onLogout: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  excessBaggageAirlines: ExcessBaggageAirline[];
  // Full-screen overlays (the Master Ledger's stream view) portal to
  // document.body with their own fixed inset-0 z-50 layer, which paints
  // over the real floating SideNav entirely -- it never disappears, it's
  // just hidden underneath. `docked` renders a second, in-flow instance
  // inside that overlay instead: no fixed positioning, no floating gap,
  // flush against the left edge like a normal flex sibling, so the
  // overlay's own content can never render underneath it and nav access
  // isn't lost while the ledger is open. Icon-only, no expand/collapse --
  // that's the floating nav's own affordance and doesn't apply here.
  docked?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const effectiveExpanded = docked ? false : isExpanded;

  useEffect(() => {
    if (docked) return;
    // Check local storage or window size for initial state
    const saved = localStorage.getItem("ehi_sidebar_expanded");
    if (saved !== null) {
      setIsExpanded(saved === "true");
    } else {
      setIsExpanded(window.innerWidth >= 1200);
    }
  }, [docked]);

  const handleToggleExpand = () => {
    if (docked) return;
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    localStorage.setItem("ehi_sidebar_expanded", String(nextState));
  };

  // The nav is position:fixed (floats above the page instead of sitting in
  // normal flex flow), so .ehi-main-content can no longer rely on flexbox
  // to make room for it -- it reads this CSS var (set on the root so no
  // prop-drilling into EHIApp is needed) to reserve matching space, kept in
  // sync with the same width this component renders at. Flush to the left
  // edge (no inset gap), so the offset equals the rail width only. The
  // docked instance sits in normal flow already, so it must never touch
  // this -- doing so would fight the real floating instance for the same var.
  useEffect(() => {
    if (docked) return;
    const width = isExpanded ? 220 : 72;
    document.documentElement.style.setProperty("--sidenav-offset", `${width}px`);
  }, [isExpanded, docked]);

  const { mode, isAir, isRoad } = useLogisticsMode();
  const allowedTabs = getAllowedTabs(user, excessBaggageAirlines, mode);
  const allowedSet = new Set(allowedTabs);

  const baggageEntries = allowedTabs
    .filter((id) => id.startsWith("Baggage:"))
    .map((id) => {
      const airlineName = id.slice("Baggage:".length);
      return {
        id,
        icon: Plane,
        label: user.role === "baggage_agent" ? airlineName : `${airlineName} POS`,
      };
    });

  const toEntries = (ids: TabView[]) => ids.filter((id) => allowedSet.has(id)).map((id) => ({ id, icon: VIEW_ICON[id] || Package, label: VIEW_LABEL[id] || id }));

  const airPrimary: TabView[] = ["Cargo", "FlightRadar"];
  const roadPrimary: TabView[] = ["Packages", "Dispatch", "Fleet"];

  const visibleTabs = [
    ...toEntries(["Tower"]),
    ...(isAir ? toEntries(airPrimary) : []),
    ...(isRoad ? toEntries(roadPrimary) : []),
    ...baggageEntries,
    ...toEntries(["Incoming", "OutboundArrivals", "MyTrips", "Scan", "More"]),
  ];

  return (
    <aside
      className={`ehi-sidenav ${effectiveExpanded ? "expanded" : "collapsed"} ${docked ? "docked" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        width: docked ? 72 : (effectiveExpanded ? 220 : 72),
        position: docked ? "relative" : "fixed",
        // Floating but attached: flush left edge, square corners, full
        // height -- reads as part of the app shell rather than a detached
        // rounded card floating in the canvas gutter.
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
        transition: docked ? undefined : "width 0.3s cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {/* Brand */}
      <div
        style={{
          padding: effectiveExpanded ? "12px 12px 8px" : "12px 0 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: effectiveExpanded ? "flex-start" : "center",
          transition: "all 0.3s cubic-bezier(0.2, 0, 0, 1)",
          flexShrink: 0,
        }}
      >
        <div
          className={`flex items-center transition-opacity ${docked ? "" : "cursor-pointer hover:opacity-80"} ${effectiveExpanded ? "gap-2.5" : "justify-center w-full"}`}
          style={{ minHeight: 36 }}
          title={docked ? undefined : (effectiveExpanded ? "Collapse sidebar" : "Expand sidebar")}
          onClick={docked ? undefined : handleToggleExpand}
        >
          <div
            style={{
              width: 36,
              height: 36,
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
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }}
              onError={(e) => {
                // Falls back to the original text treatment if the file is
                // missing or fails to load, rather than showing a broken image icon
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = document.createElement('span');
                fallback.textContent = 'EHI';
                fallback.style.cssText = "font-family:'JetBrains Mono',monospace;font-weight:800;font-size:14px;color:var(--color-foreground);";
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
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
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
                fontSize: 9,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                color: "var(--color-muted)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              Logistics Platform
            </div>
          </div>
        </div>

        <div
          className="ehi-sidebar-brand"
          style={{
            marginTop: 6,
            opacity: effectiveExpanded ? 1 : 0,
            height: effectiveExpanded ? "auto" : 0,
            overflow: "hidden",
            transition:
              "opacity 0.2s ease, height 0.3s cubic-bezier(0.2, 0, 0, 1)",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-foreground)",
            }}
          >
            {user.name}
          </div>
          <div
            style={{
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              color: "var(--color-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginTop: 1,
            }}
          >
            {user.hub}
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 3, minHeight: 0 }}>
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              title={!effectiveExpanded ? tab.label : undefined}
              className="group select-none"
              style={{
                width: "100%",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: effectiveExpanded ? "flex-start" : "center",
                gap: effectiveExpanded ? 10 : 0,
                padding: effectiveExpanded ? "6px 10px" : "6px",
                background: isActive ? "var(--color-surface-3)" : "transparent",
                border: isActive ? "1px solid var(--color-border-strong)" : "1px solid transparent",
                borderRadius: "var(--radius-pill)",
                cursor: "pointer",
                transition: "background-color 0.15s ease, border-color 0.15s ease",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--color-surface-hover)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
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
              <div
                style={{
                  opacity: effectiveExpanded ? 1 : 0,
                  width: effectiveExpanded ? "auto" : 0,
                  overflow: "hidden",
                  transition:
                    "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span
                  className={`${isActive ? "text-[var(--color-foreground)] font-semibold" : "text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] font-medium"} transition-colors`}
                  style={{
                    fontSize: 12.5,
                  }}
                >
                  {tab.label}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggleTheme}
          title={!effectiveExpanded ? (theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode") : undefined}
          className="group hover:bg-[var(--color-surface-hover)] transition-colors select-none"
          style={{
            width: "100%",
            minHeight: 44,
            padding: effectiveExpanded ? "6px 10px" : "6px",
            justifyContent: effectiveExpanded ? "flex-start" : "center",
            background: "transparent",
            border: "1px solid transparent",
            display: "flex",
            alignItems: "center",
            gap: effectiveExpanded ? 10 : 0,
            cursor: "pointer",
            borderRadius: "var(--radius-pill)",
          }}
        >
          {theme === "dark" ? (
            <Sun
              size={16}
              className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-transform duration-300 group-hover:rotate-45 active:scale-90 shrink-0"
            />
          ) : (
            <Moon
              size={16}
              className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-transform duration-300 group-hover:-rotate-12 active:scale-90 shrink-0"
            />
          )}
          <div
            style={{
              opacity: effectiveExpanded ? 1 : 0,
              width: effectiveExpanded ? "auto" : 0,
              overflow: "hidden",
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="text-left text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] font-medium transition-colors"
              style={{ fontSize: 12 }}
            >
              {theme === "dark" ? "Light Mode" : "Dark Mode"}
            </span>
          </div>
        </button>

        <button
          onClick={onLogout}
          title={!effectiveExpanded ? "Sign Out" : undefined}
          className="group hover:bg-[var(--color-surface-hover)] transition-colors select-none"
          style={{
            width: "100%",
            minHeight: 44,
            padding: effectiveExpanded ? "6px 10px" : "6px",
            justifyContent: effectiveExpanded ? "flex-start" : "center",
            background: "transparent",
            border: "1px solid transparent",
            display: "flex",
            alignItems: "center",
            gap: effectiveExpanded ? 10 : 0,
            cursor: "pointer",
            borderRadius: "var(--radius-pill)",
          }}
        >
          <LogOut
            size={16}
            className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] transition-colors shrink-0"
          />
          <div
            style={{
              opacity: effectiveExpanded ? 1 : 0,
              width: effectiveExpanded ? "auto" : 0,
              overflow: "hidden",
              transition:
                "opacity 0.2s ease, width 0.3s cubic-bezier(0.2, 0, 0, 1)",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              className="text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] font-medium transition-colors"
              style={{ fontSize: 12 }}
            >
              Sign Out
            </span>
          </div>
        </button>
      </div>
    </aside>
  );
};
