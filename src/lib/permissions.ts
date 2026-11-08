import { TabView, User, UserRole, ExcessBaggageAirline } from './types';
import { LogisticsMode } from './modeContext';

// Single source of truth for "which nav views can this user see." Before
// this, the same role-based logic was hand-duplicated across SideNav.tsx,
// BottomNav.tsx, EHIApp.tsx's ehi-nav allowlist, and More.tsx's menu
// gates -- four lists that had to be kept in sync by hand, and the only
// place a per-user override (view_overrides) could plug in without
// touching all four separately.

export interface ViewDef {
  id: TabView;
  label: string;
  roles: UserRole[];
  // Groups the checklist in StaffManagement's view-access editor -- undefined
  // means it's one of the original top-level nav tabs (see groupViewDefs
  // below). Purely cosmetic; has no bearing on getAllowedTabs/canAccessTab.
  category?: string;
  // Which logistics modes this view applies to. If undefined, applies to all modes.
  modes?: LogisticsMode[];
}

const MORE_TAB_ROLES: UserRole[] = ['super_admin', 'admin', 'accountant', 'auditor', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'office_work'];

// The static (non-airline-dependent) top-level views and which roles get
// each one by default. This is what a user falls back to when they have
// no view_overrides set -- i.e. every account until a super_admin
// explicitly customizes one.
export const STATIC_VIEWS: ViewDef[] = [
  { id: 'Tower', label: 'Dashboard', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'accountant', 'auditor'] },
  
  // Air mode views
  { id: 'Cargo', label: 'Air Cargo Intake', roles: ['super_admin', 'admin', 'cargo_agent', 'office_work'], modes: ['air', 'intermodal'] },
  { id: 'FlightRadar', label: 'Flight Radar', roles: MORE_TAB_ROLES, category: 'Daily Operations', modes: ['air', 'intermodal'] },
  { id: 'AirlineLedger', label: 'Airline Balance Ledger', roles: ['super_admin', 'admin', 'accountant'], category: 'Data & Records', modes: ['air', 'intermodal'] },
  { id: 'WeightManifest', label: 'Weight Manifest', roles: ['super_admin', 'admin', 'cargo_agent', 'office_work'], category: 'Data & Records', modes: ['air', 'intermodal'] },
  { id: 'More:AirlineCommissions', label: 'Airline Commissions', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance', modes: ['air', 'intermodal'] },
  { id: 'More:AirlinePerformance', label: 'Airline Sales & Weight Breakdown', roles: ['super_admin', 'admin', 'accountant', 'auditor'], category: 'Finance', modes: ['air', 'intermodal'] },
  { id: 'More:HubCargoRates', label: 'Hub Cargo Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration', modes: ['air', 'intermodal'] },
  { id: 'More:SpecialGoodsRates', label: 'Special Goods Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration', modes: ['air', 'intermodal'] },
  
  // Road mode views
  { id: 'Packages', label: 'Road Waybill & Parcels', roles: ['super_admin', 'admin', 'cargo_agent', 'marketing_agent', 'office_work'], modes: ['road', 'intermodal'] },
  { id: 'Dispatch', label: 'Dispatch Fleet', roles: ['super_admin', 'admin'], modes: ['road', 'intermodal'] },
  { id: 'Fleet', label: 'Fleet & Fuel', roles: ['super_admin', 'admin'], modes: ['road', 'intermodal'] },
  { id: 'MyTrips', label: 'My Trips', roles: ['driver'], modes: ['road', 'intermodal'] },
  { id: 'More:Dispatch', label: 'Dispatch & Fleet Tracking', roles: ['super_admin', 'admin'], category: 'Fleet & Logistics', modes: ['road', 'intermodal'] },
  { id: 'More:Fleet', label: 'Fleet Management', roles: ['super_admin', 'admin'], category: 'Fleet & Logistics', modes: ['road', 'intermodal'] },
  { id: 'More:PODLog', label: 'Proof of Delivery Log', roles: ['super_admin', 'admin', 'auditor', 'accountant'], category: 'Fleet & Logistics', modes: ['road', 'intermodal'] },

  // Shared operational core (Air, Road, Intermodal)
  { id: 'Scan', label: 'QR Scanner', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'accountant', 'auditor', 'driver', 'office_work'] },
  { id: 'Incoming', label: 'Incoming To Hub', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'driver', 'office_work'] },
  { id: 'OutboundArrivals', label: 'Outbound Arrivals', roles: ['super_admin', 'admin', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'accountant', 'auditor', 'office_work'] },
  { id: 'More', label: 'More', roles: ['super_admin', 'admin', 'accountant', 'auditor', 'cargo_agent', 'baggage_agent', 'marketing_agent', 'driver', 'office_work'] },
  { id: 'IT Debug', label: 'IT Debug Console', roles: ['super_admin'] },
  { id: 'Credit & Debit', label: 'Credit & Debit', roles: ['super_admin', 'admin', 'accountant'] },

  // Shared More views
  { id: 'More:EODClose', label: 'EOD Daily Close', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  { id: 'More:TransactionLedger', label: 'Transaction Ledger', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  { id: 'More:DebtCollectionLog', label: 'Debt Collection & Retrieval Log', roles: MORE_TAB_ROLES, category: 'Daily Operations' },
  { id: 'More:BankReconciliation', label: 'Bank Reconciliation', roles: ['super_admin', 'accountant'], category: 'Finance' },
  { id: 'More:AccountingConsole', label: 'Central Accounting ERP', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:Reports', label: 'Advanced Reports', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:RatesList', label: 'Rates Directory', roles: MORE_TAB_ROLES, category: 'Finance' },
  { id: 'More:CorporateBilling', label: 'Corporate Client Billing', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:OfficeWorkReconcile', label: 'Office Work Reconciliation', roles: ['super_admin', 'admin', 'accountant'], category: 'Finance' },
  { id: 'More:CustomerWallets', label: 'Customer Credit Wallets', roles: ['super_admin', 'admin', 'accountant', 'auditor'], category: 'Finance' },
  { id: 'More:FraudAlerts', label: 'Fraud & Anomalies Feed', roles: ['super_admin', 'admin', 'auditor', 'accountant'], category: 'Intelligence' },
  { id: 'More:AuditLog', label: 'Revision Audit Log', roles: ['super_admin', 'auditor'], category: 'Intelligence' },
  { id: 'DataImport', label: 'Import Historical Data', roles: ['super_admin', 'admin'], category: 'Data & Records' },
  { id: 'More:PricingConfiguration', label: 'Pricing & Rates Configuration', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:ContentTypes', label: 'Content Types', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:MinimumCharges', label: 'Minimum Charges', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:FlatTierRates', label: 'Flat Tier Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:SizeTierRates', label: 'Size Tier Rates', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:ExpenseCategories', label: 'Expense Categories', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:Banks', label: 'Banks', roles: ['super_admin', 'admin', 'accountant'], category: 'Administration' },
  { id: 'More:Settings', label: 'Platform Settings', roles: ['super_admin'], category: 'Administration' },
  { id: 'More:StaffManagement', label: 'Staff Management', roles: ['super_admin', 'admin'], category: 'Support & Account' },
  { id: 'More:SupportTickets', label: 'Help Desk & Issue Resolution', roles: MORE_TAB_ROLES, category: 'Support & Account' },
];

const CATEGORY_ORDER = ['Main Navigation', 'Daily Operations', 'Finance', 'Intelligence', 'Fleet & Logistics', 'Data & Records', 'Administration', 'Support & Account'];

export function groupViewDefs(views: ViewDef[]): { category: string; views: ViewDef[] }[] {
  const byCategory = new Map<string, ViewDef[]>();
  for (const v of views) {
    const cat = v.category || 'Main Navigation';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(v);
  }
  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, views: byCategory.get(c)! }));
}

