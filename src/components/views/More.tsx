import { ErrorBoundary } from '../ErrorBoundary';
import React, { useState, useMemo, useCallback, lazy, Suspense, memo, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Sun,
  Moon,
  Sliders,
  Layers,
} from 'lucide-react';

import {
  User,
  TabView,
  Transaction,
  Expense,
  HubShift,
  CustomerWallet,
} from '../../lib/types';
import { useLogisticsMode } from '../../lib/modeContext';
import { useTheme } from '../../lib/useTheme';
import { useDensity } from '../../lib/useDensity';
import { Spinner } from '../ui';
import { BackButton } from '../BackButton';

import {
  SETTING_GROUPS,
  SETTING_ITEMS,
  MORE_REDIRECT_ALIASES,
  SettingGroupId,
  SettingItem,
  getAccessibleSettings,
  getAccessibleGroups,
  searchSettings,
} from './settingsData';

// Lazy-loaded sub-views — exactly one is rendered at a time when activeSub matches.
const AccountingConsole = lazy(() => import('./AccountingConsole').then((m) => ({ default: m.AccountingConsole })));
const Reports = lazy(() => import('./Reports').then((m) => ({ default: m.Reports })));
const SettingsView = lazy(() => import('./Settings').then((m) => ({ default: m.Settings })));
const BankReconciliation = lazy(() => import('./BankReconciliation').then((m) => ({ default: m.BankReconciliation })));
const Fleet = lazy(() => import('./Fleet').then((m) => ({ default: m.Fleet })));
const Forecasting = lazy(() => import('./Forecasting').then((m) => ({ default: m.Forecasting })));
const FraudAlerts = lazy(() => import('./FraudAlerts').then((m) => ({ default: m.FraudAlerts })));
const AuditLog = lazy(() => import('./AuditLog').then((m) => ({ default: m.AuditLog })));
const TransactionLedgerRaw = lazy(() => import('./TransactionLedger').then((m) => ({ default: m.TransactionLedger })));
const TransactionLedger = memo(TransactionLedgerRaw);
const PODLog = lazy(() => import('./PODLog').then((m) => ({ default: m.PODLog })));
const Dispatch = lazy(() => import('./Dispatch').then((m) => ({ default: m.Dispatch })));
const EODReconciliation = lazy(() => import('./EODReconciliation').then((m) => ({ default: m.EODReconciliation })));
const SupportTickets = lazy(() => import('./SupportTickets').then((m) => ({ default: m.SupportTickets })));
const PricingConfiguration = lazy(() => import('./PricingConfiguration').then((m) => ({ default: m.PricingConfiguration })));
const HubCargoRates = lazy(() => import('./HubCargoRates').then((m) => ({ default: m.HubCargoRates })));
const AirlineCommissions = lazy(() => import('./AirlineCommissions').then((m) => ({ default: m.AirlineCommissions })));
const CorporateBilling = lazy(() => import('./CorporateBilling').then((m) => ({ default: m.CorporateBilling })));
const OfficeWorkReconciliation = lazy(() => import('./OfficeWorkReconciliation').then((m) => ({ default: m.OfficeWorkReconciliation })));
const ContentTypes = lazy(() => import('./ContentTypes').then((m) => ({ default: m.ContentTypes })));
const ExpenseCategories = lazy(() => import('./ExpenseCategories').then((m) => ({ default: m.ExpenseCategories })));
const Banks = lazy(() => import('./Banks').then((m) => ({ default: m.Banks })));
const SpecialGoodsRates = lazy(() => import('./SpecialGoodsRates').then((m) => ({ default: m.SpecialGoodsRates })));
const MinimumCharges = lazy(() => import('./MinimumCharges').then((m) => ({ default: m.MinimumCharges })));
const FlatTierRates = lazy(() => import('./FlatTierRates').then((m) => ({ default: m.FlatTierRates })));
const SizeTierRates = lazy(() => import('./SizeTierRates').then((m) => ({ default: m.SizeTierRates })));
const RatesList = lazy(() => import('./RatesList').then((m) => ({ default: m.RatesList })));
const CustomerWallets = lazy(() => import('./CustomerWallets').then((m) => ({ default: m.CustomerWallets })));
const DebtCollectionRetrievalLog = lazy(() => import('./DebtCollectionRetrievalLog').then((m) => ({ default: m.DebtCollectionRetrievalLog })));
const StaffManagement = lazy(() => import('./StaffManagement').then((m) => ({ default: m.StaffManagement })));

