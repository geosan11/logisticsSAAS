# Strip and Mode Matrix — Unified Logistics SaaS

This document establishes the official status of every module and view from EHI-MULTISYSTEMS in the unified Air + Road SaaS architecture.

## 1. Operational Mode Assignment

| Workspace / View | Target Mode | Status | Description & Role |
|---|---|---|---|
| `Dashboard` (`Tower`) | **Shared** (All) | Active | Operational KPIs, pending sync, quick actions |
| `TransactionLedger` (`More:TransactionLedger`) | **Shared** (All) | Active | Virtualized master ledger; mode-filtered stream tabs |
| `Scanner` (`Scan`) | **Shared** (All) | Active | QR custody chain: ARRIVE, DEPART, DELIVER |
| `CustomerWallets` (`More:CustomerWallets`) | **Shared** (All) | Active | B2B & retail customer credit wallets with idempotent transactions |
| `DebtCollectionLog` (`More:DebtCollectionLog`) | **Shared** (All) | Active | Debt clearance, settlements, and retrieval audit |
| `EODReconciliation` (`More:EODClose`) | **Shared** (All) | Active | End-of-day register close & expected cash calculations |
| `BankReconciliation` (`More:BankReconciliation`) | **Shared** (All) | Active | Bank statement & alert matching |
| `CorporateBilling` (`More:CorporateBilling`) | **Shared** (All) | Active | B2B corporate client invoicing & credit terms |
| `AuditLog` (`More:AuditLog`) | **Shared** (All) | Active | Tamper-resistant operator revision log |
| `IncomingToHub` (`Incoming`) | **Shared** (All) | Active | Intake validation for transfers arriving from sibling hubs |
| `OutboundArrivals` (`OutboundArrivals`) | **Shared** (All) | Active | Outbound shipment departures and route transfers |
| `StaffManagement` (`More:StaffManagement`) | **Shared** (All) | Active | User accounts, roles, and per-staff view access |
| `Settings` (`More:Settings`) | **Shared** (All) | Active | Platform & tenant configuration, branding, mode toggles |
| `CargoForm` (`Cargo`) | **Air & Intermodal** | Active | Air Cargo intake, volumetric pricing, AWB/HAWB numbers |
| `WeightManifest` (`WeightManifest`) | **Air & Intermodal** | Active | Flight cargo weight & ULD/airline manifest |
| `AirlineLedger` (`AirlineLedger`) | **Air & Intermodal** | Active | Airline payables & commission settlement balance |
| `FlightRadar` (`FlightRadar`) | **Air & Intermodal** | Active | Live flight departures board and delay tracker |
| `AirlinePerformance` (`More:AirlinePerformance`) | **Air & Intermodal** | Active | Airline sales volume & weight distribution |
| `HubCargoRates` (`More:HubCargoRates`) | **Air & Intermodal** | Active | Station-specific cargo kg, flat, and size tier rates |
| `PackageForm` (`Packages`) | **Road & Intermodal** | Active | Road Waybill / CMR & parcel intake, vehicle assignment |
| `Dispatch` (`More:Dispatch`) | **Road & Intermodal** | Promoted | Dispatch board, trip assignment, fleet tracking |
| `Fleet` (`More:Fleet`) | **Road & Intermodal** | Promoted | Vehicle registry, maintenance logs, fuel logs |
| `MyTrips` (`MyTrips`) | **Road & Intermodal** | Active | Driver active trip execution, route pings, stops |
| `PODLog` (`More:PODLog`) | **Road & Intermodal** | Active | Proof of delivery log (digital signatures, photos, GPS) |

---

## 2. Stripped Modules (UI & Bundle Diet)

The following views and components from legacy EHI counters and experimental features are stripped from the active UI, navigation, and client bundle:

| Module / Component | Reason for Stripping | DB Table Status |
|---|---|---|
| `ExcessBaggageForm.tsx` & `ExcessBaggageAirlines.tsx` | Specific to passenger airline airport terminal counter, not unified cargo/road logistics SaaS. | Tables (`manifests`, `excess_baggage_airlines`) preserved in Postgres for historical ledger data integrity. |
| `MarketingWorkspace.tsx` | Specific to legacy EHI promo/retail package counter. Replaced by unified Package / Road CMR intake. | Table (`marketing_entries`) preserved in Postgres. |
| `AIChatBuddy.tsx` | Non-operational floating chat widget; eliminates `@google/genai` client bundle weight. | Server endpoint preserved if needed for backend report parsing. |
| `Forecasting.tsx` | Unused experimental demand forecasting AI screen. | N/A |
| `AirlineLogoManager.tsx` | Superfluous admin image uploader. Replaced by direct asset URLs. | N/A |
| `SubscriptionExpiredModal.tsx` | Hardcoded mock notice modal from temporary PR. Replaced in Phase 3 by real multi-tenant subscription checks. | N/A |
| `Analytics.tsx` / `AnalyticsPDF.tsx` | Heavy recharts bundle duplicating metrics already surfaced in `Dashboard` (`Tower`). | N/A |
