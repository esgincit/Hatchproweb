# ESG HatchPro ERP — Plan from Volume 1 (review + gap analysis + build plan)

Source: Volume 1, Chapters 1–6 (V. Vadla, v1.0 draft, 13-Aug-2026), read in full 2026-11-18.
Volume 2 (BRD) not yet received — this plan marks where it must confirm details.

---

## 1. One-paragraph summary

Volume 1 defines HatchPro as a multi-tenant SaaS ERP built around one chain:
**breeder flock → hatching eggs → transfer → hatchery receiving → setter → candling ×2 → hatcher →
hatch → vaccination → chick availability → reservation/order → payment/deposit → allocation →
dispatch → delivery → feedback to the source flock**, with end-to-end traceability, approvals and
audit. Enterprise modules (inventory, procurement, maintenance, fleet, finance integration), SaaS
control plane, mobile, customer portal, AI and IoT sit around that spine.

**Key fact Volume 1 does not mention:** a working HatchPro platform already exists in this repo
(Next.js + Supabase + Flutter Android, live at hatchproweb.vercel.app). It already covers most of the
*platform foundation* (tenancy, RLS isolation, roles, subscriptions, inventory, PO/GRN, maintenance,
finance, alerts, offline, 5 languages, Android). What it does **not** cover is the Volume 1 *spine*:
breeder hatching-egg flow, egg transfer, setter/hatcher machines, two-stage candling, hatchery
vaccination, reservations/allocation/waiting list/deposits, dispatch with vehicle/driver, and the
traceability graph. **Recommendation: extend the existing platform, don't start a new codebase.**

---

## 2. Feedback on Volume 1 (what to send back to Venkatesh)

### 2.1 Strong points
- Correct product thesis: compete on the *connection* between farm, hatchery and sales, not module count.
- Traceability-first and production-linked availability are real differentiators vs POLOXY-type ERPs.
- Good discipline separating source-approved requirements from hypotheses and market claims.
- Sensible phasing (Discovery → Core MVP → SaaS → Enterprise → AI/IoT → Ecosystem) and "AI not mandatory".
- Making source rules (0.5% mortality, deposit slabs, customer tiers) tenant-configurable is right.

### 2.2 Issues to fix before Volume 2

| # | Issue | Where | Suggested fix |
|---|---|---|---|
| F1 | Document is written as greenfield; ignores the existing HatchPro build | All | Add a "Current platform baseline" section; scope Vol 2 as *delta* on what exists |
| F2 | Leftover AI-tool citation markers (`citeturn0search40`, `fileciteturn1file6`, etc.) | Ch 3, Ch 5 | Remove before any external/investor circulation |
| F3 | The three "supplied source specifications" (Parent Stock, Hatchery, Chick Sales) are referenced everywhere but not attached | Ch 1 §5 | Attach them as appendices or share — they are the real requirements |
| F4 | **Traceability model assumes 1:1 links.** In practice one setter load mixes eggs from several flocks/transfers, and one dispatch can draw from several hatch batches | Ch 5 §70, Ch 6 §87 | State explicitly that links are many-to-many with quantities (egg lot → setting → hatch → dispatch), so a complaint traces to *all* contributing flocks with proportions |
| F5 | Hatchability defined only as Chicks ÷ **Transfer** eggs | Ch 6 §92 | Industry reports both Hatch of Eggs Set (HOS) and Hatch of Fertile (HOF); transfer-based hides setter losses. Define all three; the current app uses HOS/HOF |
| F6 | Egg age / storage days, egg fumigation, egg weight, egg-room temperature missing | Ch 6 §84–87 | Egg age is a major hatchability driver — capture laid-date range per lot and alert on >7 days storage (configurable) |
| F7 | Settable eggs are calculated twice (farm sort and hatchery sort) with no rule for which wins | Ch 6 §84, §86 | Farm settable = transferable; hatchery settable = settable inventory; the difference is the receiving variance (§85.1) — say so |
| F8 | Single-stage vs multi-stage setters not addressed | Ch 6 §87 | Multi-stage machines hold several batches at once; machine capacity and batch identity rules differ — decide in BRD |
| F9 | Chick product types missing: broiler DOC vs layer DOC (female/male sexing), grade A/B, breed | Ch 6 §94 | Availability and orders must be per product type + breed + hatch date |
| F10 | Deposit slabs and tiers are rules, but cancellation/refund/no-show, credit customers, and partial-payment behaviour are missing | Ch 6 §95–98 | Add to BRD |
| F11 | No market numbers that matter for hatcheries: number of hatcheries by state/size, DOC volumes, price-per-chick, willingness to pay | Ch 3 §32 | Egg stats (149.11 bn eggs) describe table eggs, not the hatchery market; size TAM on hatcheries/DOC instead |
| F12 | No investment view: team, cost, timeline, pricing in ₹, break-even | Ch 4 §40, §51 | Needed for "investment potential" — Section 7 below gives a first cut |
| F13 | 12 documentation volumes before development = long waterfall | Ch 1 §3 | Run Vol 2 (BRD) and the pilot build in parallel; write Vols 5–7 from the built system |
| F14 | Positioning gap: existing app is farmer-first (small broiler/layer farms, Telugu, marketplace); Vol 1 is enterprise hatchery ERP | Ch 3 §26 | Treat as two editions on one platform: **Farm edition** (live) and **Hatchery/Integrator edition** (Vol 1) |
| F15 | Customer portal assumes self-service web; Indian DOC buyers mostly order by phone/WhatsApp | Ch 5 §68 | Phase 1: WhatsApp order status + payment link; full portal later |
| F16 | Regulatory: GST treatment of live chicks/hatching eggs, e-way bills, transport permits not covered | Ch 1 §9 | Confirm with a CA in BRD (not verified here) |
| F17 | Hatchery waste, biosecurity, hatchery sanitation records not in scope | Ch 6 | Add at least as Phase 3 items |

