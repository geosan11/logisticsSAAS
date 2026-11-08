import { supabase } from './supabase';
import { writeAuditLog } from './supabase';
import { UserRole, HubType } from './types';
import { notifySilentError } from './ToastContext';

export interface UserProfile {
  id: string;
  email: string;
  name: string; // The UI uses `name` instead of `full_name`. We map it.
  role: UserRole;
  hub: string; // Maps to `hub_name`
  hub_code?: string;
  hubType: HubType;
  hub_id?: string;
  active: boolean;
  can_print_ledger?: boolean;
  can_edit_ledger?: boolean;
  can_edit_remarks?: boolean;
  can_approve_retrievals?: boolean;
  assigned_airline?: string;
  view_overrides?: string[] | null;
  tenant_id?: string;
}

// Last known-good profile, used only as a fallback in getSessionInner() when
// supabase.auth.getSession() confirms a still-valid local session but the
// user_profiles lookup can't reach the network -- see the comment there.
// Never trusted on its own: it's only ever read after that session check
// passes, and only when the cached id matches the current session's user.
const CACHED_PROFILE_KEY = 'ehi_cached_profile';

// Lightweight integrity fingerprint so casual DevTools edits to role/permissions
// in localStorage (`ehi_cached_profile`) are rejected on offline fallback.
function computeProfileIntegrity(p: UserProfile): string {
  const payload = `${p.id}|${p.email}|${p.role}|${p.hub_id || ''}|${p.active}|${!!p.can_edit_ledger}|${!!p.can_approve_retrievals}|ehi-v1`;
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function cacheProfile(profile: UserProfile): void {
  try {
    const sig = computeProfileIntegrity(profile);
    localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify({ ...profile, _sig: sig }));
  } catch {
    // Best-effort only -- a full/unavailable localStorage just means the
    // next offline reload falls through to the login screen as before.
  }
}

function clearCachedProfile(): void {
  try {
    localStorage.removeItem(CACHED_PROFILE_KEY);
  } catch {}
}

function readCachedProfile(userId: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(CACHED_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserProfile & { _sig?: string };
    if (!parsed || parsed.id !== userId || !parsed.active) return null;
    if (parsed._sig && parsed._sig !== computeProfileIntegrity(parsed)) {
      clearCachedProfile();
      return null;
    }
    const { _sig, ...clean } = parsed;
    return clean;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error('Invalid email or password.');
  }

  if (!data?.user) {
    throw new Error('Login failed. Try again.');
  }

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select(`
      id,
      email,
      name,
      role,
      hub_type,
      active,
      hub_id,
      can_print_ledger,
      can_edit_ledger,
      can_edit_remarks,
      can_approve_retrievals,
      assigned_airline,
      view_overrides,
      hubs (
        name,
        code,
        type
      )
    `)
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    throw new Error('Account exists but profile not set up. Contact your admin.');
  }

  if (!profile.active) {
    await supabase.auth.signOut();
    throw new Error('Your account has been deactivated. Contact your admin.');
  }

  const prof: any = profile;
  const result = {
      id: profile.id,
      email: data.user.email || profile.email || '',
      name: profile.name,
      role: profile.role,
      hub: Array.isArray(prof.hubs) ? prof.hubs[0]?.name : (prof.hubs?.name || 'Unknown Hub'),
      hub_code: Array.isArray(prof.hubs) ? prof.hubs[0]?.code : (prof.hubs?.code || 'HQ'),
      hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
      hub_id: profile.hub_id,
      active: profile.active,
      can_print_ledger: profile.can_print_ledger ?? false,
      can_edit_ledger: profile.can_edit_ledger ?? false,
      can_edit_remarks: profile.can_edit_remarks ?? false,
      can_approve_retrievals: profile.can_approve_retrievals ?? false,
      assigned_airline: profile.assigned_airline ?? undefined,
      view_overrides: profile.view_overrides ?? null,
  };

  cacheProfile(result);

  // Write audit log (fire-and-forget)
  writeAuditLog({
    user_id: result.id,
    user_name: result.name,
    action: 'LOGIN',
    description: `${result.name} logged in at ${result.hub}`,
    hub: result.hub,
    hub_id: result.hub_id,
  }).catch(() => {});

  return result;
}

