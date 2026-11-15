import type { LucideIcon } from 'lucide-react';
import {
  Wallet,
  Tag,
  ClipboardList,
  Printer,
  Truck,
  Shield,
  CreditCard,
  Receipt,
  Plane,
  Layers,
  Database,
  Landmark,
  List,
  Scale,
  Sparkles,
  Activity,
  FileText,
  HandCoins,
  BarChart3,
  History,
  Upload,
  MapPin,
  Users,
  ShieldAlert,
  Settings,
  Brain,
  Terminal,
} from 'lucide-react';
import { User, ExcessBaggageAirline, TabView } from '../../lib/types';
import { canAccessTab } from '../../lib/permissions';
import { LogisticsMode } from '../../lib/modeContext';

export type SettingGroupId =
  | 'financial'
  | 'pricing'
  | 'records'
  | 'hardware'
  | 'fleet'
  | 'system';

export type DisclosureLevel = 'primary' | 'advanced';

export type SettingTarget =
  | { type: 'sub'; subKey: string; path: string }
  | { type: 'tab'; tab: TabView; path: string };

export interface SettingGroup {
  id: SettingGroupId;
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface SettingItem {
  id: string;
  groupId: SettingGroupId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  level: DisclosureLevel;
  keywords: string[];
  permission: string;
  target: SettingTarget;
  badge?: string;
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'financial',
    title: 'Financial & Wallets',
    description: 'Balances, credit, debit, and billing',
    icon: Wallet,
  },
  {
    id: 'pricing',
    title: 'Pricing & Tariffs',
    description: 'Tariffs, cargo rates, and rules',
    icon: Tag,
  },
  {
    id: 'records',
    title: 'Records & Audit',
    description: 'Ledgers, daily closes, and logs',
    icon: ClipboardList,
  },
  {
    id: 'hardware',
    title: 'Hardware & Printing',
    description: 'Tag printers and counter devices',
    icon: Printer,
  },
  {
    id: 'fleet',
    title: 'Fleet & Logistics',
    description: 'Vehicles, trips, and delivery tracking',
    icon: Truck,
  },
  {
    id: 'system',
    title: 'System & Security',
    description: 'Staff, support, logs, and settings',
    icon: Shield,
  },
];

