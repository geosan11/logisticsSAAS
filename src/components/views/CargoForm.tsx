import { CARGO_ROUTES } from "../../lib/constants";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button, useDensity } from "../ui";
import { createPortal } from "react-dom";
import { Transaction, User, Expense, CustomerWallet, HubShift } from "../../lib/types";
import { fmt, roundMoney, tnow, generatePickupPin, normalizeAirlineName, airlineNamesLooselyMatch, getHubCode, upperOnChange, isStandalonePWA, formatPaymentModeDisplay, lagosBusinessDate } from "../../lib/helpers";
import { chargeWalletForSale } from "../../lib/walletPayment";
import { useIsOnline } from "../../lib/useIsOnline";
import { matchWallet } from "../../lib/customerIdentity";
import { WalletRemainderSelector } from "../WalletRemainderSelector";
import { useHubRoutes, useValidatedRouteSelection, useHubs } from "../../lib/hubRoutes";
import { useAirlines, useAirlineCommissions, addAirlineIfMissing } from "../../lib/airlines";
import { useContentTypes } from "../../lib/contentTypes";
import { useSpecialGoodsRates, resolveSpecialGoodsRate } from "../../lib/specialGoodsRates";
import { getEquivalentHubIds } from "../../lib/lagosHubSync";
import { useFlatTierRates, resolveFlatTier } from "../../lib/flatTierRates";
import { useSizeTierRates, resolveSizeTier, useSizeTierContentTypeNames } from "../../lib/sizeTierRates";
import { useMinimumCharges, resolveMinimumCharge } from "../../lib/minimumCharges";
import { useBanks } from "../../lib/banks";
import { useEnterToNextField } from "../../lib/useEnterToNextField";
import { isTagAlreadyDelivered } from "../../lib/scanLogic";
import { getNextTag, getTenantTagPrefix } from "../../lib/tagPool";
import { buildTagNumber, isValidAirlineAwb, formatAirlineAwb } from "../../lib/tagNumber";
import { CustomerWalletPicker } from "../CustomerWalletPicker";
import { DepartmentSalesAnalysisModal } from "../DepartmentSalesAnalysis";
import { PrintRangeModal } from "../PrintRangeModal";
import {
  CheckCircle,
  Loader2,
  User as UserIcon,
  Plane,
  Hash,
  Package,
  MapPin,
  Layers,
  Banknote,
  CreditCard,
  Landmark,
  MessageSquare,
  Scale,
  Users,
  ShieldAlert,
  PlusCircle,
  Trash2,
  Edit3,
  Coins,
  Search,
  ArrowRight,
  Table,
  DollarSign,
  Building,
  Copy,
  ClipboardList,
  AlertTriangle,
  Rocket,
  Zap,
  Receipt,
  Tag,
  Lock,
  Calendar,
  Ruler,
  BarChart2,
  X,
  Radar,
  Phone,
} from "lucide-react";
import {
  sendReceiptWhatsApp,
  buildCargoWhatsApp,
} from "../../lib/notifications";
import { supabase, fetchAllRows } from "../../lib/supabase";
import { useToast } from "../../lib/ToastContext";
import { useConfirm } from "../../lib/ConfirmContext";

interface CorporateClient {
  id: string;
  company_name: string;
  contact_phone: string;
  accumulated_monthly_debt: number;
  active: boolean;
}

interface CorporateRouteRate {
  id: string;
  corporate_client_id: string;
  route_name: string;
  rate_per_kg: number;
  minimum_amount?: number;
}

interface PendingWeighingIntake {
  id: string;
  consignee: string;
  corporate_client_id: string;
  pieces: number;
  route: string;
  contentType: string;
  airline: string;
  awb: string;
  created_at: string;
  sender_phone?: string;
  time: string;
  isCorporate?: boolean;
  sender?: string;
  content_type?: string;
}

const LOCAL_SERIAL_KEY = () => {
  const today = new Date().toISOString().split("T")[0];
  return `ehi_cargo_serial_${today}`;
};

function getLocalSerial(): number {
  try {
    if (typeof window === "undefined" || !window.localStorage) return 1;
    const stored = localStorage.getItem(LOCAL_SERIAL_KEY());
    return stored ? parseInt(stored) : 1;
  } catch (e) {
    return 1;
  }
}

function incrementLocalSerial(): number {
  const key = LOCAL_SERIAL_KEY();
  try {
    if (typeof window === "undefined" || !window.localStorage) return getLocalSerial();
    const next = getLocalSerial() + 1;
    localStorage.setItem(key, String(next));

    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    localStorage.removeItem(`ehi_cargo_serial_${yesterday}`);

    return next;
  } catch (e) {
    return getLocalSerial();
  }
}

import { QRCode } from "../QRCode";
import { ReviewEntryModal } from "./ReviewEntryModal";
import { PaymentNarrationBox } from "../PaymentNarrationBox";