// ── DEMO PROFILES & OFFLINE PREVIEW SEED ─────────────────────────────
export const DEMO_PROFILES: Record<string, UserProfile> = {
  admin: {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin.demo@ehimultisystems.com',
    name: 'Captain Geo (Ops Director)',
    role: 'super_admin',
    hub: 'Lagos Hub (MMA2)',
    hub_code: 'LOS',
    hubType: 'Head Office',
    hub_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    active: true,
    can_print_ledger: true,
    can_edit_ledger: true,
    can_edit_remarks: true,
    can_approve_retrievals: true,
    view_overrides: null,
  },
  cargo: {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'cargo.demo@ehimultisystems.com',
    name: 'Amaka Obi (Air Cargo Lead)',
    role: 'cargo_agent',
    hub: 'Lagos Hub (MMA2)',
    hub_code: 'LOS',
    hubType: 'Cargo Station',
    hub_id: '00000000-0000-0000-0000-000000000001',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    active: true,
    can_print_ledger: true,
    can_edit_ledger: false,
    can_edit_remarks: true,
    can_approve_retrievals: false,
    view_overrides: null,
  },
  road: {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'road.demo@ehimultisystems.com',
    name: 'Tunde Adeleke (Road Operations)',
    role: 'admin',
    hub: 'Abuja Hub',
    hub_code: 'ABV',
    hubType: 'Cargo Station',
    hub_id: '00000000-0000-0000-0000-000000000002',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    active: true,
    can_print_ledger: true,
    can_edit_ledger: true,
    can_edit_remarks: true,
    can_approve_retrievals: true,
    view_overrides: null,
  },
};