export const SETTING_ITEMS: SettingItem[] = [
  // 1. Financial & Wallets
  {
    id: 'credit-debit',
    groupId: 'financial',
    title: 'Credit & Debit',
    subtitle: 'View receivables, payables, and airline commissions',
    icon: CreditCard,
    level: 'primary',
    keywords: ['credit', 'debit', 'receivables', 'payables', 'airline', 'commission', 'balance', 'finance', 'money'],
    permission: 'Credit & Debit',
    target: { type: 'tab', tab: 'Credit & Debit', path: '/credit-debit' },
  },
  {
    id: 'customer-wallets',
    groupId: 'financial',
    title: 'Customer Credit Wallets',
    subtitle: 'Manage customer advance balances, top-ups, and credit history',
    icon: Wallet,
    level: 'primary',
    keywords: ['customer', 'credit', 'wallets', 'advance', 'balance', 'top-up', 'deposit', 'funds', 'cash'],
    permission: 'More:CustomerWallets',
    target: { type: 'sub', subKey: 'customerWallets', path: '/more/customer-wallets' },
  },
  {
    id: 'corporate-billing',
    groupId: 'financial',
    title: 'Corporate Client Billing',
    subtitle: 'Generate shipment statements for corporate B2B accounts',
    icon: Receipt,
    level: 'primary',
    keywords: ['corporate', 'client', 'billing', 'statement', 'invoice', 'b2b', 'account', 'company'],
    permission: 'More:CorporateBilling',
    target: { type: 'sub', subKey: 'corporateBilling', path: '/more/corporate-billing' },
  },
  {
    id: 'airline-performance',
    groupId: 'financial',
    title: 'Airline Sales & Weight Breakdown',
    subtitle: 'View total sales (₦) and total weight (KG) per airline by date range',
    icon: Plane,
    level: 'primary',
    keywords: ['airline', 'sales', 'weight', 'breakdown', 'performance', 'kg', 'revenue', 'flight', 'report'],
    permission: 'More:AirlinePerformance',
    target: { type: 'tab', tab: 'AirlinePerformance', path: '/airline-performance' },
  },
  {
    id: 'bank-recon',
    groupId: 'financial',
    title: 'Bank Reconciliation',
    subtitle: 'Match bank deposits with system payment ledgers',
    icon: Layers,
    level: 'advanced',
    keywords: ['bank', 'reconciliation', 'csv', 'auto', 'deposits', 'match', 'statement', 'ledger', 'audit'],
    permission: 'More:BankReconciliation',
    target: { type: 'sub', subKey: 'bankRecon', path: '/more/bank-recon' },
  },
  {
    id: 'office-reconcile',
    groupId: 'financial',
    title: 'Office Work Reconciliation',
    subtitle: 'Link & reprice mis-entered corporate debts',
    icon: Receipt,
    level: 'advanced',
    keywords: ['office', 'work', 'reconciliation', 'debt', 'reprice', 'corporate', 'link', 'mis-entered'],
    permission: 'More:OfficeWorkReconcile',
    target: { type: 'sub', subKey: 'officeReconcile', path: '/more/office-reconcile' },
  },
  {
    id: 'accounting',
    groupId: 'financial',
    title: 'Central Accounting ERP',
    subtitle: 'Check balance sheets and cash flows dashboard',
    icon: Database,
    level: 'advanced',
    keywords: ['central', 'accounting', 'erp', 'balance', 'sheet', 'cash', 'flow', 'profit', 'loss', 'pnl', 'finance'],
    permission: 'More:AccountingConsole',
    target: { type: 'sub', subKey: 'accounting', path: '/more/accounting' },
  },
  {
    id: 'airline-ledger',
    groupId: 'financial',
    title: 'Airline Balance Ledger',
    subtitle: 'Per-airline running Credit / Debit / Cheque Raise ledger',
    icon: Plane,
    level: 'advanced',
    keywords: ['airline', 'balance', 'ledger', 'cheque', 'raise', 'debit', 'credit', 'running', 'statement'],
    permission: 'AirlineLedger',
    target: { type: 'tab', tab: 'AirlineLedger', path: '/airline-ledger' },
  },
  {
    id: 'expense-categories',
    groupId: 'financial',
    title: 'Expense Categories',
    subtitle: 'Categories staff log expenses against, plus monthly budgets',
    icon: Receipt,
    level: 'advanced',
    keywords: ['expense', 'categories', 'budget', 'spending', 'outgoing', 'cost', 'staff', 'ops'],
    permission: 'More:ExpenseCategories',
    target: { type: 'sub', subKey: 'expenseCategories', path: '/more/expense-categories' },
  },
  {
    id: 'banks',
    groupId: 'financial',
    title: 'Banks',
    subtitle: 'Bank list used in Transfer/POS payment dropdowns',
    icon: Landmark,
    level: 'advanced',
    keywords: ['banks', 'transfer', 'pos', 'payment', 'dropdown', 'accounts', 'institutions'],
    permission: 'More:Banks',
    target: { type: 'sub', subKey: 'banks', path: '/more/banks' },
  },

  // 2. Pricing & Tariffs
  {
    id: 'rates-list',
    groupId: 'pricing',
    title: 'Rates Directory',
    subtitle: 'View every configured rate — read-only summary',
    icon: List,
    level: 'primary',
    keywords: ['rates', 'directory', 'tariff', 'list', 'summary', 'price', 'cargo', 'kg'],
    permission: 'More:RatesList',
    target: { type: 'sub', subKey: 'ratesList', path: '/more/rates-list' },
  },
  {
    id: 'pricing',
    groupId: 'pricing',
    title: 'Pricing & Rates Configuration',
    subtitle: 'B2B client rates and retail standard tariffs',
    icon: Tag,
    level: 'primary',
    keywords: ['pricing', 'rates', 'configuration', 'standard', 'tariff', 'b2b', 'client', 'retail', 'rules'],
    permission: 'More:PricingConfiguration',
    target: { type: 'sub', subKey: 'pricing', path: '/more/pricing' },
  },
  {
    id: 'hub-cargo-rates',
    groupId: 'pricing',
    title: 'Hub Cargo Rates',
    subtitle: 'Per-hub, per-airline rate overrides on the standard tariff',
    icon: Tag,
    level: 'primary',
    keywords: ['hub', 'cargo', 'rates', 'station', 'airline', 'override', 'tariff', 'origin', 'destination'],
    permission: 'More:HubCargoRates',
    target: { type: 'sub', subKey: 'hubCargoRates', path: '/more/hub-cargo-rates' },
  },
  {
    id: 'content-types',
    groupId: 'pricing',
    title: 'Content Types',
    subtitle: 'Cargo and package content categories staff pick from at intake',
    icon: Tag,
    level: 'primary',
    keywords: ['content', 'types', 'categories', 'goods', 'package', 'intake', 'classification'],
    permission: 'More:ContentTypes',
    target: { type: 'sub', subKey: 'contentTypes', path: '/more/content-types' },
  },
  {
    id: 'airline-commissions',
    groupId: 'pricing',
    title: 'Airline Commissions',
    subtitle: 'Set percentage cuts for partner airlines',
    icon: Plane,
    level: 'advanced',
    keywords: ['airline', 'commissions', 'percentage', 'cuts', 'partner', 'fee', 'split'],
    permission: 'More:AirlineCommissions',
    target: { type: 'sub', subKey: 'airlineCommissions', path: '/more/airline-commissions' },
  },
  {
    id: 'special-goods-rates',
    groupId: 'pricing',
    title: 'Special Goods Rates',
    subtitle: 'Per-airline, weight-tiered rates for flagged content types',
    icon: Sparkles,
    level: 'advanced',
    keywords: ['special', 'goods', 'rates', 'tiered', 'perishable', 'fragile', 'valuable', 'hazardous'],
    permission: 'More:SpecialGoodsRates',
    target: { type: 'sub', subKey: 'specialGoodsRates', path: '/more/special-goods-rates' },
  },
  {
    id: 'minimum-charges',
    groupId: 'pricing',
    title: 'Minimum Charges',
    subtitle: 'Flat weight-bracket floor per airline + route',
    icon: Scale,
    level: 'advanced',
    keywords: ['minimum', 'charges', 'floor', 'baseline', 'route', 'airline', 'fee', 'bracket'],
    permission: 'More:MinimumCharges',
    target: { type: 'sub', subKey: 'minimumCharges', path: '/more/minimum-charges' },
  },
  {
    id: 'flat-tier-rates',
    groupId: 'pricing',
    title: 'Flat Tier Rates',
    subtitle: 'Flat weight-bracket pricing (Bumper & Burnet)',
    icon: Receipt,
    level: 'advanced',
    keywords: ['flat', 'tier', 'rates', 'bumper', 'burnet', 'bracket', 'pricing', 'weight'],
    permission: 'More:FlatTierRates',
    target: { type: 'sub', subKey: 'flatTierRates', path: '/more/flat-tier-rates' },
  },
  {
    id: 'size-tier-rates',
    groupId: 'pricing',
    title: 'Size Tier Rates',
    subtitle: 'Flat screen-size-bracket pricing (Plasma TV)',
    icon: Receipt,
    level: 'advanced',
    keywords: ['size', 'tier', 'rates', 'plasma', 'tv', 'dimensions', 'inches', 'bracket'],
    permission: 'More:SizeTierRates',
    target: { type: 'sub', subKey: 'sizeTierRates', path: '/more/size-tier-rates' },
  },

  // 3. Records & Audit
  {
    id: 'ledger',
    groupId: 'records',
    title: 'Transaction Ledger',
    subtitle: 'View, search, filter, and export transaction entries',
    icon: Activity,
    level: 'primary',
    keywords: ['transaction', 'ledger', 'master', 'history', 'search', 'filter', 'export', 'entries', 'payments'],
    permission: 'More:TransactionLedger',
    target: { type: 'sub', subKey: 'ledger', path: '/more/ledger' },
  },
  {
    id: 'eod',
    groupId: 'records',
    title: 'EOD Daily Close',
    subtitle: 'Generate and dispatch end of day reconciliation reports',
    icon: FileText,
    level: 'primary',
    keywords: ['eod', 'daily', 'close', 'end of day', 'reconciliation', 'register', 'cash', 'count', 'shift'],
    permission: 'More:EODClose',
    target: { type: 'sub', subKey: 'eod', path: '/more/eod' },
  },
  {
    id: 'debt-collection-log',
    groupId: 'records',
    title: 'Debt Collection & Retrieval Log',
    subtitle: 'Every debt payment and cargo retrieval, one line each',
    icon: HandCoins,
    level: 'primary',
    keywords: ['debt', 'collection', 'retrieval', 'log', 'payment', 'unretrieve', 'cashout', 'credit', 'cleared'],
    permission: 'More:DebtCollectionLog',
    target: { type: 'sub', subKey: 'debtCollectionLog', path: '/more/debt-collection-log' },
  },
  {
    id: 'reports',
    groupId: 'records',
    title: 'Advanced Reports',
    subtitle: 'Operational audits, trend sheets, and performance analytics',
    icon: BarChart3,
    level: 'primary',
    keywords: ['advanced', 'reports', 'analytics', 'trends', 'operational', 'audits', 'statements'],
    permission: 'More:Reports',
    target: { type: 'sub', subKey: 'reports', path: '/more/reports' },
  },
  {
    id: 'weight-manifest',
    groupId: 'records',
    title: 'Weight Manifest',
    subtitle: 'Daily dispatch weight tracking per flight and route',
    icon: ClipboardList,
    level: 'primary',
    keywords: ['weight', 'manifest', 'dispatch', 'flight', 'route', 'daily', 'kg', 'cargo', 'pieces'],
    permission: 'WeightManifest',
    target: { type: 'tab', tab: 'WeightManifest', path: '/weight-manifest' },
  },
  {
    id: 'audit-log',
    groupId: 'records',
    title: 'Revision Audit Log',
    subtitle: 'Strict NDPR and financial compliance trace log',
    icon: History,
    level: 'advanced',
    keywords: ['revision', 'audit', 'log', 'ndpr', 'compliance', 'security', 'changes', 'edits', 'trace'],
    permission: 'More:AuditLog',
    target: { type: 'sub', subKey: 'auditLog', path: '/more/audit-log' },
  },
  {
    id: 'data-import',
    groupId: 'records',
    title: 'Import Historical Data',
    subtitle: 'Bulk import ledger records from CSV spreadsheets',
    icon: Upload,
    level: 'advanced',
    keywords: ['import', 'historical', 'data', 'bulk', 'csv', 'upload', 'spreadsheet', 'legacy'],
    permission: 'DataImport',
    target: { type: 'tab', tab: 'DataImport', path: '/data-import' },
  },

  // 4. Hardware & Printing
  {
    id: 'gat-print-queue',
    groupId: 'hardware',
    title: 'GAT Print Queue',
    subtitle: 'Batch-print tags & receipts for GAT sales',
    icon: Printer,
    level: 'primary',
    keywords: ['gat', 'print', 'queue', 'tags', 'receipts', 'barcode', 'thermal', 'batch', 'qz'],
    permission: 'More:GatPrintQueue',
    target: { type: 'sub', subKey: 'gatPrintQueue', path: '/more/gat-print-queue' },
  },

  // 5. Fleet & Logistics
  {
    id: 'fleet',
    groupId: 'fleet',
    title: 'Fleet Management',
    subtitle: 'Vehicles registration, service scheduler, fuel expense log',
    icon: Truck,
    level: 'primary',
    keywords: ['fleet', 'management', 'vehicles', 'trucks', 'service', 'maintenance', 'fuel', 'vans'],
    permission: 'More:Fleet',
    target: { type: 'sub', subKey: 'fleet', path: '/more/fleet' },
  },
  {
    id: 'pod-log',
    groupId: 'fleet',
    title: 'Proof of Delivery Log',
    subtitle: 'GPS trace, signatures, and delivery photo evidence',
    icon: Shield,
    level: 'primary',
    keywords: ['proof', 'delivery', 'pod', 'log', 'signature', 'photos', 'gps', 'recipient'],
    permission: 'More:PODLog',
    target: { type: 'sub', subKey: 'podLog', path: '/more/pod-log' },
  },
  {
    id: 'dispatch',
    groupId: 'fleet',
    title: 'Dispatch & Fleet Tracking',
    subtitle: 'Live driver tracking on active routes',
    icon: MapPin,
    level: 'primary',
    keywords: ['dispatch', 'fleet', 'tracking', 'live', 'driver', 'routes', 'gps', 'transport'],
    permission: 'More:Dispatch',
    target: { type: 'sub', subKey: 'dispatch', path: '/more/dispatch' },
  },

  // 6. System & Security
  {
    id: 'staff',
    groupId: 'system',
    title: 'Staff Management',
    subtitle: 'Add staff, assign hubs, set roles, deactivate accounts',
    icon: Users,
    level: 'primary',
    keywords: ['staff', 'management', 'users', 'accounts', 'roles', 'permissions', 'hubs', 'passwords'],
    permission: 'More:StaffManagement',
    target: { type: 'sub', subKey: 'staff', path: '/more/staff' },
  },
  {
    id: 'support',
    groupId: 'system',
    title: 'Help Desk & Issue Resolution',
    subtitle: 'Report operational complaints or bugs',
    icon: ShieldAlert,
    level: 'primary',
    keywords: ['help', 'desk', 'tickets', 'support', 'issue', 'report', 'complaints', 'bugs', 'resolution'],
    permission: 'More:SupportTickets',
    target: { type: 'sub', subKey: 'support', path: '/more/support' },
  },
  {
    id: 'settings',
    groupId: 'system',
    title: 'Platform Settings',
    subtitle: 'Automation, connection keys, and company configuration',
    icon: Settings,
    level: 'primary',
    keywords: ['platform', 'settings', 'connection', 'supabase', 'paystack', 'company', 'api', 'keys'],
    permission: 'More:Settings',
    target: { type: 'sub', subKey: 'settings', path: '/more/settings' },
  },
  {
    id: 'airline-logos',
    groupId: 'system',
    title: 'Airline Logos',
    subtitle: 'Manage uploaded logos for all partner airlines',
    icon: Plane,
    level: 'advanced',
    keywords: ['airline', 'logos', 'partner', 'branding', 'images', 'uploads'],
    permission: 'AirlineLogos',
    target: { type: 'tab', tab: 'AirlineLogos', path: '/airline-logos' },
  },
  {
    id: 'forecasting',
    groupId: 'system',
    title: 'Demand Forecasting AI',
    subtitle: 'Capacity heatmap and busy periods projections',
    icon: Brain,
    level: 'advanced',
    keywords: ['demand', 'forecasting', 'ai', 'gemini', 'capacity', 'heatmap', 'projections', 'intelligence'],
    permission: 'More:Forecasting',
    target: { type: 'sub', subKey: 'forecasting', path: '/more/forecasting' },
  },
  {
    id: 'fraud-alerts',
    groupId: 'system',
    title: 'Fraud & Anomalies Feed',
    subtitle: 'Track sudden debt spikes and duplicated AWBs',
    icon: ShieldAlert,
    level: 'advanced',
    keywords: ['fraud', 'anomalies', 'feed', 'security', 'duplicate', 'awb', 'spikes', 'alert', 'audit'],
    permission: 'More:FraudAlerts',
    target: { type: 'sub', subKey: 'fraudAlerts', path: '/more/fraud-alerts' },
  },
  {
    id: 'it-debug',
    groupId: 'system',
    title: 'IT Debug Console',
    subtitle: 'Live system logs, debugging and diagnostics',
    icon: Terminal,
    level: 'advanced',
    keywords: ['it', 'debug', 'console', 'diagnostics', 'terminal', 'logs', 'developer', 'error'],
    permission: 'IT Debug',
    target: { type: 'tab', tab: 'IT Debug', path: '/it-debug' },
  },
];