// Kept for backward compatibility so all direct deep links and bookmarks continue to function.
export const MORE_SUB_ROUTES = {
  eod: 'eod',
  accounting: 'accounting',
  reports: 'reports',
  settings: 'settings',
  contentTypes: 'content-types',
  expenseCategories: 'expense-categories',
  banks: 'banks',
  specialGoodsRates: 'special-goods-rates',
  minimumCharges: 'minimum-charges',
  flatTierRates: 'flat-tier-rates',
  sizeTierRates: 'size-tier-rates',
  ratesList: 'rates-list',
  bankRecon: 'bank-recon',
  fleet: 'fleet',
  forecasting: 'forecasting',
  fraudAlerts: 'fraud-alerts',
  auditLog: 'audit-log',
  ledger: 'ledger',
  podLog: 'pod-log',
  dispatch: 'dispatch',
  airlineCommissions: 'airline-commissions',
  corporateBilling: 'corporate-billing',
  officeReconcile: 'office-reconcile',
  pricing: 'pricing',
  hubCargoRates: 'hub-cargo-rates',
  support: 'support',
  staff: 'staff',
  customerWallets: 'customer-wallets',
  debtCollectionLog: 'debt-collection-log',
} as const;

export type MoreSubKey = keyof typeof MORE_SUB_ROUTES;

export interface MoreProps {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onLogout: () => void;
  onEOD?: (summary: any) => void;
  onAddTx: (tx: Transaction) => void;
  onFullUpdateTx?: (tx: Transaction) => void;
  onDeleteTx: (type: string, id: string) => void;
  onAddExpense: (e: Expense) => void;
  onUpdateExpense?: (expenseId: string, decision: 'approved' | 'rejected') => void;
  onChangeTab: (t: TabView) => void;
  dateRange?: { start: string; end: string };
  onDateRangeChange?: (range: { start: string; end: string }) => void;
  activeShift?: HubShift | null;
  todayShifts?: HubShift[];
  onStartShift?: () => void;
  onEndShift?: () => void;
  customerWallets?: CustomerWallet[];
  refetchCustomerWallets?: () => void;
  ledgerRowsTruncated?: boolean;
  onLoadMoreLedgerRows?: () => void;
  ledgerRowsLoadingMore?: boolean;
}