export function seedDemoDataIfEmpty(user: UserProfile): void {
  try {
    const txKey = `ehi_recent_tx_v1_${user.id}`;
    const existing = localStorage.getItem(txKey);
    if (!existing || JSON.parse(existing).length === 0) {
      const demoTxs = [
        {
          id: 'EHI-LOS-CG-001042',
          name: 'Dangote Industries Ltd',
          detail: 'Arik Air · 4pcs · 128KG · LOS-ABV · Industrial Spares',
          amount: 89600,
          mode: 'Transfer',
          bank: 'Access Bank',
          time: '11:45',
          type: 'cargo',
          status: 'Intake',
          awb_tag_number: 'EHI-LOS-CG-001042',
          airline: 'Arik Air',
          flight: 'W3 331',
          pieces: 4,
          kg: 128,
          route: 'LOS-ABV',
          contentType: 'Industrial Spares',
          enteredByName: user.name,
          pickupPin: '7392',
          hub: user.hub,
          hub_id: user.hub_id,
          created_at: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 'EHI-LOS-PKG-000512',
          name: 'Chukwuma Electronics',
          detail: 'ABV · Electronics · 2pcs · 45kg · Solar Inverters · 🚚 KJA-482XA',
          amount: 32000,
          mode: 'Cash',
          time: '10:20',
          type: 'package',
          status: 'Intake',
          destination: 'ABV',
          contentType: 'Electronics',
          pieces: 2,
          kg: 45,
          contents: 'Solar Inverters',
          vehiclePlate: 'KJA-482XA',
          driverName: 'Musa Ibrahim',
          enteredByName: user.name,
          pickupPin: '5819',
          hub: user.hub,
          hub_id: user.hub_id,
          created_at: new Date(Date.now() - 7200000).toISOString(),
        },
        {
          id: 'EHI-LOS-CG-001041',
          name: 'Prime Pharmaceuticals',
          detail: 'Air Peace · 2pcs · 18KG · LOS-KAN · Cold-chain Vaccines',
          amount: 27500,
          mode: 'Wallet',
          time: '09:15',
          type: 'cargo',
          status: 'Intake',
          awb_tag_number: 'EHI-LOS-CG-001041',
          airline: 'Air Peace',
          flight: 'P4 7122',
          pieces: 2,
          kg: 18,
          route: 'LOS-KAN',
          contentType: 'Vaccines',
          wallet_id: '00000000-0000-0000-0000-000000000012',
          wallet_deduction_amount: 27500,
          enteredByName: user.name,
          pickupPin: '4190',
          hub: user.hub,
          hub_id: user.hub_id,
          created_at: new Date(Date.now() - 12000000).toISOString(),
        },
      ];
      localStorage.setItem(txKey, JSON.stringify(demoTxs));
    }

    const expKey = `ehi_recent_expenses_v1_${user.id}`;
    if (!localStorage.getItem(expKey)) {
      const sampleExpenses = [
        {
          id: 'EX-001',
          type: 'Fuel',
          amount: 18500,
          description: 'Diesel fuel top-up for Truck KJA-482XA (Line-haul dispatch)',
          time: new Date(Date.now() - 10000000).toISOString(),
          created_at: new Date(Date.now() - 10000000).toISOString(),
          hub_id: user.hub_id,
          status: 'approved',
          mode: 'Transfer',
          logged_by: user.name,
        },
      ];
      localStorage.setItem(expKey, JSON.stringify(sampleExpenses));
    }

    const walletsKey = 'ehi_customer_wallets_v1';
    if (!localStorage.getItem(walletsKey)) {
      const sampleWallets = [
        {
          id: '00000000-0000-0000-0000-000000000010',
          customer_name: 'Dangote Industries Ltd',
          phone: '08031234567',
          balance: 450000,
          status: 'active',
          tenant_id: user.tenant_id,
        },
        {
          id: '00000000-0000-0000-0000-000000000011',
          customer_name: 'Chukwuma Electronics',
          phone: '08029876543',
          balance: 75000,
          status: 'active',
          tenant_id: user.tenant_id,
        },
        {
          id: '00000000-0000-0000-0000-000000000012',
          customer_name: 'Prime Pharmaceuticals',
          phone: '08055551122',
          balance: 142500,
          status: 'active',
          tenant_id: user.tenant_id,
        },
      ];
      localStorage.setItem(walletsKey, JSON.stringify(sampleWallets));
    }

    const shiftKey = 'ehi_today_shifts_v1';
    if (!localStorage.getItem(shiftKey)) {
      const sampleShifts = [
        {
          id: '00000000-0000-0000-0000-000000000020',
          hub_id: user.hub_id || '00000000-0000-0000-0000-000000000001',
          department: 'all',
          opened_by: user.name,
          status: 'open',
          opened_at: new Date(Date.now() - 14400000).toISOString(),
        },
      ];
      localStorage.setItem(shiftKey, JSON.stringify(sampleShifts));
    }

    const corpKey = 'ehi_corporate_clients_v2';
    if (!localStorage.getItem(corpKey)) {
      const sampleCorps = [
        { id: '00000000-0000-0000-0000-000000000010', company_name: 'Dangote Industries Ltd', contact_phone: '08031234567', accumulated_monthly_debt: 0, active: true },
        { id: '00000000-0000-0000-0000-000000000011', company_name: 'Chukwuma Electronics', contact_phone: '08029876543', accumulated_monthly_debt: 0, active: true },
        { id: '00000000-0000-0000-0000-000000000012', company_name: 'Prime Pharmaceuticals', contact_phone: '08055551122', accumulated_monthly_debt: 0, active: true },
      ];
      localStorage.setItem(corpKey, JSON.stringify(sampleCorps));
    }
  } catch (err) {
    console.warn('Failed to seed demo data', err);
  }
}

export function signInDemo(roleKey: 'admin' | 'cargo' | 'road' = 'admin'): UserProfile {
  const profile = DEMO_PROFILES[roleKey] || DEMO_PROFILES.admin;
  try {
    localStorage.setItem('ehi_demo_user', JSON.stringify(profile));
  } catch {}
  cacheProfile(profile);
  seedDemoDataIfEmpty(profile);
  return profile;
}

export function isDemoSession(): boolean {
  try {
    return Boolean(localStorage.getItem('ehi_demo_user'));
  } catch {
    return false;
  }
}

export async function signOut() {
  clearCachedProfile();
  try {
    localStorage.removeItem('ehi_demo_user');
  } catch {}
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch(e) {
    console.warn("Sign out err", e);
    notifySilentError('Signed out locally, but the server session may not have closed. This is usually harmless.');
  }
}