/**
 * Legacy routes under /more/... that have moved to top-level tab routes.
 * Kept for backwards compatibility so existing deep links or bookmarks redirect smoothly.
 */
export const MORE_REDIRECT_ALIASES: Record<string, string> = {
  'credit-debit': '/credit-debit',
  'airline-performance': '/airline-performance',
  'airline-ledger': '/airline-ledger',
  'weight-manifest': '/weight-manifest',
  'data-import': '/data-import',
  'airline-logos': '/airline-logos',
  'it-debug': '/it-debug',
  'incoming': '/incoming',
  'outbound-arrivals': '/outbound-arrivals',
  'packages': '/packages',
  'flight-radar': '/flight-radar',
};

/**
 * Operational screens promoted to main navigation that MUST NOT reappear in Settings.
 */
export const PROMOTED_OPERATIONAL_ITEMS: string[] = [
  'Incoming to Hub',
  'Outbound Arrivals',
  'Package & Parcel Desk',
  'Flight Radar',
  'Airline POS',
];

/**
 * Filter items by user role and logistics mode.
 */
export function getAccessibleSettings(
  items: SettingItem[],
  user: Pick<User, 'role' | 'assigned_airline' | 'view_overrides'>,
  airlines: ExcessBaggageAirline[] = [],
  mode?: LogisticsMode
): SettingItem[] {
  return items.filter((item) => canAccessTab(user, item.permission, airlines, mode));
}