export const More = ({
  user,
  transactions,
  expenses,
  onLogout,
  onEOD,
  onAddTx,
  onFullUpdateTx,
  onDeleteTx,
  onAddExpense,
  onUpdateExpense,
  onChangeTab,
  dateRange,
  onDateRangeChange,
  activeShift,
  todayShifts,
  onStartShift,
  onEndShift,
  customerWallets,
  refetchCustomerWallets,
  ledgerRowsTruncated,
  onLoadMoreLedgerRows,
  ledgerRowsLoadingMore,
}: MoreProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const { mode } = useLogisticsMode();
  const { theme, toggle: toggleTheme } = useTheme();
  const { setDensity, isCompact, isSpacious } = useDensity();

  // Search query state
  const [searchQuery, setSearchQuery] = useState('');
  // Advanced disclosure state inside the opened group
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 1 = pushing forward, -1 = back
  const [direction, setDirection] = useState<1 | -1>(1);

  // Group selection from URL query param ?group=... and return target ?from=...
  const selectedGroupId = searchParams.get('group') as SettingGroupId | null;
  const fromGroupId = searchParams.get('from') as SettingGroupId | null;
  const lastGroupRef = useRef<SettingGroupId | null>(null);

  useEffect(() => {
    if (selectedGroupId) {
      lastGroupRef.current = selectedGroupId;
    }
  }, [selectedGroupId]);

  // Selected group object
  const activeGroup = useMemo(
    () => (selectedGroupId ? SETTING_GROUPS.find((g) => g.id === selectedGroupId) || null : null),
    [selectedGroupId]
  );

  // Legacy sub-route resolution from /more/<slug>
  const activeSub: MoreSubKey | null = useMemo(() => {
    const m = location.pathname.match(/^\/more\/([^/]+)/);
    if (!m) return null;
    const slug = m[1];

    // Check if this slug is a redirect alias to a root tab
    if (MORE_REDIRECT_ALIASES[slug]) {
      return null;
    }

    // Check if slug matches a sub-route
    const entry = Object.entries(MORE_SUB_ROUTES).find(([, s]) => s === slug);
    return (entry ? entry[0] : null) as MoreSubKey | null;
  }, [location.pathname]);

  // Handle redirects for promoted operational screens and tabs mapped under /more/...
  useEffect(() => {
    const m = location.pathname.match(/^\/more\/([^/]+)/);
    if (!m) return;
    const slug = m[1];
    const redirectTarget = MORE_REDIRECT_ALIASES[slug];
    if (redirectTarget) {
      navigate(redirectTarget, { replace: true });
    }
  }, [location.pathname, navigate]);

  const openSub = useCallback(
    (key: MoreSubKey) => {
      setDirection(1);
      const returnGroup = selectedGroupId || lastGroupRef.current;
      const query = returnGroup ? `?from=${returnGroup}` : '';
      navigate('/more/' + MORE_SUB_ROUTES[key] + query);
    },
    [navigate, selectedGroupId]
  );

  const closeSub = useCallback(() => {
    setDirection(-1);
    // Return to the previously active group if available, or Settings home
    const returnGroup = fromGroupId || selectedGroupId || lastGroupRef.current;
    if (returnGroup) {
      navigate('/more?group=' + returnGroup);
    } else {
      navigate('/more');
    }
  }, [navigate, fromGroupId, selectedGroupId]);

  const selectGroup = useCallback(
    (groupId: SettingGroupId | null) => {
      setDirection(groupId ? 1 : -1);
      setShowAdvanced(false);
      setSearchQuery('');
      if (groupId) {
        setSearchParams({ group: groupId });
      } else {
        setSearchParams({});
      }
    },
    [setSearchParams]
  );

  // Hand-off state between ContentTypes -> SpecialGoodsRates
  const [specialGoodsPreset, setSpecialGoodsPreset] = useState<string | undefined>(undefined);

  // Accessible settings filtered by user role permissions
  const accessibleItems = useMemo(
    () => getAccessibleSettings(SETTING_ITEMS, user, mode),
    [user, mode]
  );

  // Accessible groups with item count tallies
  const accessibleGroups = useMemo(
    () => getAccessibleGroups(SETTING_GROUPS, accessibleItems),
    [accessibleItems]
  );

  // Instant search results across all groups
  const searchResults = useMemo(
    () => searchSettings(accessibleItems, searchQuery, SETTING_GROUPS),
    [accessibleItems, searchQuery]
  );

  // Group-specific item partitions
  const currentGroupItems = useMemo(() => {
    if (!selectedGroupId) return { primary: [], advanced: [] };
    const items = accessibleItems.filter((i) => i.groupId === selectedGroupId);
    return {
      primary: items.filter((i) => i.level === 'primary'),
      advanced: items.filter((i) => i.level === 'advanced'),
    };
  }, [accessibleItems, selectedGroupId]);

  const handleItemClick = useCallback(
    (item: SettingItem) => {
      if (item.target.type === 'sub') {
        openSub(item.target.subKey as MoreSubKey);
      } else {
        onChangeTab(item.target.tab);
      }
    },
    [openSub, onChangeTab]
  );

  // Render sub-view component
  const getActiveSubView = (): { key: string; element: React.ReactElement } | null => {
    if (activeSub === 'eod') {
      return {
        key: 'eod',
        element: (
          <EODReconciliation
            user={user}
            transactions={transactions}
            expenses={expenses}
            onBack={closeSub}
            onEOD={onEOD || (() => {})}
          />
        ),
      };
    }

    if (activeSub === 'accounting') {
      return {
        key: 'accounting',
        element: (
          <AccountingConsole
            user={user}
            transactions={transactions}
            expenses={expenses}
            onBack={closeSub}
            onAddExpense={onAddExpense}
            onUpdateExpense={onUpdateExpense}
            onOpenBankRecon={() => openSub('bankRecon')}
            onFullUpdateTx={onFullUpdateTx}
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
          />
        ),
      };
    }

    if (activeSub === 'reports') {
      return {
        key: 'reports',
        element: <Reports user={user} transactions={transactions} onBack={closeSub} />,
      };
    }

    if (activeSub === 'settings') {
      return {
        key: 'settings',
        element: (
          <SettingsView
            user={user}
            onBack={closeSub}
            onOpenAirlineCommissions={() => openSub('airlineCommissions')}
          />
        ),
      };
    }

    if (activeSub === 'bankRecon') {
      return {
        key: 'bankRecon',
        element: (
          <BankReconciliation
            transactions={transactions}
            onBack={closeSub}
            user={user}
            onConfirm={({ matchedIds }) => {
              if (onFullUpdateTx) {
                matchedIds.forEach((id) => {
                  const tx = transactions.find((t) => t.id === id);
                  if (tx) {
                    onFullUpdateTx({
                      ...tx,
                      paymentConfirmed: true,
                      confirmedAt: new Date().toLocaleTimeString('en-NG'),
                      confirmedBy: user.name,
                    });
                  }
                });
              }
            }}
          />
        ),
      };
    }

    if (activeSub === 'fleet') {
      return { key: 'fleet', element: <Fleet onBack={closeSub} /> };
    }

    if (activeSub === 'forecasting') {
      return { key: 'forecasting', element: <Forecasting onBack={closeSub} /> };
    }

    if (activeSub === 'fraudAlerts') {
      return { key: 'fraudAlerts', element: <FraudAlerts user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'customerWallets') {
      return { key: 'customerWallets', element: <CustomerWallets user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'ledger') {
      return {
        key: 'ledger',
        element: (
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center bg-[var(--color-canvas)]">
                <div className="text-[var(--color-error)] font-bold text-[14px]">The ledger hit a snag.</div>
                <div className="text-[var(--color-muted)] font-mono text-[11px] max-w-md break-words">
                  {error.message || 'An unexpected error occurred.'}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={reset}
                    className="min-h-[44px] px-4 py-2 bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)] rounded-full text-[12px] font-bold cursor-pointer"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={closeSub}
                    className="min-h-[44px] px-4 py-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] rounded-full text-[12px] font-bold cursor-pointer"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          >
            <TransactionLedger
              user={user}
              transactions={transactions}
              expenses={expenses}
              onBack={closeSub}
              onUpdateTx={onFullUpdateTx || onAddTx}
              onDeleteTx={onDeleteTx}
              dateRange={dateRange}
              onDateRangeChange={onDateRangeChange}
              activeShift={activeShift}
              shifts={todayShifts}
              customerWallets={customerWallets}
              refetchCustomerWallets={refetchCustomerWallets}
              ledgerRowsTruncated={ledgerRowsTruncated}
              onLoadMoreLedgerRows={onLoadMoreLedgerRows}
              ledgerRowsLoadingMore={ledgerRowsLoadingMore}
            />
          </ErrorBoundary>
        ),
      };
    }

    if (activeSub === 'auditLog') {
      return { key: 'auditLog', element: <AuditLog onBack={closeSub} /> };
    }

    if (activeSub === 'podLog') {
      return { key: 'podLog', element: <PODLog user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'debtCollectionLog') {
      return {
        key: 'debtCollectionLog',
        element: <DebtCollectionRetrievalLog transactions={transactions} onBack={closeSub} />,
      };
    }

    if (activeSub === 'dispatch') {
      return { key: 'dispatch', element: <Dispatch onBack={closeSub} /> };
    }

    if (activeSub === 'airlineCommissions') {
      return { key: 'airlineCommissions', element: <AirlineCommissions onBack={closeSub} /> };
    }

    if (activeSub === 'corporateBilling') {
      return { key: 'corporateBilling', element: <CorporateBilling user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'officeReconcile') {
      return { key: 'officeReconcile', element: <OfficeWorkReconciliation user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'pricing') {
      return { key: 'pricing', element: <PricingConfiguration user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'hubCargoRates') {
      return { key: 'hubCargoRates', element: <HubCargoRates user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'contentTypes') {
      return {
        key: 'contentTypes',
        element: (
          <ContentTypes
            onBack={closeSub}
            onManageRates={(contentTypeId, rateType) => {
              if (rateType === 'flat') {
                openSub('flatTierRates');
              } else if (rateType === 'size') {
                openSub('sizeTierRates');
              } else {
                setSpecialGoodsPreset(contentTypeId);
                openSub('specialGoodsRates');
              }
            }}
          />
        ),
      };
    }

    if (activeSub === 'specialGoodsRates') {
      return {
        key: 'specialGoodsRates',
        element: (
          <SpecialGoodsRates
            user={user}
            onBack={() => {
              setSpecialGoodsPreset(undefined);
              closeSub();
            }}
            presetContentTypeId={specialGoodsPreset}
          />
        ),
      };
    }

    if (activeSub === 'minimumCharges') {
      return { key: 'minimumCharges', element: <MinimumCharges onBack={closeSub} /> };
    }

    if (activeSub === 'flatTierRates') {
      return { key: 'flatTierRates', element: <FlatTierRates user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'sizeTierRates') {
      return { key: 'sizeTierRates', element: <SizeTierRates user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'ratesList') {
      return {
        key: 'ratesList',
        element: (
          <RatesList
            onBack={closeSub}
            onOpenConfig={(target) => {
              if (target === 'pricing') openSub('pricing');
              else if (target === 'hubRates') openSub('hubCargoRates');
              else if (target === 'contentTypes') openSub('contentTypes');
              else if (target === 'specialGoods') openSub('specialGoodsRates');
              else if (target === 'minimumCharges') openSub('minimumCharges');
              else if (target === 'airlineCommissions') openSub('airlineCommissions');
              else if (target === 'flatTier') openSub('flatTierRates');
              else if (target === 'sizeTier') openSub('sizeTierRates');
            }}
          />
        ),
      };
    }

    if (activeSub === 'expenseCategories') {
      return { key: 'expenseCategories', element: <ExpenseCategories onBack={closeSub} /> };
    }

    if (activeSub === 'banks') {
      return { key: 'banks', element: <Banks onBack={closeSub} /> };
    }

    if (activeSub === 'support') {
      return { key: 'support', element: <SupportTickets user={user} onBack={closeSub} /> };
    }

    if (activeSub === 'staff') {
      return { key: 'staff', element: <StaffManagement user={user} onBack={closeSub} /> };
    }

    return null;
  };

  const activeView = getActiveSubView();
  const isLedgerView = activeView?.key === 'ledger';

  const slideVariants = {
    enter: (dir: 1 | -1) => ({ x: dir === 1 ? '100%' : '-100%' }),
    center: { x: 0 },
    exit: (dir: 1 | -1) => ({ x: dir === 1 ? '-100%' : '100%' }),
  };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--color-canvas)]">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.div
          key={activeView?.key ?? (selectedGroupId ? `group-${selectedGroupId}` : 'settings-home')}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: prefersReducedMotion || isLedgerView ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 min-h-0 flex flex-col overflow-y-auto"
        >
          {activeView ? (
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full py-20">
                  <Spinner size="lg" tone="muted" />
                </div>
              }
            >
              {activeView.element}
            </Suspense>
          ) : (
            <div className="w-full max-w-4xl mx-auto p-4 sm:p-5 space-y-4 pb-16 select-none">
              {/* Top Search Bar */}
              <div className="relative">
                <Search
                  size={18}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search settings..."
                  className="w-full min-h-[44px] pl-10 pr-10 rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] placeholder-[var(--color-muted)] text-[14px] sm:text-[13px] font-sans focus:outline-none focus:border-[var(--color-border-strong)] transition-colors shadow-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* View 1: Active Search Results */}
              {searchQuery.trim().length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-muted)]">
                      Matching Settings ({searchResults.length})
                    </span>
                  </div>

                  {searchResults.length === 0 ? (
                    <div className="ehi-card p-8 text-center space-y-2">
                      <Search size={32} className="mx-auto text-[var(--color-muted)] opacity-30" />
                      <div className="text-[14px] font-bold text-[var(--color-foreground)]">
                        No settings found
                      </div>
                      <div className="text-[12px] font-mono text-[var(--color-muted)]">
                        No settings match "{searchQuery}"
                      </div>
                    </div>
                  ) : (
                    <div className="ehi-card divide-y divide-[var(--color-border)] overflow-hidden">
                      {searchResults.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.id}
                            onClick={() => handleItemClick(item)}
                            className="w-full flex items-center gap-3.5 py-3 px-4 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group min-h-[50px]"
                          >
                            <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] shrink-0 transition-colors">
                              <Icon size={16} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[13px] font-bold text-[var(--color-foreground)] truncate">
                                  {item.title}
                                </span>
                                {item.level === 'advanced' && (
                                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)] shrink-0">
                                    Advanced
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-[var(--color-muted)] truncate mt-0.5">
                                {item.subtitle}
                              </div>
                            </div>
                            <div className="hidden sm:flex items-center gap-2 shrink-0">
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-muted)] border border-[var(--color-border)]">
                                {item.groupTitle}
                              </span>
                              <ChevronRight size={16} className="text-[var(--color-muted)]" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : selectedGroupId && activeGroup ? (
                /* View 2: Opened Group View (Progressive Disclosure Sub-Page) */
                <div className="space-y-3.5">
                  {/* Group Header Strip */}
                  <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <BackButton
                        onClick={() => selectGroup(null)}
                        label="Settings"
                        className="min-h-[44px]"
                      />
                      <div className="h-4 w-px bg-[var(--color-border)] shrink-0" />
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-foreground)] shrink-0">
                          {React.createElement(activeGroup.icon, { size: 16 })}
                        </div>
                        <h2 className="text-[15px] font-bold text-[var(--color-foreground)] font-sans truncate">
                          {activeGroup.title}
                        </h2>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-[var(--color-muted)] shrink-0">
                      {currentGroupItems.primary.length + currentGroupItems.advanced.length}
                    </span>
                  </div>

                  <p className="text-[12px] font-mono text-[var(--color-muted)] px-1">
                    {activeGroup.description}
                  </p>

                  {/* Primary Items List */}
                  <div className="ehi-card divide-y divide-[var(--color-border)] overflow-hidden">
                    {currentGroupItems.primary.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleItemClick(item)}
                          className="w-full flex items-center gap-3.5 py-3 px-4 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group min-h-[50px]"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] shrink-0 transition-colors">
                            <Icon size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[13px] font-bold text-[var(--color-foreground)] truncate block">
                              {item.title}
                            </span>
                            <div className="text-[11px] font-mono text-[var(--color-muted)] truncate mt-0.5">
                              {item.subtitle}
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-[var(--color-muted)] shrink-0" />
                        </button>
                      );
                    })}
                  </div>

                  {/* Advanced Disclosure Inside Group */}
                  {currentGroupItems.advanced.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-hover)] text-left cursor-pointer min-h-[44px] transition-colors"
                      >
                        <span className="flex items-center gap-2 text-[12px] font-bold text-[var(--color-foreground)]">
                          {showAdvanced ? (
                            <ChevronDown size={16} className="text-[var(--color-muted)]" />
                          ) : (
                            <ChevronRight size={16} className="text-[var(--color-muted)]" />
                          )}
                          Advanced
                          <span className="text-[10px] font-mono text-[var(--color-muted)] font-normal">
                            ({currentGroupItems.advanced.length})
                          </span>
                        </span>
                        <span className="text-[11px] font-mono text-[var(--color-muted)]">
                          {showAdvanced ? 'Hide' : 'Show'}
                        </span>
                      </button>

                      {showAdvanced && (
                        <div className="ehi-card divide-y divide-[var(--color-border)] overflow-hidden">
                          {currentGroupItems.advanced.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.id}
                                onClick={() => handleItemClick(item)}
                                className="w-full flex items-center gap-3.5 py-3 px-4 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group min-h-[50px]"
                              >
                                <div className="w-8 h-8 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted)] group-hover:text-[var(--color-foreground)] shrink-0 transition-colors">
                                  <Icon size={16} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-[13px] font-bold text-[var(--color-foreground)] truncate block">
                                    {item.title}
                                  </span>
                                  <div className="text-[11px] font-mono text-[var(--color-muted)] truncate mt-0.5">
                                    {item.subtitle}
                                  </div>
                                </div>
                                <ChevronRight size={16} className="text-[var(--color-muted)] shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* View 3: Settings Home Page (6 Groups + Appearance) */
                <div className="space-y-4">
                  {/* Display & Density Preferences */}
                  <div className="ehi-card p-3 sm:p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    {/* Theme */}
                    <div className="flex items-center justify-between gap-3 flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {theme === 'dark' ? (
                          <Moon size={16} className="text-[var(--color-muted)] shrink-0" />
                        ) : (
                          <Sun size={16} className="text-[var(--color-muted)] shrink-0" />
                        )}
                        <span className="text-[12px] font-bold text-[var(--color-foreground)] truncate font-sans">
                          Theme
                        </span>
                      </div>
                      <div className="flex items-center bg-[var(--color-surface-2)] p-0.5 rounded-full border border-[var(--color-border-strong)] shrink-0">
                        <button
                          type="button"
                          onClick={() => theme !== 'dark' && toggleTheme()}
                          aria-label="Dark mode"
                          className={`min-h-[44px] min-w-[48px] px-3.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                            theme === 'dark'
                              ? 'bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)]'
                              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                          }`}
                        >
                          Dark
                        </button>
                        <button
                          type="button"
                          onClick={() => theme !== 'light' && toggleTheme()}
                          aria-label="Light mode"
                          className={`min-h-[44px] min-w-[48px] px-3.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                            theme === 'light'
                              ? 'bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)]'
                              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                          }`}
                        >
                          Light
                        </button>
                      </div>
                    </div>

                    <div className="hidden sm:block w-px h-6 bg-[var(--color-border)] shrink-0" />

                    {/* Density */}
                    <div className="flex items-center justify-between gap-3 flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Sliders size={16} className="text-[var(--color-muted)] shrink-0" />
                        <span className="text-[12px] font-bold text-[var(--color-foreground)] truncate font-sans">
                          Density
                        </span>
                      </div>
                      <div className="flex items-center bg-[var(--color-surface-2)] p-0.5 rounded-full border border-[var(--color-border-strong)] shrink-0">
                        <button
                          type="button"
                          onClick={() => !isSpacious && setDensity('spacious')}
                          aria-label="Spacious touch density"
                          className={`min-h-[44px] min-w-[54px] px-3.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                            isSpacious
                              ? 'bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)]'
                              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                          }`}
                        >
                          Spacious
                        </button>
                        <button
                          type="button"
                          onClick={() => !isCompact && setDensity('compact')}
                          aria-label="Compact data density"
                          className={`min-h-[44px] min-w-[54px] px-3.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer flex items-center justify-center ${
                            isCompact
                              ? 'bg-[var(--color-primary-pill)] text-[var(--color-primary-pill-text)]'
                              : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
                          }`}
                        >
                          Compact
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 6 Structured Groups */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {accessibleGroups.map((group) => {
                      const Icon = group.icon;
                      return (
                        <button
                          key={group.id}
                          onClick={() => selectGroup(group.id)}
                          className="ehi-card p-3.5 flex items-center justify-between gap-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer group min-h-[64px]"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-foreground)] shrink-0 group-hover:border-[var(--color-border-strong)] transition-colors">
                              <Icon size={18} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold text-[var(--color-foreground)] font-sans truncate">
                                {group.title}
                              </div>
                              <div className="text-[11px] font-mono text-[var(--color-muted)] mt-0.5">
                                {group.description}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] font-semibold">
                              {group.count}
                            </span>
                            <ChevronRight size={16} className="text-[var(--color-muted)]" />
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Quiet Session Footer */}
                  <div className="pt-2 pb-1 text-center text-[10px] font-mono text-[var(--color-muted)] opacity-60">
                    Terminal &middot; {user.hub} &middot; {user.name} ({user.role})
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