// ── STAFF ACCOUNT MANAGEMENT ──────────────────────────────────────

export interface CreateStaffPayload {
  name:      string;
  email:     string;
  password:  string;
  role:      string;
  hub_id:    string;
  hub_type:  string;
  phone?:    string;
  assigned_airline?: string;
}

// Creates a new staff account via the server endpoint
// (server uses service role key — client anon key can't create users)
export async function createStaffAccount(payload: CreateStaffPayload): Promise<{ id: string; email: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch('/api/admin/create-staff', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:    JSON.stringify(payload),
  });

  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) {
      data = JSON.parse(rawText);
    }
  } catch (e) {
    // Not valid JSON — rawText still holds whatever the server actually sent,
    // surfaced below instead of being silently discarded.
  }

  if (!res.ok || data.error) {
    if (res.status === 503) {
      throw new Error('Staff account creation is not configured on the server. Add SUPABASE_SERVICE_ROLE_KEY to your environment variables.');
    }
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
  return { id: data.id, email: data.email };
}

export interface BulkStaffRow {
  row: number; // original CSV row number, kept through chunking for clean error reporting
  name: string;
  email: string;
  role: string;
  hub_code: string;
  hub_type?: string;
  phone?: string;
}

export interface BulkStaffResult {
  row: number;
  email: string;
  success: boolean;
  tempPassword?: string;
  error?: string;
}

// Creates one chunk (max 50 rows) of staff accounts via the bulk endpoint.
// Callers with larger CSVs should split into chunks and call this
// repeatedly — see BulkStaffImport.tsx, which does this with a visible
// progress bar rather than one long-running request.
export async function createStaffAccountsBulk(rows: BulkStaffRow[]): Promise<{ results: BulkStaffResult[]; successCount: number; failureCount: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';
  const res = await fetch('/api/admin/create-staff-bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ staff: rows }),
  });

  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) data = JSON.parse(rawText);
  } catch (e) {
    // Not valid JSON — rawText still holds whatever the server actually sent.
  }

  if (!res.ok || data.error) {
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
  return data;
}

// Fetches all staff (super_admin sees all, hub admin sees own hub)
export async function fetchStaffList(hubId?: string): Promise<any[]> {
  let q = supabase
    .from('user_profiles')
    .select('id, email, name, role, hub_type, active, hub_id, can_print_ledger, can_edit_ledger, hubs(name, code)')
    .order('name');

  if (hubId) q = q.eq('hub_id', hubId) as any;

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

// Update a staff profile (role, hub, active status)
export async function updateStaffProfile(
  userId: string,
  updates: { role?: string; hub_id?: string; hub_type?: string; active?: boolean; name?: string; phone?: string; can_print_ledger?: boolean; can_edit_ledger?: boolean; can_edit_remarks?: boolean; can_approve_retrievals?: boolean; assigned_airline?: string | null; view_overrides?: string[] | null }
): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token || '';

  const res = await fetch('/api/admin/update-staff', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body:    JSON.stringify({ userId, updates }),
  });
  
  let data: any = {};
  let rawText = '';
  try {
    rawText = await res.text();
    if (rawText) data = JSON.parse(rawText);
  } catch(e) {}

  if (!res.ok || data.error) {
    if (res.status === 503) {
      throw new Error('Staff management is not available — the server is not fully configured. Contact your system administrator.');
    }
    const fallback = rawText
      ? `Server returned status ${res.status}: ${rawText.slice(0, 200)}`
      : `Server returned error status ${res.status} with an empty response`;
    throw new Error(data.error || fallback);
  }
}

