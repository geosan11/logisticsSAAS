import { User, TabView, ExcessBaggageAirline } from '../lib/types';
import { getHubCode } from '../lib/helpers';
import {
  Home,
  Package,
  Plane,
  QrCode,
  MoreHorizontal,
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
  More: MoreHorizontal,
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
  More: 'More',
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
      .map((id) => {
        const isBaggage = id.startsWith('Baggage:');
        return {
          id: id as TabView,
          title: isBaggage ? id.slice('Baggage:'.length) : (VIEW_TITLE[id] || id),
          icon: isBaggage ? Plane : (VIEW_ICON[id] || MoreHorizontal),
        };
      });

    const finalTabs = overrideTabs.length > 5
      ? [...overrideTabs.slice(0, 4), { id: 'More' as TabView, title: 'More', icon: MoreHorizontal }]
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
  const more: NavTab = { id: 'More', title: 'More', icon: MoreHorizontal };

  const baggageTabId = allowedTabs.find((id) => id.startsWith('Baggage:'));
  const baggageTab: NavTab | undefined = baggageTabId
    ? {
        id: baggageTabId,
        title: baggageTabId.slice('Baggage:'.length),
        icon: Plane,
      }
    : undefined;

  let candidates: NavTab[] = [];
  if (user.role === 'driver') {
    candidates = [trips, incoming, outbound, scan, more];
  } else if (user.role === 'baggage_agent') {
    candidates = [home, ...(baggageTab ? [baggageTab] : []), incoming, outbound, more];
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
        className="flex items-center justify-around px-2"
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
              className="flex-1 flex flex-col items-center justify-center cursor-pointer min-h-[44px] min-w-[44px] py-1 px-1 transition-all"
              style={{
                background: 'transparent',
                border: 'none',
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.title}
            >
              <div
                className="flex flex-col items-center justify-center py-1 px-3 rounded-full transition-all duration-150"
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
                  strokeWidth={isActive ? 2.2 : 1.8}
                  className="transition-colors"
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: '-0.01em',
                    marginTop: 2,
                    lineHeight: 1,
                  }}
                  className="truncate max-w-[64px]"
                >
                  {tab.title}
                </span>
              </div>
            </button>
          );
        })}
      </nav>
    </div>
  );
};
