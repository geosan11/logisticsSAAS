import { User, TabView } from '../lib/types';
import { getHubCode } from '../lib/helpers';
import { Home, Package, Plane, QrCode, MoreHorizontal, Truck, Building, Radar } from 'lucide-react';
import { useLogisticsMode } from '../lib/modeContext';

const VIEW_ICON: Record<string, any> = {
  Tower: Home, Cargo: Plane, Packages: Truck, Dispatch: Truck, Fleet: Truck, FlightRadar: Radar,
  Scan: QrCode, Incoming: Package, OutboundArrivals: Package, MyTrips: Truck, More: MoreHorizontal,
  GAT: Building,
};
const VIEW_TITLE: Record<string, string> = {
  Tower: 'Dashboard', Cargo: 'Air Cargo', Packages: 'Waybills', Dispatch: 'Dispatch', Fleet: 'Fleet', FlightRadar: 'Radar',
  Scan: 'Scanner', Incoming: 'Incoming', OutboundArrivals: 'Outbound', MyTrips: 'My Trips', More: 'More',
  GAT: 'GAT',
};

export const BottomNav = ({ user, currentTab, onChangeTab }: {
  user: User;
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  const { mode, isAir, isRoad } = useLogisticsMode();
  const userHubCode = getHubCode(user.hub_code || user.hub);

  if (user.view_overrides != null) {
    const overrideTabs = user.view_overrides
      .filter((id) => id !== 'GAT' || userHubCode === 'LOS')
      .map((id) => {
        const isBaggage = id.startsWith('Baggage:');
        return {
          id: id as TabView,
          title: isBaggage ? id.slice('Baggage:'.length) : (VIEW_TITLE[id] || id),
          icon: isBaggage ? Plane : (VIEW_ICON[id] || MoreHorizontal),
        };
      });
    return <BottomNavTabs tabs={overrideTabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
  }

  // Curated mode- & role-aware tab sets — max 5 items
  const home     = { id: 'Tower' as TabView, title: 'Dashboard', icon: Home };
  const cargo    = { id: 'Cargo' as TabView, title: 'Air Cargo', icon: Plane };
  const waybills = { id: 'Packages' as TabView, title: 'Waybills', icon: Truck };
  const dispatch = { id: 'Dispatch' as TabView, title: 'Dispatch', icon: Truck };
  const radar    = { id: 'FlightRadar' as TabView, title: 'Radar', icon: Radar };
  const scan     = { id: 'Scan' as TabView, title: 'Scanner', icon: QrCode };
  const trips    = { id: 'MyTrips' as TabView, title: 'My Trips', icon: Truck };
  const more     = { id: 'More' as TabView, title: 'More', icon: MoreHorizontal };

  const getTabsForRole = (role: string) => {
    if (role === 'driver') {
      return [home, trips, scan, more];
    }

    if (mode === 'air') {
      return [home, cargo, radar, scan, more];
    }

    if (mode === 'road') {
      return [home, waybills, dispatch, scan, more];
    }

    // Intermodal (default / both)
    return [home, cargo, waybills, scan, more];
  };

  const tabs = getTabsForRole(user.role);
  return <BottomNavTabs tabs={tabs} currentTab={currentTab} onChangeTab={onChangeTab} />;
};

type NavTab = { id: TabView; title: string; icon: any };

const BottomNavTabs = ({ tabs, currentTab, onChangeTab }: {
  tabs: NavTab[];
  currentTab: TabView;
  onChangeTab: (t: TabView) => void;
}) => {
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === currentTab));

  return (
    <div
      className="relative w-full shrink-0 z-50"
      style={{
        height: 'calc(70px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        overflow: 'visible',
      }}
    >
      {/* Raised sliding bubble — a real button, not decorative */}
      <button
        onClick={() => onChangeTab(tabs[activeIndex].id)}
        aria-label={tabs[activeIndex]?.title}
        aria-current="page"
        className="absolute rounded-full flex items-center justify-center"
        style={{
          left: `calc(16px + (100% - 32px) * ${(activeIndex + 0.5) / tabs.length})`,
          transform: 'translateX(-50%)',
          bottom: 30,
          width: 40,
          height: 40,
          background: 'radial-gradient(circle at 35% 30%, var(--color-accent-amber), var(--color-accent-amber) 60%, #C98E28 100%)',
          boxShadow: '0 6px 16px rgba(251,191,36,0.40), 0 0 0 4px var(--color-obsidian)',
          border: 'none',
          cursor: 'pointer',
          zIndex: 2,
          transition: 'left 300ms cubic-bezier(0.34, 1.4, 0.64, 1), transform 0.1s ease, box-shadow 0.15s ease',
        }}
      >
        {(() => {
          const ActiveIcon = tabs[activeIndex]?.icon;
          return ActiveIcon ? (
            <ActiveIcon size={15} strokeWidth={2.25} color="var(--color-on-accent)" />
          ) : null;
        })()}
      </button>

      {/* Glass pill */}
      <div
        className="absolute left-4 right-4 bottom-0 flex items-center justify-around rounded-full"
        style={{
          height: 56,
          background: 'var(--color-nav-glass)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid var(--color-border-strong)',
          boxShadow: 'var(--shadow-nav)',
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = i === activeIndex;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className="group flex-1 h-full flex flex-col items-center justify-center gap-0.5 transition-opacity"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                minWidth: 0,
                opacity: isActive ? 0 : 1,
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.title}
            >
              <div style={{ height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon
                  size={14}
                  className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
                />
              </div>
              <span
                style={{ fontSize: 8.5, fontWeight: 500, letterSpacing: '0.01em' }}
                className="text-[var(--color-muted)] group-hover:text-[var(--color-accent-amber)] transition-colors"
              >
                {tab.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
