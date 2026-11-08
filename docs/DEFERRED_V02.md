# Deferred Features & Future Roadmap (v0.2.0+)

This document tracks capabilities and enhancements intentionally deferred from the initial **v0.1.0-unified** shell to keep the foundation lightweight, reliable, and focused on core operational excellence.

---

## 1. Multi-Tenant Automated Billing & Subscriptions
- **Current State (v0.1.0):** Database schema and RLS are multi-tenant ready with `tenants` table, `current_user_tenant_id()`, tenant isolation triggers, and tenant branding settings in `Settings.tsx`.
- **v0.2.0 Installment:**
  - Automated recurring SaaS subscription billing via Paystack / Stripe.
  - Per-tenant usage metrics (active users, monthly waybills/AWBs logged, Dexie sync volume).
  - Self-serve plan upgrades (Starter, Professional, Enterprise).

## 2. Carrier EDI & Direct Airline System Integrations
- **Current State (v0.1.0):** Volumetric IATA pricing calculation (`(L × W × H) / 6000`), AWB tag reservation, airway bill printing, airline commission tracking, and flight status tracking.
- **v0.2.0 Installment:**
  - CargoIMP / CargoXML electronic messaging direct to airline cargo reservations systems.
  - Automatic customs e-declaration filing integrations.

## 3. Dedicated Driver Mobile PWA & Turn-by-Turn Telematics
- **Current State (v0.1.0):** Active dispatch map (`Dispatch.tsx`), trip creation with vehicle/driver assignment (`PackageForm.tsx`), and full Proof of Delivery with signature, GPS, and compressed photo (`ProofOfDelivery.tsx`).
- **v0.2.0 Installment:**
  - Dedicated offline driver companion mode with turn-by-turn route optimization.
  - Automated geofence departure and arrival triggers.

## 4. White-Label Custom Domains & Multi-Tenant Routing
- **Current State (v0.1.0):** Dynamic tenant logo, company name, brand accent color, and mode toggles configured per tenant.
- **v0.2.0 Installment:**
  - Custom domain routing (`app.logistics-partner.com` mapped to tenant UUID).
  - Tenant-specific transactional email and SMS sender IDs.

## 5. Self-Service Customer Portal
- **Current State (v0.1.0):** Operational desk interfaces for retail counter, corporate clients, customer wallets, and reconciliation.
- **v0.2.0 Installment:**
  - Public/authenticated customer portal where B2B shippers can schedule pickups, track shipments, download statements, and fund wallets directly.