### 2.3 Answers to the "open decisions" (Ch 1 §9, Ch 5 §76) — already decided by the existing build
| Decision | Current reality (proposed to keep) |
|---|---|
| Tech stack / service boundaries | Modular monolith: Next.js 15 web + Supabase (Postgres, Auth, Edge Functions, Realtime, Storage) |
| Tenant isolation | Shared DB, `tenant_id` on every row + Postgres RLS (SQL-tested); dedicated DB for Enterprise Plus later |
| Cloud / hosting | Vercel (web) + Supabase (Postgres, region to confirm — India data residency question for BRD) |
| Mobile | Flutter Android app (offline outbox) + installable web PWA |
| Identity | Phone OTP; enterprise SSO deferred |
| Event model | Postgres triggers + RPCs now; queue/broker only when needed |
| Accounting integration | Tally XML + GSTR-1 JSON export exist; live Tally/Zoho sync later |
| Payments | Razorpay (gateway + webhook built; keys pending) |
| Messaging | WhatsApp (wa.me now, Business API when keys arrive), Web Push, SMS (MSG91 pending) |
| AI | Claude API (ai-triage built; key pending) |

---

## 3. Gap analysis — Volume 1 vs existing HatchPro

Legend: ✅ done · 🟡 partial · ❌ missing

### 3.1 Foundation & SaaS
| Vol 1 capability | Status | Evidence / note |
|---|---|---|
| Tenant, farms, houses (sheds) | ✅ | `tenant`, `farm`, `shed` |
| Users, roles, scoped permissions | ✅ | `user_role_assignment` (tenant/farm/shed scope), `ACT_ROLES` |
| Roles named in Vol 1 (hatchery coordinator, ops manager, sales officer, maintenance tech, driver) | 🟡 | Have owner/manager/supervisor/vet/store/finance/auditor; add the missing ones |
| Tenant onboarding + provisioning | ✅ | `/apply` + OTP + `provision-tenant` |
| Subscriptions, plans, usage metering | ✅ | `subscription`, `usage_daily`, `meter_usage()` |
| Feature entitlements per plan | 🟡 | Plan exists; module-level gating not enforced |
| Suspension / lifecycle | ✅ | read-only lock (0017/0018) |
| Platform console (support view, audit) | ✅ | `/admin`, `audit_log` |
| Tenant configurable rules/thresholds | ❌ | Alert thresholds hard-coded in `_shared/alerts.ts` |
| Branding per tenant | ❌ | |
| Generic approval states (Draft→Submitted→Approved→Locked) | 🟡 | Only `daily_shed_log.locked` and payment approval >₹50k |
| Audit trail of material changes | 🟡 | `audit_log` append-only, not written for every controlled record |
| Document management | ✅ | `tenant_document`, storage buckets |
| Notifications engine | ✅ | `notification`, daily-alerts, push, realtime toasts |
| i18n (en/te/hi/ta/kn), offline, PWA, Android | ✅ | |

### 3.2 Parent stock / breeder farm
| Capability | Status | Note |
|---|---|---|
| Flock placement (breed, date) | 🟡 | `batch` with `farm_type='breeder'`; **no female/male split** |
| Daily bird count, mortality, culls, feed, water, temp/RH | 🟡 | `daily_shed_log`; no F/M split, no body weight F/M, twice-daily environment, lighting, litter, ammonia, generator |
| Mortality alert (0.5%), water ±20/30% | 🟡 | Spike + water drop alerts exist with different thresholds; not tenant-configurable |
| Health / vet visits / disease cases / vaccination schedule | ✅ | |
| Hatching-egg collection (multiple per day, nest/floor, 7 reject categories) | ❌ | `egg_production` uses table-egg grades (jumbo…dirty) |
| Settable eggs, hen-day %, settable %, floor % | ❌ | |
| Egg transfer to hatchery (reference, approval, draft receiving) | ❌ | |
| Hatchery → farm feedback (fertility, HOF, embryo mortality, cull %) | ❌ | |
| Breed standards | ✅ | `breed_standard_curve` |

### 3.3 Hatchery
| Capability | Status | Note |
|---|---|---|
| Hatchery setting as a batch | ✅ | batch with `farm_type='hatchery'` |
| Egg receiving + reconciliation vs transfer | ❌ | |
| Hatching-egg inventory (lots, egg age) | ❌ | |
| Setter / hatcher machine master, capacity, status IN USE | ❌ | `asset` exists (could be extended) |
| Setter/hatcher environment readings + alerts + ack | ❌ | Only shed temp/RH |
| First candling (Day 10) | 🟡 | `hatch_record` single candling (clears, dead germ) |
| Second candling (Day 18) + approval | ❌ | |
| Setter → hatcher transfer | ❌ | |
| Hatch result (A/B, culls, dead-in-hatcher, unhatched) + KPIs | 🟡 | A/B/culls + fertility/HOS/HOF exist; dead-in-hatcher, waste % missing |
| Hatchery vaccination with vaccine lot/expiry/operator | ❌ | |
| Available chick inventory | 🟡 | DOC dispatch guard (0033) vs hatched stock |

### 3.4 Commercial
| Capability | Status | Note |
|---|---|---|
| Customer master, credit | ✅ | no tier, no delivery locations |
| Invoice, receipts, receivables, reminders | ✅ | |
| Sales order / temporary reservation | ❌ | Sales are invoices only |
| Payment proof upload / verification | 🟡 | Razorpay webhook built; no proof-upload flow |
| Deposit rules (<500 none, 500–5,000 50%, >5,000 100%) | ❌ | |
| Customer tiers (Platinum/Gold/Standard) | ❌ | |
| 12-week rolling availability forecast | ❌ | |
| Waiting list, reschedule, partial allocation | ❌ | |
| Allocation recommendation + hatchery manager approval | ❌ | |
| Delivery planning (route, vehicle, driver, schedule) | ❌ | |
| Dispatch record (batch, qty, vehicle, driver, time) | 🟡 | Dispatch = DOC invoice; no vehicle/driver/time |
| Ready → Dispatched → Delivered → Completed + proof of delivery | ❌ | |
| Customer portal | ❌ | Vendor portal exists (pattern reusable) |

### 3.5 Enterprise / analytics / future
| Capability | Status |
|---|---|
| Inventory ledger, stores, items, expiry | ✅ |
| Procurement (PO, GRN, bills, payment approval) | ✅ |
| Maintenance (assets, tickets, service) | ✅ (no preventive schedule) |
| Fleet (vehicles, trips, fuel) | ❌ |
| Finance exports (Tally, GSTR-1, P&L) | ✅ |
| Payroll / bank file | ✅ (extra, not in Vol 1) |
| Contract farming, marketplace, 3D farm | ✅ (extra, not in Vol 1) |
| Farm dashboards | ✅ |
| Hatchery / sales / executive dashboards | 🟡 |
| Traceability forward/backward query | ❌ |
| AI (triage) | 🟡 (key pending) |
| IoT ingestion | ❌ |