async function getSessionInner(): Promise<UserProfile | null> {
  const demoRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('ehi_demo_user') : null;
  if (demoRaw) {
    try {
      const demoUser = JSON.parse(demoRaw) as UserProfile;
      if (demoUser && demoUser.id && demoUser.active) {
        return demoUser;
      }
    } catch {}
  }

  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !data?.session) return null;

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select(`
      id,
      email,
      name,
      role,
      hub_type,
      active,
      hub_id,
      can_print_ledger,
      can_edit_ledger,
      can_edit_remarks,
      can_approve_retrievals,
      assigned_airline,
      view_overrides,
      hubs (
        name,
        code,
        type
      )
    `)
    .eq('id', data.session.user.id)
    .single();

  const prof: any = profile;

  if (error || !profile) {
    // error.code is only ever populated when PostgREST/Postgres actually
    // answered (RLS denial, PGRST116 no-row, etc) -- postgrest-js leaves it
    // '' for a client-side failure (offline, DNS, timeout; see
    // PostgrestBuilder.then()'s catch branch). Treating "couldn't reach the
    // server" the same as "the server said this profile/session is invalid"
    // was logging users out the instant their connection blipped, even
    // though the supabase.auth.getSession() call above already confirmed
    // the session itself is still valid locally. Fall back to the last
    // known-good profile instead of forcing the login screen; the next
    // successful check (online) re-verifies for real and refreshes it.
    if (error && !error.code) {
      const cached = readCachedProfile(data.session.user.id);
      if (cached) return cached;
    }
    return null;
  }

  // A deactivated account is blocked at signIn() time, but that alone
  // doesn't revoke an already-issued refresh token -- without this check,
  // reopening the app or a new tab in an already-signed-in session let a
  // deactivated staffer straight back in, no fresh sign-in required. Tear
  // the session down here too, matching signIn()'s handling.
  if (!profile.active) {
    clearCachedProfile();
    await supabase.auth.signOut();
    return null;
  }

  const result = {
    id: profile.id,
    email: data.session.user.email || profile.email || '',
    name: profile.name,
    role: profile.role,
    hub: Array.isArray(prof.hubs) ? prof.hubs[0]?.name : (prof.hubs?.name || 'Unknown Hub'),
    hub_code: Array.isArray(prof.hubs) ? prof.hubs[0]?.code : (prof.hubs?.code || 'HQ'),
    hubType: profile.hub_type || (Array.isArray(prof.hubs) ? prof.hubs[0]?.type : prof.hubs?.type) || 'Cargo Station',
    hub_id: profile.hub_id,
    active: profile.active,
    can_print_ledger: profile.can_print_ledger ?? false,
    can_edit_ledger: profile.can_edit_ledger ?? false,
    can_edit_remarks: profile.can_edit_remarks ?? false,
    can_approve_retrievals: profile.can_approve_retrievals ?? false,
    assigned_airline: profile.assigned_airline ?? undefined,
    view_overrides: profile.view_overrides ?? null,
  } as any;

  cacheProfile(result);
  return result;
}

// `onLateResult` fires only when the 3.5s timeout below wins the race but
// the real lookup then goes on to succeed anyway a moment later -- without
// it, that result was silently discarded (Promise.race never cancels the
// loser, it just stops anyone from being told about it), which meant any
// staffer on a slow hub WiFi/mobile connection got dumped on the login
// screen and had to re-enter credentials even though their session was
// perfectly valid the whole time. This was the actual cause of reports of
// "getting logged out unexpectedly" -- not a real sign-out, just a slow
// answer whose result nobody was listening for anymore. App.tsx uses this
// to log the user straight in the moment the slow answer does arrive,
// instead of leaving them stuck on a login form for no real reason.
export async function getSession(onLateResult?: (profile: UserProfile | null) => void): Promise<UserProfile | null> {
  let timedOut = false;
  const inner = getSessionInner().catch((err) => {
    console.error('getSessionInner failed:', err);
    return null;
  });

  inner.then((profile) => {
    if (timedOut && onLateResult) onLateResult(profile);
  });

  try {
    // Neither Supabase call inside getSessionInner carries a client-side
    // timeout, so a stalled mobile connection could leave AuthenticatedApp's
    // loading spinner (App.tsx) spinning forever with no fallback. Race
    // against a timeout the same way fetchAndApplyServerConfig already does
    // for /api/config, so a bad connection degrades to the login screen
    // instead of an infinite spinner -- but the real lookup above keeps
    // running regardless of which side of the race resolves first.
    return await Promise.race([
      inner,
      new Promise<null>((resolve) => setTimeout(() => { timedOut = true; resolve(null); }, 3500)),
    ]);
  } catch (err) {
    console.error('Failed to get session:', err);
    timedOut = true;
    return null;
  }
}

