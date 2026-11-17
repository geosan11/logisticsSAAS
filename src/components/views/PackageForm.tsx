import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useEnterToNextField } from "../../lib/useEnterToNextField";
import { User, Transaction, Expense, HubShift } from "../../lib/types";
import { fmt, uid, tnow, generatePaymentNarration, getHubCode, upperOnChange, isStandalonePWA, generatePickupPin, formatPaymentModeDisplay } from "../../lib/helpers";
import { chargeWalletForSale } from "../../lib/walletPayment";
import { useIsOnline } from "../../lib/useIsOnline";
import { matchOfficeClient, useCorporateClients, useCorporateRouteRates, useOfficeWorkAutoPrice } from "../../lib/officeWork";
import { matchWallet } from "../../lib/customerIdentity";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { useHubRoutes, useValidatedRouteSelection, useHubs } from "../../lib/hubRoutes";
import { useContentTypes } from "../../lib/contentTypes";
import { useExpenseCategories } from "../../lib/expenseCategories";
import { useBanks } from "../../lib/banks";
import { MIN_PACKAGE_AMOUNT } from "../../lib/constants";
import { getNextTag } from "../../lib/tagPool";
import {
  Plus,
  CheckCircle,
  ClipboardList,
  BarChart2,
  Printer,
  Bluetooth,
  Copy,
  AlertTriangle,
  User as UserIcon,
  Banknote,
  CreditCard,
  Landmark,
  MapPin,
  Layers,
  Hash,
  Package as PackageIcon,
  Scale,
  Truck,
  Phone,
  FileText,
  X,
  Building2,
  Clock,
  Lock,
} from "lucide-react";
import { Spinner, useDensity } from "../ui";
import { supabase, writeAuditLog } from "../../lib/supabase";
import { clearDebt, DEBT_TABLE_NAME } from "../../lib/debt";
import { sendReceiptWhatsApp, buildPackageWhatsApp } from "../../lib/notifications";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";
import { EmptyState } from "./EmptyState";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import { CustomerWallet } from "../../lib/types";
import { ReviewEntryModal } from "./ReviewEntryModal";
import { DepartmentSalesAnalysisModal } from "../DepartmentSalesAnalysis";
import { QRCode } from "../QRCode";

