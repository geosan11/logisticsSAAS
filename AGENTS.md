# EHI Multisystems - AI Developer Guidelines & Verification Protocol

This file serves as a persistent guide injected directly into the agent's context. It establishes the mandatory pre-implementation rules, post-implementation debugging, validation, and quality-checking protocol for all changes.

---

## 1. The Seven EHI Reliability Rules (MUST ENFORCE)

Before making any change touching the areas below, you **MUST** state which rules apply and how you satisfied them in your plan/turn:

1. **Ledger & Performance**:
   - Virtualize long lists (`@tanstack/react-virtual`).
   - Bound queries; paginate with server cursors (`ledger_search_page`). Never load unbounded history into the UI.
2. **Wallet & Financial Integrity**:
   - Fail-closed checks.
   - Idempotent operations using stable `p_idempotency_key`.
   - Explicit race handling on rate sync and wallet updates. No silent failures.
3. **RLS & Multi-Tenancy**:
   - Array-aware `sibling_hub_ids()`: compare using `hub_id = ANY(sibling_hub_ids())` (never scalar equality on array or extra subquery parens).
   - Strict tenant isolation: every tenant table and policy must enforce `tenant_id = current_user_tenant_id()`. Multi-tenant tested from day one.
4. **Offline Visibility & Sync**:
   - Clear offline state indicator.
   - Dexie (`IndexedDB`) + Supabase sync must surface conflicts and quarantined entries with clear operator visibility. Tag pools and reconciliation must stay consistent.
5. **Modals & Portals**:
   - Use portals for all modals (`src/components/Modal.tsx` rendered to `document.body`).
   - Never use nested ad-hoc `fixed inset-0` dialogs that cause stacking context / z-index collisions.
6. **Financial Correctness & Audit**:
   - Every money movement (wallet intake, debt clearance, refund, dispatch advance, payout) must have an audit trail (`audit_log`, `wallet_transactions`, `debt_collection_events`) and reconciliation path (`EODReconciliation`).
7. **UI Consistency & Mode-Awareness**:
   - Mode-aware components (`Air` / `Road` / `Intermodal`), but unified shared design system.
   - Professional, clean, logistics-grade density (Obsidian theme: dark card surfaces, amber accents, status green/red).

---

## 2. Verification Protocol (Run on Every Change)

For **every** feature request, bug fix, or refactor, you **MUST** run the following verification pipeline before declaring the task complete:

### Step 1: TypeScript Integrity Check
```bash
npm run lint
```
Strict `tsc --noEmit`. Fix all linter and compiler errors immediately. Never submit code with active compiler errors.

### Step 2: Automated Tests
```bash
npx --yes vitest run
```
Verify unit and regression tests pass cleanly.

### Step 3: Application Production Build
```bash
npm run build
```
Ensures full bundle compilation of client assets, PWA service worker, and the bundled server (`dist/server.cjs`).

---

## 3. Core Architectural Guardrails

### A. Strict Type Safety & Imports
- **Named Imports Only:** Avoid generic or manual object destructuring for critical React components. Explicitly import hooks and state triggers.
- **Pre-Existing Hooks:** Real-time components must leverage stable props, primitive values in dependency arrays, or memoized local triggers to prevent infinite rendering loops.
- **Dependency Ingestion:** Always double-check `package.json` to leverage precompiled helper libraries (`lucide-react`, `motion/react`, `recharts`, `dexie`, etc.) rather than importing raw modules.

### B. Mobile Screen & Responsive Boundary Integrity
- **Safe-Area Layout Protection:** Lower viewport elements like the mobile BottomNav must be pinned to the absolute bottom utilizing standard padding values:
  `padding-bottom: calc(62px + env(safe-area-inset-bottom)) !important;`
- **Main View Scroll Safety:** Set main tags to prevent layout clipping and overlap:
  `main { flex: 1; overflow-y: auto; padding-bottom: 0 !important; }`
- **Viewport Constraints:** Ensure that elements render consistently across tablet, desktop, and mobile viewports.

### C. Persistent Offline-First Architecture
- **Dual-State Synchronization:** This application is built as an offline-first resilient system. Ensure retail and corporate transactions are safely cached inside Dexie (local state query wrappers) first, then verified and pushed down to the primary DB when network connectivity shifts safely.
- **Graceful Fallbacks:** If API connections are delayed or unavailable, show appropriate offline badges or warning indicators, matching the prepackaged EHI visual style.