export const CargoForm = ({
  onAddTx,
  user: propUser,
  transactions = [],
  onShowHistory,
  customerWallets: passedWallets,
  setCustomerWallets: passedSetWallets,
  activeShift,
}: {
  onAddTx: (tx: Transaction) => void;
  user: User;
  transactions?: Transaction[];
  onShowHistory?: () => void;
  customerWallets?: CustomerWallet[];
  setCustomerWallets?: React.Dispatch<React.SetStateAction<CustomerWallet[]>>;
  // Whichever hub_shifts row is currently open for this hub's 'cargo'
  // department (EHIApp.tsx's activeShiftsByDept['cargo']) -- stamped onto
  // every new entry as created_shift_id so clear_cargo_debt can later tell
  // whether an Individual debt was fully cleared before this same shift
  // ever closed. null when no cargo shift is open right now.
  activeShift?: HubShift | null;
}) => {
  const isAdmin = ['super_admin', 'admin', 'accountant'].includes(propUser.role);
  // The "Global Hub Context" dropdown used to be sourced from CARGO_ROUTES
  // (a static list of route DISPLAY strings like "LOS/Lagos", with no real
  // hub_id behind any entry) and defaulted its initial selection to the
  // raw propUser.hub_id (a UUID) before the admin ever touched it. Since
  // `user` below spreads that SAME value into BOTH hub_id AND hub (the
  // human-readable name field), every admin/super_admin who hadn't
  // manually picked a hub had their effective user.hub_id/hub corrupted:
  // hub showed as a garbled "74D"-style code once getHubCode() truncated
  // the UUID for AWB tag/receipt labels, and hub_id -- used directly in
  // hub-scoped rate lookups (hub_airline_route_rates etc) and the actual
  // cargo_entries INSERT below -- was never a valid UUID at all once the
  // admin DID pick a route from the dropdown (a Postgres uuid column
  // rejects a "LOS/Lagos" string outright). useHubs() sources real hub
  // records instead, so both fields are always genuinely correct.
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

  // Navigation tabs between Regular & Corporate Billing
  const [activePortal, setActivePortal] = useState<"retail" | "corporate">(
    "retail",
  );
  // "directory" was a third value here with a full handler pair
  // (handleCreateCorpAccount/handleSaveRouteRate) that wrote ONLY to
  // localStorage -- but no button anywhere ever called setCorpSubTab
  // ("directory"), so that whole path was unreachable dead code, and
  // creating a corporate client or setting a contract rate through the
  // UI already happens correctly (synced to Supabase) via
  // PricingConfiguration.tsx. Removed rather than wired up, since wiring
  // it up would have exposed a second, localStorage-only path for the
  // same actions -- the exact "looks saved but isn't" bug already fixed
  // elsewhere this session for Phase 1 intakes.
  const [corpSubTab, setCorpSubTab] = useState<"intake" | "weighing">("intake");
  const { isCompact } = useDensity();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const routes = useHubRoutes();
  const contentTypes = useContentTypes();
  const banks = useBanks();

  const generateAwb = () => `AWB-${Math.floor(100000 + Math.random() * 900000)}`;

  // --- STANDARD RETAIL STATES ---
  const [serialNumber, setSerialNumber] = useState<number>(getLocalSerial);
  // Starts blank (not "Other") so the field is immediately typeable -- see
  // the consigneeOptions/datalist combobox below, which lets staff either
  // pick a known corporate client or type a new/walk-in name directly,
  // without a forced dropdown pick or an auto-select effect fighting it.
  const [consignee, setConsignee] = useState("");
  const [airline, setAirline] = useState("Arik Air");
  const [customAirline, setCustomAirline] = useState("");
  // Optional -- Flight Radar (src/components/views/FlightRadar.tsx) reads
  // this to look up live flight status. Left blank at intake is fine; can
  // be filled in later from TransactionLedger's edit modal. Auto-filled
  // below once airline+route are picked, from the hub's cached departures
  // board -- see the matching effect after actualAirline.
  const [flightNumber, setFlightNumber] = useState("");
  const [flightAutoFilled, setFlightAutoFilled] = useState(false);
  const [airlineAwb, setAirlineAwb] = useState("");
  const [airlineAwbError, setAirlineAwbError] = useState<string | null>(null);
  const [departuresBoard, setDeparturesBoard] = useState<{ flightNumber: string | null; airline: string | null; destinationIata: string | null; scheduledDeparture: string | null; status: string }[]>([]);

  // Fetched once per hub (server-side cached ~20min, see server/
  // flightRadar.ts's DEPARTURES_CACHE_TTL_MS) -- cheap even if this effect
  // re-runs, since it's just re-reading the shared cache row most of the
  // time, not a fresh AeroDataBox call.
  useEffect(() => {
    const originIata = getHubCode(user.hub_code || user.hub);
    if (!originIata || originIata === 'XXX') return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: sess }) => {
      const token = sess.session?.access_token || '';
      return fetch(`/api/flight-radar/departures?originIata=${encodeURIComponent(originIata)}&date=${encodeURIComponent(lagosBusinessDate())}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    })
      .then(r => {
        if (r.ok) return r.json();
        // Not a toast (fires on every hub load; a transient/quota failure
        // shouldn't nag staff mid-intake) -- but no longer a silent no-op
        // either, so a real misconfiguration is at least visible in the
        // browser console instead of just leaving Flight No. unexplainably blank.
        console.error(`[FlightRadar] departures fetch failed: ${r.status}`);
        return null;
      })
      .then(data => { if (!cancelled && data) setDeparturesBoard(data.flights || []); })
      .catch(err => console.error('[FlightRadar] departures fetch error:', err));
    return () => { cancelled = true; };
  }, [user.hub_code, user.hub]);
  const [customConsignee, setCustomConsignee] = useState("");

  // This is now a REAL, already-allocated number, not a non-destructive
  // preview -- popped from the local tag pool (src/lib/tagPool.ts), which
  // is a pure local operation, so it works offline too. Popping a pooled
  // number doesn't touch the shared server counter (that already happened
  // when the block was reserved), so an abandoned/reset form just leaves
  // this one number unused within this device's own pool -- not "stolen"
  // from another agent the way calling next_awb_number() directly would be.
  const [awb, setAwb] = useState('');
  const fetchAwbPreview = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const poolKey = `${hubCode}-CG`;
    const tag = await getNextTag(poolKey, `${getTenantTagPrefix()}-${hubCode}-CG`);
    setAwb(tag || '');
  };
  // Re-fetch when the admin's hub context changes -- fetchAwbPreview's
  // pool key is derived from user.hub_code/hub, so a mount-only effect
  // left a tag reserved from whichever hub was active at mount, unrelated
  // to whatever the admin later switches "Global Hub Context" to.
  // Matches the corporate-intake preview's own effect below, which
  // already re-fetches on this exact dependency pair.
  useEffect(() => { fetchAwbPreview(); }, [user.hub_code, user.hub]);

  const [pcs, setPcs] = useState("1");
  const [kg, setKg] = useState("");
  // Optional IATA volumetric dimensions (cm) -> (L x W x H) / 6000
  const [showDims, setShowDims] = useState(false);
  const [lengthCm, setLengthCm] = useState("");
  const [widthCm, setWidthCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  // Screen size, only relevant/shown for content types flagged is_size_tier
  // (e.g. Plasma TV) -- see isSizeTierContent below. kg stays a separate
  // field even for these entries (still tracked for manifest/cargo weight).
  const [sizeInches, setSizeInches] = useState("");
  const [showRetailReview, setShowRetailReview] = useState(false);
  // Left empty rather than defaulting to routes[0]/contentTypes[0] --
  // a pre-filled dropdown looks like a deliberate choice, so staff could
  // submit an entry against whatever happened to be first in the list
  // without ever consciously picking it. isRetailFormValid already
  // requires both non-empty, so this makes that enforcement actually bite.
  const [route, setRoute] = useState('');
  useValidatedRouteSelection(routes, route, setRoute);
  const [contentType, setContentType] = useState('');
  const [customContentType, setCustomContentType] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<string>(
    "Cash",
  );
  // Wallet-mode charges are a real-time, non-reversible atomic RPC (see
  // chargeWalletForSale's own comment) with no offline queue -- queuing it
  // would risk a cross-device double-spend against the same wallet that no
  // client-side fix can fully close. Blocked outright while offline instead.
  const isOnline = useIsOnline();
  useEffect(() => {
    if (!isOnline && mode === 'Wallet') setMode('Cash');
  }, [isOnline, mode]);
  const [corporateMode, setCorporateMode] = useState<string>("Debt");
  const [bank, setBank] = useState(banks[0] as string);
  const [remark, setRemark] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [consigneePhone, setConsigneePhone] = useState("");

  const [narrationCode, setNarrationCode] = useState<string>("");

  useEffect(() => {
    if (mode === "Transfer" && !narrationCode) {
      import("../../lib/helpers").then(({ generatePaymentNarration }) => {
        // serialNumber is a device-local daily counter (localStorage,
        // resets independently per browser) -- two devices at the same hub
        // both processing their own transaction #5 of the day would
        // generate the IDENTICAL narration code, a guaranteed collision,
        // not just a probabilistic one. Matches the random-serial approach
        // PackageForm/MarketingWorkspace/ExcessBaggageForm already use.
        setNarrationCode(generatePaymentNarration(user.hub_code || user.hub, Math.floor(Math.random() * 9000) + 1000));
      });
    }
    // Only regenerate when mode switches TO Transfer — not on every narrationCode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const [standardRates, setStandardRates] = useState<Record<string, number>>(
    {},
  );
  // Hub-specific pricing overrides, most-specific first: an exact
  // hub+airline+route rate, then this hub's default for the route
  // regardless of airline. Both are scoped to this hub only (retail intake
  // always happens at the agent's own hub, same as cargo_entries.hub_id) --
  // fetched once alongside standardRates, which remains the last-resort
  // company-wide fallback (see resolveRate below).
  const [hubAirlineRouteRates, setHubAirlineRouteRates] = useState<Record<string, number>>({});
  const [hubRouteRates, setHubRouteRates] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const { data, error } = await supabase.from('standard_cargo_rates').select('route_name, rate_per_kg');
        if (data && data.length > 0 && !error) {
          const rates: Record<string, number> = {};
          data.forEach((r: any) => { rates[r.route_name] = Number(r.rate_per_kg); });
          setStandardRates(rates);
          localStorage.setItem("ehi_standard_cargo_rates", JSON.stringify(rates));
        } else {
          // No server rows and no cache: leave standardRates empty rather
          // than synthesizing a flat 500/route default. resolveRate()'s
          // company-wide tier must be able to tell "nothing configured"
          // (undefined) apart from "someone actually set 500" -- a synthetic
          // default here would be indistinguishable from a real rate, and
          // once cached to localStorage would keep silently reappearing on
          // this device even after real rates exist server-side, for any
          // route/hub combo that never got an override.
          const saved = localStorage.getItem("ehi_standard_cargo_rates");
          if (saved) setStandardRates(JSON.parse(saved));
        }
      } catch (err) {
        const saved = localStorage.getItem("ehi_standard_cargo_rates");
        if (saved) setStandardRates(JSON.parse(saved));
      }
    };
    fetchRates();

    // Rates change rarely (an admin edits them occasionally), but an agent
    // can stay on this tab for a full shift without ever re-triggering this
    // mount-time fetch -- a rate changed mid-shift wouldn't show up until
    // they navigate away and back or reload. A realtime channel here would
    // add another persistent connection per active cargo agent on top of
    // the ones already budgeted in EHIApp.tsx for the entry-stream data,
    // for data that doesn't need push latency -- refetch on refocus (covers
    // alt-tabbing away and back) plus a bounded interval backstop (covers
    // staying continuously foregrounded) instead.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchRates);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchRates);
    };
  }, []);

  const [lagosHubIds, setLagosHubIds] = useState<string[]>([]);

  useEffect(() => {
    if (!user.hub_id) return;
    const fetchHubRates = async () => {
      const hubIds = await getEquivalentHubIds(user.hub_id);
      setLagosHubIds(hubIds);
      const [airlineRes, hubRes] = await Promise.all([
        supabase.from('hub_airline_route_rates').select('airline, route_name, rate_per_kg').in('hub_id', hubIds),
        supabase.from('hub_route_rates').select('route_name, rate_per_kg').in('hub_id', hubIds),
      ]);
      if (airlineRes.data && !airlineRes.error) {
        const rates: Record<string, number> = {};
        airlineRes.data.forEach((r: any) => {
          rates[`${r.airline}|${r.route_name}`] = Number(r.rate_per_kg);
          rates[`${normalizeAirlineName(r.airline)}|${r.route_name}`] = Number(r.rate_per_kg);
        });
        setHubAirlineRouteRates(rates);
      }
      if (hubRes.data && !hubRes.error) {
        const rates: Record<string, number> = {};
        hubRes.data.forEach((r: any) => { rates[r.route_name] = Number(r.rate_per_kg); });
        setHubRouteRates(rates);
      }
    };
    fetchHubRates();

    // Same staleness reasoning as the standardRates effect above -- see
    // that comment for why this is a poll+refocus backstop rather than a
    // realtime subscription.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchHubRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchHubRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchHubRates);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchHubRates);
    };
  }, [user.hub_id]);

  const specialGoodsRates = useSpecialGoodsRates();
  const minimumCharges = useMinimumCharges();
  const flatTierRates = useFlatTierRates();
  const sizeTierRates = useSizeTierRates();
  const sizeTierContentTypeNames = useSizeTierContentTypeNames();

  // Rate lookup for retail cargo pricing, highest priority first: a
  // special-goods kg-tier rate for this content type + airline (set in
  // Special Goods Rates, only applies when the content type is flagged),
  // then the normal 3-tier cascade -- exact hub+airline+route override,
  // then this hub's default for the route (any airline), then the
  // company-wide standard_cargo_rates value. Returns null (not a guessed
  // number) when nothing is configured at any tier -- staff must then price
  // the entry manually rather than the form silently assuming a rate no one
  // actually set (the previous `standardRates[route] || 500` behavior this
  // replaces could silently under/overcharge for any route/hub that simply
  // hadn't been configured yet).
  const resolveRate = (forAirline: string, forRoute: string, forContentType: string, forKg: number): number | null => {
    const special = resolveSpecialGoodsRate(specialGoodsRates, forContentType, forAirline, forKg, user.hub_id, forRoute, lagosHubIds);
    if (special != null) return special;
    const exact = hubAirlineRouteRates[`${forAirline}|${forRoute}`] ?? hubAirlineRouteRates[`${normalizeAirlineName(forAirline)}|${forRoute}`];
    if (exact != null) return exact;
    const hubDefault = hubRouteRates[forRoute];
    if (hubDefault != null) return hubDefault;
    const company = standardRates[forRoute];
    if (company != null) return company;
    return null;
  };

  // Resolved once here (rather than only inside handleRetailSubmit, where it
  // used to live) so both the render-time price preview and the submit
  // handler agree on the same airline name used for the rate lookup.
  const actualAirline = airline === "Other" && customAirline.trim() ? customAirline.trim() : airline;

  // Auto-fill Flight No. once airline+route are both known, from the
  // departures board fetched above -- never overwrites a value staff
  // already typed or edited (the `flightNumber.trim()` guard), and always
  // picks the SOONEST upcoming match rather than enforcing any cutoff, per
  // the agreed design (staff may log cargo well ahead of its flight).
  useEffect(() => {
    if (flightNumber.trim() || !route || departuresBoard.length === 0) return;
    const destIata = route.split('/')[0];
    const now = Date.now();
    // airlineNamesLooselyMatch (not normalizeAirlineName) -- AeroDataBox's
    // raw carrier-name string is outside this app's control, so an exact
    // post-normalization match would silently never fire for any airline
    // not already in normalizeAirlineName's small hardcoded list, which
    // includes every brand-new airline added via CargoForm's "Other" or
    // the admin Add Airline screen. See helpers.ts's own comment.
    const next = departuresBoard
      .filter(f => f.flightNumber && f.destinationIata === destIata && airlineNamesLooselyMatch(actualAirline, f.airline) && f.scheduledDeparture && new Date(f.scheduledDeparture).getTime() >= now)
      .sort((a, b) => new Date(a.scheduledDeparture!).getTime() - new Date(b.scheduledDeparture!).getTime())[0];
    if (next?.flightNumber) {
      setFlightNumber(next.flightNumber);
      setFlightAutoFilled(true);
    }
  }, [route, actualAirline, departuresBoard]);

  // Same reasoning as actualAirline above -- hoisted so the preview and
  // submit paths (and the special-goods/minimum-charge lookups both use)
  // agree on one value instead of each re-deriving it.
  const actualContentType = contentType === "Other" ? customContentType : contentType;
  // Whether the currently-selected content type is flagged is_size_tier
  // (e.g. Plasma TV) -- drives the Screen Size (inches) input below and
  // the size-tier price check that takes priority over the normal kg cascade.
  const isSizeTierContent = sizeTierContentTypeNames.has(actualContentType);

  const volumetricWeight = useMemo(() => {
    const l = parseFloat(lengthCm) || 0;
    const w = parseFloat(widthCm) || 0;
    const h = parseFloat(heightCm) || 0;
    if (l > 0 && w > 0 && h > 0) {
      return Math.round(((l * w * h) / 6000) * 100) / 100;
    }
    return 0;
  }, [lengthCm, widthCm, heightCm]);

  const effectiveKg = useMemo(() => {
    const actualW = parseFloat(kg) || 0;
    return Math.max(actualW, volumetricWeight);
  }, [kg, volumetricWeight]);

  // Compute auto-price from KG × rate, floored by any matching minimum
  // charge bracket for this airline+route — used to pre-fill the amount
  // field. Derived without setState so there is no extra re-render on every
  // keystroke.
  const autoAmount = useMemo(() => {
    const w = effectiveKg;
    // Size-tier content (e.g. Plasma TV) prices as one whole amount per
    // screen-size bracket, keyed on inches instead of kg -- checked before
    // the kg-based checks below since w may legitimately be 0/irrelevant
    // for a sized item whose price doesn't depend on weight at all.
    if (isSizeTierContent) {
      const inches = Math.round(parseFloat(sizeInches)) || 0;
      if (inches > 0) {
        const sized = resolveSizeTier(sizeTierRates, actualContentType, actualAirline, route, inches, user.hub_id, lagosHubIds);
        if (sized != null) return sized.toString();
      }
    }
    if (w <= 0) return "";
    // Flat-tier content (e.g. Bumper & Burnet) prices as one whole amount per
    // weight bracket, not per-kg -- it overrides the entire per-kg cascade
    // below (including minimum charges) rather than layering on top of it.
    const flat = resolveFlatTier(flatTierRates, actualContentType, actualAirline, route, w, user.hub_id, lagosHubIds);
    if (flat != null) return flat.toString();
    const rate = resolveRate(actualAirline, route, actualContentType, w);
    const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
    if (rate == null && minCharge == null) return "";
    const computed = rate != null ? roundMoney(w * rate) : 0;
    const final = minCharge != null ? Math.max(computed, minCharge) : computed;
    return final.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKg, sizeInches, isSizeTierContent, route, actualContentType, actualAirline, standardRates, hubRouteRates, hubAirlineRouteRates, specialGoodsRates, minimumCharges, flatTierRates, sizeTierRates]);

  // Which of the three overrides (if any) determined autoAmount -- surfaced
  // as a badge near the price preview so staff aren't confused by a number
  // that doesn't match kg × the route rate they're used to seeing.
  const priceOverrideInfo = useMemo(() => {
    if (isSizeTierContent) {
      const inches = Math.round(parseFloat(sizeInches)) || 0;
      if (inches > 0) {
        const sized = resolveSizeTier(sizeTierRates, actualContentType, actualAirline, route, inches, user.hub_id, lagosHubIds);
        if (sized != null) return { type: 'size' as const, amount: sized };
      }
    }
    const w = effectiveKg;
    if (w <= 0) return null;
    const flat = resolveFlatTier(flatTierRates, actualContentType, actualAirline, route, w, user.hub_id, lagosHubIds);
    if (flat != null) {
      return { type: 'flat' as const, amount: flat };
    }
    const specialRate = resolveSpecialGoodsRate(specialGoodsRates, actualContentType, actualAirline, w, user.hub_id, route, lagosHubIds);
    const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
    // Was special-goods-only -- when no special-goods rate applied but the
    // full cascade (hub/company rate) still resolved a legitimately higher
    // per-kg amount than autoAmount actually uses, perKgAmount fell back to
    // null and this badge unconditionally claimed "Minimum Charge applied"
    // even though the real charge (visible in the Amount field) was the
    // cascade rate, never the minimum. Falls back to the same resolveRate()
    // cascade autoAmount itself uses whenever no special-goods rate exists.
    const cascadeRate = specialRate ?? resolveRate(actualAirline, route, actualContentType, w);
    const perKgAmount = cascadeRate != null ? roundMoney(w * cascadeRate) : null;
    if (minCharge != null && (perKgAmount == null || minCharge > perKgAmount)) {
      return { type: 'minimum' as const, amount: minCharge };
    }
    if (specialRate != null) {
      return { type: 'special' as const, rate: specialRate };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKg, sizeInches, isSizeTierContent, route, actualContentType, actualAirline, specialGoodsRates, minimumCharges, flatTierRates, sizeTierRates, standardRates, hubRouteRates, hubAirlineRouteRates]);

  const availableAirlines = useAirlines();
  const airlineCommissions = useAirlineCommissions();

  useEffect(() => {
    if (availableAirlines.length > 0 && !availableAirlines.includes(airline)) {
      setAirline(availableAirlines[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableAirlines]);

  const [successTx, setSuccessTx] = useState<Transaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Same-customer batch: items already saved to cargo_entries (each its own
  // individual entry_ref/AWB, exactly like a normal single entry) while the
  // agent keeps adding more pieces for the same consignee, held here only so
  // they can be printed together at the end instead of one dialog per item.
  const [batchItems, setBatchItems] = useState<Transaction[]>([]);
  const [showBatchSummary, setShowBatchSummary] = useState(false);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [batchPrintProgress, setBatchPrintProgress] = useState('');
  // null = print every batchItem. Sized to whatever batchItems.length was
  // when the range was picked -- reset to null wherever a fresh batch
  // starts so a leftover range from a differently-sized batch can't
  // silently apply to this one.
  const [printRange, setPrintRange] = useState<{ from: number; to: number } | null>(null);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);
  const formRootRef = useRef<HTMLDivElement>(null);
  useEnterToNextField(formRootRef);

  useEffect(() => {
    if (successTx && successRef.current) {
      // Scroll the nearest scrollable ancestor, not window — avoids iOS jank
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [successTx]);

  // --- CARGO DESK DAY CLOSE ---
  // A wholly separate close from EODReconciliation.tsx's shared aggregate --
  // that screen assumes a rigid midnight-to-midnight boundary, which breaks
  // for cargo shifts that span overnight (e.g. 10pm-6am). This lets staff
  // pick the actual period being closed (which can cross midnight) instead,
  // persisted via cargo_day_close so the exact boundary is auditable later.
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showSalesAnalysis, setShowSalesAnalysis] = useState(false);
  const [closingDay, setClosingDay] = useState(false);

  // Esc closes the period-close modal (unless a close is already running).
  useEffect(() => {
    if (!showCloseModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closingDay) setShowCloseModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCloseModal, closingDay]);
  const [periodStart, setPeriodStart] = useState<string>('');
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [lastCloseEnd, setLastCloseEnd] = useState<string | null>(null);
  const [closeSummaryLoading, setCloseSummaryLoading] = useState(false);
  const [closeEntries, setCloseEntries] = useState<Array<{
    amount: number; receipt_mode: string; route: string | null; consignee_name: string;
    airline: string | null; awb_tag_number: string | null; total_pcs: number; total_kg: number;
    content_type: string | null; bank: string | null; wallet_deduction_amount?: number | null;
    payment_history?: any[] | null;
  }>>([]);
  const [closeExpenses, setCloseExpenses] = useState<Expense[]>([]);
  const [closeOlderDebtPayments, setCloseOlderDebtPayments] = useState<Array<{ payment_history: any[] | null }>>([]);

  // datetime-local <-> Date, local time (no timezone suffix) -- toISOString()
  // would shift the displayed value by the browser's UTC offset.
  const toLocalInputValue = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // Default the range when the modal opens: start picks up from this hub's
  // last close (continuous, non-overlapping periods with no gap), falling
  // back to today-midnight if this hub has never closed a cargo period.
  useEffect(() => {
    if (!showCloseModal) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('cargo_day_close')
        .select('period_end')
        .eq('hub_id', user.hub_id)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const now = new Date();
      let defaultStart: Date;
      if (data?.period_end) {
        defaultStart = new Date(data.period_end);
      } else {
        defaultStart = new Date();
        defaultStart.setHours(0, 0, 0, 0);
      }
      setLastCloseEnd(data?.period_end || null);
      setPeriodStart(toLocalInputValue(defaultStart));
      setPeriodEnd(toLocalInputValue(now));
    })();
    return () => { active = false; };
  }, [showCloseModal, user.hub_id]);

  // Reload the summary whenever the picked range changes -- datetime-local
  // inputs only fire onChange on commit (not per keystroke), so no debounce
  // is needed here.
  useEffect(() => {
    if (!showCloseModal || !periodStart || !periodEnd) return;
    const startD = new Date(periodStart);
    const endD = new Date(periodEnd);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) return;
    let active = true;
    setCloseSummaryLoading(true);
    (async () => {
      const startISO = startD.toISOString();
      const endISO = endD.toISOString();
      // fetchAllRows, not a bare .limit(1000) -- a hub that runs a
      // high-volume period (or goes a long stretch without closing) could
      // have entries/expenses beyond the 1000th silently excluded from
      // every total here and from the persisted cargo_day_close row, with
      // no warning shown anywhere.
      try {
        const [entries, expenses, olderDebtPayments] = await Promise.all([
          fetchAllRows<any>((from, to) => supabase.from('cargo_entries')
            .select('amount,receipt_mode,route,consignee_name,airline,awb_tag_number,total_pcs,total_kg,content_type,bank,created_at,wallet_deduction_amount,payment_history')
            .eq('hub_id', user.hub_id)
            .gte('created_at', startISO).lt('created_at', endISO)
            .order('created_at', { ascending: true }).range(from, to)),
          fetchAllRows<any>((from, to) => supabase.from('expenses')
            .select('*')
            .eq('hub_id', user.hub_id)
            .gte('created_at', startISO).lt('created_at', endISO)
            .range(from, to)),
          // Debts OPENED before this period but paid down (in cash or
          // otherwise) DURING it wouldn't be fetched at all by the
          // created_at-scoped query above -- their payment never showed up
          // in "Debt Recovered Today" even though it was physically
          // collected this period. Bounded to 180 days before the period
          // start (aging debts beyond that are vanishingly rare -- see
          // DebtorsTab.tsx's own 90-day "writeoff-risk" bucket) so this
          // doesn't become an ever-growing unbounded scan as the business
          // accumulates history.
          fetchAllRows<any>((from, to) => supabase.from('cargo_entries')
            .select('payment_history')
            .eq('hub_id', user.hub_id)
            .eq('receipt_mode', 'Debt')
            .gte('created_at', new Date(startD.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString())
            .lt('created_at', startISO)
            .range(from, to)),
        ]);
        if (!active) return;
        setCloseEntries(entries);
        setCloseExpenses(expenses as Expense[]);
        setCloseOlderDebtPayments(olderDebtPayments);
      } catch (err: any) {
        if (!active) return;
        showToast({ message: `Failed to load close summary: ${err.message || err}`, type: 'error' });
      }
      if (active) setCloseSummaryLoading(false);
    })();
    return () => { active = false; };
  }, [showCloseModal, periodStart, periodEnd, user.hub_id]);

  // A short wallet's remainder is recorded with `receipt_mode` set to
  // whatever collected the gap (e.g. "Cash") but `amount` left as the FULL
  // sale total -- only `wallet_deduction_amount` records the wallet
  // portion. Without subtracting it here, a split sale double-counts: the
  // wallet-covered part is credited both to the wallet AND to this
  // physical cash/transfer/POS total, overstating what's actually in the
  // till. Matches AccountingConsole.tsx/EODReconciliation.tsx's identical
  // nonWalletPortion fix for the shared reconciliation screens -- this
  // department-local day-close total never got the same fix.
  const nonWalletPortion = (t: any) => Math.max(0, (t.amount || 0) - (t.wallet_deduction_amount || 0));
  const closeTotalSales = closeEntries.reduce((s, t) => s + t.amount, 0);
  const closeCashSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Cash' ? nonWalletPortion(t) : 0), 0);
  const closePosSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'POS' ? nonWalletPortion(t) : 0), 0);
  const closeTransferSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Transfer' ? nonWalletPortion(t) : 0), 0);
  const closeDebtSales = closeEntries.reduce((s, t) => s + (t.receipt_mode === 'Debt' ? nonWalletPortion(t) : 0), 0);
  // Scans in-period entries AND the bounded-lookback older-debt fetch above
  // -- a debt opened before this period but paid down during it only ever
  // shows up in the latter, since its own created_at falls outside
  // [periodStart, periodEnd).
  const closeDebtPaymentSource: Array<{ payment_history?: any[] | null }> = [...closeEntries, ...closeOlderDebtPayments];
  const closeDebtCashRecoveredToday = closeDebtPaymentSource.reduce((sum: number, t: any) => {
    if (!t.payment_history || !Array.isArray(t.payment_history)) return sum;
    const todays = t.payment_history.filter((p: any) => p.mode === 'Cash' && p.at && new Date(p.at) >= new Date(periodStart) && new Date(p.at) <= new Date(periodEnd));
    return sum + todays.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  }, 0);
  const closeDebtTotalRecoveredToday = closeDebtPaymentSource.reduce((sum: number, t: any) => {
    if (!t.payment_history || !Array.isArray(t.payment_history)) return sum;
    const todays = t.payment_history.filter((p: any) => p.at && new Date(p.at) >= new Date(periodStart) && new Date(p.at) <= new Date(periodEnd));
    return sum + todays.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  }, 0);
  const closeTotalExpenses = closeExpenses.reduce((s, e) => s + e.amount, 0);
  const closePhysicalCash = closeCashSales + closeDebtCashRecoveredToday;
  const closeBalanceCash = closePhysicalCash - closeTotalExpenses;
  const closeRouteCounts: Record<string, number> = {};
  closeEntries.forEach(t => { const r = t.route || 'Unknown'; closeRouteCounts[r] = (closeRouteCounts[r] || 0) + 1; });

  const handleCloseDay = async () => {
    if (closingDay) return;
    const startD = new Date(periodStart);
    const endD = new Date(periodEnd);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime())) {
      showToast({ message: 'Please enter valid start and end times.', type: 'warning' });
      return;
    }
    const startISO = startD.toISOString();
    const endISO = endD.toISOString();
    if (endD <= startD) {
      showToast({ message: 'End time must be after start time.', type: 'warning' });
      return;
    }
    // Starting before the hub's last recorded close would re-aggregate
    // entries that were already counted in that prior cargo_day_close row
    // into this new one too -- there's no "closed" flag on cargo_entries
    // itself to stop it, so this client-side check is the only guard.
    if (lastCloseEnd && startD < new Date(lastCloseEnd)) {
      showToast({ message: `Start time is before the last close (${new Date(lastCloseEnd).toLocaleString('en-GB')}) -- would double-count already-closed entries.`, type: 'error' });
      return;
    }
    const ok = await confirm({
      title: 'Close Cargo Desk period?',
      message: `Close the cargo period from ${startD.toLocaleString('en-GB')} to ${endD.toLocaleString('en-GB')}? This cannot be undone.`,
      confirmLabel: 'Close Period',
      tone: 'danger',
    });
    if (!ok) return;
    setClosingDay(true);
    try {
      const { error } = await supabase.from('cargo_day_close').upsert({
        hub_id: user.hub_id,
        hub: user.hub,
        period_start: startISO,
        period_end: endISO,
        total_sales: closeTotalSales,
        cash_sales: closeCashSales,
        pos_sales: closePosSales,
        transfer_sales: closeTransferSales,
        debt_sales: closeDebtSales,
        total_expenses: closeTotalExpenses,
        balance_cash: closeBalanceCash,
        entry_count: closeEntries.length,
        route_counts: closeRouteCounts,
        closed_by: user.name,
        closed_at: new Date().toISOString(),
      }, { onConflict: 'hub_id,period_end' });
      if (error) throw error;
      showToast({ message: 'Cargo period closed successfully', type: 'success' });
      setShowCloseModal(false);
    } catch (err: any) {
      showToast({ message: 'Failed to close period: ' + err.message, type: 'error' });
    } finally {
      setClosingDay(false);
    }
  };

  // --- B2B CORPORATE PERSISTED STATES ---
  const [corpClients, setCorpClients] = useState<CorporateClient[]>(() => {
    try {
      if (typeof window === "undefined" || !window.localStorage) return [];
      const saved = localStorage.getItem("ehi_corporate_clients_v2");
      if (saved) return JSON.parse(saved);
      return [];
    } catch (e) {
      return [];
    }
  });

  // Real values always come from the corporate_route_rates fetch below --
  // no local seed. A prior placeholder seed here used fake IDs ("corp_1"
  // .."corp_3") that could never match a real client's Postgres UUID, which
  // meant every corporate shipment silently billed at the fallback rate
  // instead of its negotiated one until the fetch below was added.
  const [corpRates, setCorpRates] = useState<CorporateRouteRate[]>([]);

  const [pendingIntakes, setPendingIntakes] = useState<PendingWeighingIntake[]>(
    () => {
      try {
        if (typeof window === "undefined" || !window.localStorage) return [];
        const saved = localStorage.getItem("ehi_pending_intakes_v2");
        if (saved) return JSON.parse(saved);
        return [];
      } catch (e) {
        return [];
      }
    },
  );

  // --- PHASE 1 STATE FIELDS ---
  const [intakeConsignee, setIntakeConsignee] = useState(
    corpClients[0]?.company_name || "Aramex",
  );
  const [intakeAirline, setIntakeAirline] = useState("Arik Air");

  useEffect(() => {
    if (availableAirlines.length > 0) {
      if (!availableAirlines.includes(intakeAirline)) {
        setIntakeAirline(availableAirlines[0]);
      }
    }
  }, [availableAirlines]);

  // Load real corporate clients from Supabase — overrides the local seed when data exists
  useEffect(() => {
    let active = true;
    const fetchCorpClients = async () => {
      try {
        const { data } = await supabase
          .from('corporate_clients')
          .select('id, company_name, contact_phone, accumulated_monthly_debt, active')
          .order('company_name');
        if (active && data && data.length > 0) {
          const mapped = data.map((c: any) => ({
            id: c.id,
            company_name: c.company_name,
            contact_phone: c.contact_phone || '',
            accumulated_monthly_debt: c.accumulated_monthly_debt ?? 0,
            active: c.active ?? true,
          }));
          setCorpClients(mapped);
        }
      } catch { /* keep local seed if offline */ }
    };
    fetchCorpClients();

    // Same staleness reasoning as the corpRates fetch below: a new B2B
    // client added (or an existing one deactivated) in Pricing
    // Configuration mid-shift wouldn't otherwise show up here until this
    // tab reloaded.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchCorpClients, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchCorpClients(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchCorpClients);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchCorpClients);
    };
  }, []);

  // Customer Wallets state for detecting prepaid credit balances at point of consignment
  const [internalWallets, setInternalWallets] = useState<CustomerWallet[]>([]);
  const customerWallets = passedWallets && passedWallets.length > 0 ? passedWallets : internalWallets;
  const setCustomerWallets = passedSetWallets || setInternalWallets;

  useEffect(() => {
    if (passedWallets && passedWallets.length > 0) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('customer_wallets')
          .select('*')
          .gt('balance', 0);
        if (active && data) setInternalWallets(data as CustomerWallet[]);
      } catch { /* keep local if offline */ }
    })();
    return () => { active = false; };
  }, [passedWallets]);

  // Options for the Retail Entry Consignee dropdown -- the real corporate
  // client list from Supabase (kept live-synced above), not a hardcoded
  // roster. "Other" always stays last so staff can type a one-off name for
  // a walk-in customer who isn't a registered corporate client.
  const consigneeOptions = useMemo(
    () => [...corpClients.map((c) => c.company_name), "Other"],
    [corpClients],
  );

  // Office-work detection: when a retail consignee name closely matches a
  // registered corporate/office-work client, we surface a banner so the
  // staff member can link this entry to that account. This addresses the
  // "forgot to go through the Office Work tab" pattern that was causing
  // retail entries to be silently recorded at the wrong (retail) rate.
  // Normalized (trim/upper/collapse-spaces) match against the corporate
  // roster, returning WHICH kind of match it was. Exact matches are safe to
  // auto-apply; fuzzy (prefix) matches are only ever suggested, because
  // auto-billing a coincidental walk-in as a corporate account is worse than
  // asking. Mirrors the DB's normalize_company_name().
  const officeMatch = useMemo(() => {
    const raw = (consignee === 'Other' ? customConsignee : consignee).trim();
    if (raw.length < 3) return { client: null as any, type: null as 'exact' | 'fuzzy' | null };
    // Deactivated clients are excluded from matching (not from corpClients
    // itself -- other code here still needs the full roster, inactive
    // clients included, for ID-based lookups like debt increments on
    // already-in-flight corporate shipments) so a deactivated client simply
    // stops being suggested for new work.
    const activeClients = corpClients.filter(c => c.active !== false);
    const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
    const q = norm(raw);
    const exact = activeClients.find(c => norm(c.company_name) === q);
    if (exact) return { client: exact, type: 'exact' as const };
    const fuzzy = activeClients.find(c => norm(c.company_name).startsWith(q) || q.startsWith(norm(c.company_name).slice(0, Math.min(8, norm(c.company_name).length))));
    return fuzzy ? { client: fuzzy, type: 'fuzzy' as const } : { client: null as any, type: null };
  }, [consignee, customConsignee, corpClients]);

  const detectedOfficeClient = officeMatch.client;

  const [linkedAsOfficeWork, setLinkedAsOfficeWork] = useState(false);

  const [selectedWalletOverride, setSelectedWalletOverride] = useState<any>(null);
  const [walletRemainderMode, setWalletRemainderMode] = useState<'Cash' | 'Transfer' | 'POS'>('Cash');
  const [walletRemainderBank, setWalletRemainderBank] = useState('');
  // Active Customer Wallet matching the typed consignee name or manual selection --
  // phone first (reliable identity), falling back to exact name match.
  const activeWallet = useMemo(() => {
    if (selectedWalletOverride) return selectedWalletOverride;
    const nm = (consignee === 'Other' ? customConsignee : consignee);
    return matchWallet(customerWallets, nm, consigneePhone);
  }, [consignee, customConsignee, consigneePhone, customerWallets, selectedWalletOverride]);

  // Neither match type auto-links anymore -- an exact match used to
  // auto-link (and, via the effect below, auto-bill) instantly with zero
  // confirmation, which silently applied a corporate account's negotiated
  // rate to anyone who happened to type that exact name (including a
  // coincidentally-same-named walk-in). Both exact and fuzzy matches now
  // only populate the suggestion banner and require the explicit "Yes,
  // Link as Office Work" click. Any change to the consignee also
  // un-confirms a previously confirmed link and clears a stale
  // office-work-computed amount, so editing the name away from a confirmed
  // match doesn't leave the corporate-rate price sitting in `amount` to be
  // billed as a plain individual sale.
  const wasLinkedRef = useRef(false);
  useEffect(() => {
    if (wasLinkedRef.current) setAmount('');
    setLinkedAsOfficeWork(false);
    wasLinkedRef.current = false;
  }, [consignee, customConsignee, officeMatch.type]);

  // When the entry is linked as office work, try to find the corporate route
  // rate for the selected route and pre-fill the amount.
  const officeWorkRate = useMemo(() => {
    if (!linkedAsOfficeWork || !detectedOfficeClient) return null;
    const rate = corpRates.find(
      r => r.corporate_client_id === detectedOfficeClient.id && r.route_name === route
    );
    return rate || null;
  }, [linkedAsOfficeWork, detectedOfficeClient, corpRates, route]);

  // Auto-fill the amount from the contract rate whenever this entry is linked
  // as office work and we have a rate + weight. Keyed on a client|route|kg
  // signature so it fills once per change and does NOT fight a manual edit the
  // agent makes afterward (that edit stays until kg/route/client changes).
  const officePricedSigRef = useRef<string>('');
  useEffect(() => {
    if (!linkedAsOfficeWork || !officeWorkRate) return;
    const w = effectiveKg;
    if (w <= 0) return;
    const sig = `${officeWorkRate.corporate_client_id}|${route}|${w}`;
    if (officePricedSigRef.current === sig) return;
    officePricedSigRef.current = sig;
    const computed = Math.max(roundMoney(w * officeWorkRate.rate_per_kg), officeWorkRate.minimum_amount ?? 0);
    setAmount(String(computed));
  }, [linkedAsOfficeWork, officeWorkRate, effectiveKg, route]);

  // Load real corporate contract rates from Supabase — this table was
  // NEVER fetched here at all: corpRates only ever came from localStorage
  // or the hardcoded placeholder seed above, whose corporate_client_id
  // values ("corp_1".."corp_3") can never match a real client's Postgres
  // UUID (corpClients above IS fetched correctly). The contractRateRecord
  // lookup in handleFinalizeWeighing therefore never matched for any real
  // corporate account, and every corporate shipment silently billed at the
  // ₦500/kg fallback instead of its negotiated rate -- with no error
  // anywhere, since falling through to the fallback is the normal,
  // expected behavior for a client with no override on file.
  useEffect(() => {
    let active = true;
    const fetchCorpRates = async () => {
      try {
        const { data } = await supabase
          .from('corporate_route_rates')
          .select('id, corporate_client_id, route_name, rate_per_kg, minimum_amount');
        if (active && data && data.length > 0) {
          setCorpRates(data as CorporateRouteRate[]);
        }
      } catch { /* keep local seed if offline */ }
    };
    fetchCorpRates();

    // Same staleness reasoning as the standardRates/hubRates effects above:
    // an admin editing a corporate client's negotiated rate in Pricing
    // Configuration mid-shift wouldn't otherwise show up here until the
    // agent navigated away and back or reloaded, silently billing every
    // B2B shipment finalized in the meantime at the stale rate.
    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(fetchCorpRates, REFRESH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchCorpRates(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchCorpRates);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchCorpRates);
    };
  }, []);

  // Load pending Phase 1 gate intakes from Supabase -- this table used to be
  // localStorage-only despite the italic notice below telling staff it
  // "syncs dynamically with our centralized database architecture." It
  // didn't: a shipment received at the gate had zero server record until
  // Phase 2 finished on that same device, so a cleared browser or a
  // different staff member finishing Phase 2 could never see it. Supabase
  // (hub-scoped by RLS) is now the source of truth; localStorage is just
  // the instant-paint / offline fallback while this fetch is in flight.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('pending_corporate_intakes')
          .select('id, consignee, corporate_client_id, pieces, route, content_type, airline, awb, sender_phone, created_at')
          .order('created_at', { ascending: false });
        if (active && data) {
          const mapped: PendingWeighingIntake[] = data.map((r: any) => ({
            id: r.id,
            consignee: r.consignee,
            corporate_client_id: r.corporate_client_id || "",
            pieces: r.pieces,
            route: r.route || "",
            contentType: r.content_type || "",
            airline: r.airline || "",
            awb: r.awb,
            created_at: r.created_at,
            sender_phone: r.sender_phone || undefined,
            time: new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
            isCorporate: true,
          }));
          setPendingIntakes(mapped);
          localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(mapped));
        }
      } catch { /* keep local cache if offline */ }
    })();
    return () => { active = false; };
  }, []);

  const [intakeAwb, setIntakeAwb] = useState("");
  const fetchIntakeAwbPreview = async () => {
    const hubCode = getHubCode(user.hub_code || user.hub);
    const poolKey = `${hubCode}-CG`;
    const tag = await getNextTag(poolKey, `${getTenantTagPrefix()}-${hubCode}-CG`);
    setIntakeAwb(tag || '');
  };
  useEffect(() => { fetchIntakeAwbPreview(); }, [user.hub_code, user.hub]);
  const [intakePcs, setIntakePcs] = useState("1");
  // Left empty rather than defaulting to routes[0]/contentTypes[0] -- see
  // the retail route/contentType state above for why. handleLogFieldIntake
  // now explicitly validates both before submitting.
  const [intakeRoute, setIntakeRoute] = useState('');
  useValidatedRouteSelection(routes, intakeRoute, setIntakeRoute);
  const [intakeContentType, setIntakeContentType] = useState<string>('');
  const [intakeSenderPhone, setIntakeSenderPhone] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // --- PHASE 2 STATE FIELDS ---
  const [selectedIntake, setSelectedIntake] =
    useState<PendingWeighingIntake | null>(null);
  const [gateWeight, setGateWeight] = useState("");
  const [customRateOverwrite, setCustomRateOverwrite] = useState("");
  const [isWeighingSubmitting, setIsWeighingSubmitting] = useState(false);

  // Negotiated contract rate for the intake currently on the scale, if one
  // exists -- computed once here and reused by the rate display, the
  // computed-bill display, and handleFinalizeWeighing, instead of each
  // re-deriving it independently (previously three separate copies of the
  // same lookup, one of which used a stale rate at submit time relative to
  // what the screen displayed).
  const contractRateForSelectedIntake = useMemo(() => {
    if (!selectedIntake) return null;
    const client = corpClients.find((c) => c.id === selectedIntake.corporate_client_id);
    if (!client) return null;
    return corpRates.find((r) => r.corporate_client_id === client.id && r.route_name === selectedIntake.route) || null;
  }, [selectedIntake, corpClients, corpRates]);

  // --- SYSTEM HELPERS ---
  const isAuthorizedRole =
    user &&
    ["super_admin", "admin", "accountant", "auditor"].includes(user.role);

  const updateLocalCorpClients = (updated: CorporateClient[]) => {
    setCorpClients(updated);
    localStorage.setItem("ehi_corporate_clients_v2", JSON.stringify(updated));
  };

  const updateLocalPendingIntakes = (updated: PendingWeighingIntake[]) => {
    setPendingIntakes(updated);
    localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(updated));
  };

  // pendingIntakes lives only in localStorage (there is no server refetch
  // that would restore an entry) -- the two delete buttons below used to
  // remove the row from local state immediately and fire-and-forget the
  // server delete with only a console.error on failure. A failed delete
  // (RLS, network) left the row permanently orphaned in
  // pending_corporate_intakes with nothing on screen ever pointing back
  // at it again. Now the local removal only happens after the server
  // confirms the delete succeeded.
  const handleDeletePendingIntake = async (pi: PendingWeighingIntake) => {
    if (!window.confirm("Delete this pending intake?")) return;
    try {
      const { error } = await supabase.from('pending_corporate_intakes').delete().eq('id', pi.id);
      if (error) throw error;
      // Functional update -- `pendingIntakes` captured in this handler's
      // closure is stale by the time the await resolves; a gate intake
      // logged during the round-trip (handleLogFieldIntake) would otherwise
      // be wiped from state AND localStorage, invisible until a remount.
      setPendingIntakes(prev => {
        const next = prev.filter(x => x.id !== pi.id);
        try { localStorage.setItem("ehi_pending_intakes_v2", JSON.stringify(next)); } catch { /* quota / private mode */ }
        return next;
      });
      if (selectedIntake?.id === pi.id) {
        setSelectedIntake(null);
        setGateWeight("");
        setCustomRateOverwrite("");
      }
    } catch (err) {
      console.error('Delete pending intake error:', err);
      showToast({ message: "Couldn't delete this intake -- check your connection and try again.", type: 'error' });
    }
  };

  // --- ACTION: LOG FIELD INTAKE (Phase 1) ---
  const handleLogFieldIntake = async () => {
    if (!intakeAwb.trim()) {
      showToast({ message: "Please provide the Air Waybill / Tag Number.", type: "warning" });
      return;
    }
    // intakeRoute/intakeContentType now start empty rather than defaulting
    // to routes[0]/contentTypes[0] (same reasoning as the retail form) --
    // unlike that form's isRetailFormValid, this button was never gated on
    // either field, so an empty selection would otherwise submit silently.
    if (!intakeRoute) {
      showToast({ message: "Select a route before logging this intake.", type: "warning" });
      return;
    }
    if (!intakeContentType) {
      showToast({ message: "Select a content type before logging this intake.", type: "warning" });
      return;
    }
    // parseInt(intakePcs) || 1 at the point of use only catches "0" and
    // non-numeric input (both fall back to 1) -- a negative string like
    // "-5" is truthy and parses to -5, flowing straight into the ledger
    // and the per-piece tag-numbering logic without ever being re-checked
    // at Phase 2 finalize.
    const intakePiecesNum = parseInt(intakePcs);
    if (!Number.isInteger(intakePiecesNum) || intakePiecesNum <= 0) {
      showToast({ message: "Enter a valid piece count of 1 or more.", type: "warning" });
      return;
    }

    // Resolve the stable client ID NOW, while corpClients is guaranteed
    // current -- storing company_name alone (a mutable, editable field)
    // meant a client renamed between intake and finalize would silently
    // fail to match later, and there was no durable link for reporting.
    const matchedClient = corpClients.find((c) => c.company_name === intakeConsignee);

    const newIntake: PendingWeighingIntake = {
      id: `CG-INT-${Math.floor(100 + Math.random() * 900)}`,
      consignee: intakeConsignee,
      corporate_client_id: matchedClient?.id || "",
      pieces: intakePiecesNum,
      route: intakeRoute,
      contentType: intakeContentType,
      airline: intakeAirline,
      awb: intakeAwb.toUpperCase().trim(),
      created_at: new Date().toISOString(),
      sender_phone: intakeSenderPhone.trim() || undefined,
      time: tnow(),
      isCorporate: true,
    };

    const updated = [newIntake, ...pendingIntakes];
    updateLocalPendingIntakes(updated);

    // Write through to Supabase so this record survives a cleared browser
    // and is visible to whoever finishes Phase 2, even on a different
    // device -- see the fetch effect above for the full history here.
    // Best-effort: the local write above already gives this device an
    // instant, working copy, so a failed/offline insert doesn't block the
    // gate agent, it just means this specific record won't show up
    // elsewhere until it's retried.
    try {
      const { error } = await supabase.from('pending_corporate_intakes').insert({
        id: newIntake.id,
        consignee: newIntake.consignee,
        corporate_client_id: newIntake.corporate_client_id || null,
        pieces: newIntake.pieces,
        route: newIntake.route,
        content_type: newIntake.contentType,
        airline: newIntake.airline,
        awb: newIntake.awb,
        sender_phone: newIntake.sender_phone || null,
        hub_id: user.hub_id || null,
        hub: user.hub,
        entered_by: user.name,
        created_at: newIntake.created_at,
      });
      if (error) throw error;
    } catch (err) {
      console.error('Failed to sync Phase 1 intake to Supabase (kept locally, will not appear on other devices until retried):', err);
    }

    // Clear and Toast
    fetchIntakeAwbPreview();
    setIntakePcs("1");
    setIntakeSenderPhone("");
    setSuccessMessage(
      `Phase 1 Pick-up saved for ${newIntake.consignee}. Cargo registered at Gate.`,
    );
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  // --- ACTION: FINALIZE SCALE WEIGHING (Phase 2) ---
  const handleFinalizeWeighing = async () => {
    if (!selectedIntake || !gateWeight) return;
    setIsWeighingSubmitting(true);

    const weightNum = Math.round(parseFloat(gateWeight)) || 0;
    if (weightNum <= 0) {
      showToast({ message: "Please enter a valid verified weight in KG.", type: "warning" });
      setIsWeighingSubmitting(false);
      return;
    }

    if (customRateOverwrite) {
      const overwriteNum = parseFloat(customRateOverwrite);
      if (isNaN(overwriteNum) || overwriteNum <= 0) {
        showToast({ message: "Custom rate must be a positive number greater than zero.", type: "warning" });
        setIsWeighingSubmitting(false);
        return;
      }
    }

    // No contract rate on file and no admin override typed -- previously
    // this silently billed at a hardcoded ₦500/KG baseline with no warning
    // anywhere, indistinguishable from an intentional ₦500 rate. Block and
    // require an explicit override instead of guessing a number that could
    // be wildly wrong for this client/route.
    if (!customRateOverwrite && !contractRateForSelectedIntake) {
      showToast({ message: "No negotiated rate on file for this client/route. Enter an admin rate overwrite before finalizing.", type: "warning" });
      setIsWeighingSubmitting(false);
      return;
    }

    const rateToUse = customRateOverwrite
      ? parseFloat(customRateOverwrite)
      : contractRateForSelectedIntake!.rate_per_kg;

    let computedCost = roundMoney(weightNum * rateToUse);
    if (!customRateOverwrite && contractRateForSelectedIntake && contractRateForSelectedIntake.minimum_amount) {
      const minAmount = Number(contractRateForSelectedIntake.minimum_amount);
      if (minAmount > 0 && computedCost < minAmount) {
        computedCost = minAmount;
      }
    }

    const gateHubCode = getHubCode(user.hub_code || user.hub);
    const gateResolvedId = await getNextTag(`${gateHubCode}-CG`, `${getTenantTagPrefix()}-${gateHubCode}-CG`);
    if (!gateResolvedId) {
      showToast({ message: "No tag number available offline. Connect to the internet briefly to reserve more, then try again.", type: "error" });
      setIsWeighingSubmitting(false);
      return;
    }

    // Lock in the commission rate at entry time (see retail submit path for why).
    // Reads the reactive useAirlineCommissions() state already in scope
    // (live-fetched on mount) instead of re-reading localStorage directly --
    // a slow/offline fetch could otherwise book this at a stale or
    // default-0% rate that's permanently baked in.
    const gateWeighCommissionRate = selectedIntake.airline
      ? (airlineCommissions[normalizeAirlineName(selectedIntake.airline)] ?? airlineCommissions[selectedIntake.airline] ?? 0)
      : 0;

    // Build central ledger transaction record (Debt contract)
    const finalTxDetail = `${selectedIntake.airline} · ${selectedIntake.pieces || 1}pcs · ${weightNum}kg · ${selectedIntake.route} · ${selectedIntake.contentType || selectedIntake.content_type || 'General Goods'}`;

    // Flags reuse of a physical AWB whose previous consignment already
    // completed delivery -- a duplicated physical tag lets two shipments
    // share one tracking history, a common consign-fraud pattern. Fire-
    // and-forget rather than awaited -- see the retail submit path's
    // identical comment on why this shouldn't block the whole submission.
    // Skipped offline entirely -- the check would only ever fail on the
    // network call itself while offline.
    if (navigator.onLine) {
      isTagAlreadyDelivered(selectedIntake.awb).then(alreadyDelivered => {
        if (alreadyDelivered) {
          showToast({
            message: `⚠ ${selectedIntake.awb} may have been reused -- it was already delivered on a previous consignment. Verify the physical AWB.`,
            type: "error",
          });
        }
      }).catch(() => {});
    }

    const txEntry: Transaction = {
      id: gateResolvedId,
      name: selectedIntake.consignee,
      corporate_client_id: selectedIntake.corporate_client_id || undefined,
      // B2B monthly-billed client -- distinct from the retail path above,
      // which sets 'Individual'. This is what accumulates into
      // accumulated_monthly_debt below, not a per-shipment individual debt.
      clientType: "Corporate",
      detail: finalTxDetail,
      amount: computedCost,
      mode: corporateMode,
      remarks: `Gate Weight Finalized (${rateToUse} ₦/KG Contract). Ref Intake ID: ${selectedIntake.id}`,
      time: tnow(),
      type: "cargo",
      status: "Intake",
      awb_tag_number: gateResolvedId,
      airline: selectedIntake.airline,
      commissionRate: gateWeighCommissionRate,
      pieces: selectedIntake.pieces,
      kg: weightNum,
      route: selectedIntake.route,
      contentType: selectedIntake.contentType || selectedIntake.content_type || 'General Goods',
      enteredByName: user.name,
      // See the retail tx's identical comment above -- same gap, same fix.
      hub: user.hub,
      hub_id: user.hub_id,
    };

    // 1. Add to central transactions grid
    onAddTx(txEntry);

    // 2. Increment client's monthly accumulated debt balance (only if Debt)
    if (corporateMode === "Debt") {
      const matchingClientObj = corpClients.find((c) => c.id === selectedIntake.corporate_client_id);
      if (matchingClientObj) {
        try {
          const { data: newDebtTotal, error: debtUpdateError } = await supabase.rpc(
            'increment_corporate_debt',
            { p_client_id: matchingClientObj.id, p_amount: computedCost },
          );
          if (debtUpdateError) throw debtUpdateError;
          const updatedClients = corpClients.map((c) =>
            c.id === matchingClientObj.id ? { ...c, accumulated_monthly_debt: newDebtTotal } : c,
          );
          updateLocalCorpClients(updatedClients);
        } catch (err: any) {
          console.error('Failed to persist corporate client debt to Supabase', err);
          showToast({ message: `Transaction saved, but ${matchingClientObj.company_name}'s debt balance failed to update on the server: ${err.message || 'unknown error'}. Reconcile manually.`, type: 'error' });
        }
      }
    }

    // 3. Remove from pending intakes queue
    const filteredPending = pendingIntakes.filter(
      (pi) => pi.id !== selectedIntake.id,
    );
    updateLocalPendingIntakes(filteredPending);
    try {
      await supabase.from('pending_corporate_intakes').delete().eq('id', selectedIntake.id);
    } catch (err) {
      console.error('Failed to remove finalized intake from Supabase (still cleared locally):', err);
    }

    // 4. Trigger printer receipt model & clear states
    setSuccessTx(txEntry);
    
    // Send Whatsapp Receipt for Corporate Debt Client
    if (selectedIntake.sender_phone) {
      sendReceiptWhatsApp({
        phone: selectedIntake.sender_phone,
        ref: txEntry.id,
        message: buildCargoWhatsApp({
          ref: txEntry.id,
          consignee: selectedIntake.consignee,
          awb: selectedIntake.awb,
          route: selectedIntake.route,
          kg: weightNum,
          pcs: selectedIntake.pieces,
          amount: computedCost,
          mode: corporateMode,
        }),
      });
    }

    setSelectedIntake(null);
    setGateWeight("");
    setCustomRateOverwrite("");
    setIsWeighingSubmitting(false);
  };

  // --- RETAIL BILLING SUBMIT ---
  const saleIdempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const actualConsignee = consignee === "Other" ? customConsignee : consignee;
  const w = effectiveKg;
  const rate = resolveRate(actualAirline, route, actualContentType, w);
  const minCharge = resolveMinimumCharge(minimumCharges, actualAirline, route, w);
  // null rate/minCharge = nothing configured at any tier (special-goods,
  // hub+airline+route, hub default, company-wide, or a minimum-charge
  // bracket) -- minAmount of 0 here is not "free," it's "no computed
  // floor," and isRetailFormValid below only enforces the >= minAmount
  // check when a real rate or minimum charge was found. When both exist,
  // the minimum charge floors the per-kg computed amount (see autoAmount
  // above, which this mirrors).
  const perKgAmount = rate != null ? roundMoney(w * rate) : null;
  const minAmount = minCharge != null ? Math.max(perKgAmount ?? 0, minCharge) : (perKgAmount ?? 0);
  // Use manual amount if typed, else fall back to auto-computed price
  const effectiveAmount = amount || autoAmount;
  const parsedAmount = parseFloat(effectiveAmount) || 0;

  // w>0 and a positive integer pieces count are both required -- previously
  // neither was checked directly: an empty/zero kg just made minAmount
  // compute to 0, so any manually-typed amount>0 alone passed, and pieces
  // had no validation at all (parseInt(pcs)||1 at submit only catches "0",
  // not a negative string like "-5", which is truthy and would flow
  // straight into the ledger and the per-piece tag-numbering logic).
  const piecesNum = parseInt(pcs);
  const isRetailFormValid = useMemo(
    () =>
      actualConsignee.trim().length >= 3 &&
      route.trim().length > 0 &&
      actualContentType.trim().length > 0 &&
      // Size-tier content (e.g. Plasma TV) is priced by screen size, not
      // weight -- kg stays optional/still-trackable for these entries, but
      // requiring w > 0 unconditionally would block a valid size-tier sale
      // whenever the agent hasn't also weighed the item.
      (isSizeTierContent ? (Math.round(parseFloat(sizeInches)) || 0) > 0 : w > 0) &&
      Number.isInteger(piecesNum) && piecesNum > 0 &&
      // minAmount above is computed purely from resolveRate/
      // resolveMinimumCharge -- both keyed on airline+route+kg alone, with
      // no content-type awareness -- so it can easily land higher than a
      // size/flat-tier item's own correct, deliberately-configured whole-
      // bracket price (autoAmount already gives tier pricing full priority
      // over the per-kg+minimum cascade, per its own comment above). Without
      // this, a legitimately-priced size/flat-tier sale could be blocked by
      // a minimum-charge bracket that was never meant to apply to it.
      // A negotiated office-work contract rate is authoritative pricing the
      // company already agreed to -- it can legitimately fall below the
      // retail-computed minAmount (e.g. a bulk-volume discount), so it's
      // exempted from the floor the same way size/flat-tier pricing already
      // is, just below. Only when a rate actually exists for this route
      // (officeWorkRate) -- a confirmed link with no configured rate is not
      // itself a pricing decision, so the normal floor still applies.
      (priceOverrideInfo?.type === 'size' || priceOverrideInfo?.type === 'flat' || (linkedAsOfficeWork && officeWorkRate)
        ? parsedAmount > 0
        : (rate == null && minCharge == null ? parsedAmount > 0 : parsedAmount >= minAmount && parsedAmount > 0)) &&
      // Wallet mode requires an actual resolved wallet -- without this,
      // `activeWallet` being null (no name/phone match, nothing picked in
      // CustomerWalletPicker) still passed validation, and the submit
      // handler's wallet-charging block is itself gated on `activeWallet`
      // truthy, so it silently no-ops: the sale recorded mode: "Wallet" at
      // the full amount with no money ever collected and no wallet debited.
      (mode !== 'Wallet' || !!activeWallet) &&
      // A short wallet paying its remainder by Transfer/POS needs a bank
      // before the entry can be submitted -- mirrors the same guard in
      // handleRetailSubmit, so the button (and the review modal it opens)
      // isn't enabled on a submission that's guaranteed to be blocked.
      (mode !== 'Wallet' || !activeWallet || activeWallet.balance >= parsedAmount ||
        !(walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ||
        walletRemainderBank.trim().length > 0),
    [actualConsignee, route, actualContentType, w, sizeInches, isSizeTierContent, piecesNum, parsedAmount, minAmount, rate, minCharge, priceOverrideInfo, linkedAsOfficeWork, officeWorkRate, mode, activeWallet, walletRemainderMode, walletRemainderBank],
  );

  const handleRetailSubmit = async () => {
    if (!isRetailFormValid || submitting) return;
    setSubmitting(true);
    // Everything below is wrapped in try/catch -- previously an unexpected
    // throw here (e.g. getNextTag/isTagAlreadyDelivered/chargeWalletForSale
    // rejecting instead of resolving) would leave `submitting` stuck true
    // forever. Harmless before, since ReviewEntryModal used to close
    // immediately regardless of outcome -- but now that it stays open
    // through submission (Confirm/Cancel both disabled while isSubmitting),
    // an unhandled exception would leave the modal permanently stuck open
    // with no way out but a page reload.
    try {

    // New custom airline typed into "Other" -- add it to pricing_config
    // (visible to Airline Commissions, Hub Cargo Rates, Airline Ledger,
    // Marketing Workspace next time each of those fetches) with a default
    // 5% commission. It won't appear in this screen's own dropdown until
    // its next fetch/remount, same as any other config screen.
    if (airline === "Other" && actualAirline && !availableAirlines.includes(actualAirline)) {
      try {
        await addAirlineIfMissing(actualAirline);
      } catch (e) {
        // Ignore
      }
    }

    const pickupPin = generatePickupPin();

    // Lock in the commission rate at entry time so a later change to
    // pricing_config can't silently rewrite historical airline payables.
    // Reads the reactive useAirlineCommissions() state already in scope
    // instead of re-reading localStorage directly (see gate-weigh path
    // above for why).
    const commissionRate = airlineCommissions[normalizeAirlineName(actualAirline)] ?? airlineCommissions[actualAirline] ?? 0;

    // AWB is {PREFIX}-{HUBCODE}-{6-digit per-hub sequence}, e.g. HW-LOS-001042.
    // The number was already allocated on mount/reset (see fetchAwbPreview
    // above) from the local tag pool -- popped from a block reserved via
    // the atomic reserve_awb_block()/next_awb_number() counter, so it's
    // already guaranteed unique whether or not this device is online right
    // now. Only re-attempt allocation here if that earlier pop somehow
    // came back empty (pool + connectivity both unavailable at mount time).
    const hubCode = getHubCode(user.hub_code || user.hub);
    let resolvedAwb = awb;
    if (!resolvedAwb) {
      resolvedAwb = await getNextTag(`${hubCode}-CG`, `${getTenantTagPrefix()}-${hubCode}-CG`);
    }

    // Flags reuse of a tag whose previous consignment already completed
    // delivery -- a duplicated physical tag makes two shipments share one
    // tracking history and is a common consign-fraud pattern. Fire-and-
    // forget rather than awaited: this AWB just came from the atomic pool/
    // counter so a hit here is rare, and blocking the whole submission on
    // this one network round-trip added latency to every online Cash/
    // Transfer/POS/Debt sale for a check that isn't correctness-critical to
    // *this* submission. Skipped offline entirely -- the check would only
    // ever fail on the network call itself while offline, never produce a
    // real true/false answer.
    if (navigator.onLine) {
      isTagAlreadyDelivered(resolvedAwb).then(alreadyDelivered => {
        if (alreadyDelivered) {
          showToast({
            message: `⚠ ${resolvedAwb} may have been reused -- it was already delivered on a previous consignment. Verify the physical AWB.`,
            type: "error",
          });
        }
      }).catch(() => {});
    }

    const nextSerial = incrementLocalSerial();
    setSerialNumber(nextSerial);

    const summaryStr = `${actualAirline} · ${pcs}pcs · ${effectiveKg}KG · ${route} · ${actualContentType}${isSizeTierContent && sizeInches ? ` · ${sizeInches}in` : ''}`;

    const tx: Transaction = {
      id: resolvedAwb,
      name: actualConsignee,
      detail: summaryStr,
      amount: parsedAmount,
      mode,
      bank: mode === "Transfer" || mode === "POS" ? bank : undefined,
      paymentNarration: mode === "Transfer" ? narrationCode : undefined,
      remarks: remark.trim(),
      time: tnow(),
      type: "cargo",
      status: "Intake",
      awb_tag_number: resolvedAwb,
      airline_awb: airlineAwb.trim() ? formatAirlineAwb(airlineAwb) : undefined,
      airline: actualAirline,
      flight: flightNumber.trim() || undefined,
      commissionRate,
      pieces: parseInt(pcs) || 1,
      kg: effectiveKg,
      sizeInches: isSizeTierContent && sizeInches ? (Math.round(parseFloat(sizeInches)) || undefined) : undefined,
      pickupPin,
      consigneePhone: consigneePhone.trim(),
      // Office-work linking: when staff confirm this retail entry belongs to
      // a corporate/office client, flag it so the ledger shows OFFICE WORK
      // badge and the EOD/accountant can correctly attribute it.
      linked_as_office_work: linkedAsOfficeWork || undefined,
      corporate_client_id: linkedAsOfficeWork && detectedOfficeClient ? detectedOfficeClient.id : undefined,
      applied_rate_per_kg: linkedAsOfficeWork && officeWorkRate ? officeWorkRate.rate_per_kg : undefined,
      // Retail walk-in sale -- distinct from the B2B corporate path below,
      // which sets 'Corporate' instead.
      clientType: linkedAsOfficeWork ? "Corporate" : "Individual",
      enteredByName: user.name,
      // Was missing entirely -- EHIApp.tsx's handleAddTx falls back to
      // `hubId = tx.hub_id || user.hub_id` using ITS OWN top-level,
      // never-admin-overridden user prop when tx.hub_id is absent. Without
      // this, an admin using "Global Hub Context" to act as a different
      // hub had pricing correctly computed against their chosen hub, but
      // the saved entry was still filed under their own real hub --
      // invisible to the hub they thought they were entering it for.
      hub: user.hub,
      hub_id: user.hub_id,
    } as Transaction;
    // Stamped so a later batch reprint (handlePrintAllBatch, well after
    // `serialNumber` state has moved on to the next item) still prints the
    // serial that was actually current when THIS item was entered.
    (tx as any).serialAtSubmit = nextSerial;
    // Lets clear_cargo_debt later tell whether a Debt-mode sale is fully
    // cleared before this same shift ever closes -- see created_shift_id's
    // own comment on the CargoForm props type above.
    tx.created_shift_id = activeShift?.id;

    // Wallet payment — AUTO-SPLIT. Wallet covers what it can; any remainder is
    // collected by the chosen Cash/Transfer/POS method and recorded as the
    // receipt_mode, so the till isn't silently short. EOD nets
    // wallet_deduction_amount out of the cash/transfer/POS totals.
    if (mode === "Wallet" && activeWallet) {
      // Guard: a short wallet needs a remainder method (Cash needs nothing;
      // Transfer/POS need a bank/terminal reference). Checked BEFORE
      // chargeWalletForSale -- that call commits an atomic, non-reversible
      // wallet deduction, so this can never run after the money has already
      // moved (previously it did, silently deducting the wallet even when
      // the bank field was left blank).
      const walletRemainder = Math.max(0, parsedAmount - activeWallet.balance);
      if (walletRemainder > 0 && (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') && !walletRemainderBank.trim()) {
        showToast({ message: `Enter the bank/terminal for the ₦${fmt(walletRemainder)} remainder.`, type: 'warning' });
        setSubmitting(false);
        return;
      }
      const charge = await chargeWalletForSale({
        wallet: activeWallet,
        amount: parsedAmount,
        cargoRef: resolvedAwb,
        description: `Cargo Consignment ${resolvedAwb}`,
        loggedBy: user.name,
        department: 'cargo',
        idempotencyKey: saleIdempotencyKeyRef.current,
      });
      if (!charge.ok) {
        showToast({ message: `Wallet deduction failed: ${charge.error}. Entry was not logged.`, type: "error" });
        setSubmitting(false);
        return;
      }
      tx.wallet_id = activeWallet.id;
      tx.wallet_deduction_amount = charge.walletDeduction;
      (tx as any).wallet_balance_before = activeWallet.balance;
      (tx as any).wallet_balance_after = charge.newBalance;
      if (charge.remainder > 0) {
        // Book the sale under the remainder method; wallet part stays tracked
        // in wallet_deduction_amount.
        tx.mode = walletRemainderMode;
        tx.bank = (walletRemainderMode === 'Transfer' || walletRemainderMode === 'POS') ? walletRemainderBank.trim() : undefined;
      }
      setCustomerWallets(prev => prev.map(w => w.id === activeWallet.id ? { ...w, balance: charge.newBalance! } : w));
      showToast({
        message: charge.remainder > 0
          ? `₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet · ₦${fmt(charge.remainder)} by ${walletRemainderMode}. Balance: ₦${fmt(charge.newBalance!)}`
          : `👜 ₦${fmt(charge.walletDeduction)} from ${activeWallet.customer_name}'s wallet. Remaining: ₦${fmt(charge.newBalance!)}`,
        type: "success",
      });
    }

    onAddTx(tx);
    setSuccessTx(tx);
    // Never reset back to false on confirm (only on Cancel) -- left true,
    // this reappeared as soon as "New Entry" cleared successTx and put the
    // main form back on screen, since the modal's own render condition
    // (`showRetailReview && <ReviewEntryModal .../>`) was still satisfied.
    setShowRetailReview(false);
    setSubmitting(false);

    // Call PIN notification API. /api/notify/* requires an authenticated
    // caller (server/app.ts's requireAuthenticatedUser) -- without this
    // header the call 401s unconditionally regardless of session validity,
    // silently dropping every pickup-PIN notification.
    supabase.auth.getSession().then(({ data: sess }) => {
      const token = sess.session?.access_token || '';
      fetch("/api/notify/pickup-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          senderPhone: senderPhone.trim(),
          consigneePhone: consigneePhone.trim(),
          pin: pickupPin,
          entryRef: tx.id,
          route,
        }),
      }).catch((e) => console.error("Failed to notify pin:", e));
    });

    if (senderPhone.trim().length > 0) {
      sendReceiptWhatsApp({
        phone: senderPhone.trim(),
        ref: tx.id,
        message: buildCargoWhatsApp({
          ref: tx.id,
          consignee: actualConsignee,
          awb: resolvedAwb,
          route,
          kg,
          pcs,
          amount: parsedAmount,
          mode,
          bank: mode === "Transfer" || mode === "POS" ? bank : undefined,
          paymentNarration: mode === "Transfer" ? narrationCode : undefined,
          pin: pickupPin,
        }),
      });
    }
    } catch (err: any) {
      setSubmitting(false);
      showToast({ message: `Unexpected error: ${err?.message || 'please try again'}`, type: 'error' });
    }
  };

  // keepCustomer=true is the "Add Another Item (Same Customer)" path -- it
  // clears every per-shipment field (airline, route, weight, amount, payment
  // mode...) but leaves consignee/phone untouched so the next item in the
  // batch doesn't require re-typing the customer's details.
  const handleReset = (keepCustomer = false) => {
    if (!keepCustomer) {
      setConsignee("");
      setCustomConsignee("");
      setSenderPhone("");
      setConsigneePhone("");
      setBatchItems([]);
    }
    setAirline(availableAirlines[0] || "Other");
    setCustomAirline("");
    setFlightNumber("");
    setFlightAutoFilled(false);
    setAirlineAwb("");
    setAirlineAwbError(null);
    fetchAwbPreview();
    saleIdempotencyKeyRef.current = crypto.randomUUID();
    setPcs("1");
    setKg("");
    setLengthCm("");
    setWidthCm("");
    setHeightCm("");
    setShowDims(false);
    // Blank, not routes[0]/contentTypes[0] -- these start blank on mount
    // specifically so isRetailFormValid's non-empty checks force a
    // conscious pick (see their own useState('') declarations); silently
    // repopulating a default here let a shipment submit priced/filed under
    // whatever route/content happened to be first in the list, not what
    // the agent actually chose for this customer.
    setRoute('');
    setContentType('');
    setCustomContentType("");
    setAmount("");
    setMode("Cash");
    setBank(banks[0] as string);
    setRemark("");
    setSuccessTx(null);
    // Wallet override/remainder-payment state otherwise survives into the
    // next customer's sale -- if Wallet mode is used again without
    // explicitly re-picking a wallet, the charge would silently apply to
    // THIS (previous) customer's wallet instead of the new one.
    setSelectedWalletOverride(null);
    setWalletRemainderMode('Cash');
    setWalletRemainderBank('');
    // Reused otherwise -- the same bank narration/reference code would be
    // printed on two different customers' Transfer receipts, breaking bank
    // reconciliation (which relies on it being unique per transaction).
    setNarrationCode("");
  };

  // Queues the just-completed entry and returns to a blank item form for
  // the SAME consignee -- the entry itself was already saved to
  // cargo_entries by handleRetailSubmit above, this only affects what gets
  // offered for printing together at the end.
  const handleAddAnotherForBatch = () => {
    if (successTx) setBatchItems(prev => [...prev, successTx]);
    handleReset(true);
  };

  const buildBatchReceiptData = (tx: Transaction) => ({
    entryRef: tx.id,
    serialNumber: (tx as any).serialAtSubmit ?? (serialNumber - 1),
    date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
    hubName: user?.hub || "Air Cargo Hub",
    agentName: user?.name || "Cargo Agent",
    airline: (() => {
      const txAir = tx.airline || airline;
      return txAir === "Green Africa"
        ? "Green Africa Airways"
        : txAir === "United Nigeria"
          ? "United Nigeria Airlines"
          : txAir;
    })(),
    consignee: tx.name,
    awbTagNumber: tx.awb_tag_number || tx.id,
    pieces: tx.pieces || 1,
    kg: tx.kg || 0,
    route: tx.detail.split(" · ")[3] || route,
    contentType: tx.detail.split(" · ")[4] || contentType,
    amount: tx.amount,
    paymentMode: formatPaymentModeDisplay(tx.mode, tx.wallet_deduction_amount, tx.amount),
    paymentNarration: tx.paymentNarration,
    bankName: tx.bank || undefined,
    remark: tx.remarks || undefined,
    pickupPin: (tx as any).pickupPin || undefined,
  });

  const printOneBatchItem = async (tx: Transaction) => {
    const { printCargoTagPDF } = await import("./CargoTagPDF");
    await printCargoTagPDF({
      id: tx.awb_tag_number || tx.id,
      name: tx.name,
      route: tx.detail.split(" · ")[3] || route,
      pieces: tx.pieces || 1,
      weight: tx.kg || 0,
      airline: tx.airline || airline,
      hubName: user?.hub || "Air Cargo Hub",
      date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
      contentType: tx.detail?.split(" · ")[4] || contentType,
      agentName: tx.enteredByName,
      phone: tx.consigneePhone,
    });
  };

  const handlePrintAllBatch = async (docType: 'tag-pdf' | 'pos80') => {
    if (batchItems.length === 0 || batchPrinting) return;
    // printRange is 1-indexed/inclusive (as picked in PrintRangeModal);
    // null means the whole batch. slice() takes it back to 0-indexed.
    const itemsToPrint = printRange ? batchItems.slice(printRange.from - 1, printRange.to) : batchItems;
    if (itemsToPrint.length === 0) return;
    setBatchPrinting(true);

    if (docType === 'pos80') {
      // One Bluetooth connection for the whole batch
      try {
        const { printBatchViaBluetooth } = await import('../../lib/escpos');
        const { compileCargoReceiptStream } = await import('../../lib/escposCargoReceiptPrinting');
        const { done, failed } = await printBatchViaBluetooth(
          itemsToPrint.map((tx) => async () => compileCargoReceiptStream(
            { ...buildBatchReceiptData(tx), trackingUrl: `https://app.haulwey.com/track/${tx.id}` },
            '80mm',
          )),
          (i, total) => setBatchPrintProgress(`Printing ${i + 1} of ${total}…`),
        );
        showToast({ message: `${done} printed${failed ? `, ${failed} failed` : ''}.`, type: failed ? 'warning' : 'success' });
      } catch (err: any) {
        console.error('Bluetooth batch print failed:', err);
        showToast({ message: err?.message || 'Bluetooth print failed. Ensure the printer is paired and powered on.', type: 'error' });
      }
      setBatchPrinting(false);
      setBatchPrintProgress('');
      return;
    }

    // USB tag label printing per item
    let done = 0, failed = 0;
    for (let i = 0; i < itemsToPrint.length; i++) {
      setBatchPrintProgress(`Printing ${i + 1} of ${itemsToPrint.length}…`);
      try {
        await printOneBatchItem(itemsToPrint[i]);
        done++;
      } catch (err) {
        failed++;
        console.error(`Batch print failed for ${itemsToPrint[i].id}`, err);
      }
    }
    setBatchPrinting(false);
    setBatchPrintProgress('');
    showToast({ message: `${done} printed${failed ? `, ${failed} failed` : ''}.`, type: failed ? 'warning' : 'success' });
  };

  const handlePrintTagPDF100mm = async () => {
    if (successTx) {
      // Open the tab synchronously, in direct response to the click --
      // window.open() called after the awaits below (dynamic import, QR
      // generation, PDF rendering) loses the user-gesture context that
      // mobile browsers require, and gets silently blocked. Skipped
      // entirely in an installed/standalone PWA though: window.open()
      // there hands off to a separate browser process immediately (see
      // isStandalonePWA's comment in helpers.ts) -- that hand-off IS the
      // "jumps out to the browser" bug, and closing the window afterward
      // once openPdfOrDownload detects standalone mode doesn't undo it.
      // openPdfOrDownload does a same-document forced download instead
      // whenever isStandalonePWA() is true, regardless of what's passed
      // here, so passing null is safe.
      const preOpenedWindow = isStandalonePWA() ? null : window.open('', '_blank');
      // The tab above opens blank and only gets filled in once the PDF
      // finishes generating below, so there's otherwise no visible sign
      // anything is happening in the meantime -- unlike handlePrintReceipt,
      // which opens the tab already pointed at the finished blob.
      showToast({ message: 'Generating tag PDF…', type: 'info' });
      try {
        const { printCargoTagPDF } = await import("./CargoTagPDF");
        await printCargoTagPDF({
          id: successTx.awb_tag_number || awb,
          name: successTx.name,
          route: successTx.detail.split(" · ")[3] || route,
          pieces: successTx.pieces || parseInt(pcs) || 1,
          weight: successTx.kg || parseFloat(kg),
          airline: (() => {
            const txAir = successTx.airline || airline;
            return txAir === "Green Africa"
              ? "Green Africa Airways"
              : txAir === "United Nigeria"
                ? "United Nigeria Airlines"
                : txAir;
          })(),
          hubName: user?.hub || "Air Cargo Hub",
          date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
          contentType: successTx.detail?.split(" · ")[4] || contentType,
          agentName: successTx.enteredByName,
          phone: successTx.consigneePhone,
        }, preOpenedWindow);
      } catch (err) {
        console.error('Failed to open tag PDF', err);
        preOpenedWindow?.close();
        showToast({ message: 'Failed to open tag PDF', type: 'error' });
        return;
      }

      try {
        await supabase.from('tag_print_log').insert({
          cargo_ref: successTx.id,
          awb_tag_number: successTx.awb_tag_number || awb,
          printed_by: user.id,
          printed_by_name: user.name,
          hub_id: user.hub_id,
          hub_name: user.hub || 'Unknown',
          print_method: 'pdf',
          pieces_printed: successTx.pieces || parseInt(pcs) || 1,
        });
      } catch (err) {
        console.error('Failed to log tag print', err);
      }
    }
  };

  const formInputClass =
    "w-full min-h-[44px] h-11 px-3.5 text-[14px] rounded-xl bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] font-sans focus:outline-none focus:border-[var(--color-border-strong)] transition-colors placeholder:text-[var(--color-muted)]";

  const cardPadClass = isCompact
    ? "p-3.5 space-y-3"
    : "p-4 sm:p-5 space-y-4";
  const spaceYClass = isCompact ? "space-y-3" : "space-y-4";
  const gapClass = isCompact ? "gap-2.5" : "gap-3";

  const renderLabel = (icon: any, text: string) => {
    const Icon = icon;
    return (
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={14} className="text-[var(--color-muted)] shrink-0" />
        <label className="text-[12px] font-sans font-medium text-[var(--color-muted)] select-none">
          {text}
        </label>
      </div>
    );
  };

  // --- SUB-PANEL: COMPLETED RECEIPT SCREEN ---
  if (successTx) {
    const printData = {
      entryRef: successTx.id,
      serialNumber: serialNumber - 1,
      date: `${new Date().toLocaleDateString("en-GB")} ${tnow()}`,
      hubName: user?.hub || "Air Cargo Hub",
      agentName: user?.name || "Cargo Agent",
      airline: (() => {
        const txAir = successTx.airline || airline;
        return txAir === "Green Africa"
          ? "Green Africa Airways"
          : txAir === "United Nigeria"
            ? "United Nigeria Airlines"
            : txAir;
      })(),
      consignee: successTx.name,
      awbTagNumber: successTx.awb_tag_number || awb,
      pieces: successTx.pieces || parseInt(pcs),
      kg: successTx.kg || parseFloat(kg),
      route: successTx.detail.split(" · ")[3] || route,
      contentType: successTx.detail.split(" · ")[4] || contentType,
      amount: successTx.amount,
      paymentMode: formatPaymentModeDisplay(successTx.mode, successTx.wallet_deduction_amount, successTx.amount),
      paymentNarration: successTx.paymentNarration,
      bankName: successTx.bank || undefined,
      remark: successTx.remarks || undefined,
      pickupPin: (successTx as any).pickupPin || undefined,
    };

    return (
      <div ref={successRef} className="p-4 space-y-4 max-w-md mx-auto w-full select-none">
        {/* Header banner */}
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-4 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle
              size={20}
              className="text-[var(--color-success)] shrink-0"
            />
            <div className="min-w-0">
              <span className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans block truncate">
                {successTx.mode === "Debt"
                  ? successTx.clientType === "Corporate"
                    ? "B2B invoice saved"
                    : "Credit sale logged"
                  : "Cargo saved successfully"}
              </span>
              <span className="text-[11px] font-mono text-[var(--color-muted)] block">
                {successTx.id}
              </span>
              {(successTx as any).airline_awb && (
                <span className="text-[10px] font-mono text-[var(--color-muted)] block">
                  Airline AWB: {(successTx as any).airline_awb}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* QR Code + Pickup PIN Side-by-Side row */}
        <div className="flex gap-3 items-stretch">
          {/* QR Code Container */}
          <div className="flex items-center justify-center p-2 bg-white rounded-2xl border border-[var(--color-border)] shrink-0 shadow-xs">
            <QRCode id={successTx.id} size={72} />
          </div>
          
          {/* Pickup PIN or Reference details */}
          {(successTx as any).pickupPin ? (
            <div className="flex-1 border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)] flex flex-col justify-center px-4 py-2.5 shadow-xs">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-sans font-medium text-[var(--color-muted)]">
                  Pickup PIN
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText((successTx as any).pickupPin)
                  }
                  className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
                  title="Copy PIN"
                  aria-label="Copy PIN"
                >
                  <Copy size={14} />
                </button>
              </div>
              <div className="text-[20px] font-mono font-bold text-[var(--color-foreground)] tracking-wider mt-0.5 tabular-nums">
                {(successTx as any).pickupPin}
              </div>
              <p className="text-[11px] text-[var(--color-muted)] font-sans leading-tight mt-0.5">
                Share this PIN with consignee for pickup verification
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center border border-[var(--color-border)] rounded-2xl bg-[var(--color-surface-card)] px-4 py-2.5 shadow-xs">
              <span className="text-[11px] font-sans font-medium text-[var(--color-muted)]">Tag Number</span>
              <span className="text-[12px] font-mono font-medium text-[var(--color-foreground)] truncate mt-0.5">{successTx.id}</span>
              {(successTx as any).airline_awb && (
                <span className="text-[10px] font-mono text-[var(--color-muted)] truncate mt-0.5">
                  Airline AWB: {(successTx as any).airline_awb}
                </span>
              )}
              <p className="text-[11px] text-[var(--color-muted)] font-sans leading-tight mt-0.5">
                Scannable cargo QR code generated for waybill tags
              </p>
            </div>
          )}
        </div>

        {/* Details Card */}
        <div className="w-full bg-[var(--color-surface-card)] rounded-2xl p-4 border border-[var(--color-border)] text-left space-y-2.5 shadow-xs">
          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[13px] font-sans">
            <span className="text-[var(--color-muted)]">Consignee</span>
            <span className="font-semibold text-[var(--color-foreground)] truncate max-w-[65%]">{successTx.name}</span>
          </div>

          {/* WALLET DEBITED SUMMARY ROW */}
          {successTx.wallet_deduction_amount && (
            <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[12px] font-sans">
              <span className="text-[var(--color-muted)]">Wallet deducted</span>
              <span className="text-[var(--color-error)] font-medium tabular-nums">-₦{fmt(successTx.wallet_deduction_amount)}</span>
            </div>
          )}

          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[13px] font-sans">
            <span className="text-[var(--color-muted)]">AWB / Tag no.</span>
            <span className="font-mono font-semibold text-[var(--color-foreground)] tabular-nums">{successTx.awb_tag_number}</span>
          </div>

          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[13px] font-sans">
            <span className="text-[var(--color-muted)]">Weight / Route</span>
            <span className="font-medium text-[var(--color-foreground)] truncate max-w-[65%] tabular-nums">
              {successTx.kg} kg · {successTx.detail.split(" · ")[3]}
            </span>
          </div>

          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[13px] font-sans">
            <span className="text-[var(--color-muted)]">Content</span>
            <span className="font-medium text-[var(--color-foreground)]">{successTx.detail.split(" · ")[4] || "Package"}</span>
          </div>

          <div className="flex justify-between items-center border-b border-[var(--color-border)] pb-2 text-[13px] font-sans">
            <span className="text-[var(--color-muted)]">Amount charged</span>
            <span className="font-sans font-bold text-[16px] text-[var(--color-foreground)] tabular-nums">₦{fmt(successTx.amount)}</span>
          </div>

          <div className="flex justify-between items-center pt-1 text-[12px] font-sans">
            <span className="text-[var(--color-muted)]">Payment billing</span>
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              successTx.mode === "Debt"
                ? "bg-[rgba(239,68,68,0.12)] text-[var(--color-error)]"
                : "bg-[var(--color-surface-3)] text-[var(--color-foreground)]"
            }`}>
              {successTx.mode === "Debt"
                ? successTx.clientType === "Corporate"
                  ? "B2B monthly debt"
                  : "Individual debt"
                : successTx.mode}
            </span>
          </div>
        </div>

        {/* Print Buttons Grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              import('../../lib/escpos').then(async ({ printViaBluetooth }) => {
                await printViaBluetooth(async () => {
                  const m = await import('../../lib/escposCargoReceiptPrinting');
                  const thermalPrintData = {
                    ...printData,
                    trackingUrl: `https://app.haulwey.com/track/${successTx.id}`,
                  };
                  return await m.compileCargoReceiptStream(thermalPrintData, '80mm');
                });
              }).catch((err: any) => {
                console.error('Bluetooth print failed:', err);
                showToast({ message: err?.message || 'Bluetooth print failed. Ensure printer is paired.', type: 'error' });
              });
            }}
            className="w-full min-h-[44px] h-11 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-xl border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <Receipt size={14} className="shrink-0 text-[var(--color-muted)]" />
            <span>80mm receipt</span>
          </button>
          <button
            type="button"
            onClick={handlePrintTagPDF100mm}
            className="w-full min-h-[44px] h-11 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-xl border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            title="Print USB tag label (100×80mm)"
          >
            <Tag size={14} className="shrink-0 text-[var(--color-muted)]" />
            <span>USB tag print</span>
          </button>
        </div>

        {/* Same-customer batch controls */}
        {successTx.clientType !== "Corporate" && (
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={handleAddAnotherForBatch}
              className="w-full min-h-[44px] h-11 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[13px] font-sans font-medium rounded-full border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Layers size={15} />
              <span>Add another item for {successTx.name}</span>
            </button>

            {batchItems.length > 0 && (
              <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-3.5 space-y-2.5">
                <div className="text-[12px] font-sans text-[var(--color-muted)]">
                  Batch so far: <span className="font-semibold text-[var(--color-foreground)]">{batchItems.length + 1} items</span> · <span className="tabular-nums font-semibold text-[var(--color-foreground)]">₦{fmt(batchItems.reduce((s, t) => s + t.amount, 0) + successTx.amount)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setBatchItems(prev => [...prev, successTx]); setSuccessTx(null); setPrintRange(null); setShowBatchSummary(true); }}
                  className="w-full min-h-[44px] h-11 bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-full border border-[var(--color-border-strong)] transition-colors cursor-pointer"
                >
                  Finish &amp; print batch ({batchItems.length + 1} items)
                </button>
              </div>
            )}
          </div>
        )}

        {/* New Entry Button */}
        <button
          type="button"
          onClick={() => handleReset()}
          className="w-full min-h-[44px] h-11 bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[13px] font-sans font-semibold rounded-full transition-colors cursor-pointer shadow-xs mt-2"
        >
          {batchItems.length > 0 ? "New entry (different customer)" : "Start new entry"}
        </button>
      </div>
    );
  }

  if (showBatchSummary) {
    const batchTotal = batchItems.reduce((s, t) => s + t.amount, 0);
    const batchConsignee = batchItems[0]?.name || "Customer";
    return (
      <div className="p-4 space-y-4 max-w-md mx-auto w-full select-none">
        <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-2xl p-4">
          <div className="text-[14px] font-semibold text-[var(--color-foreground)] font-sans">
            Batch complete — {batchConsignee}
          </div>
          <div className="text-[12px] font-sans text-[var(--color-muted)] mt-1">
            {batchItems.length} item(s) · <span className="font-semibold text-[var(--color-foreground)] tabular-nums">₦{fmt(batchTotal)}</span> total
          </div>
        </div>

        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {batchItems.map((tx) => (
            <div key={tx.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-card)] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold font-mono text-[var(--color-foreground)] truncate tabular-nums">
                  {tx.awb_tag_number || tx.id}
                </div>
                <div className="text-[11px] font-sans text-[var(--color-muted)] truncate mt-0.5">
                  {tx.detail.split(" · ")[3] || ""} · {tx.pieces || 1} pcs · {tx.kg || 0} kg
                </div>
              </div>
              <div className="text-[13px] font-sans font-semibold text-[var(--color-foreground)] shrink-0 tabular-nums">
                ₦{fmt(tx.amount)}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between text-[12px] font-sans text-[var(--color-muted)] px-1">
          <span>
            {printRange
              ? `Printing items ${printRange.from}–${printRange.to} (${printRange.to - printRange.from + 1} of ${batchItems.length})`
              : `Printing all ${batchItems.length} item(s)`}
          </span>
          <button
            type="button"
            onClick={() => setShowRangeModal(true)}
            className="font-medium text-[var(--color-foreground)] underline cursor-pointer"
          >
            Change range
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handlePrintAllBatch('pos80')}
            disabled={batchPrinting}
            className="w-full min-h-[44px] h-11 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-xl border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Receipt size={14} className="shrink-0 text-[var(--color-muted)]" />
            <span>80mm receipt</span>
          </button>
          <button
            type="button"
            onClick={() => handlePrintAllBatch('tag-pdf')}
            disabled={batchPrinting}
            className="w-full min-h-[44px] h-11 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)] text-[12px] font-sans font-medium rounded-xl border border-[var(--color-border)] transition-colors cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
            title="Print USB tag label (100×80mm)"
          >
            <Tag size={14} className="shrink-0 text-[var(--color-muted)]" />
            <span>USB tag print</span>
          </button>
        </div>

        {batchPrinting && (
          <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-muted)] justify-center py-1">
            <Loader2 size={14} className="animate-spin text-[var(--color-muted)]" />
            <span>{batchPrintProgress}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => { setShowBatchSummary(false); handleReset(); }}
          className="w-full min-h-[44px] h-11 bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[13px] font-sans font-semibold rounded-full transition-colors cursor-pointer shadow-xs mt-2"
        >
          Start new customer
        </button>

        {showRangeModal && (
          <PrintRangeModal
            totalCount={batchItems.length}
            itemLabel="items"
            initialFrom={printRange?.from}
            initialTo={printRange?.to}
            onConfirm={(range) => {
              setPrintRange(range.from === 1 && range.to === batchItems.length ? null : range);
              setShowRangeModal(false);
            }}
            onCancel={() => setShowRangeModal(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      ref={formRootRef}
      className="pb-24"
      style={{ width: "100%", boxSizing: "border-box" }}
    >
      {/* UNIFIED QUIET HEADER TOOLBAR */}
      <div className="px-4 pt-3 pb-3 border-b border-[var(--color-border)] mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 shrink">
            <h1 className="text-[20px] font-sans font-semibold tracking-tight text-[var(--color-foreground)] leading-tight">
              Air cargo
            </h1>
            <p className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5 truncate max-w-xs md:max-w-md">
              Log shipments, track air waybills, and manage dispatches
            </p>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap shrink-0">
            {isAdmin && (
              <label className="flex items-center gap-1.5 px-3 min-h-[44px] h-11 bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-full shrink-0 cursor-pointer transition-colors">
                <span className="text-[11px] font-sans text-[var(--color-muted)] select-none">Hub</span>
                <select
                  value={adminSelectedHubId || user.hub_id}
                  onChange={(e) => setAdminSelectedHubId(e.target.value)}
                  className="bg-transparent text-[var(--color-foreground)] font-sans font-medium text-[12px] focus:outline-none cursor-pointer max-w-[125px] truncate h-full"
                >
                  {hubList.map(h => <option key={h.id} value={h.id}>{h.code}/{h.name}</option>)}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={() => setShowSalesAnalysis(true)}
              className="flex items-center gap-1.5 min-h-[44px] h-11 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-full text-[13px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer shrink-0"
            >
              <BarChart2 size={15} className="text-[var(--color-muted)]" />
              <span>Sales analysis</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCloseModal(true)}
              className="flex items-center gap-1.5 min-h-[44px] h-11 px-3 bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-full text-[13px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer shrink-0"
            >
              <Lock size={15} className="text-[var(--color-muted)]" />
              <span>Close period</span>
            </button>
          </div>
        </div>

        {/* PORTAL SWITCHER: CALM SEGMENTED CONTROL */}
        <div className="mt-3 flex justify-center">
          <div className="inline-flex p-1 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] w-full max-w-md min-h-[50px] items-center">
            <button
              type="button"
              onClick={() => setActivePortal("retail")}
              className={`flex-1 flex items-center justify-center gap-2 min-h-[44px] h-11 text-[13px] font-sans font-medium rounded-full transition-all cursor-pointer ${
                activePortal === "retail"
                  ? "bg-[var(--color-surface-1)] text-[var(--color-foreground)] shadow-xs"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Package size={15} />
              <span>Retail cargo</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePortal("corporate")}
              className={`flex-1 flex items-center justify-center gap-2 min-h-[44px] h-11 text-[13px] font-sans font-medium rounded-full transition-all cursor-pointer relative ${
                activePortal === "corporate"
                  ? "bg-[var(--color-surface-1)] text-[var(--color-foreground)] shadow-xs"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Users size={15} />
              <span>Office work (B2B)</span>
              {pendingIntakes.length > 0 && (
                <span className="ml-1 bg-[var(--color-error)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingIntakes.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* RETAIL CARGO LAYOUT */}
      {activePortal === "retail" && (
        <div className={`p-4 grid items-start ${isCompact ? 'gap-3.5 md:grid-cols-[1fr_250px]' : 'gap-4 sm:gap-5 md:grid-cols-[1fr_260px] lg:grid-cols-[1fr_280px]'}`}>
          <div>
            {batchItems.length > 0 && (
              <div className="mb-4 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-[12px] font-sans text-[var(--color-foreground)]">
                  <Layers size={15} className="text-[var(--color-muted)] shrink-0" />
                  <span>
                    Batch for <strong className="font-semibold">{batchItems[0]?.name}</strong>: {batchItems.length} item(s) · <span className="tabular-nums font-semibold">₦{fmt(batchItems.reduce((s, t) => s + t.amount, 0))}</span> logged so far
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => { setPrintRange(null); setShowBatchSummary(true); }}
                  className="min-h-[36px] px-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[12px] font-sans font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer"
                >
                  Finish &amp; print batch
                </button>
              </div>
            )}

            <div className={spaceYClass}>
              {/* GROUP 1: CONSIGNMENT & ROUTING */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5 flex items-center justify-between">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Consignment &amp; routing
                  </h3>
                  {onShowHistory && (
                    <button
                      type="button"
                      onClick={onShowHistory}
                      className="flex items-center gap-1.5 min-h-[36px] px-3 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-full text-[12px] font-sans font-medium text-[var(--color-foreground)] transition-colors cursor-pointer"
                    >
                      <ClipboardList size={14} className="text-[var(--color-muted)]" />
                      <span>History</span>
                    </button>
                  )}
                </div>

                <div>
                  {renderLabel(UserIcon, "Consignee")}
                  <div className="flex flex-col space-y-2">
                    <input
                      id="retail-consignee"
                      name="consignee"
                      list="consignee-datalist"
                      placeholder="Type or select consignee name"
                      value={consignee}
                      onChange={(e) => setConsignee(e.target.value)}
                      className={formInputClass}
                    />
                    <datalist id="consignee-datalist">
                      {consigneeOptions.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    {consignee === "Other" && (
                      <input
                        id="retail-custom-consignee"
                        name="custom-consignee"
                        placeholder="Enter consignee name"
                        value={customConsignee}
                        onChange={upperOnChange(setCustomConsignee)}
                        className={formInputClass}
                      />
                    )}
                    {actualConsignee.trim().length > 0 && actualConsignee.trim().length < 3 && (
                      <p className="text-[11px] font-sans text-[var(--color-warning)]">
                        Consignee name must be at least 3 characters.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    {renderLabel(Phone, "Sender phone (optional)")}
                    <input
                      id="retail-sender-phone"
                      name="sender-phone"
                      type="tel"
                      placeholder="e.g. +234, +44, +1"
                      value={senderPhone}
                      onChange={(e) => setSenderPhone(e.target.value)}
                      className={formInputClass}
                    />
                  </div>
                  <div>
                    {renderLabel(Phone, "Consignee phone (optional)")}
                    <input
                      id="retail-consignee-phone"
                      name="consignee-phone"
                      type="tel"
                      placeholder="e.g. +234, +44, +1"
                      value={consigneePhone}
                      onChange={(e) => setConsigneePhone(e.target.value)}
                      className={formInputClass}
                    />
                  </div>
                </div>

                {/* Active Customer Wallet Banner */}
                {activeWallet && (
                  <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Coins size={16} className="text-[var(--color-success)] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">
                          Wallet balance available
                        </div>
                        <div className="text-[11px] font-sans text-[var(--color-muted)] truncate">
                          {activeWallet.customer_name} has <span className="font-semibold text-[var(--color-success)] tabular-nums">₦{fmt(activeWallet.balance)}</span> credit
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMode("Wallet")}
                      className={`min-h-[36px] px-3 rounded-full text-[12px] font-sans font-medium transition-colors cursor-pointer shrink-0 ${
                        mode === "Wallet"
                          ? "bg-white text-black dark:bg-white dark:text-black font-semibold shadow-xs"
                          : "border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-3)]"
                      }`}
                    >
                      {mode === "Wallet" ? "Using wallet" : "Use wallet"}
                    </button>
                  </div>
                )}

                {/* Office-work detection banner */}
                {detectedOfficeClient && !linkedAsOfficeWork && (
                  <div className="p-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-start gap-3">
                    <AlertTriangle size={16} className="text-[var(--color-muted)] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 text-[12px] font-sans">
                      <div className="font-medium text-[var(--color-foreground)]">
                        {officeMatch.type === 'exact' ? 'Registered client match' : 'Office work client detected'}
                      </div>
                      <div className="text-[11px] text-[var(--color-muted)] mt-0.5">
                        <span className="font-medium text-[var(--color-foreground)]">{detectedOfficeClient.company_name}</span> is a registered corporate account.
                        {officeWorkRate
                          ? ` Contract rate for ${route}: ₦${officeWorkRate.rate_per_kg}/kg`
                          : ' No contract rate configured for this route — amount stays manual.'}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setLinkedAsOfficeWork(true);
                            wasLinkedRef.current = true;
                            if (officeWorkRate && kg) {
                              const w = parseFloat(kg) || 0;
                              if (w > 0) {
                                const computed = Math.max(
                                  w * officeWorkRate.rate_per_kg,
                                  officeWorkRate.minimum_amount ?? 0
                                );
                                setAmount(String(computed));
                              }
                            }
                          }}
                          className="min-h-[36px] px-3 rounded-full bg-white text-black dark:bg-white dark:text-black font-sans font-medium text-[12px] shadow-xs cursor-pointer"
                        >
                          Link as office work
                        </button>
                        <button
                          type="button"
                          onClick={() => setLinkedAsOfficeWork(false)}
                          className="min-h-[36px] px-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] font-sans text-[12px] cursor-pointer"
                        >
                          Keep as retail
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {linkedAsOfficeWork && detectedOfficeClient && (
                  <div className="p-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] flex items-center gap-2">
                    <span className="text-[10px] font-semibold font-sans px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-foreground)]">
                      Office work
                    </span>
                    <span className="text-[12px] font-sans text-[var(--color-foreground)] flex-1 truncate">{detectedOfficeClient.company_name}</span>
                    <button type="button" onClick={() => { setLinkedAsOfficeWork(false); setAmount(''); wasLinkedRef.current = false; }} className="text-[11px] font-sans text-[var(--color-muted)] hover:text-[var(--color-error)] cursor-pointer">
                      Unlink
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    {renderLabel(Plane, "Airline")}
                    <select
                      value={airline}
                      onChange={(e) => { setAirline(e.target.value); setAmount(""); }}
                      className={formInputClass}
                    >
                      {availableAirlines.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    {airline === "Other" && (
                      <input
                        id="retail-custom-airline"
                        name="custom-airline"
                        placeholder="Enter airline name"
                        value={customAirline}
                        onChange={upperOnChange(setCustomAirline)}
                        className={`${formInputClass} mt-2`}
                      />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      {renderLabel(Radar, "Flight number (optional)")}
                      {flightAutoFilled && (
                        <span className="text-[10px] font-sans font-medium text-[var(--color-muted)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] mb-1.5">
                          Auto-filled
                        </span>
                      )}
                    </div>
                    <input
                      id="retail-flight-number"
                      name="flight-number"
                      type="text"
                      placeholder="e.g. W3 331"
                      value={flightNumber}
                      onChange={(e) => { setFlightNumber(e.target.value.toUpperCase()); setFlightAutoFilled(false); }}
                      className={formInputClass}
                    />
                  </div>

                  <div>
                    {renderLabel(Plane, "Airline AWB (optional)")}
                    <input
                      id="retail-airline-awb"
                      name="airline-awb"
                      type="text"
                      placeholder="e.g. 072-12345678"
                      maxLength={12}
                      value={airlineAwb}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^0-9-]/g, '');
                        setAirlineAwb(val);
                        if (val && !isValidAirlineAwb(val)) {
                          setAirlineAwbError('11 digits (e.g. 072-12345678)');
                        } else {
                          setAirlineAwbError(null);
                        }
                      }}
                      className={formInputClass}
                    />
                    {airlineAwbError && (
                      <div className="text-[11px] font-sans text-[var(--color-error)] mt-1">{airlineAwbError}</div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    {renderLabel(MapPin, "Route")}
                    <select
                      value={route}
                      onChange={(e) => { setRoute(e.target.value); setAmount(""); }}
                      className={formInputClass}
                    >
                      <option value="" disabled>-- Select route --</option>
                      {routes.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Hash, "AWB / tag number (auto-generated)")}
                    <input
                      id="retail-awb"
                      name="awb"
                      type="text"
                      value={awb || "Loading…"}
                      readOnly
                      className={`${formInputClass} font-mono font-medium tabular-nums bg-[var(--color-surface-2)] text-[var(--color-foreground)] select-all cursor-default`}
                    />
                  </div>
                </div>
              </div>

              {/* GROUP 2: SHIPMENT WEIGHT & CONTENT */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Shipment weight &amp; content
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    {renderLabel(Package, "Pieces")}
                    <input
                      id="retail-pcs"
                      name="pcs"
                      type="number"
                      min="1"
                      value={pcs}
                      onChange={(e) => setPcs(e.target.value)}
                      className={formInputClass}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      {renderLabel(Scale, "Weight (kg)")}
                      <button
                        type="button"
                        onClick={() => setShowDims(!showDims)}
                        className="min-h-[36px] px-3 py-1 text-[11px] font-sans font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-full transition-colors cursor-pointer flex items-center gap-1 mb-1.5"
                      >
                        {showDims ? "Hide dimensions" : "+ Dimensions (cm)"}
                      </button>
                    </div>
                    <input
                      id="retail-kg"
                      name="kg"
                      type="number"
                      step="1"
                      min="1"
                      value={kg}
                      onChange={(e) => {
                        const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                        setKg(cleanVal);
                        setAmount(""); // reset manual override so autoAmount takes over
                      }}
                      className={formInputClass}
                    />
                  </div>
                </div>

                {showDims && (
                  <div className="p-3.5 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-sans font-medium text-[var(--color-foreground)]">Dimensions (L × W × H in cm)</span>
                      <span className="text-[11px] font-sans text-[var(--color-muted)]">IATA Volumetric (/6000)</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        placeholder="L (cm)"
                        value={lengthCm}
                        onChange={(e) => setLengthCm(e.target.value)}
                        className={formInputClass}
                      />
                      <input
                        type="number"
                        placeholder="W (cm)"
                        value={widthCm}
                        onChange={(e) => setWidthCm(e.target.value)}
                        className={formInputClass}
                      />
                      <input
                        type="number"
                        placeholder="H (cm)"
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        className={formInputClass}
                      />
                    </div>
                    {volumetricWeight > 0 && (
                      <div className="text-[11px] font-sans text-[var(--color-muted)] flex items-center justify-between pt-1 border-t border-[var(--color-border)]">
                        <span>Volumetric weight: <strong className="tabular-nums text-[var(--color-foreground)]">{volumetricWeight} kg</strong></span>
                        <span>Chargeable: <strong className="tabular-nums text-[var(--color-foreground)]">{effectiveKg} kg</strong></span>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  {renderLabel(Layers, "Content type")}
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className={formInputClass}
                  >
                    <option value="" disabled>-- Select content --</option>
                    {contentTypes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {contentType === "Other" && (
                    <input
                      id="retail-custom-content"
                      name="custom-content"
                      placeholder="Enter content type"
                      value={customContentType}
                      onChange={upperOnChange(setCustomContentType)}
                      className={`${formInputClass} mt-2`}
                    />
                  )}
                </div>

                {isSizeTierContent && (
                  <div>
                    {renderLabel(Ruler, "Screen size (inches)")}
                    <input
                      id="retail-size-inches"
                      name="size-inches"
                      type="number"
                      step="1"
                      min="1"
                      value={sizeInches}
                      onChange={(e) => {
                        const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                        setSizeInches(cleanVal);
                        setAmount(""); // reset manual override so autoAmount takes over
                      }}
                      className={formInputClass}
                    />
                  </div>
                )}
              </div>

              {/* GROUP 3: PAYMENT DETAILS */}
              <div className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] ${cardPadClass}`}>
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Payment details
                  </h3>
                </div>

                <div>
                  {renderLabel(Banknote, "Amount")}
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-sans font-medium text-[16px]">
                      ₦
                    </span>
                    <input
                      id="retail-amount"
                      name="amount"
                      type="number"
                      min="0"
                      value={effectiveAmount}
                      onChange={(e) => setAmount(e.target.value)}
                      onBlur={() => {
                        if (!(priceOverrideInfo?.type === 'size' || priceOverrideInfo?.type === 'flat' || (linkedAsOfficeWork && officeWorkRate)) && parsedAmount < minAmount) {
                          setAmount(minAmount.toString());
                        }
                      }}
                      className={`${formInputClass} pl-9 font-sans tabular-nums text-[16px] font-semibold ${!(linkedAsOfficeWork && officeWorkRate) && parsedAmount < minAmount ? 'border-[var(--color-error)]' : ''}`}
                    />
                  </div>
                  {rate == null && minCharge == null && !priceOverrideInfo ? (
                    <div className="text-[11px] font-sans text-[var(--color-warning)] mt-1">No rate configured for this hub/airline/route — enter amount manually</div>
                  ) : (
                    !(linkedAsOfficeWork && officeWorkRate) && parsedAmount > 0 && parsedAmount < minAmount && (
                      <div className="text-[11px] font-sans text-[var(--color-error)] mt-1">Amount cannot be less than ₦{minAmount.toLocaleString()}</div>
                    )
                  )}
                  {priceOverrideInfo && (
                    <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1">
                      {priceOverrideInfo.type === 'size'
                        ? `Size tier rate applied: ₦${fmt(priceOverrideInfo.amount)} (whole bracket, by screen size)`
                        : priceOverrideInfo.type === 'flat'
                        ? `Flat rate applied: ₦${fmt(priceOverrideInfo.amount)} (whole bracket, not per-kg)`
                        : priceOverrideInfo.type === 'special'
                        ? `Special goods rate applied: ₦${fmt(priceOverrideInfo.rate)}/kg`
                        : `Minimum charge applied: ₦${fmt(priceOverrideInfo.amount)}`}
                    </div>
                  )}
                  {volumetricWeight > (parseFloat(kg) || 0) && (
                    <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1">
                      Billed at volumetric weight: <span className="tabular-nums font-medium text-[var(--color-foreground)]">{effectiveKg} kg</span> (actual {parseFloat(kg) || 0} kg)
                    </div>
                  )}
                </div>

                <div>
                  {renderLabel(CreditCard, "Payment mode")}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-[var(--color-surface-2)] rounded-xl border border-[var(--color-border)] mb-3">
                    {(isOnline ? ["Cash", "Transfer", "POS", "Wallet"] : ["Cash", "Transfer", "POS"]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m as any)}
                        className={`min-h-[44px] h-11 text-[13px] font-sans font-medium rounded-lg transition-all focus:outline-none cursor-pointer flex items-center justify-center gap-1.5 ${
                          mode === m
                            ? "bg-[var(--color-surface-1)] text-[var(--color-foreground)] font-semibold shadow-xs border border-[var(--color-border-strong)]"
                            : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                        }`}
                      >
                        {m === "Wallet" ? "Wallet" : m}
                      </button>
                    ))}
                  </div>
                  {!isOnline && (
                    <div className="text-[11px] font-sans text-[var(--color-muted)] mb-3">
                      Wallet payments need a connection — use Cash, Transfer, or POS while offline.
                    </div>
                  )}

                  {mode === "Wallet" && (
                    <div className="mb-3 space-y-2">
                      <CustomerWalletPicker
                        wallets={customerWallets}
                        selectedWallet={activeWallet}
                        onSelectWallet={(w) => setSelectedWalletOverride(w)}
                        currentCustomerName={consignee === 'Other' ? customConsignee : consignee}
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

                  <div className="flex items-center justify-center gap-3 my-3">
                    <div className="flex-1 h-px bg-[var(--color-border)]" />
                    <div className="text-[11px] font-sans text-[var(--color-muted)]">
                      or
                    </div>
                    <div className="flex-1 h-px bg-[var(--color-border)]" />
                  </div>

                  <button
                    type="button"
                    onClick={() => setMode("Debt")}
                    className={`w-full min-h-[44px] h-11 text-[13px] font-sans font-medium rounded-xl border transition-colors cursor-pointer focus:outline-none ${
                      mode === "Debt"
                        ? "bg-[var(--color-surface-2)] border-[var(--color-error)] text-[var(--color-error)] font-semibold"
                        : "bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-error)]"
                    }`}
                  >
                    Log as credit sale (debt)
                  </button>

                  {mode === "Debt" && (
                    <div className="mt-2 text-[12px] font-sans text-[var(--color-error)] bg-[var(--color-surface-2)] p-3 rounded-xl border border-[var(--color-border)]">
                      This sale will be logged as credit. Collect payment before dispatch or arrange with management.
                    </div>
                  )}
                </div>

                {mode === "Transfer" && (
                  <div>
                    {renderLabel(Landmark, "Bank")}
                    <select
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                      className={formInputClass}
                    >
                      {banks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <PaymentNarrationBox narrationCode={narrationCode} />
                  </div>
                )}

                {mode === "POS" && (
                  <div>
                    {renderLabel(CreditCard, "POS terminal / bank")}
                    <select
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                      className={formInputClass}
                    >
                      {banks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  {renderLabel(MessageSquare, "Remark (optional)")}
                  <input
                    id="retail-remark"
                    name="remark"
                    placeholder="Add notes…"
                    value={remark}
                    onChange={upperOnChange(setRemark)}
                    className={formInputClass}
                  />
                </div>
              </div>

              {/* PRIMARY ACTION BUTTON */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowRetailReview(true)}
                  disabled={!isRetailFormValid || submitting}
                  className="w-full min-h-[48px] h-12 rounded-full font-sans font-semibold text-[15px] flex items-center justify-center gap-2 transition-colors cursor-pointer bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  <span>{submitting ? "Logging shipment…" : "Log cargo entry"}</span>
                </button>
                {showRetailReview && (
                  <ReviewEntryModal
                    title="Review cargo entry"
                    details={[
                      { label: 'Consignee', value: actualConsignee },
                      { label: 'Route', value: route },
                      { label: 'Content', value: actualContentType },
                      { label: 'Weight', value: `${effectiveKg} KG${volumetricWeight > (parseFloat(kg) || 0) ? ' (Volumetric)' : ''}` },
                      { label: 'Amount', value: parsedAmount },
                      { label: 'Payment mode', value: mode },
                    ]}
                    onConfirm={() => { handleRetailSubmit(); }}
                    onCancel={() => setShowRetailReview(false)}
                    confirmText="Confirm & log entry"
                    isSubmitting={submitting}
                  />
                )}
              </div>
            </div>
          </div>

          {/* DESKTOP ASIDE SUMMARY CARD */}
          <aside className="ehi-desktop-only">
            <div className={`sticky top-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-card)] shadow-xs ${isCompact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2.5">
                <span className="text-[12px] font-sans font-semibold text-[var(--color-foreground)]">
                  Entry summary
                </span>
                <span className="text-[11px] font-sans text-[var(--color-muted)] tabular-nums">
                  #{serialNumber}
                </span>
              </div>

              <div className="space-y-2 text-[13px] font-sans">
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[var(--color-muted)] text-[12px]">Consignee</span>
                  <span className="truncate max-w-[140px] font-medium text-[var(--color-foreground)] text-right">
                    {actualConsignee || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[var(--color-muted)] text-[12px]">AWB tag</span>
                  <span className="font-medium text-[var(--color-foreground)] tabular-nums text-right">
                    {awb || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[var(--color-muted)] text-[12px]">Route</span>
                  <span className="font-medium text-[var(--color-foreground)] text-right">
                    {route || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[var(--color-muted)] text-[12px]">Content</span>
                  <span className="font-medium text-[var(--color-foreground)] text-right">
                    {actualContentType || "—"}
                  </span>
                </div>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[var(--color-muted)] text-[12px]">Pieces / weight</span>
                  <span className="font-medium text-[var(--color-foreground)] tabular-nums text-right">
                    {pcs || "—"} pcs · {kg ? `${kg} kg` : "—"}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--color-border)]">
                <div className="text-[11px] font-sans text-[var(--color-muted)] mb-1">
                  Total amount
                </div>
                <div className="text-[26px] font-sans font-bold text-[var(--color-foreground)] tabular-nums tracking-tight">
                  {parsedAmount > 0 ? "₦" + parsedAmount.toLocaleString("en-NG") : "₦0"}
                </div>
                <div className="text-[12px] font-sans text-[var(--color-muted)] mt-1 flex items-center gap-1.5">
                  <span>{mode}</span>
                  {mode === "Transfer" && bank && <span>· {bank}</span>}
                </div>
              </div>

              <div className="pt-2 text-[11px] font-sans text-[var(--color-muted)] flex justify-between border-t border-[var(--color-border)]">
                <span>Date</span>
                <span>{new Date().toLocaleDateString("en-NG")}</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* CORPORATE SYSTEM PORTAL */}
      {activePortal === "corporate" && (
        <div className="space-y-6 p-4">
          {/* CORPORATE SUBTABS ROUTING */}
          <div className="flex border-b border-[var(--color-border)] gap-2 pb-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setCorpSubTab("intake")}
              className={`min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium transition-all cursor-pointer flex items-center gap-2 ${
                corpSubTab === "intake"
                  ? "bg-[var(--color-surface-2)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <ClipboardList size={15} />
              <span>Phase 1: Field intake book</span>
            </button>
            <button
              type="button"
              onClick={() => setCorpSubTab("weighing")}
              className={`min-h-[44px] h-11 px-4 rounded-full text-[13px] font-sans font-medium transition-all cursor-pointer flex items-center gap-2 relative ${
                corpSubTab === "weighing"
                  ? "bg-[var(--color-surface-2)] text-[var(--color-foreground)] font-semibold border border-[var(--color-border-strong)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              }`}
            >
              <Scale size={15} />
              <span>Phase 2: Yard gate weigh scale</span>
              {pendingIntakes.length > 0 && (
                <span className="bg-[var(--color-error)] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingIntakes.length}
                </span>
              )}
            </button>
          </div>

          {/* DYNAMIC SUBTABS VIEW */}
          {corpSubTab === "intake" && (
            <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
              {/* PHASE 1 INPUT FORM */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-5 rounded-2xl space-y-4">
                <div className="border-b border-[var(--color-border)] pb-2.5">
                  <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                    Log office work pick-up (no pricing)
                  </h3>
                </div>

                {successMessage && (
                  <div className="p-3 text-[12px] font-sans font-medium text-[var(--color-success)] bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-xl flex items-center gap-2">
                    <CheckCircle size={15} />
                    <span>{successMessage}</span>
                  </div>
                )}

                <div className="space-y-3.5">
                  <div>
                    {renderLabel(UserIcon, "Office work client")}
                    <select
                      id="intake-consignee"
                      name="intake-consignee"
                      value={intakeConsignee}
                      onChange={(e) => setIntakeConsignee(e.target.value)}
                      className={formInputClass}
                    >
                      {corpClients.map((c) => (
                        <option key={c.id} value={c.company_name}>
                          {c.company_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Phone, "Client phone (optional)")}
                    <input
                      type="tel"
                      placeholder="e.g. +234, +44, +1"
                      value={intakeSenderPhone}
                      onChange={(e) => setIntakeSenderPhone(e.target.value)}
                      className={formInputClass}
                    />
                  </div>

                  <div>
                    {renderLabel(Plane, "Carrier airline")}
                    <select
                      value={intakeAirline}
                      onChange={(e) => setIntakeAirline(e.target.value)}
                      className={formInputClass}
                    >
                      {availableAirlines.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    {renderLabel(Hash, "AWB tag / waybill number (auto-generated)")}
                    <input
                      type="text"
                      value={intakeAwb}
                      readOnly
                      className={`${formInputClass} font-mono font-medium tabular-nums bg-[var(--color-surface-2)] text-[var(--color-foreground)] select-all cursor-default`}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      {renderLabel(Package, "Pieces (boxes/parcels)")}
                      <input
                        type="number"
                        min="1"
                        value={intakePcs}
                        onChange={(e) => setIntakePcs(e.target.value)}
                        className={formInputClass}
                      />
                    </div>
                    <div>
                      {renderLabel(MapPin, "Destination route")}
                      <select
                        value={intakeRoute}
                        onChange={(e) => setIntakeRoute(e.target.value)}
                        className={formInputClass}
                      >
                        <option value="" disabled>-- Select route --</option>
                        {routes.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    {renderLabel(Layers, "Cargo content type")}
                    <select
                      value={intakeContentType}
                      onChange={(e) => setIntakeContentType(e.target.value)}
                      className={formInputClass}
                    >
                      <option value="" disabled>-- Select content --</option>
                      {contentTypes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] p-3.5 rounded-xl text-[12px] font-sans text-[var(--color-muted)] space-y-1">
                    <p className="font-semibold text-[var(--color-foreground)] flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-[var(--color-muted)]" />
                      Weighing and billing rule
                    </p>
                    <p>
                      No pricing or weights are registered during field intake. Definitive weights and billing calculations are finalized at the yard gate weigh scale.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleLogFieldIntake}
                    className="w-full min-h-[48px] h-12 mt-2 cursor-pointer bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 font-sans font-semibold text-[14px] rounded-full flex items-center justify-center gap-2 shadow-xs transition-colors"
                  >
                    <Rocket size={16} />
                    <span>Log intake for weighing</span>
                  </button>
                </div>
              </div>

              {/* LIST OF PENDING INTAKES */}
              <div className="space-y-4">
                <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-5 rounded-2xl">
                  <div className="border-b border-[var(--color-border)] pb-2.5 mb-3 flex items-center justify-between">
                    <h4 className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
                      Pending pick-up intakes
                    </h4>
                    <span className="text-[11px] font-sans text-[var(--color-muted)] tabular-nums">
                      {pendingIntakes.length} pending
                    </span>
                  </div>

                  {pendingIntakes.length === 0 ? (
                    <div className="text-center py-10 text-[var(--color-muted)] text-[12px] font-sans">
                      No pending field intakes currently recorded. Use the intake form on the left.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--color-border)] max-h-[380px] overflow-y-auto pr-1">
                      {pendingIntakes.map((pi) => (
                        <div
                          key={pi.id}
                          className="py-3 flex items-center justify-between text-[12px] font-sans gap-3"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[var(--color-foreground)] flex items-center gap-1.5 truncate">
                              <Building size={14} className="text-[var(--color-muted)] shrink-0" />
                              <span className="truncate">{pi.consignee}</span>
                              <span className="font-mono text-[10px] text-[var(--color-muted)] shrink-0">
                                ({pi.id})
                              </span>
                            </div>
                            <div className="text-[var(--color-muted)] text-[11px] mt-0.5 truncate">
                              {pi.airline} · <span className="tabular-nums font-mono">{pi.awb}</span> · {pi.pieces} pcs · {pi.route}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] font-sans text-[var(--color-muted)] tabular-nums">
                              {pi.time}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePendingIntake(pi);
                              }}
                              className="min-h-[44px] min-w-[44px] w-11 h-11 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors rounded-full cursor-pointer"
                              title="Delete pending intake"
                              aria-label="Delete pending intake"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] font-sans text-[var(--color-muted)] leading-relaxed">
                  Every pickup record entered here is saved to the centralized database and visible to any staff member at this hub. Scale weighing operates in strict sequence at the gate yard scale.
                </div>
              </div>
            </div>
          )}

          {/* PHASE 2 SUBTAB: YARD GATE WEIGH SCALE */}
          {corpSubTab === "weighing" && (
            <div className="grid gap-6 md:grid-cols-[1.5fr_1fr] max-w-6xl mx-auto">
              {/* QUEUE */}
              <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-5 rounded-2xl">
                <div className="flex items-center justify-between mb-4 pb-2.5 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Scale size={16} className="text-[var(--color-muted)]" />
                    <h3 className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                      Gate yard scale queue
                    </h3>
                  </div>
                  <span className="text-[11px] font-sans text-[var(--color-muted)]">
                    Active scales ready
                  </span>
                </div>

                {pendingIntakes.length === 0 ? (
                  <div className="text-center py-20 text-[var(--color-muted)] text-[13px] font-sans">
                    <p className="font-semibold text-[var(--color-foreground)] mb-1">
                      Scale yard queue empty
                    </p>
                    <p className="max-w-md mx-auto text-[11px]">
                      All office work shipments have been weighed and routed. Check Phase 1 Logbook or the main Ledger.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {pendingIntakes.map((pi) => {
                      const isSelected = selectedIntake?.id === pi.id;

                      const matchingC = corpClients.find(
                        (c) => c.id === pi.corporate_client_id,
                      );
                      const clientRate = matchingC
                        ? corpRates.find(
                            (r) =>
                              r.corporate_client_id === matchingC.id &&
                              r.route_name === pi.route,
                          )
                        : null;
                      const finalRate = clientRate ? clientRate.rate_per_kg : null;

                      return (
                        <div
                          key={pi.id}
                          onClick={() => {
                            setSelectedIntake(pi);
                            setGateWeight("");
                            setCustomRateOverwrite("");
                          }}
                          className={`p-3.5 rounded-xl border text-[13px] font-sans transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-[var(--color-surface-2)] border-[var(--color-foreground)] shadow-xs"
                              : "bg-[var(--color-surface-1)] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 truncate">
                              <span className="font-semibold text-[var(--color-foreground)] flex items-center gap-1.5 truncate">
                                <Building size={15} className="text-[var(--color-muted)] shrink-0" />
                                <span className="truncate">{pi.consignee}</span>
                              </span>
                              <span className="text-[10px] font-mono text-[var(--color-muted)] px-1.5 py-0.5 bg-[var(--color-surface-3)] rounded shrink-0">
                                {pi.id}
                              </span>
                            </div>
                            <div className="text-[11px] text-[var(--color-muted)] space-x-1.5 truncate">
                              <span>Waybill: <strong className="font-mono text-[var(--color-foreground)]">{pi.awb}</strong></span>
                              <span>·</span>
                              <span>Route: <strong className="text-[var(--color-foreground)]">{pi.route}</strong></span>
                              <span>·</span>
                              <span>Pcs: <strong>{pi.pieces}</strong></span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right text-[11px] font-sans">
                              <div className="text-[var(--color-muted)]">Rate</div>
                              <div className={finalRate != null ? "font-semibold text-[var(--color-foreground)] tabular-nums" : "font-semibold text-[var(--color-error)]"}>
                                {finalRate != null ? `₦${finalRate}/kg` : "No rate on file"}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePendingIntake(pi);
                                }}
                                className="min-h-[44px] min-w-[44px] w-11 h-11 flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors rounded-full cursor-pointer"
                                title="Delete pending intake"
                                aria-label="Delete pending intake"
                              >
                                <Trash2 size={15} />
                              </button>
                              <ArrowRight
                                size={15}
                                className={isSelected ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)]"}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CONSOLE */}
              <div className="space-y-4">
                {selectedIntake ? (
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-5 sm:p-6 rounded-2xl text-[var(--color-foreground)] space-y-5">
                    <div className="border-b border-[var(--color-border)] pb-2.5">
                      <div className="text-[14px] font-sans font-semibold text-[var(--color-foreground)]">
                        Scale weighing console
                      </div>
                    </div>

                    <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] space-y-2 text-[12px] font-sans">
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)]">Arrived client</span>
                        <span className="font-semibold text-[var(--color-foreground)]">{selectedIntake.consignee}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)]">Route</span>
                        <span className="font-semibold text-[var(--color-foreground)]">{selectedIntake.route}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-[var(--color-border)]">
                        <span className="text-[var(--color-muted)]">Carrier waybill</span>
                        <span className="font-mono font-semibold text-[var(--color-foreground)]">{selectedIntake.awb}</span>
                      </div>
                      <div className="flex justify-between items-center py-1">
                        <span className="text-[var(--color-muted)]">Total containers</span>
                        <span className="font-semibold text-[var(--color-foreground)]">{selectedIntake.pieces} pieces</span>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="cargo-gate-weight" className="text-[12px] font-sans font-medium text-[var(--color-muted)] block mb-1.5">
                        Commercial scale verified weight (KG)
                      </label>
                      <div className="relative">
                        <input
                          id="cargo-gate-weight"
                          type="number"
                          step="1"
                          min="1"
                          placeholder="Scale reading"
                          value={gateWeight}
                          onChange={(e) => {
                            const cleanVal = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                            setGateWeight(cleanVal);
                          }}
                          className="w-full min-h-[48px] h-12 pl-4 pr-12 text-[18px] font-bold text-[var(--color-foreground)] rounded-xl bg-[var(--color-surface-1)] border border-[var(--color-border)] font-sans tabular-nums focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)] font-medium text-[12px] font-sans">
                          KG
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3 font-sans">
                      <div className="bg-[var(--color-surface-2)] p-4 rounded-xl border border-[var(--color-border)] space-y-2.5 text-[12px]">
                        <div className="flex justify-between items-center">
                          <span className="text-[var(--color-muted)]">Negotiated rate</span>
                          <span className="font-semibold text-[var(--color-foreground)] tabular-nums">
                            {contractRateForSelectedIntake
                              ? `₦${contractRateForSelectedIntake.rate_per_kg}/kg`
                              : "None on file"}
                          </span>
                        </div>

                        {isAuthorizedRole ? (
                          <div className="pt-2 border-t border-[var(--color-border)]">
                            <label htmlFor="cargo-custom-rate-overwrite" className="text-[11px] text-[var(--color-muted)] block mb-1">
                              Admin custom rate override (₦/KG){!contractRateForSelectedIntake ? ' — required, no contract rate' : ''}
                            </label>
                            <input
                              id="cargo-custom-rate-overwrite"
                              type="number"
                              placeholder={contractRateForSelectedIntake ? "Leave empty for contract rate" : "Enter rate (required)"}
                              value={customRateOverwrite}
                              onChange={(e) => setCustomRateOverwrite(e.target.value)}
                              className="w-full min-h-[44px] h-11 px-3 text-[12px] bg-[var(--color-surface-1)] text-[var(--color-foreground)] border border-[var(--color-border)] rounded-xl focus:outline-none focus:border-[var(--color-border-strong)] transition-colors font-sans tabular-nums"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)] pt-1 border-t border-[var(--color-border)]">
                            <ShieldAlert size={13} />
                            <span>Rates locked by accounting rules</span>
                          </div>
                        )}

                        {!contractRateForSelectedIntake && (
                          <div className="text-[11px] text-[var(--color-warning)]">
                            No negotiated rate on file — {isAuthorizedRole ? 'an admin rate override is required to finalize.' : 'ask an admin or accountant to set one.'}
                          </div>
                        )}

                        <div className="pt-2.5 border-t border-[var(--color-border)] flex justify-between items-baseline">
                          <span className="text-[12px] text-[var(--color-muted)]">Computed bill</span>
                          <span className="text-[20px] text-[var(--color-foreground)] font-bold tabular-nums">
                            {(() => {
                              const rate = customRateOverwrite
                                ? parseFloat(customRateOverwrite)
                                : contractRateForSelectedIntake?.rate_per_kg;
                              if (rate == null) return "—";
                              const weight = Math.round(parseFloat(gateWeight)) || 0;
                              let cost = weight * rate;
                              if (!customRateOverwrite && contractRateForSelectedIntake && contractRateForSelectedIntake.minimum_amount) {
                                const minAmount = Number(contractRateForSelectedIntake.minimum_amount);
                                if (minAmount > 0 && cost < minAmount) {
                                  cost = minAmount;
                                }
                              }
                              return `₦${cost.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
                            })()}
                          </span>
                        </div>
                      </div>

                      <div className="text-[11px] text-[var(--color-muted)] bg-[var(--color-surface-2)] p-3 rounded-xl border border-[var(--color-border)] leading-snug flex items-start gap-2">
                        <Zap size={14} className="shrink-0 mt-0.5 text-[var(--color-muted)]" />
                        <span>
                          If debt is selected, the invoice amount will automatically post to the client's monthly balance.
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5 font-sans">
                      <span className="text-[12px] font-medium text-[var(--color-muted)]">Payment mode</span>
                      <select
                        value={corporateMode}
                        onChange={(e) => setCorporateMode(e.target.value)}
                        className={formInputClass}
                      >
                        <option value="Cash">Cash (Paid)</option>
                        <option value="POS">POS (Paid)</option>
                        <option value="Transfer">Bank Transfer (Paid)</option>
                        <option value="Debt">Debt (Add to monthly balance)</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleFinalizeWeighing}
                      disabled={!gateWeight || isWeighingSubmitting || (!contractRateForSelectedIntake && !customRateOverwrite)}
                      className="w-full min-h-[48px] h-12 cursor-pointer bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 font-sans font-semibold text-[14px] rounded-full flex items-center justify-center gap-2 shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isWeighingSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <CheckCircle size={16} />
                          <span>Finalize gate invoice</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="bg-[var(--color-surface-card)] border border-[var(--color-border)] p-12 rounded-2xl text-center text-[var(--color-muted)]">
                    <Scale size={32} className="mx-auto text-[var(--color-muted)] mb-3" />
                    <p className="text-[13px] font-sans font-semibold text-[var(--color-foreground)]">
                      Scale diagnostic standby
                    </p>
                    <p className="text-[11px] font-sans max-w-xs mx-auto mt-1">
                      Select any office work booking from the left queue to verify scale weight.
                    </p>
                  </div>
                )}

                <div className="bg-[var(--color-surface-card)] p-4 rounded-xl border border-[var(--color-border)]">
                  <h5 className="text-[12px] font-sans font-semibold text-[var(--color-foreground)] mb-1 flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-[var(--color-muted)]" />
                    Office work scaling rules
                  </h5>
                  <p className="text-[11px] font-sans text-[var(--color-muted)] leading-relaxed">
                    Weights verified on the gate scale are definitive. Debt payments on corporate accounts bill monthly to keep the yard queue moving smoothly.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CLOSE CARGO PERIOD MODAL */}
      {showCloseModal && createPortal(
        <div className="fixed inset-0 ehi-scrim z-[9999] flex items-center justify-center sm:p-4">
          <div className="bg-[var(--color-surface-1)] border-0 sm:border border-[var(--color-border)] rounded-none sm:rounded-2xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col font-sans">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] bg-[var(--color-surface-card)] shrink-0">
              <div>
                <h3 className="text-[15px] font-sans font-semibold text-[var(--color-foreground)]">Close cargo period</h3>
                <div className="text-[12px] font-sans text-[var(--color-muted)] mt-0.5">Agent: <span className="text-[var(--color-foreground)] font-medium">{user.name}</span> · {user.hub}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                aria-label="Close"
                className="min-h-[44px] min-w-[44px] w-11 h-11 -mr-2 flex items-center justify-center hover:bg-[var(--color-surface-hover)] rounded-full text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-2 border-b border-[var(--color-border)] pb-3">
                <div className="text-[11px] font-sans text-[var(--color-muted)] flex items-center gap-1.5 font-medium">
                  <Calendar size={13} />
                  <span>Closing period</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="datetime-local"
                    value={periodStart}
                    onChange={e => setPeriodStart(e.target.value)}
                    className="min-h-[44px] h-11 px-3 text-[12px] font-sans rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] flex-1 focus:outline-none"
                  />
                  <span className="text-[var(--color-muted)] text-[12px]">to</span>
                  <input
                    type="datetime-local"
                    value={periodEnd}
                    onChange={e => setPeriodEnd(e.target.value)}
                    className="min-h-[44px] h-11 px-3 text-[12px] font-sans rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-foreground)] flex-1 focus:outline-none"
                  />
                </div>
                {lastCloseEnd && (
                  <div className="text-[11px] font-sans text-[var(--color-muted)]">
                    Last close ended: {new Date(lastCloseEnd).toLocaleString('en-GB')}
                  </div>
                )}
                <div className="text-[12px] font-sans text-[var(--color-foreground)] font-medium">
                  {periodStart ? new Date(periodStart).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  {' → '}
                  {periodEnd ? new Date(periodEnd).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
              </div>

              {closeSummaryLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[var(--color-muted)]" /></div>
              ) : (
                <>
                  <div className="space-y-2 text-[13px] font-sans">
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Total sales</span><span className="font-semibold text-[var(--color-foreground)] tabular-nums">{fmt(closeTotalSales)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Cash sales</span><span className="text-[var(--color-foreground)] tabular-nums">{fmt(closeCashSales)}</span></div>
                    {closeDebtCashRecoveredToday > 0 && <div className="flex justify-between text-[var(--color-success)]"><span>Debt recovered (cash)</span><span className="tabular-nums">+ {fmt(closeDebtCashRecoveredToday)}</span></div>}
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">POS sales</span><span className="text-[var(--color-foreground)] tabular-nums">{fmt(closePosSales)}</span></div>
                    <div className="flex justify-between"><span className="text-[var(--color-muted)]">Bank transfer</span><span className="text-[var(--color-foreground)] tabular-nums">{fmt(closeTransferSales)}</span></div>
                    {closeDebtSales > 0 && <div className="flex justify-between border-t border-[var(--color-border)] pt-2"><span className="text-[var(--color-warning)]">Unpaid credit sales (debt)</span><span className="text-[var(--color-warning)] font-semibold tabular-nums">{fmt(closeDebtSales)}</span></div>}
                    {closeDebtTotalRecoveredToday > 0 && <div className="flex justify-between"><span className="text-[var(--color-success)]">Debt collected today</span><span className="text-[var(--color-success)] font-semibold tabular-nums">{fmt(closeDebtTotalRecoveredToday)}</span></div>}
                  </div>
                  <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-2xl p-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] font-sans font-medium text-[var(--color-muted)]">Balance cash</span>
                      <span className={`text-[22px] font-sans font-bold tabular-nums ${closeBalanceCash >= 0 ? 'text-[var(--color-foreground)]' : 'text-[var(--color-error)]'}`}>{fmt(Math.abs(closeBalanceCash))}</span>
                    </div>
                    <div className="text-[11px] font-sans text-[var(--color-muted)] mt-1">({fmt(closePhysicalCash)} cash in hand − {fmt(closeTotalExpenses)} expenses)</div>
                  </div>
                </>
              )}
            </div>

            {/* Footer actions */}
            <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)] flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                type="button"
                disabled={closeSummaryLoading}
                onClick={() => {
                  import('./CargoReceipt').then(m => m.downloadCargoDailySummary({
                    periodStart: periodStart ? new Date(periodStart).toLocaleString('en-GB') : '',
                    periodEnd: periodEnd ? new Date(periodEnd).toLocaleString('en-GB') : '',
                    agentName: user.name,
                    hubName: user.hub,
                    entries: closeEntries.map(t => ({
                      consignee: t.consignee_name,
                      airline: t.airline || '',
                      awb: t.awb_tag_number || '',
                      route: t.route || '',
                      contentType: t.content_type || '',
                      pieces: t.total_pcs,
                      kg: t.total_kg,
                      amount: t.amount,
                      paymentMode: formatPaymentModeDisplay(t.receipt_mode, t.wallet_deduction_amount, t.amount),
                      bank: t.bank || undefined,
                    })),
                    totalSales: closeTotalSales,
                    cashSales: closeCashSales,
                    posSales: closePosSales,
                    transferSales: closeTransferSales,
                    debtSales: closeDebtSales,
                    expenses: closeExpenses.map(e => ({ type: e.type, amount: e.amount, description: e.description })),
                    totalExpenses: closeTotalExpenses,
                    balanceCash: closeBalanceCash,
                  }));
                }}
                className="flex-1 min-h-[44px] h-11 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border)] text-[var(--color-foreground)] text-[13px] font-sans font-medium hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Download summary PDF
              </button>
              <button
                type="button"
                onClick={handleCloseDay}
                disabled={closeSummaryLoading || closingDay}
                className="flex-1 min-h-[44px] h-11 rounded-full bg-white text-black hover:bg-neutral-200 dark:bg-white dark:text-black dark:hover:bg-neutral-200 text-[13px] font-sans font-semibold shadow-xs transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {closingDay && <Loader2 size={15} className="animate-spin" />}
                <span>{closingDay ? "Closing…" : "Confirm & close period"}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}


      {showSalesAnalysis && (
        <DepartmentSalesAnalysisModal
          user={user}
          deptType="cargo"
          deptLabel="Cargo"
          routeLabel="Route"
          onClose={() => setShowSalesAnalysis(false)}
        />
      )}
    </div>
  );
};