/**
 * Get groups that contain at least one accessible item for the user.
 */
export function getAccessibleGroups(
  groups: SettingGroup[],
  accessibleItems: SettingItem[]
): (SettingGroup & { count: number; primaryCount: number; advancedCount: number })[] {
  return groups
    .map((g) => {
      const groupItems = accessibleItems.filter((item) => item.groupId === g.id);
      const primaryCount = groupItems.filter((i) => i.level === 'primary').length;
      const advancedCount = groupItems.filter((i) => i.level === 'advanced').length;
      return {
        ...g,
        count: groupItems.length,
        primaryCount,
        advancedCount,
      };
    })
    .filter((g) => g.count > 0);
}

/**
 * Instant search filter matching against title, subtitle, group name, and keywords.
 */
export function searchSettings(
  items: SettingItem[],
  query: string,
  groups: SettingGroup[] = SETTING_GROUPS
): (SettingItem & { groupTitle: string })[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const groupMap = new Map(groups.map((g) => [g.id, g.title]));

  return items
    .filter((item) => {
      if (item.title.toLowerCase().includes(q)) return true;
      if (item.subtitle.toLowerCase().includes(q)) return true;
      const groupTitle = groupMap.get(item.groupId);
      if (groupTitle && groupTitle.toLowerCase().includes(q)) return true;
      if (item.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    })
    .map((item) => ({
      ...item,
      groupTitle: groupMap.get(item.groupId) || '',
    }));
}