// Retained for backward compatibility if old airline baggage views are configured
export function getBaggageViews(role: UserRole, assignedAirline: string | undefined, airlines: ExcessBaggageAirline[]): ViewDef[] {
  // Excess baggage counters are stripped from primary SaaS UI.
  // Returns empty to keep navigation clean.
  return [];
}

export function getAllViewDefs(airlines: ExcessBaggageAirline[]): ViewDef[] {
  return [...STATIC_VIEWS];
}

// Maps TabView to its ViewDef lookup
const VIEW_MAP = new Map<TabView, ViewDef>(STATIC_VIEWS.map((v) => [v.id, v]));

export function getRoleDefaultTabs(
  user: Pick<User, 'role' | 'assigned_airline'>,
  airlines: ExcessBaggageAirline[],
  mode?: LogisticsMode
): TabView[] {
  return STATIC_VIEWS
    .filter((v) => {
      if (!v.roles.includes(user.role)) return false;
      if (mode && v.modes && !v.modes.includes(mode)) return false;
      return true;
    })
    .map((v) => v.id);
}

export function getAllowedTabs(
  user: Pick<User, 'role' | 'assigned_airline' | 'view_overrides'>,
  airlines: ExcessBaggageAirline[],
  mode?: LogisticsMode
): TabView[] {
  let tabs: TabView[];
  if (user.view_overrides != null) {
    tabs = user.view_overrides as TabView[];
  } else {
    tabs = getRoleDefaultTabs(user, airlines, mode);
  }

  // If a mode filter is applied, ensure overridden views also conform to mode
  if (mode) {
    tabs = tabs.filter((tabId) => {
      const def = VIEW_MAP.get(tabId);
      if (!def || !def.modes) return true; // View applies to all modes
      return def.modes.includes(mode);
    });
  }

  return tabs;
}

export function canAccessTab(
  user: Pick<User, 'role' | 'assigned_airline' | 'view_overrides'>,
  tab: string,
  airlines: ExcessBaggageAirline[],
  mode?: LogisticsMode
): boolean {
  return getAllowedTabs(user, airlines, mode).includes(tab as TabView);
}