**Roughly:** foundation/enterprise ≈ 75% done; Vol 1 spine (breeder eggs → hatchery → allocation → dispatch → traceability) ≈ 15% done.

---

## 4. Target data model additions (Phase 1)

Reuse first: `shed` = house, `batch` = flock / incubation setting, `asset` = machines, `worker` = driver, `customer`, `invoice`, `payment`, `audit_log`, `notification`.

| New / changed | Purpose | Key columns |
|---|---|---|
| `batch` + cols | Breeder flock split | `females_placed`, `males_placed` |
| `daily_shed_log` + cols | Breeder daily record | `mortality_f/m`, `culls_f/m`, `bw_f_g/bw_m_g`, `feed_f_kg/feed_m_kg`, `light_hours` |
| `env_reading` | Shed + machine environment, manual or IoT | `subject (shed\|machine)`, `subject_id`, `read_at`, `temp_c`, `rh_pct`, `co2_ppm`, `nh3_ppm`, `source (manual\|iot)` |
| `hatching_egg_collection` | Multiple collections per day | `flock_id`, `date`, `collection_no`, `total`, `nest`, `floor`, `broken`, `cracked`, `dirty`, `misshapen`, `double_yolk`, `small`, `soft_shell`, generated `settable`, `status` |
| `egg_transfer` | Farm → hatchery, the traceability key | `ref` (Transfer Reference), `flock_id`, `to_hatchery_farm_id`, `laid_from/laid_to`, `trays`, `qty`, `status draft→approved→sent→received→reconciled` |
| `egg_receipt` | Hatchery receiving | `transfer_id`, `received`, `cracked`, `misshapen`, `other_reject`, generated `settable`, `variance`, `status` |
| `egg_lot` (view or table) | Settable inventory with egg age | `receipt_id`, `flock_id`, `available_qty`, `laid_from` |
| machine cols on `asset` | Setter/hatcher | `machine_kind (setter\|hatcher)`, `capacity_eggs`, `stage (single\|multi)`, `status (free\|in_use\|fault)` |
| `setting_lot` | **Many-to-many** egg lot → incubation batch | `batch_id`, `egg_lot_id`, `qty` |
| `candling` | Replaces single candling in `hatch_record` | `batch_id`, `stage (1\|2)`, `day`, `clears`, `early_dead`, `mid_dead`, `late_dead`, `status`, `approved_by/at` |
| `hatcher_transfer` | Day 18 move | `batch_id`, `hatcher_id`, `qty`, `moved_at` |
| `hatch_record` + cols | Full hatch result | `dead_in_hatcher`, `unhatched`, `approved_by/at` |
| `chick_vaccination` | Hatchery vaccination | `batch_id`, `vaccine_id`, `vaccine_lot`, `expiry`, `qty`, `operator_id`, `given_at` (trigger refuses expired) |
| `customer` + cols | Priority & delivery | `tier (platinum\|gold\|standard)`, `delivery_address`, `lat/lng` |
| `sales_order` | Reservation-before-payment | `customer_id`, `product (broiler_doc\|layer_doc_f\|layer_doc_m)`, `breed_id`, `qty`, `hatch_date`, `deposit_required`, `deposit_paid`, `status requested→reserved→reviewed→payment_verified→approved→allocated→ready→dispatched→delivered→completed / waitlisted / cancelled` |
| `order_allocation` | **Many-to-many** order ← hatch batches | `order_id`, `batch_id`, `qty`, `recommended_by`, `approved_by/at`, `override_reason` |
| `vehicle` | Fleet minimal | `reg_no`, `capacity_boxes`, `owner (own\|hired)` |
| `dispatch` | Trip | `vehicle_id`, `driver_worker_id`, `planned_at`, `dispatched_at`, `delivered_at`, `pod_media_id`, `status` |
| `dispatch_line` | Which allocations on which trip | `dispatch_id`, `allocation_id`, `qty` |
| `tenant_rule` | Configurable rules | `key` (e.g. `mortality_alert_pct`, `deposit_slabs`, `tier_order`, `egg_max_storage_days`), `value jsonb` |
| `trace_back(dispatch_id)`, `trace_forward(flock_id)` | SQL functions over the links above | returns tree with quantities/proportions |

Every new table follows existing rules: `tenant_id` + RLS, role policies, `*_active_*` suspension policies, `ACT_ROLES` entry, SQL test file.

**Approval pattern (one, reused):** columns `status`, `submitted_by/at`, `approved_by/at`, `reject_reason`; one shared trigger `guard_locked()` refuses UPDATE/DELETE once `status in ('approved','locked')` unless the caller has the approver role, and writes `audit_log`.

---

## 5. Build plan

Assumes the existing team pattern (Claude-assisted dev + 1–2 developers + 1 domain expert reviewer). Durations are **estimates**, to be re-checked after the BRD.

### Phase 0 — Discovery & alignment (2–3 weeks) — *before* coding the spine
1. Get the three source specs (F3) and Volume 2.
2. Interview 2–3 pilot hatcheries (Tier-1: AP/Telangana). Validate H1, H2, H4, H6 (Ch 3 §30). Collect real registers: egg receiving sheet, setter chart, candling sheet, hatch sheet, order book, dispatch book.
3. Decide on F4 (many-to-many), F5 (KPI definitions), F8 (single/multi-stage), F9 (product types), deposit/refund rules.
4. Decide edition strategy (F14) and pricing hypothesis in ₹.
5. **Exit:** signed pilot scope + list of pilot customers + confirmed KPI formulas.

### Phase 1 — Core MVP: the connected spine (≈ 12–16 weeks), riskiest first