export const PackageForm = ({
  user: propUser,
  transactions,
  expenses,
  onAddTx,
  onUpdateTx,
  onAddExpense,
  onShowHistory,
  customerWallets = [],
  setCustomerWallets,
  activeShift,
}: {
  user: User;
  transactions: Transaction[];
  expenses: Expense[];
  onAddTx: (tx: Transaction) => void;
  onUpdateTx: (tx: Transaction) => void;
  onAddExpense: (exp: Expense) => void;
  onShowHistory?: () => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
  activeShift?: HubShift | null;
}) => {
  const { isCompact } = useDensity();
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  const hubList = useHubs();
  const [adminSelectedHubId, setAdminSelectedHubId] = useState<string>(propUser.hub_id || '');
  const selectedHubRecord = hubList.find(h => h.id === adminSelectedHubId);
  const user = isAdmin
    ? {
        ...propUser,
        hub_id: adminSelectedHubId || propUser.hub_id,
        hub: selectedHubRecord?.name || propUser.hub,
        hub_code: selectedHubRecord?.code || propUser.hub_code,
      }
    : propUser;

  const userHubCode = getHubCode(user.hub_code || user.hub);

  const { showToast } = useToast();
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const confirm = useConfirm();
  const destinations = useHubRoutes({ includeOther: false, coldFallback: false });
  const contentTypes = useContentTypes();

  const [trackingRef, setTrackingRef] = useState<string>('');
  useEffect(() => {
    const allocate = async () => {
      const hubCode = getHubCode(user.hub_code || user.hub);
      const tag = await getNextTag(`${hubCode}-PKG`, `EHI-${hubCode}-PKG`);
      if (tag) {
        setTrackingRef(tag);
      } else {
        setTrackingRef('');
        showToast({ message: 'No tracking number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
      }
    };
    allocate();
  }, [user.hub_code, user.hub]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState<string>('');
  useValidatedRouteSelection(destinations, destination, setDestination);
  const [contentType, setContentType] = useState<'Package' | 'Parcel'>('Package');
  const [pcs, setPcs] = useState("1");
  const [kg, setKg] = useState("");
  const [contents, setContents] = useState<string>('');
  const [customContents, setCustomContents] = useState("");
  const [remark, setRemark] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>("Cash");
  const isOnline = useIsOnline();
  useEffect(() => {
    if (!isOnline && mode === 'Wallet') setMode('Cash');
  }, [isOnline, mode]);

  const banks = useBanks();
  const [bank, setBank] = useState<string>(banks[0]);
  const [narrationCode, setNarrationCode] = useState<string>("");

  // Road / Fleet vehicle assignment for road waybills
  const [vehicles, setVehicles] = useState<{ plate: string; driver_name: string; make?: string; model?: string; status?: string }[]>([]);
  const [assignedVehicle, setAssignedVehicle] = useState<string>('');
  const [assignedDriver, setAssignedDriver] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    const fetchVehicles = async () => {
      try {
        const { data, error } = await supabase
          .from('fleet_vehicles')
          .select('plate, driver_name, make, model, status')
          .order('plate', { ascending: true });
        if (mounted && data && !error) {
          setVehicles(data);
        }
      } catch {
        // Safe offline fallback
      }
    };
    fetchVehicles();
    return () => { mounted = false; };
  }, []);

  const corpClients = useCorporateClients();
  const corpRates = useCorporateRouteRates();
  const officeMatch = useMemo(() => matchOfficeClient(name, corpClients), [name, corpClients]);
  const detectedOfficeClient = officeMatch.client;
  const [linkedAsOfficeWork, setLinkedAsOfficeWork] = useState(false);
  const wasLinkedRef = useRef(false);
  useEffect(() => {
    if (wasLinkedRef.current) setAmount('');
    setLinkedAsOfficeWork(false);
    wasLinkedRef.current = false;
  }, [name, officeMatch.type]);
  const officeWorkRate = useMemo(() => {
    if (!linkedAsOfficeWork || !detectedOfficeClient) return null;
    return corpRates.find(r => r.corporate_client_id === detectedOfficeClient.id && r.route_name === destination) || null;
  }, [linkedAsOfficeWork, detectedOfficeClient, corpRates, destination]);
  useOfficeWorkAutoPrice(linkedAsOfficeWork, officeWorkRate, parseFloat(kg) || 0, destination, setAmount);

  useEffect(() => {
    if ((mode === "Transfer" || mode === "POS") && !narrationCode) {
      setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
    }
  }, [mode, narrationCode, user.hub, user.hub_code]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPackageReview, setShowPackageReview] = useState(false);

  const expenseCategoryNames = useExpenseCategories().map(c => c.name);
  const [expType, setExpType] = useState<string>('');
  useEffect(() => {
    if (expenseCategoryNames.length > 0 && !expenseCategoryNames.includes(expType)) setExpType(expenseCategoryNames[0]);
  }, [expenseCategoryNames]);
  const [expAmount, setExpAmount] = useState("");
  const [expDesc, setExpDesc] = useState("");

  const actualContents = contents === "Other" ? customContents : contents;
  const parsedAmount = parseFloat(amount) || 0;
  const pcsNum = parseInt(pcs) || 0;
  const kgNum = parseFloat(kg) || 0;

  const isValidCore = name.trim().length > 0
    && ((linkedAsOfficeWork && officeWorkRate) ? parsedAmount > 0 : parsedAmount >= MIN_PACKAGE_AMOUNT)
    && destination.trim().length > 0
    && actualContents.trim().length > 0
    && !!trackingRef
    && pcsNum > 0;

  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = (createdAt?: string) => !!createdAt && createdAt.split('T')[0] === todayStr;

  const packageTxs = transactions.filter((t) => t.type === "package" && isToday(t.created_at));
  const totalSales = packageTxs.reduce((sum, t) => sum + t.amount, 0);
  const nonWalletPortion = (t: Transaction) => Math.max(0, (t.amount || 0) - (t.wallet_deduction_amount || 0));
  const cashSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Cash" ? nonWalletPortion(t) : 0), 0);
  const posSales = packageTxs.reduce((sum, t) => sum + (t.mode === "POS" ? nonWalletPortion(t) : 0), 0);
  const transferSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Transfer" ? nonWalletPortion(t) : 0), 0);
  const debtSales = packageTxs.reduce((sum, t) => sum + (t.mode === "Debt" ? nonWalletPortion(t) : 0), 0);
  const debtCashRecoveredToday = packageTxs.reduce((sum, t) => {
    if (!t.paymentHistory) return sum;
    const todays = t.paymentHistory.filter(p => p.mode === 'Cash' && p.at && isToday(p.at));
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const debtTotalRecoveredToday = packageTxs.reduce((sum, t) => {
    if (!t.paymentHistory) return sum;
    const todays = t.paymentHistory.filter(p => p.at && isToday(p.at));
    return sum + todays.reduce((s, p) => s + p.amount, 0);
  }, 0);
  const totalExpenses = expenses.filter(e => isToday(e.created_at)).reduce((sum, e) => sum + e.amount, 0);
  const physicalCash = cashSales + debtCashRecoveredToday;
  const balanceCash = physicalCash - totalExpenses;

  const destinationCounts: Record<string, number> = {};
  packageTxs.forEach(t => {
    const d = t.destination || 'Unknown';
    destinationCounts[d] = (destinationCounts[d] || 0) + 1;
  });

  const unpaidDebts = packageTxs.filter(t => t.mode === 'Debt' && (t.amount - (t.amountPaid || 0)) > 0);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showSalesAnalysis, setShowSalesAnalysis] = useState(false);
  const [closingDay, setClosingDay] = useState(false);

  useEffect(() => {
    if (!showCloseModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closingDay) setShowCloseModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCloseModal, closingDay]);

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<CustomerWallet | null>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    return matchWallet(customerWallets, name, phone);
  }, [name, phone, customerWallets, selectedWalletOverride]);

  const saleIdempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const walletRemainderBankOk = mode !== 'Wallet' || (!!activeWallet && (activeWallet.balance >= parsedAmount ||
    !(walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') || walletRemainderBank.trim().length > 0));
  const isValid = isValidCore && walletRemainderBankOk;

  const handleAddEntry = async () => {
    if (!(linkedAsOfficeWork && officeWorkRate) && parsedAmount < MIN_PACKAGE_AMOUNT) {
      showToast({ message: `Amount must be at least ₦${MIN_PACKAGE_AMOUNT.toLocaleString()}`, type: 'warning' });
      return;
    }
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const tx: Transaction = {
        id: trackingRef,
        name: name.trim(),
        detail: `${destination} · ${contentType} · ${pcsNum}pcs · ${kgNum}kg · ${actualContents}${assignedVehicle ? ` · 🚚 ${assignedVehicle}` : ''}`,
        amount: parsedAmount,
        mode,
        bank: (mode === "Transfer" || mode === "POS") ? bank : undefined,
        paymentNarration: (mode === "Transfer" || mode === "POS") ? narrationCode : undefined,
        time: tnow(),
        created_at: new Date().toISOString(),
        type: "package",
        status: "Intake",
        destination,
        contentType,
        pieces: pcsNum,
        kg: kgNum,
        contents: actualContents,
        vehiclePlate: assignedVehicle || undefined,
        driverName: assignedDriver || undefined,
        hub: user.hub,
        hub_id: user.hub_id,
        enteredByName: user.name,
        debtPaid: mode === "Debt" ? false : undefined,
        linked_as_office_work: linkedAsOfficeWork || undefined,
        corporate_client_id: linkedAsOfficeWork && detectedOfficeClient ? detectedOfficeClient.id : undefined,
        applied_rate_per_kg: linkedAsOfficeWork && officeWorkRate ? officeWorkRate.rate_per_kg : undefined,
        clientType: linkedAsOfficeWork ? "Corporate" : "Individual",
        created_shift_id: activeShift?.id,
        consigneePhone: phone.trim() || undefined,
        pickupPin: generatePickupPin(),
        remarks: remark.trim(),
      } as any;

      if (mode === "Wallet" && activeWallet) {
        const walletRemainder = Math.max(0, parsedAmount - activeWallet.balance);
        if (walletRemainder > 0 && (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') && !walletRemainderBank.trim()) {
          showToast({ message: `Enter the bank/terminal for the ₦${fmt(walletRemainder)} remainder.`, type: 'warning' });
          setSubmitting(false);
          return;
        }
        const charge = await chargeWalletForSale({
          wallet: activeWallet,
          amount: parsedAmount,
          cargoRef: trackingRef,
          description: `Package Consignment ${trackingRef}`,
          loggedBy: user.name,
          department: 'package',
          idempotencyKey: saleIdempotencyKeyRef.current,
        });
        if (!charge.ok) {
          showToast({ message: `Wallet deduction failed: ${charge.error}. Entry was not logged.`, type: 'error' });
          setSubmitting(false);
          return;
        }
        tx.wallet_id = activeWallet.id;
        tx.wallet_deduction_amount = charge.walletDeduction;
        (tx as any).wallet_balance_before = activeWallet.balance;
        (tx as any).wallet_balance_after = charge.newBalance;
        if (charge.remainder > 0) {
          tx.mode = walletRemainderMode;
          tx.bank = (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ? walletRemainderBank.trim() : undefined;
        }

        if (setCustomerWallets) {
          setCustomerWallets(prev => prev.map(w => w.id === activeWallet.id ? { ...w, balance: charge.newBalance! } : w));
        }
        showToast({
          message: charge.remainder > 0
            ? `₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet · ₦${fmt(charge.remainder)} by ${walletRemainderMode}. Balance: ₦${fmt(charge.newBalance!)}`
            : `₦${fmt(charge.walletDeduction)} deducted from ${activeWallet.customer_name}'s credit wallet. Remaining balance: ₦${fmt(charge.newBalance!)}`,
          type: 'success'
        });
      }

      setSuccessTx(tx);
      setShowPackageReview(false);
      setSubmitting(false);
      onAddTx(tx);

      if (phone.trim().length > 0) {
        sendReceiptWhatsApp({
          phone: phone.trim(),
          ref: tx.id,
          message: buildPackageWhatsApp({
            ref: tx.id,
            customer: tx.name,
            destination,
            contentType,
            amount: parsedAmount,
            mode,
            bank: (mode === "Transfer" || mode === "POS") ? bank : undefined,
            paymentNarration: (mode === "Transfer" || mode === "POS") ? narrationCode : undefined,
          }),
        });
      }
    } catch (err: any) {
      setSubmitting(false);
      showToast({ message: `Unexpected error: ${err?.message || 'please try again'}`, type: 'error' });
    }
  };

  const handleReset = () => {
    saleIdempotencyKeyRef.current = crypto.randomUUID();
    setName("");
    setPhone("");
    setPcs("1");
    setKg("");
    setContents('');
    setCustomContents("");
    setDestination('');
    setAmount("");
    setMode("Cash");
    setNarrationCode("");
    setRemark("");
    setAssignedVehicle("");
    setAssignedDriver("");
    setSuccessTx(null);
    setSelectedWalletOverride(null);
    setWalletRemainderMode('Cash');
    setWalletRemainderBank('');
    setTrackingRef('');
    const hubCodeReset = getHubCode(user.hub_code || user.hub);
    getNextTag(`${hubCodeReset}-PKG`, `EHI-${hubCodeReset}-PKG`).then(tag => {
      if (tag) {
        setTrackingRef(tag);
      } else {
        setTrackingRef('');
        showToast({ message: 'No tracking number available offline. Connect to the internet briefly to reserve more, then try again.', type: 'error' });
      }
    });
  };

  const handleAddExpense = () => {
    const amt = parseFloat(expAmount);
    if (!amt || amt <= 0) {
      showToast({ message: 'Enter an expense amount greater than zero.', type: 'warning' });
      return;
    }
    onAddExpense({ id: uid('EX' as any), type: expType, amount: amt, description: expDesc.trim(), time: tnow() });
    setExpAmount("");
    setExpDesc("");
  };

  const handleMarkDebtPaid = async (tx: Transaction) => {
    if (markingPaidId) return;
    const remaining = tx.amount - (tx.amountPaid || 0) - ((tx.raw as any)?.retrieved_amount || 0);
    if (remaining <= 0) return;
    setMarkingPaidId(tx.id);
    try {
      const result = await clearDebt({
        type: 'package',
        id: tx.id,
        paymentAmount: remaining,
        paymentMode: 'Cash',
        loggedBy: user.name || 'Unknown',
        expectedRemaining: remaining,
      });
      if (!result.ok) {
        showToast({ message: result.error || 'Failed to mark debt paid.', type: 'error' });
        return;
      }
      const historyEntry = { amount: remaining, mode: 'Cash' as const, by: user.name || 'Unknown', at: new Date().toISOString() };
      const fullyPaid = result.fullyPaid ?? true;
      onUpdateTx({
        ...tx,
        debtPaid: fullyPaid,
        debtPaidAt: fullyPaid ? new Date().toISOString() : undefined,
        amountPaid: result.newAmountPaid ?? tx.amount,
        paymentHistory: [...(tx.paymentHistory || []), historyEntry],
        mode: fullyPaid ? 'Debt Paid' : 'Debt',
      });
      writeAuditLog({
        user_id: user.id, user_name: user.name || 'Unknown', action: 'DEBT_COLLECTION',
        table_name: DEBT_TABLE_NAME.package, record_id: tx.id,
        description: `₦${fmt(remaining)} collected against ${tx.name}'s debt via Cash (fully cleared)`,
        hub: tx.hub || user.hub, hub_id: tx.hub_id || user.hub_id,
        old_values: { amount_paid: tx.amountPaid || 0 },
        new_values: { amount_paid: result.newAmountPaid, mode: 'Cash', amount: remaining },
      }).catch(() => {});
      showToast({ message: 'Debt marked paid', type: 'success' });
    } finally {
      setMarkingPaidId(null);
    }
  };

  const handleCloseDay = async () => {
    if (closingDay) return;
    const ok = await confirm({
      title: 'Close package desk session?',
      message: "Close today's package desk session? This cannot be undone.",
      confirmLabel: 'Close day',
      tone: 'danger',
    });
    if (!ok) return;
    setClosingDay(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase.from('package_day_close').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        date: today,
        total_sales: totalSales,
        cash_sales: cashSales,
        pos_sales: posSales,
        transfer_sales: transferSales,
        debt_sales: debtSales,
        total_expenses: totalExpenses,
        balance_cash: balanceCash,
        entry_count: packageTxs.length,
        destination_counts: destinationCounts,
        closed_by: user.name,
        closed_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,date' });
      if (error) throw error;
      showToast({ message: 'Day closed successfully', type: 'success' });
      setShowCloseModal(false);
    } catch (err: any) {
      showToast({ message: 'Failed to close day: ' + err.message, type: 'error' });
    } finally {
      setClosingDay(false);
    }
  };

  const formInputClass =
    "w-full min-h-[44px] h-11 px-3.5 text-[14px] rounded-xl bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-border-strong)] transition-all placeholder:text-[var(--color-muted)]";

  const renderLabel = (icon: any, text: string) => {
    const Icon = icon;
    return (
      <label className="text-[12px] font-sans font-medium text-[var(--color-text-secondary)] mb-1.5 flex items-center gap-1.5">
        <Icon size={14} className="text-[var(--color-muted)] shrink-0" />
        <span>{text}</span>
      </label>
    );
  };

  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

  const cardPadClass = isCompact ? 'p-3.5 space-y-3' : 'p-3.5 sm:p-5 space-y-4';
  const spaceYClass = isCompact ? 'space-y-3' : 'space-y-4';
  const gridGapClass = isCompact ? 'gap-3.5' : 'gap-4 sm:gap-5';

  return (
    <div ref={formRootRef} className="w-full flex-1 flex flex-col min-h-0 bg-[var(--color-canvas)]">
      {/* UNIFIED QUIET HEADER TOOLBAR */}
      <div className="border-b border-[var(--color-border)] px-3.5 sm:px-4 py-3 bg-[var(--color-surface-card)]">
        <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
          <div className="min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-sans font-semibold text-[var(--color-foreground)] tracking-tight">
              Package desk
            </h1>
            <p className="text-[12px] font-sans text-[var(--color-muted)] truncate max-w-xs md:max-w-md">
              Road waybill &amp; parcel consignments
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap justify-start sm:justify-end shrink-0 max-w-full">
            {isAdmin && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-sans text-[var(--color-muted)] hidden sm:inline">Hub:</span>
                <select
                  value={adminSelectedHubId}
                  onChange={(e) => setAdminSelectedHubId(e.target.value)}
                  className="min-w-[72px] sm:min-w-[88px] max-w-[115px] sm:max-w-[130px] truncate min-h-[44px] h-11 px-2.5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-border-strong)] cursor-pointer"
                  title="Global Hub Context"
                  aria-label="Global Hub Context"
                >
                  {hubList.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.code} · {h.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowSalesAnalysis(true)}
              className="min-w-[44px] min-h-[44px] h-11 px-2.5 sm:px-3 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
              title="Sales analysis"
              aria-label="Sales analysis"
            >
              <BarChart2 size={14} className="text-[var(--color-muted)] shrink-0" />
              <span className="hidden sm:inline">Sales analysis</span>
              <span className="inline sm:hidden">Sales</span>
            </button>

            {onShowHistory && (
              <button
                type="button"
                onClick={onShowHistory}
                className="min-w-[44px] min-h-[44px] h-11 px-2.5 sm:px-3 rounded-full text-[12px] font-sans font-medium bg-[var(--color-surface-2)] border border-[var(--color-border)] hover:bg-[var(--color-surface-3)] text-[var(--color-foreground)] transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                title="History"
                aria-label="History"
              >
                <ClipboardList size={14} className="text-[var(--color-muted)] shrink-0" />
                <span>History</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MAIN TWO-COLUMN CONTENT GRID */}
      <div className={`p-3 sm:p-4 grid grid-cols-1 items-start min-w-0 w-full ${isCompact ? 'gap-3.5 md:grid-cols-[1fr_240px] lg:grid-cols-[1fr_250px]' : 'gap-4 sm:gap-5 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_275px] xl:grid-cols-[1fr_300px]'}`}>
        <div className={`min-w-0 w-full ${spaceYClass}`}>
          {successTx ? (
            /* SUCCESS CONFIRMATION CARD */
            <div className="p-4 sm:p-5 space-y-4 max-w-md mx-auto w-full select-none bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl shadow-sm">
              {/* Status Header Banner */}
              <div className="bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 rounded-xl px-3.5 py-2.5 flex items-center gap-2">
                <CheckCircle size={18} className="text-[var(--color-success)] shrink-0" />
                <span className="text-[13px] font-sans font-semibold text-[var(--color-success)]">
                  Package saved successfully
                </span>
              </div>

              {/* QR Code + Pickup PIN Side-by-Side Row */}
              <div className="flex gap-3 items-stretch">
                <div className="flex items-center justify-center p-2 bg-white rounded-xl border border-[var(--color-border)] shrink-0 shadow-xs">
                  <QRCode id={successTx.id} size={72} />
                </div>

                {(successTx as any).pickupPin ? (
                  <div className="flex-1 border border-[var(--color-border)] rounded-xl bg-[var(--color-surface-2)] flex flex-col justify-center px-3.5 py-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                        Pickup pin
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText((successTx as any).pickupPin);
                          showToast({ message: "Pickup PIN copied!", type: "success" });
                        }}
                        className="min-w-[44px] min-h-[44px] w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                        title="Copy PIN"
                        aria-label="Copy PIN"
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                    <div className="text-[22px] font-mono font-bold text-[var(--color-foreground)] tracking-widest tabular-nums mt-0.5">
                      {(successTx as any).pickupPin}
                    </div>
                    <p className="text-[11px] font-sans text-[var(--color-muted)] leading-tight mt-0.5">
                      Share this PIN with consignee for pickup verification.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center border border-[var(--color-border)] rounded-xl bg-[var(--color-surface-2)] px-3.5 py-2.5">
                    <span className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Tracking reference</span>
                    <span className="text-[13px] font-mono font-semibold text-[var(--color-foreground)] truncate mt-0.5 tabular-nums">{successTx.id}</span>
                    <p className="text-[11px] font-sans text-[var(--color-muted)] leading-tight mt-0.5">
                      Scannable tracking QR code generated for package tags.
                    </p>
                  </div>
                )}
              </div>

              {/* Details Card */}
              <div className="w-full bg-[var(--color-surface-2)] rounded-xl p-3.5 border border-[var(--color-border)] text-left space-y-2">
                <div className="flex justify-between border-b border-[var(--color-border)] pb-1.5">
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">Consignee</span>
                  <span className="text-[13px] font-sans font-medium text-[var(--color-foreground)] truncate max-w-[65%]">{successTx.name}</span>
                </div>

                {successTx.wallet_deduction_amount && (
                  <div className="flex justify-between border-b border-[var(--color-border)] pb-1.5 text-[12px] font-sans">
                    <span className="text-[var(--color-muted)]">Wallet debited (Bal: ₦{fmt((successTx as any).wallet_balance_after || 0)})</span>
                    <span className="text-[var(--color-error)] font-medium tabular-nums">-₦{fmt(successTx.wallet_deduction_amount)}</span>
                  </div>
                )}

                <div className="flex justify-between border-b border-[var(--color-border)] pb-1.5">
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">Tracking reference</span>
                  <span className="text-[12px] font-mono font-semibold text-[var(--color-foreground)] tabular-nums">{successTx.id}</span>
                </div>

                <div className="flex justify-between border-b border-[var(--color-border)] pb-1.5">
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">Destination / Content</span>
                  <span className="text-[13px] font-sans text-[var(--color-foreground)] truncate max-w-[65%]">
                    {successTx.detail}
                  </span>
                </div>

                <div className="flex justify-between border-b border-[var(--color-border)] pb-1.5">
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">Payment method</span>
                  <span className="text-[13px] font-sans text-[var(--color-foreground)]">
                    {successTx.mode} {successTx.bank ? `· ${successTx.bank}` : ''}
                  </span>
                </div>

                <div className="flex justify-between pt-0.5">
                  <span className="text-[12px] font-sans text-[var(--color-muted)]">Amount paid</span>
                  <span className="text-[16px] font-sans font-bold text-[var(--color-foreground)] tabular-nums">
                    ₦{fmt(successTx.amount)}
                  </span>
                </div>
              </div>

              {/* Primary Flat White Pill Button */}
              <button
                type="button"
                onClick={handleReset}
                className="min-h-[48px] h-12 w-full rounded-full font-semibold text-[15px] font-sans bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 shadow-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <Plus size={16} />
                <span>Log another package</span>
              </button>

              {/* Action Buttons: Bluetooth POS & PDF Documents */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposPackagePrinting');
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          destination,
                          contentType,
                          pieces: successTx.pieces,
                          kg: successTx.kg,
                          contents: successTx.contents,
                          amount: successTx.amount,
                          paymentMode: formatPaymentModeDisplay(successTx.mode, successTx.wallet_deduction_amount, successTx.amount),
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compilePackageReceiptStream(printData, '80mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="min-h-[44px] h-11 px-3 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Bluetooth size={14} className="text-[var(--color-muted)]" />
                  <span>POS (80mm)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                      await printViaBluetooth(async () => {
                        const m = await import('../../lib/escposPackagePrinting');
                        const printData = {
                          entryRef: successTx.id,
                          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                          agentName: user.name,
                          customerName: successTx.name,
                          phone: phone || undefined,
                          destination,
                          contentType,
                          pieces: successTx.pieces,
                          kg: successTx.kg,
                          contents: successTx.contents,
                          amount: successTx.amount,
                          paymentMode: formatPaymentModeDisplay(successTx.mode, successTx.wallet_deduction_amount, successTx.amount),
                          paymentNarration: successTx.paymentNarration,
                          bankName: bank || undefined,
                          trackingUrl: `https://app.ehimultisystems.com/track/${successTx.id}`,
                        };
                        return await m.compilePackageReceiptStream(printData, '58mm');
                      });
                    }).catch((err: any) => {
                      console.error('Bluetooth print failed:', err);
                      showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
                    });
                  }}
                  className="min-h-[44px] h-11 px-3 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Bluetooth size={14} className="text-[var(--color-muted)]" />
                  <span>POS (58mm)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    import('./PackageReceipt').then(m => m.downloadPackageReceipt({
                      entryRef: successTx.id,
                      date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                      agentName: user.name,
                      customerName: successTx.name,
                      phone: phone || undefined,
                      destination,
                      contentType,
                      pieces: successTx.pieces,
                      kg: successTx.kg,
                      contents: successTx.contents,
                      vehiclePlate: successTx.vehiclePlate,
                      driverName: successTx.driverName,
                      amount: successTx.amount,
                      paymentMode: formatPaymentModeDisplay(successTx.mode, successTx.wallet_deduction_amount, successTx.amount),
                      paymentNarration: successTx.paymentNarration,
                      bankName: bank || undefined,
                    }));
                  }}
                  className="min-h-[44px] h-11 px-3 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                >
                  <FileText size={14} className="text-[var(--color-muted)]" />
                  <span>Receipt PDF</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
                    showToast({ message: 'Generating tag PDF…', type: 'info' });
                    try {
                      const { printPackageTagPDF } = await import('./PackageTagPDF');
                      await printPackageTagPDF({
                        id: successTx.id,
                        name: successTx.name,
                        destination,
                        contentType,
                        pieces: successTx.pieces,
                        kg: successTx.kg,
                        contents: successTx.contents,
                        hubName: user?.hub || "EHI Station",
                        date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
                        agentName: successTx.enteredByName,
                        phone: successTx.consigneePhone,
                      }, preOpenedWindow);
                    } catch (err) {
                      console.error('Failed to open tag PDF', err);
                      preOpenedWindow?.close();
                      showToast({ message: 'Failed to open tag PDF', type: 'error' });
                    }
                  }}
                  className="min-h-[44px] h-11 px-3 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                  title="Fixed 100mm x 80mm label -- for thermal label printers or browser print"
                >
                  <Printer size={14} className="text-[var(--color-muted)]" />
                  <span>Tag PDF</span>
                </button>
              </div>
            </div>
          ) : (
            /* ENTERABLE PACKAGE FORM */
            <div className={spaceYClass}>
              {/* CARD 1: CONSIGNMENT & ROUTING */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Consignment &amp; routing
                  </h3>
                </div>

                <div className="space-y-3 pt-1">
                  {/* Tracking Ref Row */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                    <span className="text-[12px] font-sans text-[var(--color-muted)]">Tracking reference</span>
                    <span className="text-[13px] font-mono font-semibold text-[var(--color-foreground)] tabular-nums">
                      {trackingRef || 'Allocating…'}
                    </span>
                  </div>

                  {/* Consignee Name & Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      {renderLabel(UserIcon, mode === "Debt" ? "Debtor name" : "Consignee name")}
                      <input
                        id="pkg-name"
                        name="name"
                        placeholder={mode === "Debt" ? "Debtor name" : "Full consignee name"}
                        value={name}
                        onChange={upperOnChange(setName)}
                        className={formInputClass}
                      />
                    </div>

                    <div>
                      {renderLabel(Phone, "Consignee phone")}
                      <input
                        id="pkg-phone"
                        name="phone"
                        type="tel"
                        placeholder="Phone number"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={formInputClass}
                      />
                    </div>
                  </div>

                  {/* Corporate Client Detection */}
                  {detectedOfficeClient && !linkedAsOfficeWork && (
                    <div className="p-3.5 rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 flex items-start gap-3">
                      <AlertTriangle size={16} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-sans font-semibold text-[var(--color-foreground)]">
                          {officeMatch.type === 'exact' ? 'Registered corporate match' : 'Corporate client detected'}
                        </div>
                        <div className="text-[11px] font-sans text-[var(--color-muted)] mt-0.5">
                          <span className="font-medium text-[var(--color-foreground)]">{detectedOfficeClient.company_name}</span> is a registered account.
                          {officeWorkRate
                            ? ` Contract rate for ${destination}: ₦${officeWorkRate.rate_per_kg}/kg`
                            : ' No contract rate configured for this route — pricing stays manual.'}
                        </div>
                        <div className="flex gap-2 mt-2.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setLinkedAsOfficeWork(true);
                              wasLinkedRef.current = true;
                              if (officeWorkRate && kg) {
                                const w = parseFloat(kg) || 0;
                                if (w > 0) {
                                  const computed = Math.max(w * officeWorkRate.rate_per_kg, officeWorkRate.minimum_amount ?? 0);
                                  setAmount(String(computed));
                                }
                              }
                            }}
                            className="min-h-[44px] h-11 px-4 rounded-full bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer select-none"
                          >
                            Yes, link as corporate
                          </button>
                          <button
                            type="button"
                            onClick={() => setLinkedAsOfficeWork(false)}
                            className="min-h-[44px] h-11 px-4 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] text-[12px] font-sans font-medium transition-colors cursor-pointer select-none"
                          >
                            Keep as retail
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {linkedAsOfficeWork && detectedOfficeClient && (
                    <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 size={15} className="text-[var(--color-muted)] shrink-0" />
                        <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)] truncate">
                          Corporate: {detectedOfficeClient.company_name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setLinkedAsOfficeWork(false); setAmount(''); wasLinkedRef.current = false; }}
                        className="min-h-[44px] h-11 px-3.5 text-[12px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-error)] bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-full transition-colors cursor-pointer shrink-0 flex items-center justify-center"
                      >
                        Unlink
                      </button>
                    </div>
                  )}

                  {/* Destination & Package Type */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      {renderLabel(MapPin, "Destination")}
                      <select
                        value={destination}
                        onChange={(e) => {
                          setDestination(e.target.value);
                          if (linkedAsOfficeWork) setAmount('');
                        }}
                        className={formInputClass}
                      >
                        <option value="" disabled>Select destination…</option>
                        {destinations.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>

                    <div>
                      {renderLabel(PackageIcon, "Package type")}
                      <select
                        value={contentType}
                        onChange={(e) => setContentType(e.target.value as 'Package' | 'Parcel')}
                        className={formInputClass}
                      >
                        <option value="Package">Package</option>
                        <option value="Parcel">Parcel</option>
                      </select>
                    </div>
                  </div>

                  {/* Vehicle / Truck Assignment */}
                  <div>
                    {renderLabel(Truck, "Vehicle assignment (optional)")}
                    <select
                      value={assignedVehicle}
                      onChange={(e) => {
                        const p = e.target.value;
                        setAssignedVehicle(p);
                        const match = vehicles.find(v => v.plate === p);
                        setAssignedDriver(match?.driver_name || '');
                      }}
                      className={formInputClass}
                    >
                      <option value="">No vehicle assigned (Counter intake)</option>
                      {vehicles.map((v) => (
                        <option key={v.plate} value={v.plate}>
                          {v.plate} {v.driver_name ? `· Driver: ${v.driver_name}` : ''} {v.make ? `(${v.make} ${v.model || ''})` : ''} [{v.status || 'Available'}]
                        </option>
                      ))}
                    </select>
                    {assignedVehicle && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-sans text-[var(--color-muted)] px-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-success)] shrink-0" />
                        <span>{assignedDriver ? `Driver: ${assignedDriver}` : 'No driver registered for this vehicle'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* CARD 2: SHIPMENT CONTENT & PIECES */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Shipment content &amp; pieces
                  </h3>
                </div>

                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      {renderLabel(Hash, "Pieces")}
                      <input
                        id="pkg-pcs"
                        name="pcs"
                        type="number"
                        min="1"
                        placeholder="1"
                        value={pcs}
                        onChange={(e) => setPcs(e.target.value)}
                        className={`${formInputClass} tabular-nums font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                      />
                    </div>

                    <div>
                      {renderLabel(Scale, "Weight in kg (optional)")}
                      <input
                        id="pkg-kg"
                        name="kg"
                        type="number"
                        min="0"
                        step="0.1"
                        placeholder="0.0"
                        value={kg}
                        onChange={(e) => setKg(e.target.value)}
                        className={`${formInputClass} tabular-nums font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                      />
                    </div>
                  </div>

                  <div>
                    {renderLabel(Layers, "Content category")}
                    <select
                      value={contents}
                      onChange={(e) => setContents(e.target.value)}
                      className={formInputClass}
                    >
                      <option value="" disabled>Select contents…</option>
                      {contentTypes.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {contents === "Other" && (
                      <input
                        id="pkg-custom-contents"
                        name="custom-contents"
                        placeholder="Describe package content"
                        value={customContents}
                        onChange={upperOnChange(setCustomContents)}
                        className={`${formInputClass} mt-2`}
                      />
                    )}
                  </div>

                  <div>
                    {renderLabel(FileText, "Remark (optional)")}
                    <input
                      id="pkg-remark"
                      name="remark"
                      placeholder="Special handling instructions or notes"
                      value={remark}
                      onChange={upperOnChange(setRemark)}
                      className={formInputClass}
                    />
                  </div>
                </div>
              </div>

              {/* CARD 3: PAYMENT DETAILS */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Payment details
                  </h3>
                </div>

                <div className="space-y-3 pt-1">
                  {/* Payment Mode Pills */}
                  <div>
                    {renderLabel(CreditCard, "Payment method")}
                    <div className={`grid ${isOnline ? "grid-cols-4" : "grid-cols-3"} gap-1 p-1 bg-[var(--color-surface-2)] rounded-full border border-[var(--color-border)] min-w-0 w-full`}>
                      {(isOnline ? ["Cash", "POS", "Transfer", "Wallet"] : ["Cash", "POS", "Transfer"]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMode(m as any)}
                          className={`min-h-[44px] h-11 text-[12px] sm:text-[13px] font-sans font-medium rounded-full transition-all flex items-center justify-center gap-1 px-1 sm:px-2 cursor-pointer select-none truncate ${
                            mode === m
                              ? "bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border-strong)] shadow-xs"
                              : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                          }`}
                        >
                          {m === "Wallet" ? <CreditCard size={13} className="shrink-0 hidden xs:inline" /> : null}
                          <span className="truncate">{m}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {!isOnline && (
                    <div className="text-[11px] font-sans text-[var(--color-muted)]">
                      Wallet payments require an active connection — use Cash, Transfer, or POS while offline.
                    </div>
                  )}

                  {mode === "Wallet" && (
                    <div className="space-y-2 pt-1">
                      <CustomerWalletPicker
                        wallets={customerWallets}
                        selectedWallet={activeWallet}
                        onSelectWallet={(w) => setSelectedWalletOverride(w)}
                        currentCustomerName={name}
                      />
                      {activeWallet && activeWallet.balance < parsedAmount && (
                        <WalletRemainderSelector
                          walletName={activeWallet.customer_name}
                          coverage={activeWallet.balance}
                          remainder={parsedAmount - activeWallet.balance}
                          mode={walletRemainderMode}
                          bank={walletRemainderBank}
                          onModeChange={setWalletRemainderMode}
                          onBankChange={setWalletRemainderBank}
                          banks={banks}
                        />
                      )}
                    </div>
                  )}

                  {/* Log as Credit Sale (Debt) */}
                  <button
                    type="button"
                    onClick={() => setMode(mode === "Debt" ? "Cash" : "Debt")}
                    className={`w-full min-h-[44px] h-11 text-[13px] font-sans font-medium rounded-full border transition-all cursor-pointer flex items-center justify-center gap-2 select-none ${
                      mode === "Debt"
                        ? "bg-[var(--color-error)]/15 border-[var(--color-error)] text-[var(--color-error)] shadow-xs"
                        : "bg-transparent border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border-strong)]"
                    }`}
                  >
                    <span>{mode === "Debt" ? "Active: Credit sale (debt) · Tap to cancel" : "Log as credit sale"}</span>
                  </button>

                  {mode === "Debt" && (
                    <div className="text-[12px] font-sans text-[var(--color-error)] bg-[var(--color-error)]/10 p-3 rounded-xl border border-[var(--color-error)]/20">
                      This entry will be logged as an unpaid credit sale. Collect payment before dispatch or arrange with management.
                    </div>
                  )}

                  {(mode === "Transfer" || mode === "POS") && (
                    <div>
                      {renderLabel(Landmark, mode === "POS" ? "POS terminal / bank" : "Receiving bank")}
                      <select
                        value={bank}
                        onChange={(e) => setBank(e.target.value)}
                        className={formInputClass}
                      >
                        {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Amount Field */}
                  <div>
                    {renderLabel(Banknote, "Amount")}
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-sans text-[16px]">
                        ₦
                      </span>
                      <input
                        id="pkg-amount"
                        name="amount"
                        type="number"
                        min="0"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        className={`w-full min-h-[44px] h-11 pl-9 pr-3.5 text-[15px] font-sans tabular-nums rounded-xl bg-[var(--color-surface-2)] text-[var(--color-foreground)] border transition-all ${
                          !(linkedAsOfficeWork && officeWorkRate) && amount !== "" && parsedAmount < MIN_PACKAGE_AMOUNT
                            ? "border-[var(--color-error)] focus:outline-none focus:border-[var(--color-error)]"
                            : "border-[var(--color-border)] focus:outline-none focus:border-[var(--color-border-strong)]"
                        }`}
                      />
                    </div>
                    {!(linkedAsOfficeWork && officeWorkRate) && amount !== "" && parsedAmount < MIN_PACKAGE_AMOUNT && (
                      <p className="text-[11px] text-[var(--color-error)] font-sans mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} className="shrink-0" />
                        <span>Minimum amount is ₦{MIN_PACKAGE_AMOUNT.toLocaleString()}</span>
                      </p>
                    )}
                  </div>

                  {/* Primary Submit Pill Button */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowPackageReview(true)}
                      disabled={!isValid || submitting}
                      className="min-h-[48px] h-12 w-full rounded-full font-semibold text-[15px] font-sans bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
                    >
                      {submitting && <Spinner size="sm" tone="current" />}
                      <span>{submitting ? "Logging package..." : "Log package entry"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* CARD 4: STATION EXPENSES */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Station expenses
                  </h3>
                </div>

                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2.5">
                    <select
                      value={expType}
                      onChange={(e) => setExpType(e.target.value)}
                      className={formInputClass}
                      title="Expense category"
                    >
                      {expenseCategoryNames.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>

                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-sans text-[14px]">
                        ₦
                      </span>
                      <input
                        id="pkg-exp-amount"
                        name="exp-amount"
                        type="number"
                        min="0"
                        placeholder="Amount"
                        value={expAmount}
                        onChange={(e) => setExpAmount(e.target.value)}
                        className="w-full min-h-[44px] h-11 pl-7 pr-3 text-[13px] font-sans tabular-nums rounded-xl bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-border-strong)]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      id="pkg-exp-desc"
                      name="exp-desc"
                      placeholder="Expense description (optional)"
                      value={expDesc}
                      onChange={upperOnChange(setExpDesc)}
                      className={`${formInputClass} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleAddExpense}
                      disabled={!(parseFloat(expAmount) > 0)}
                      className="min-h-[44px] h-11 px-4 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 w-full sm:w-auto flex items-center justify-center"
                    >
                      Log expense
                    </button>
                  </div>
                </div>
              </div>

              {/* CARD 5: UNPAID DEBTORS */}
              {unpaidDebts.length > 0 && (
                <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] overflow-hidden shadow-xs">
                  <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
                    <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                      Unpaid debts today
                    </h3>
                    <span className="text-[11px] font-sans font-medium px-2 py-0.5 rounded-full bg-[var(--color-error)]/15 text-[var(--color-error)] border border-[var(--color-error)]/20">
                      {unpaidDebts.length} pending
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--color-border)]">
                    {unpaidDebts.map((t) => (
                      <div key={t.id} className="flex justify-between items-center px-4 py-3">
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="text-[13px] font-sans font-medium text-[var(--color-foreground)] truncate">{t.name}</div>
                          <div className="text-[11px] font-sans text-[var(--color-muted)] truncate">{t.detail}</div>
                        </div>
                        <div className="flex items-center gap-2.5 shrink-0">
                          <span className="text-[13px] font-sans font-semibold text-[var(--color-error)] tabular-nums">₦{fmt(t.amount)}</span>
                          <button
                            type="button"
                            onClick={() => handleMarkDebtPaid(t)}
                            disabled={markingPaidId === t.id}
                            className="min-h-[44px] h-11 px-3.5 rounded-full text-[12px] font-sans font-medium bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25 hover:bg-[var(--color-success)]/20 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center select-none"
                          >
                            {markingPaidId === t.id ? 'Saving…' : 'Mark paid'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN ASIDE: SHIFT SUMMARY */}
        <aside className={`min-w-0 w-full ${spaceYClass}`}>
          <div className="sticky top-4 space-y-4">
            <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5">
                <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                  Shift summary
                </h3>
                <span className="text-[11px] font-sans text-[var(--color-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full border border-[var(--color-border)] tabular-nums">
                  {packageTxs.length} entries
                </span>
              </div>

              <div className="space-y-2 text-[13px] font-sans pt-1">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Total sales</span>
                  <span className="font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(totalSales)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Cash sales</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(cashSales)}</span>
                </div>
                {debtCashRecoveredToday > 0 && (
                  <div className="flex justify-between items-center text-[var(--color-success)]">
                    <span>Debt recovered (cash)</span>
                    <span className="tabular-nums font-medium">+ ₦{fmt(debtCashRecoveredToday)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">POS</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(posSales)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Bank transfer</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(transferSales)}</span>
                </div>
                {debtSales > 0 && (
                  <div className="flex justify-between items-center border-t border-[var(--color-border)] pt-2 mt-1 text-[var(--color-error)]">
                    <span>Unpaid credit sales</span>
                    <span className="font-semibold tabular-nums">₦{fmt(debtSales)}</span>
                  </div>
                )}
                {debtTotalRecoveredToday > 0 && (
                  <div className="flex justify-between items-center text-[var(--color-success)]">
                    <span>Debt collected today</span>
                    <span className="font-semibold tabular-nums">₦{fmt(debtTotalRecoveredToday)}</span>
                  </div>
                )}
              </div>

              {/* Net Cash Position Box */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-1.5 mt-2">
                <div className="flex justify-between text-[12px] font-sans text-[var(--color-muted)]">
                  <span>Cash in hand</span>
                  <span className="tabular-nums">₦{fmt(physicalCash)}</span>
                </div>
                <div className="flex justify-between text-[12px] font-sans text-[var(--color-error)]">
                  <span>Expenses</span>
                  <span className="tabular-nums">− ₦{fmt(totalExpenses)}</span>
                </div>
                <div className="flex justify-between items-center font-semibold text-[14px] font-sans border-t border-[var(--color-border)] pt-2 mt-1">
                  <span className="text-[var(--color-foreground)]">Balance cash</span>
                  <span className={`tabular-nums ${balanceCash >= 0 ? 'text-[var(--color-foreground)]' : 'text-[var(--color-error)]'}`}>
                    ₦{fmt(Math.abs(balanceCash))}{balanceCash < 0 ? ' (deficit)' : ''}
                  </span>
                </div>
              </div>

              {/* Destinations Today */}
              {Object.keys(destinationCounts).length > 0 && (
                <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
                  <div className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[var(--color-muted)]">
                    <MapPin size={13} className="shrink-0" />
                    <span>Destinations today</span>
                  </div>
                  <div className="space-y-1">
                    {Object.entries(destinationCounts).sort((a, b) => b[1] - a[1]).map(([d, cnt]) => (
                      <div key={d} className="flex justify-between items-center text-[12px] font-sans">
                        <span className="text-[var(--color-muted)] truncate mr-2">{d}</span>
                        <span className="font-medium text-[var(--color-foreground)] shrink-0 tabular-nums">{cnt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Entries Today */}
              <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
                <div className="flex items-center justify-between text-[12px] font-sans font-medium text-[var(--color-muted)]">
                  <div className="flex items-center gap-1.5">
                    <Clock size={13} className="shrink-0 text-[var(--color-muted)]" />
                    <span>Recent entries</span>
                  </div>
                  <span className="tabular-nums">{packageTxs.length}</span>
                </div>
                {packageTxs.length === 0 ? (
                  <p className="text-[12px] font-sans text-[var(--color-muted)] text-center py-4">
                    No entries logged yet
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--color-border)] max-h-[260px] overflow-y-auto">
                    {[...packageTxs].reverse().map((t) => (
                      <div key={t.id} className="flex justify-between items-center py-2">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="text-[12px] font-sans font-medium text-[var(--color-foreground)] truncate">{t.name}</div>
                          <div className="text-[11px] font-sans text-[var(--color-muted)] truncate">{t.detail}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[12px] font-sans font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(t.amount)}</div>
                          <div className={`text-[10px] font-sans ${t.mode === 'Debt' ? 'text-[var(--color-error)]' : 'text-[var(--color-muted)]'}`}>
                            {t.mode}{t.bank ? ` · ${t.bank}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* End Day Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(true)}
                  className="min-h-[44px] h-11 w-full rounded-full font-medium text-[13px] font-sans bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-2 select-none"
                >
                  <Lock size={14} className="text-[var(--color-muted)]" />
                  <span>End day &amp; close session</span>
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* REVIEW ENTRY MODAL */}
      {showPackageReview && (
        <ReviewEntryModal
          title="Review package entry"
          details={[
            { label: 'Customer', value: name },
            { label: 'Destination', value: destination },
            { label: 'Type & Pieces', value: `${contentType} · ${pcsNum} pcs` },
            { label: 'Content', value: actualContents },
            { label: 'Amount', value: parseFloat(amount) || 0 },
            { label: 'Payment mode', value: mode },
            ...(assignedVehicle ? [{ label: 'Assigned vehicle', value: `${assignedVehicle}${assignedDriver ? ` (${assignedDriver})` : ''}` }] : []),
          ]}
          onConfirm={() => {
            handleAddEntry();
          }}
          onCancel={() => setShowPackageReview(false)}
          confirmText="Log package"
          isSubmitting={submitting}
        />
      )}

      {/* CLOSE DAY MODAL */}
      {showCloseModal && createPortal(
        <div
          className="fixed inset-0 w-screen h-screen ehi-scrim z-[99999] flex items-center justify-center p-3 sm:p-4 select-none animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget && !closingDay) setShowCloseModal(false);
          }}
        >
          <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-[16px] font-sans font-semibold text-[var(--color-foreground)]">
                  End day &amp; close session
                </h2>
                <p className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5">
                  Package desk reconciliation · {new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} · {user.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="min-w-[44px] min-h-[44px] w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              <div className="space-y-2 text-[13px] font-sans">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Total sales</span>
                  <span className="font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(totalSales)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Cash sales</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(cashSales)}</span>
                </div>
                {debtCashRecoveredToday > 0 && (
                  <div className="flex justify-between items-center text-[var(--color-success)]">
                    <span>Debt recovered (cash)</span>
                    <span className="tabular-nums font-medium">+ ₦{fmt(debtCashRecoveredToday)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">POS</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(posSales)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted)]">Bank transfer</span>
                  <span className="text-[var(--color-foreground)] tabular-nums">₦{fmt(transferSales)}</span>
                </div>
                {debtSales > 0 && (
                  <div className="flex justify-between items-center border-t border-[var(--color-border)] pt-2 mt-1 text-[var(--color-error)]">
                    <span>Unpaid credit sales</span>
                    <span className="font-semibold tabular-nums">₦{fmt(debtSales)}</span>
                  </div>
                )}
                {debtTotalRecoveredToday > 0 && (
                  <div className="flex justify-between items-center text-[var(--color-success)]">
                    <span>Debt collected today</span>
                    <span className="font-semibold tabular-nums">₦{fmt(debtTotalRecoveredToday)}</span>
                  </div>
                )}
              </div>

              {/* Cash in Hand & Net Balance Box */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 space-y-2">
                <div className="flex justify-between items-center text-[12px] font-sans text-[var(--color-muted)]">
                  <span>Cash in hand</span>
                  <span className="tabular-nums">₦{fmt(physicalCash)}</span>
                </div>
                <div className="flex justify-between items-center text-[12px] font-sans text-[var(--color-error)]">
                  <span>Expenses</span>
                  <span className="tabular-nums">− ₦{fmt(totalExpenses)}</span>
                </div>
                <div className="border-t border-[var(--color-border)] pt-2.5 flex justify-between items-center">
                  <span className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">Balance cash</span>
                  <span className={`text-[20px] font-sans font-bold tabular-nums ${balanceCash >= 0 ? 'text-[var(--color-foreground)]' : 'text-[var(--color-error)]'}`}>
                    ₦{fmt(Math.abs(balanceCash))}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  import('./PackageReceipt').then(m => m.downloadPackageDailySummary({
                    date: new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
                    agentName: user.name,
                    hubName: user.hub,
                    entries: packageTxs.map(t => ({
                      customerName: t.name,
                      destination: t.destination || '',
                      contentType: t.contentType || '',
                      pieces: t.pieces,
                      kg: t.kg,
                      amount: t.amount,
                      paymentMode: formatPaymentModeDisplay(t.mode, t.wallet_deduction_amount, t.amount),
                      bank: t.bank,
                    })),
                    totalSales,
                    cashSales,
                    posSales,
                    transferSales,
                    debtSales,
                    expenses: expenses.filter(e => isToday(e.created_at)),
                    totalExpenses,
                    balanceCash,
                  }));
                }}
                className="min-h-[44px] h-11 px-3.5 rounded-full bg-[var(--color-surface-2)] text-[var(--color-foreground)] border border-[var(--color-border)] text-[12px] font-sans font-medium hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer flex-1 flex items-center justify-center gap-1.5"
              >
                <FileText size={14} className="text-[var(--color-muted)]" />
                <span>Summary PDF</span>
              </button>

              <button
                type="button"
                onClick={handleCloseDay}
                disabled={closingDay}
                className="min-h-[44px] h-11 px-4 rounded-full font-semibold text-[13px] font-sans bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 flex-1 shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none"
              >
                {closingDay && <Spinner size="sm" tone="current" />}
                <span>{closingDay ? 'Closing…' : 'Confirm & close day'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* SALES ANALYSIS MODAL */}
      {showSalesAnalysis && (
        <DepartmentSalesAnalysisModal
          user={user}
          deptType="package"
          deptLabel="Package"
          routeLabel="Destination"
          onClose={() => setShowSalesAnalysis(false)}
        />
      )}
    </div>
  );
};
