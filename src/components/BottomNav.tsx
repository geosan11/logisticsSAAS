import { User, TabView, ExcessBaggageAirline } from '../lib/types';
import { getHubCode } from '../lib/helpers';
import {
  Home,
  Package,
  Plane,
  QrCode,
  Settings,
  Truck,
  Building,
  Radar,
  ArrowDownToLine,
  ArrowUpToLine,
} from 'lucide-react';
import { useLogisticsMode } from '../lib/modeContext';
import { getAllowedTabs } from '../lib/permissions';

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
  GAT: Building,
};

const VIEW_TITLE: Record<string, string> = {
  Tower: 'Dashboard',
  Cargo: 'Air Cargo',
  Packages: 'Packages',
  Dispatch: 'Dispatch',
  Fleet: 'Fleet',
  FlightRadar: 'Radar',
  Scan: 'Scanner',
  Incoming: 'Incoming',
  OutboundArrivals: 'Outbound',
  MyTrips: 'My Trips',
  More: 'Settings',
  GAT: 'GAT',
};

export const BottomNav = ({
  user,
  currentTab,
  onChangeTab,
  excessBaggageAirlines = [],
}: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
  excessBaggageAirlines?: ExcessBaggageAirline[];
}) => {
  const { mode } = useLogisticsMode();
  const allowedTabs = getAllowedTabs(user, excessBaggageAirlines, mode);
  const allowedSet = new Set(allowedTabs);
  const userHubCode = getHubCode(user.hub_code || user.hub);

  if (user.view_overrides != null) {
    const overrideTabs = user.view_overrides
      .filter((id) => (id !== 'GAT' || userHubCode === 'LOS') && allowedSet.has(id as TabView))
      .map((id) => ({
        id: id as TabView,
        title: VIEW_TITLE[id] || id,
        icon: VIEW_ICON[id] || Settings,
      }));

    const finalTabs = overrideTabs.length > 5
      ? [...overrideTabs.slice(0, 4), { id: 'More' as TabView, title: 'Settings', icon: Settings }]
      : overrideTabs;
    return <BottomNavTabs tabs={finalTabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
  }

  // Operational tab candidates
  const home: NavTab = { id: 'Tower', title: 'Dashboard', icon: Home };
  const cargo: NavTab = { id: 'Cargo', title: 'Air Cargo', icon: Plane };
  const packages: NavTab = { id: 'Packages', title: 'Packages', icon: Package };
  const incoming: NavTab = { id: 'Incoming', title: 'Incoming', icon: ArrowDownToLine };
  const outbound: NavTab = { id: 'OutboundArrivals', title: 'Outbound', icon: ArrowUpToLine };
  const radar: NavTab = { id: 'FlightRadar', title: 'Radar', icon: Radar };
  const dispatch: NavTab = { id: 'Dispatch', title: 'Dispatch', icon: Truck };
  const trips: NavTab = { id: 'MyTrips', title: 'My Trips', icon: Truck };
  const scan: NavTab = { id: 'Scan', title: 'Scanner', icon: QrCode };
  const more: NavTab = { id: 'More', title: 'Settings', icon: Settings };

  let candidates: NavTab[] = [];
  if (user.role === 'driver') {
    candidates = [trips, incoming, outbound, scan, more];
  } else if (user.role === 'baggage_agent') {
    candidates = [home, incoming, outbound, more];
  } else if (mode === 'air') {
    candidates = [home, cargo, radar, incoming, more];
  } else if (mode === 'road') {
    candidates = [home, packages, dispatch, incoming, more];
  } else {
    // Intermodal
    candidates = [home, cargo, packages, incoming, more];
  }

  // Filter against allowed permissions
  const allowedCandidates = candidates.filter((t) => allowedSet.has(t.id));

  // Enforce max 5 bottom items; overflow stays reachable via More or SideNav
  let finalTabs: NavTab[];
  if (allowedCandidates.length > 5) {
    const hasMore = allowedCandidates.some((t) => t.id === 'More');
    const top4 = allowedCandidates.filter((t) => t.id !== 'More').slice(0, 4);
    finalTabs = hasMore ? [...top4, more] : allowedCandidates.slice(0, 5);
  } else {
    finalTabs = allowedCandidates;
  }

  return <BottomNavTabs tabs={finalTabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
};

type NavTab = { id: TabView; title: string; icon: any };

const BottomNavTabs = ({
  tabs,
  currentTab,
  onChangeTab,
}: {
  tabs: NavTab[];
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  return (
    <div
      className="w-full shrink-0 z-50 select-none"
      style={{
        background: 'var(--color-nav-bg)',
        borderTop: '1px solid var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <nav
        aria-label="Bottom Navigation"
        className="flex items-center justify-around px-1"
        style={{ minHeight: 56, height: 56 }}
      >
        {tabs.map((tab) => {
          const isActive =
            tab.id === currentTab ||
            (tab.id === 'More' &&
              !tabs.some((t) => t.id === currentTab) &&
              currentTab.startsWith('More:'));
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className="flex-1 h-full min-h-[56px] min-w-[44px] flex flex-col items-center justify-center cursor-pointer py-1 px-0.5 transition-all select-none group"
              style={{
                background: 'transparent',
                border: 'none',
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.title}
            >
              {/* Icon Container with subtle pill highlight for active tab */}
              <div
                className="w-12 h-7 rounded-full flex items-center justify-center transition-all duration-150"
                style={{
                  background: isActive ? 'var(--color-surface-3)' : 'transparent',
                  border: isActive
                    ? '1px solid var(--color-border-strong)'
                    : '1px solid transparent',
                  color: isActive
                    ? 'var(--color-foreground)'
                    : 'var(--color-muted)',
                }}
              >
                <Icon
                  size={16}
                  strokeWidth={isActive ? 2.3 : 1.8}
                  className="transition-colors group-hover:text-[var(--color-foreground)]"
                />
              </div>

              {/* Clean text label below icon */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 600 : 500,
                  letterSpacing: '-0.01em',
                  marginTop: 2,
                  lineHeight: 1,
                  color: isActive
                    ? 'var(--color-foreground)'
                    : 'var(--color-muted)',
                }}
                className="truncate max-w-[64px] transition-colors group-hover:text-[var(--color-foreground)]"
              >
                {tab.title}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