| WP | Scope | Depends on | Size |
|---|---|---|---|
| **1.1 Traceability core + approvals** (riskiest) | `setting_lot`, `order_allocation` link model, `guard_locked()` trigger + audit, `trace_back/forward` functions, SQL tests with mixed-flock settings | — | M |
| 1.2 Tenant rules | `tenant_rule` + settings screen; move alert thresholds out of code | — | S |
| 1.3 Breeder flock | F/M placement + daily log split, env readings twice-daily, mortality/water alerts from rules | 1.2 | M |
| 1.4 Hatching-egg collection | Collection form (multi per day), reject categories, settable/hen-day/floor %, approval | 1.1, 1.3 | M |
| 1.5 Egg transfer + receiving | Transfer ref, approval, auto draft receipt at hatchery, variance + reconciliation exception, egg lots with egg age | 1.4 | M |
| 1.6 Machines + setter loading | Setter/hatcher master on `asset`, capacity check, setting from one or more egg lots, expected hatch date, machine status | 1.5 | M |
| 1.7 Machine environment + alerts | Manual readings per machine, out-of-range alert, escalation, acknowledge/action/resolve | 1.6 | S |
| 1.8 Candling ×2 + hatcher transfer | Day 10 / Day 18 candling with approval, suggested transfer qty, hatcher IN USE | 1.6 | M |
| 1.9 Hatch + chick vaccination | Full hatch result + KPIs (HOS, HOF, transfer-based, cull, DIH, waste); vaccination with lot/expiry block; chick inventory | 1.8 | M |
| 1.10 Feedback loop | Push fertility/HOF/embryo mortality/cull to flock page + farm dashboard (proportional for mixed settings) | 1.9 | S |
| 1.11 Availability forecast | 12-week view: expected chicks (set qty × flock's historical HOS) − reserved = available, per product/breed/date | 1.6 | M |
| 1.12 Orders, deposits, tiers, waiting list | Sales order states, deposit slabs from rules, payment proof upload + verify (Razorpay link when keys arrive), tiers, waitlist/reschedule | 1.11, 1.2 | L |
| 1.13 Allocation | Shortage detection, recommendation by tier then order date, partial allocation, hatchery-manager approval, override with reason | 1.12, 1.9 | M |
| 1.14 Dispatch & delivery | Vehicle/driver, delivery plan grouped by date/destination, dispatch stamp, POD photo, Ready→Dispatched→Delivered→Completed, invoice auto-created from dispatch | 1.13 | M |
| 1.15 Dashboards + reports | Hatchery, sales, egg, transfer reconciliation, traceability investigation screen | all | M |
| 1.16 Roles + i18n + Android | New roles (hatchery coordinator, ops manager, sales officer, driver), 5-language strings, Flutter screens for collection/candling/hatch/driver POD | all | M |

Each WP finishes with: migration + SQL test, zod schema + act + ACT_ROLES, UI in existing demo style, unit tests for calculations, e2e spec (phone + desktop), QA migration note.

**Phase 1 exit criteria (acceptance)**
- A chick dispatch can be traced back to every contributing flock with quantities in ≤ 2 clicks; a flock traces forward to every customer.
- No downstream screen asks for farm/flock/transfer data already entered upstream.
- Approved candling/hatch/allocation records cannot be edited by non-approvers (SQL-tested).
- Over-allocation impossible without a recorded override.
- Pilot hatchery runs one full cycle (≈ 21 days set→hatch + dispatch) in the system in parallel with paper.

### Phase 2 — SaaS commercialization (≈ 6–8 weeks)
Module entitlements per plan (Starter/Professional/Enterprise/Enterprise Plus), tenant branding, Excel/CSV import for onboarding (flocks, customers, machines), WhatsApp Business API (order status, dispatch, payment link), Razorpay live, customer portal v1 (order status, invoices, payment proof, hatch dates — reuse vendor-portal pattern), pricing page.

### Phase 3 — Enterprise expansion (≈ 8–10 weeks)
Fleet (trips, fuel, vehicle maintenance), preventive maintenance schedules for setters/hatchers, feed/medicine consumption costing per flock, hatchery sanitation/biosecurity/waste records, executive multi-location dashboard, Tally/Zoho live sync, enterprise SSO.

### Phase 4 — Intelligence (after ≥ 6 months of pilot data)
Hatch prediction (per flock age + egg age + machine), demand forecast, mortality/environment anomaly detection, predictive maintenance, KPI assistant (Claude). IoT gateway for setter/hatcher controllers (MQTT/HTTP → `env_reading source='iot'`).

### Phase 5 — Ecosystem
Marketplace (already exists for farm edition), partner APIs (public REST + webhooks), international (currency, units, languages).

---

## 6. Phase-1 priorities (answer to "priorities for the first phase")
1. Traceability link model (many-to-many) — everything else depends on it and it is hardest to change later.
2. Egg transfer → receiving → setting — removes duplicate entry, the first visible win for a pilot.
3. Candling/hatch with approvals + chick inventory — makes availability real.
4. Availability forecast + allocation — the commercial differentiator (H4).
5. Dispatch with POD — closes the chain.
Defer to Phase 2+: customer self-service portal, fleet, procurement changes, AI, IoT.

---

## 7. Investment view (first cut — to validate)

Not in Volume 1; numbers below are assumptions, not research.

| Item | Assumption |
|---|---|
| Phase 0+1 effort | ≈ 4–5 months, 2 developers + part-time domain expert + QA, Claude-assisted |
| Infra at pilot | Supabase Pro + Vercel Pro + WhatsApp/SMS usage — low; confirm current prices before budgeting |
| Revenue streams | SaaS subscription per hatchery (by eggs set/month or machines), implementation fee, integration services, premium support |
| Biggest cost risk | Implementation/onboarding per customer (data migration, training), not software |
| Biggest value proof | Pilot showing reduced over-commitment of chicks and complete traceability |

**Needed from ESG:** target price per hatchery/month, pilot customer list, team allocation, budget cap.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Spine model wrong (1:1 assumption) | WP 1.1 first, with mixed-flock SQL tests and real hatchery sheets |
| Scope too broad for v1 | Phase 1 = spine only; enterprise extras already exist |
| Two products diverge (farm vs hatchery edition) | One codebase, `farm_type` + entitlements decide screens |
| KPI disagreements with customers | Fix formulas in Phase 0, show all three hatchability variants |
| Paid keys still missing (Razorpay, WhatsApp, MSG91, Anthropic) | Get them before pilot; features degrade gracefully today |
| QA environment drift (manual migrations) | Keep `docs/QA.md` per WP; apply migrations per release |
| Data residency for Indian enterprise buyers | Confirm Supabase region in Phase 0 |

---

## 9. What Volume 2 (BRD) must contain for this plan to proceed
- Numbered requirements per WP above with acceptance criteria.
- Final KPI formulas (F5) and egg-age rules (F6).
- Product types, sexing, grades (F9).
- Deposit/refund/cancellation/credit rules (F10).
- Single vs multi-stage setters (F8).
- Role list with permission matrix (module × action × scope × state).
- Notification matrix (event → role → channel).
- Pilot customers and their actual paper formats.

## 10. Immediate next steps
1. Reply to Venkatesh with Section 2 feedback + Section 6 priorities.
2. Ask for the three source specs and pilot hatchery contacts.
3. When Volume 2 arrives: map each BRD requirement onto the WP table, then start WP 1.1.

---
---

# PART B — Volume 2 (BRD) update, 2026-11-18

Source: Volume 2, Chapters 1–12 (v1.0, 14-Aug-2026), PDFs in repo root, read in full (4 parallel reviews).
Note: the PDF tables (BR-ID ↔ priority, RACI, state tables) extract scrambled, so **priority per requirement ID is not trusted** until we get the DOCX/XLSX.

## B1. What Volume 2 contains

| Ch | Topic | Requirements |
|---|---|---|
| 1 | BRD foundation: 8 business goals, P0–P3 priorities, 30 baseline reqs, 10 source rules (BR-RULE-001..010) | 30 |
| 2 | 20 roles, module matrix, RACI, approval authority, segregation of duties, delegation, alert routing | BR-ROL 14 |
| 3 | Tenant lifecycle (8 states), onboarding (12 steps), branch hierarchy, support access, entitlements, import, API credentials | BR-TEN 22 |
| 4 | Parent stock farm (F/M flock, daily, weekly body weight, environment, biosecurity, egg collection, transfer, feedback) | BR-FRM 47 |
| 5 | Egg production & transfer (egg age, farm egg store, reservations, transfer states, variance) | BR-EGG 33 |
| 6 | Hatchery (receiving, machines, setter, 30-min environment, candling D10/D18, hatcher, hatch, vaccination) | BR-HAT 50 |
| 7 | Chick quality grades, vaccine batches, chick inventory, holds, adjustments | BR-QLT 40 |
| 8 | Orders, temp reservation, tiers, deposits, waiting list, payment verification, 2-level allocation, portal | BR-SAL 45 |
| 9 | Delivery planning, routes, vehicle/driver, loading, dispatch, POD, returns | BR-DLV 48 |
| 10 | Assets, PM schedules, breakdowns, work orders, alarms, MTTR/MTBF | BR-MNT 46 |
| 11 | Item master, stock ledger, FEFO, counts, transfers, PR→RFQ→PO→GRN→return | BR-INV 32 + BR-PRC 28 |
| 12 | Operational finance: billing, payment verification, invoices (10 states), credit/debit notes, refunds, collections, accounting integration, period close | BR-FIN 36 + BR-ACC 18 |

**≈ 460 numbered requirements + 30 baseline.** Good quality overall: clear states, exception tables, configurable rules, audit everywhere.

## B2. Status of our Vol 1 feedback

| F | Status in Vol 2 |
|---|---|
| F1 existing build | **Ignored** — still greenfield; stack/cloud "not yet approved" (Ch1 §6.4) |
| F2 AI citation markers | **Worse** — ≈130 `fileciteturn…` markers (Ch1 4, Ch2 16, Ch4 22, Ch5 10, Ch7 14, Ch8 19, Ch9 7, Ch10 ≈19, Ch11 ≈18) |
| F3 source specs | Not attached; now called "NCGR specifications" (undefined) |
| F4 many-to-many traceability | **Ignored, 1:1 stated** — "Transfer must reference one valid source flock" (Ch4 §93.2); setter loading has single farm/flock (Ch6 §148); dispatch has one hatch batch (Ch9 §269) |
| F5 hatchability | **Not fixed** — still Chicks ÷ Day-18 transfer eggs (Ch6 §154.1) |
| F6 egg age | Partial — 7-day warning from collection time (Ch5 §116); nothing on age at setting, egg-room temp, fumigation |
| F7 settable twice | Partial — hatchery settable feeds inventory (Ch6 §145); no rule which wins |
| F8 single/multi-stage | Ignored — one capacity field, no occupancy |
| F9 product types | Partial — configurable grade master; no broiler/layer, no sexing |
| F10 refund/credit | Partial — cancellation rules (Ch8 §242), refunds in Ch12; credit dealers/no-shows/DOA claims missing |
| F11/F12 market/investment | Ignored — pricing "not approved" |
| F13 waterfall | Worse — BRD roadmap now 20 chapters |
| F14 editions | Partial — "small tenants must not be forced into complex hierarchy" (Ch3 §54) |
| F15 WhatsApp | Ignored — channels "Email/SMS/app"; portal P1 |
| F16 GST/tax | Explicitly deferred everywhere |
| F17 hatchery sanitation | Farm biosecurity only |

## B3. Issues found in Volume 2 (to send back)

**Blocking (decide before build)**
1. **Login = email first, mobile optional** (Ch3 §57). Indian farm/hatchery staff use phone; our live app is phone-OTP. Ask: phone OTP primary, email optional.
2. **Traceability is 1:1** (F4) — real setters mix flocks; dispatches mix hatch batches. Must be many-to-many with quantities.
3. **Three overlapping "reservation" objects** — inventory reservation (Ch7 §194, needs batch), temporary reservation (Ch8 §222, no batch), production reservation (Ch8 §236, batch optional). Also Ch7 says allocate only quality+vaccination-eligible stock, Ch8 allocates weeks ahead against forecast — contradictory. Need one model: *forecast reservation* (weeks ahead) → *batch allocation* (hatch day).
4. **Hatchability formula** (F5) and **embryo mortality** excludes early dead (Ch6 §151) while Ch4 §94 includes it. Fertility counts dirty/contaminated as fertile.
5. **12-week forecast has no formula** for expected production; expected hatch date (BR-HAT-013) seems P1 though the forecast depends on it.
6. **GST deferred**, but statutory invoices are needed on day 1. Believed (verify with a CA): day-old chicks and fertilised eggs are GST-exempt → bill of supply, not tax invoice; e-invoice/e-way bill/TDS 194Q/194C, cash limits 40A(3)/269ST, MSME 45-day rule not covered.
7. **Who is the book of accounts** — Ch12 says external accounting is the system of record, but small tenants use HatchPro bills/payments/ledger today (we export to Tally). Decide per edition.

**Contradictions / ambiguities**
- RACI has two "Accountable" on hatching, allocation review, farm feedback, chick quality, vaccination, reconciliation, dispatch confirmation.
- Egg receiving owner: technician (Ch2 §28.3) vs coordination officer (§28.4) vs Hatch Ops Manager (RACI).
- Roles used but not defined: "Dispatch Team", "Farm User"; no Finance/Accounts, Auditor, Procurement roles in Ch2 though Ch9/11/12 need them.
- Branch "optional" (§52) but table shows required (§54.2).
- Expired vaccine: warn (Ch6), warn/block (Ch4), tenant setting (Ch7).
- Order states in Ch9 §280 (Partially Fulfilled, Exception) missing from Ch8 §241; payment status lists differ (§220 vs §229).
- Asset states differ between §299, §300, §316; breakdown and work-order are two parallel state machines.
- "Transfer Reference" used for both farm→hatchery and setter→hatcher.
- °F on the farm (Ch4), °C in the hatchery (Ch6).
- Setter wet-bulb 27–29 °C at 37.5 °C dry bulb seems to correspond to a lower RH than the 50–60 % digital target — please re-check.
- No hatcher release rule (IN USE → EMPTY), no setter occupancy.
- Deposit "% of order value" but unit price optional; "payment-eligible quantity" undefined for a 50 % deposit.
- Undefined KPI formulas: machine performance score, environmental compliance %, egg-to-chick conversion, vaccination coverage, eggs per female.

**Domain gaps (DOC business in India)**
- Chicks are perishable: no max age at dispatch / max hold time; holds and adjustments assume stock can wait.
- Chick boxes (≈100/box), free/extra chicks for transit loss, dead-on-arrival claims, chick-van temperature.
- Daily-changing chick price (booking price vs dispatch-day price).
- Dealers/agents/integrators on credit — "payment verified before dispatch" will clash with them.
- Hatch-pull day has hours, but quality → vaccination → 2-level allocation approvals all sit on it.
- 30-minute machine readings + "no reading" alert effectively require IoT; manual = ~1,000 readings per machine per cycle.
- 0.5 %/day mortality alert is very high for breeders (crisis level) — confirm.
- DPDP Act 2023 (consent, breach notice), data residency, retention periods, TRAI DLT SMS templates not mentioned.

**Over-scope for phase 1 (opinion)**: delegation, role-assignment approval, permission versioning, tenant API keys, import rollback, branding, UAT-gated onboarding, 8-state tenant lifecycle; routes/loading/overlap checks (most of Ch9 marked P0); 6 chick hold types; RFQ, supplier scoring, multi-currency, 5-pattern accounting integration, MTBF. ≈160 requirements in Ch10–12 alone for "secondary" scope.

## B4. Changes to our plan

**Data model (on top of §4)**
- `branch` (optional level) + scopes branch / hatchery / own-records on `user_role_assignment`.
- `tenant_rule` gains categories: approval matrix (per action, role, amount), SoD `allow_self_approval` (default ON for single-owner tenants), `expired_vaccine_policy` (warn|block|override — replaces our hard block), egg-age days, reservation expiry, all environment thresholds (farm + setter + hatcher), deposit slabs, tier order.
- Shared `guard_locked()` also checks creator ≠ approver when SoD is on; allocation gets **two-level** approval (hatchery sales → hatchery manager).
- Farm: `body_weight_record` (weekly, per sex, sample size, uniformity, CV %, fleshing score) instead of daily bw columns; `egg_stock_txn` farm egg store + `egg_reservation`.
- `hatching_egg_collection` adds `collected_at`, `other_reject`, nest+floor=total check; `egg_transfer` adds snapshots (house, breed, flock age), settable vs total sent, oldest egg age, vehicle/driver, override reason+authorizer, states draft→submitted→approved→dispatched→received→reconciled/cancelled; `egg_receipt` unique per transfer + variance reason/review.
- `candling`: `infertile`, `early/mid/late_dead`, `dirty_contaminated`, generated live/transfer eggs; `hatcher_transfer` with approval; machine `machine_no`, occupancy, release rule.
- `alert` lifecycle table (open→ack→actioned→resolved, escalation, routing by role from Ch2 §44).
- `chick_quality_grade` master (dispatch-eligible flag) + `chick_quality_inspection`; `vaccine_batch` table; chick inventory ledger with holds/adjustments (no negatives).
- Commercial: `customer` status + `customer_delivery_location`; `sales_order` states per Ch8 §241 (keep original date); one reservation model (decision pending); `waiting_list`; `payment_verification` (pending/submitted/verified/partial/rejected/waived + proof).
- Dispatch: `vehicle` (type, capacity, doc expiry, status), driver on `worker`, `dispatch`, `dispatch_line` (many hatch batches), POD (receiver, delivered, rejected/short qty), `return_exception`.
- Maintenance: `pm_schedule` (days|hours|batches), usage counters, breakdown root cause/downtime, machine blocked from production while in breakdown.

**Bugs in our own code found by the review (to verify + fix in Phase 1)**
- `receive_grn` reads only the first PO line, and sets `partial` from this receipt not the running total; no accepted/rejected split.
- No SQL guard against issuing more stock than on hand.
- `customer.credit_limit` stored but never enforced.

**Phasing (revised)**
- **Phase 0** adds: get DOCX/XLSX originals; settle the 7 blocking items in B3.
- **Phase 1 (spine)** unchanged order; WP 1.9 splits into 1.9a hatch + quality, 1.9b vaccine batches + chick inventory; WP 1.12 grows (2-level allocation, payment verification); WP 1.14 = **minimal** dispatch (vehicle, driver, dispatch, multi-batch lines, POD) — routes/loading/overlap checks move to Phase 3. Add: machine status blocks setting (BR-MNT-027–030), stock-issue guard + GRN fixes.
- Machine environment: manual 2–4 readings/day in Phase 1, 30-minute cadence only with IoT (Phase 4).
- **Phase 2** adds: PM schedules + due alerts, credit notes/refunds, credit-limit enforcement, period lock, branch level, entitlement enforcement in UI+API, support-access grants with reason/time window, portal v1 (WhatsApp-first).
- **Phase 3** adds: PR/RFQ approval chain, reservations/transfers in-transit, count approvals, unit conversion, serials, supplier KPIs, accounting integration status/reconciliation, collections, routes/loading, delegation, tenant API keys, import rollback.
- **Cut/defer**: multi-currency, API accounting sync (Tally export suffices), permission versioning.
- Estimate impact (rough): Phase 1 grows from ≈12–16 to ≈16–20 weeks if the B3 decisions land as proposed.

---

# PART C — Venkatesh's reply (2026-11-19) + NCGR reference specs, 2026-11-20

Sources: `reply_email.pdf` (answers to our 37 questions), `Parent Stock 1.pdf`, `hatchery 1.pdf`, `sales 1.pdf` (NCGR Ltd, Isaac Habumugisha, June 2026). Vol 2 originals were **not** sent; we work from the Vol 2 PDF text already extracted. Requirement IDs + P0/P1/P2 read cleanly from it (≈500 IDs); the garbled Vol 2 RACI table is superseded by the RACI in the reply (C1). Venkatesh states his answers are *proposed*, not management-approved — items marked **(mgmt)** stay open.

## C1. Decisions now fixed for the build

| Area | Decision | Plan impact |
|---|---|---|
| Login | Mobile + OTP primary; email = verified secondary (notifications, recovery) | Matches live app; no change |
| Branch | Optional level; org-level users see consolidated data | `branch` nullable FK (B4) |
| RACI | One final Accountable per activity: farm daily/feed/egg collection/egg transfer → Farm Manager; egg receiving, candling, setter→hatcher, dispatch confirmation → Hatchery Ops Manager; hatch report, chick allocation → Hatchery Manager; chick quality → Vet Lead / designated Hatchery Mgr; vaccination → Vet Lead; financial reconciliation → Finance Manager | Seed `tenant_rule` approval matrix with this table |
| Egg receiving | Draft receipt auto-created from approved transfer; Production Technician confirms qty/rejects/discrepancy; Coordination Officer verifies; Hatch Ops Mgr accountable | WP 1.5 as planned |
| Roles | Add Dispatch Team, Farm User (scoped to assigned farms/houses), Finance/Accounts, Auditor (read-only), Procurement — all optional/configurable | WP 1.16 role list |
| Self-approval | Allowed for owner/admin, configurable per tenant; creator+approver kept; always audit-logged; extra control for refunds/credit notes/high-value adjustments | `allow_self_approval` rule (B4) confirmed |
| Traceability | Multiple source lots per setter batch allowed (Phase 1 prefers single flock); per-lot quantities kept; mixed-source feedback shown as **estimated** (proportional) | WP 1.1 `setting_lot` + `is_estimated` flag on feedback |
| Multi-batch orders | One order fulfilled from many hatch batches; allocation + dispatch ref per batch | `order_allocation`, `dispatch_line` confirmed |
| Hatchability | Show HES (Chicks ÷ Eggs Set), HOF (Chicks ÷ Fertile, Fertile = Set − Infertile), Hatch of Transfer (Chicks ÷ Transfer eggs). Farm dashboard: HES primary, HOF + fertility supporting. Hatchery dashboard: all three | WP 1.9/1.10 |
| Embryo mortality | Early (D10), mid, late each ÷ Eggs Set; Total = sum. Dirty/contaminated tracked separately, not mortality | `candling` generated cols |
| Forecast | Expected chicks = forecast eggs set × expected hatch rate (approved planning rate or history); saleable = expected − expected culls; available = saleable − reservations; by hatch week/date, product, breed, batch; 12-week rolling + 3-week near-term view | WP 1.11 |
| Machine score | No composite score in v1 — show temp compliance, RH compliance, uptime, alarm count, fan/sensor failures separately | WP 1.7/1.15 |
| Env compliance % | In-range valid readings ÷ valid readings × 100, per temp/RH + overall; missing readings reported separately, never counted compliant | WP 1.7 |
| Egg→chick | Saleable chicks ÷ eggs set × 100, plus gross (chicks hatched) version | WP 1.15 |
| Vaccination coverage | Vaccinated eligible ÷ eligible in hatch batch, per vaccine/dose; overall status required before dispatch | dispatch eligibility check |
| Eggs per female | Period eggs ÷ Σ daily remaining females; daily = hen-day % | WP 1.4 |
| Units | Store °C; tenant display °C/°F; keep original value+unit on migrated records | `env_reading.temp_c` + display pref |
| Setters | Configurable single/multi-stage on machine register; Phase 1 = setter→hatcher flow | `asset.stage` |
| Hatcher release | IN USE → EMPTY only after: results, chicks removed + reconciled, waste recorded, cleaning/disinfection, post-hatch checklist, authorised "ready" confirmation | new `machine_release` checklist record |
| Egg age | Computed at transfer, receiving and setter loading; setting over max storage days (spec: 7) needs authorised override + reason | WP 1.5/1.6 |
| Env readings | Manual and sensor both; each reading stores source; sensor-silence alert | `env_reading.source` (B4) confirmed |
| Expired vaccine | Default **warn**; tenant policy can block; override records user/reason/time | `expired_vaccine_policy` rule (B4) confirmed |
| Floor/dirty eggs | Floor eggs excluded from settable by default; dirty not set untreated; treated qty may be recorded separately under approved process; broken/cracked/misshapen/double-yolk/small/soft-shell always reject | WP 1.4 |
| Products | Configurable Chick Product Master: category, breed/strain, sex, optional grade, vaccination reqs, price, active | replaces fixed `product` enum in `sales_order` |
| Reservations | Temporary (24 h default, ≤48 h, pending payment) → Production reservation (against forecast) → Final allocation (actual eligible chicks). Flow: order → temp → payment verification → sales review → production reservation → allocation review → Hatchery Mgr approval → final allocation → dispatch | Resolves B3 blocking #3 |
| Deposit | <500 none; 500–5,000 = 50 %; >5,000 = 100 %. Verified 50 % lets the **full** qty proceed to reservation/allocation review; no guaranteed availability | WP 1.12 |
| Credit | Customer credit terms + limits + outstanding; dispatch before payment verification **blocked by default**; exceptions only for approved-credit customers or mgmt approval; overrides audited | Enforce `credit_limit` (fixes own-code bug) |
| Price lock | Locked at commercial approval; later change = authorised amendment + customer confirmation; keep original/revised/reason/approver | `sales_order.price_locked_at` + amendment log |
| Cancellation/no-show/DOA | Record reason, dates, approval, refund status; partial cancellation; DOA claims linked to order/batch/delivery/evidence; refunds need approval + txn ref | WP 1.12/1.14 (policy values = mgmt) |
| Max dispatch age | Configurable per product; system computes age, blocks beyond limit unless authorised exception | `tenant_rule` |
| SLA defaults | Temp reservation 24 h; waitlist offer 12 h; Platinum approval 2 business hours — all configurable | seed `tenant_rule` |
| Notifications | In-app, SMS, email, WhatsApp; tenant + user preferences | existing notification + WhatsApp work |
| Book of accounts | HatchPro = operational/commercial (orders, invoices, deposits, verification, receivables refs, refunds/credit notes, reports); GL/statutory/tax returns in external system; integration not tied to one product | Resolves B3 #7; keep Tally export |
| Tax | Configurable tax categories/rates per product & txn; GSTIN on parties; e-invoice/e-way bill/TDS kept possible; **no hard-coded rates** | WP 1.14 invoice uses tax config |
| Approval limits | Configurable by txn type, amount, role, branch, risk. PR → Dept/Store Mgr; PO → Procurement Mgr; stock adj → Store Mgr (+extra for high value); credit note → Finance Mgr; refund → Finance Mgr / mgmt | `tenant_rule` approval matrix |
| Currency | INR default; multi-currency deferred unless pilot needs it | see C3 |
| Invoice trigger | Order confirmation doc → payment receipt on advance → sales invoice + delivery note at dispatch → POD closes | WP 1.14 |

## C2. What the NCGR specs add (not already in plan)

- **Parent stock:** Flock ID format `NCGR-F01-2026-W22`; breeds Ross/Cobb/Other; auto production calendar (light stimulation = placement + 21 wk, first egg + 25 wk, peak, depletion). Daily F/M mortality + culls, daily & cumulative mortality %. Weekly body weight per sex (sample ≥50 F or 2 %, ≥15 M or 10 %), uniformity, CV %, male fleshing score 1–5, breed standard table, alert at ±10 %. Feed per diet stage (Starter/Grower/Pre-Breeder/Breeder 1/2), g/bird per sex, clean-up time, feed store days-remaining alert < 3 days. Water meter, ml/bird, water:feed ratio, treatment, quality; alert −20 % / +30 % vs previous day avg. Egg collection 1st–4th per day; floor egg alert > 5 %. Transfer ref `TRF-2026-W30-F01`, oldest egg ≤ 7 days. Vaccination route (eye drop/water/injection/spray), medication record, disease investigation, biosecurity incident. Environment ≥ 2×/day: temp 65–81 °F (alert >90/<59 °F), RH 50–70 %, ventilation, light hours/lux, litter (alert Wet/Caked), ammonia (alert >20 ppm), power source. Hatchery feedback per transfer batch with 4-week rolling trend. Shared keys: Farm ID, Flock ID, Transfer Ref.
- **Hatchery:** incubation batch ID `INC-2026-W30-001`; setter env normal dry bulb 37.5 ± 0.3 °C, wet bulb 27–29 °C, RH 50–60 %; alerts >37.8/<37.2 °C, >65/<45 % RH, fan = 0, no reading → Ops Mgr + Maintenance. Live eggs = set − infertile − early dead − dirty. Hatch: cull % = culls ÷ hatched; dead-in-hatcher % and hatch waste % ÷ transfer eggs; chick inventory += hatched − culls. Allocation blocked at balance ≤ 0 + notify Hatchery Mgr. Dispatch docs: delivery note per customer, dispatch list per hatch, customer allocation list; dispatch time auto-stamped. One-click trace report from any delivery. Equipment register incl. generators, HVAC, compressors; breakdown downtime hours. Dashboards daily/weekly/monthly incl. farm comparison, vaccine consumption, machine downtime.
- **Sales:** waiting list auto-suggests next available hatch date and notifies on freed space; tiers Platinum/Gold/Standard; sales performance per field manager (new customers, orders volume/value, revenue, on-time collection %, retention); customer portal (status, invoices, payment-proof upload, hatch dates/availability, notifications); allocation meeting step — no auto-approval under shortage; partial allocation + reschedule.

**Plan changes from C1/C2**
- WP 1.3 adds production calendar, weekly `body_weight_record` with breed-standard table, water-meter record, feed diet stages + days-of-feed alert, medication/disease/biosecurity records.
- WP 1.6 adds `machine_release` checklist; WP 1.12 adds Chick Product Master, price lock/amendment, credit check at dispatch, waiting-list next-date suggestion; WP 1.14 adds the 3 dispatch documents + tax-config invoice; WP 1.15 adds sales performance + farm comparison + one-click trace report.
- `tenant_rule` seed values = numbers in C1/C2 (alert thresholds, deposit slabs, SLAs, egg age 7 d).
- Phase 0 exit now only waits on C3 items, not on Vol 2 originals.

## C3. Still open (need from ESG/management)

1. Pilot organisation(s) + volumes (farms, houses, setters, hatchers, users, transactions) — not finalised.
2. Specs are NCGR Ltd (Rwanda deliveries), reply says India/INR/GST — confirm pilot country, currency and tax regime.
3. Sample registers (11 listed in reply) — to be collected.
4. (mgmt) Chick product catalogue; credit policy + limits; cancellation/refund %, DOA claim window; max dispatch age per product; approval monetary thresholds; SLA defaults sign-off; invoice milestone + GST treatment (tax advisor).
5. Updated Vol 1/2 chapters after these decisions (Venkatesh's step 8).

