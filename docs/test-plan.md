# HatchPro web — end-to-end test plan

Built by reading the code at commit `01a7ed5` (branch `worktree-pdf-reports`): routes in `apps/web/app/**`, every form act in
`app/actions/forms.ts` (`runAct`), validation in `lib/schemas.ts`, roles in `lib/auth/permissions.ts` + `route-guard.ts`,
DB rules in `supabase/migrations/0001–0032`, existing Playwright specs in `apps/web/e2e/*.spec.ts` and SQL tests in
`supabase/tests/*.sql`. Nothing was executed while writing it.

## 1. Scope

**In scope:** every screen and form a real user touches in the web app (farm tenant app, public `/apply`, vendor portal,
platform console), as **positive**, **negative** (validation / DB rule), **edge** (limits, boundaries, double-submit,
offline, cross-tenant) and **role** (wrong role, suspended tenant) cases. Run on both Playwright viewports: **phone 390×844**
and **desktop 1280×800** (`playwright.config.ts` projects `phone` / `desktop`).

**Out of scope (needs real external accounts / keys) and why:**

| Feature | Why skipped | What is still tested |
|---|---|---|
| Razorpay checkout (vendor plan, `ad-checkout`) | needs live Razorpay keys + real card/UPI | "Online payment is not set up yet" message; signed webhook simulated locally (marketplace.spec) |
| Real SMS / MSG91 (apply OTP for non-test numbers) | needs MSG91 key + template | test numbers via `APPLY_TEST_OTP` / `APPLY_TEST_PHONES`; `sms_not_configured` error text |
| AI triage results (`ai-triage`) | needs `ANTHROPIC_API_KEY` | photo upload to private bucket + "AI check is not set up yet" |
| WhatsApp Business API sending (daily alerts) | needs `WHATSAPP_TOKEN` | wa.me click-to-chat link generation + reminder_log |
| Web Push delivery to a real phone | needs VAPID keys + real device | Push toggle UI, permission prompt, subscription row |
| Play Store signing / Android release | needs keystore | — (Flutter app not covered here) |
| Cloudflare Turnstile real challenge | needs site key | Turnstile test key auto-passes locally |

## 2. Test logins (local Supabase, OTP `123456` for all — `supabase/config.toml [auth.sms.test_otp]`)

| Alias | Mobile (type 10 digits) | Who | Tenant / role | Lands on |
|---|---|---|---|---|
| OWN | 98490 12345 | Venkata Krishna Reddy | VKR Poultry Farms · tenant_owner (profile lang te) | /welcome first time, then /home |
| SUP | 90000 33445 | Mallesh | VKR · shed_supervisor | /home (tabs: home, farm, log, more) |
| FIN | 98490 22334 | Rajitha Reddy | VKR · finance | /home (tabs: home, money, more) |
| KSO | 94400 12121 | K. Srinivasulu | KS Farms · tenant_owner (broiler, hatchery, contract) | /home |
| PA | 90000 00000 | Praveen G | platform_admin (use `/platform/login`) | /admin |
| APP | 99990 00001 | e2e applicant | none until approved | "no account" until approval |
| INV | 99990 00002 | e2e invitee | whatever role OWN/APP invites | per role |
| VEN | 99990 00003 | e2e marketplace vendor | advertiser (created by PA "+ Advertiser") | /vendor |

**Setup gaps for roles without a test OTP** (tester action, local config only — not a code change): seed users
Suresh Yadav **farm_manager** (`919000011223`), Dr. Ramesh Babu **veterinarian** (`919866077889`), Narsimha **store_keeper**
(`919000099001`) exist in `seed.sql` but have no `test_otp` entry — add them locally, or invite INV with each role
(labour, auditor, veterinarian, store_keeper, farm_manager) in turn. Aliases below: MGR, VET, STK, LAB, AUD. Platform teams
other than admin (platform_sales / _finance / _ops / _support / _marketing) have **no seed login at all** → PLT-R* cases need one created.

Seed anchors: VKR batches `VKR-B-2026-14` (broiler, growing), `VKR-B-2026-13` (closed), `VKR-L-2026-01/02` (layer, laying),
`VKR-P-2026-03` (pullet); KS `KS-B-2026-21` (broiler, contract), `KS-H-2026-37` (hatchery, 57,600 eggs set). Bill
`VKR-B0004` (₹3,97,800 partial). QA "today" = `APP_TODAY` (2026-10-19 with the demo seed).

**Tamper method** (server-side role/validation checks hidden by the UI): on any tenant page, DevTools console
`window.dispatchEvent(new CustomEvent('hp-act',{detail:{act:'<act>',ctx:{}}}))` opens the form even if the button is hidden;
edit field values / remove `required` / change `<select>` options in the Elements panel, then submit. Expected server
messages: `forms.invalid` (red fields), `forms.forbidden` = "Your role cannot do this", `forms.notFound`.

**Spec aliases used in the Status column** (all in `apps/web/e2e/`):

| Alias | Spec · test |
|---|---|
| auth#picker | auth.spec · owner picks a farm type once, then lands on Home directly |
| auth#switch | auth.spec · view can be switched from the tenant chip |
| auth#supMoney | auth.spec · supervisor has no Money tab and is bounced from /money |
| auth#staff | auth.spec · platform admin uses the staff login; farm login rejects them |
| auth#unknown | auth.spec · unknown number cannot self-register |
| auth#overflow | auth.spec · no horizontal overflow on login, welcome, home |
| forms#batchMort | forms.spec · place a batch in a free shed, then record mortality on it |
| forms#log | forms.spec · daily log saves and shows in the batch table |
| forms#sale | forms.spec · sale on credit appears in receivables, receiving it in full marks it paid |
| forms#att | forms.spec · attendance: tapping H marks the worker half-day today |
| forms#role | forms.spec · server refuses actions outside the role (supervisor cannot place a batch) |
| forms2#life | forms2.spec · batch lifecycle: place → change stage → close with lifting invoice |
| forms2#equip | forms2.spec · equipment: high-priority issue alerts the owner; closing with a cost books a bill |
| forms2#stock | forms2.spec · stock: raise a PO, receive it with a bill above the PO → variance flagged, stock up |
| forms2#docs | forms2.spec · compliance: a document expiring soon shows a days-left pill |
| forms2#supBtns | forms2.spec · roles: a supervisor does not see owner-only buttons |
| forms2#exports | forms2.spec · exports download real files; a supervisor is refused money exports |
| forms2#approval | forms2.spec · payment over ₹50,000 by finance waits for the owner, who approves it |
| alerts#live | alerts.spec · a new alert pops up live and push can be turned on |
| console#all | console.spec · platform console sections and audited support view (desktop only) |
| contract#settle | contract.spec · contract terms → link batch → settle with integrator |
| farm3d#live | farm3d.spec · live 3D farm: open a shed, mortality updates live |
| hatch#flow | hatchery.spec · hatchery: candle, hatch and dispatch a setting |
| i18n#langs | i18n.spec · profile language applies at login, picker switches all five languages |
| market#journey | marketplace.spec · vendor lists, pays, gets approved; farmer contacts; vendor sees the lead (desktop only) |
| offline#log | offline.spec · daily log saved offline syncs when back online |
| offline#photo | offline.spec · dead-bird photo is stored privately and sent to AI triage |
| onboard#journey | onboarding.spec · apply → approve → owner gets farm + sheds → invites a supervisor (desktop only) |
| payroll#bank | payroll.spec · owner adds bank details and downloads the salary bank file |
| remind#wa | remind.spec · owner sends a WhatsApp payment reminder and it is logged |
| reports#print | reports.spec · owner generates each printable report |
| screens#all | screens.spec · all tenant screens render with data and no horizontal overflow (OWN, layer view) |
| shift#add | shift.spec · shift entries add to the day, also offline |
| tenants#suspend | tenants.spec · platform suspends a tenant → its owner is locked out; add tenant opens the application form (desktop only) |

**DB-level rules already proven by SQL tests** (`supabase/tests/`, run with psql): `approval_test` (₹50k gate, split
payments, direct edits refused), `suspension_test` (read-only tenant), `roles_test` (supervisor JWT limits, owner/manager
escalation), `hatchery_test`, `contract_test`, `marketplace_test`, `apply_verify_test`, `audit_test`, `worker_bank_test`,
`shift_log_test`, `reminders_test`, `push_test`, `storage_test`, `sync_receipt_test`, `tenant_billing_test`, `owners_test`,
`actions_test`, `actions_0005_test`, `gateway_payment_test`. Unit tests (`apps/web/tests/unit`) cover `redirectFor`,
schemas, KPIs, settlement, reports. These are noted as "(SQL: x)" / "(unit: x)" but rows are still marked **GAP** when no
browser test drives the case through the UI — the plan is about what an end user sees.

**Status legend:** `COVERED <alias>` = an existing e2e test asserts this; `GAP` = no e2e test (manual or new spec needed).
`⚠ verify` in Expected = the code has no guard for this; the expected behaviour is what *should* happen and a failure is a
likely defect, not a test error.

---

## 3. Test cases

### 3.1 Auth & routing

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| AUTH-01 | Farm login with valid OTP | Positive | OWN | /login → 98490 12345 → Send OTP → 123456 → Verify | First time /welcome; later /home | COVERED auth#picker |
| AUTH-02 | Mobile with formatting accepted | Edge | OWN | Enter `+91 98490-12345` | Normalised to +919849012345; OTP field appears | GAP |
| AUTH-03 | Wrong OTP | Negative | OWN | Send OTP → enter `000000` → Verify | Red alert pill (token invalid/expired); stays on login | GAP |
| AUTH-04 | OTP with 5 digits | Negative | OWN | Enter `12345` → Verify | Refused by GoTrue; error pill; no session | GAP |
| AUTH-05 | OTP field max length | Edge | OWN | Paste `1234567890` | Field keeps 6 chars (maxLength=6) | GAP |
| AUTH-06 | Empty mobile | Negative | ANON | Click Send OTP with empty field | Browser `required` blocks submit | GAP |
| AUTH-07 | 9-digit / letters mobile | Negative | ANON | `98490123` / `abcdefghij` → Send OTP | Error pill from Auth; OTP field not shown | GAP |
| AUTH-08 | Unknown number cannot self-register | Negative | ANON | 99999 99999 → Send OTP | "no account" pill | COVERED auth#unknown |
| AUTH-09 | OTP resend rate limit | Edge | OWN | Send OTP, Change number, Send again within 1 s | "only request this after…" pill; retry after wait works | GAP (only handled as retry inside every spec) |
| AUTH-10 | Change number button | Positive | OWN | After Send OTP → "Change number" | Mobile editable again, code cleared | GAP |
| AUTH-11 | Platform staff at farm login | Negative | PA | /login with 90000 00000 | Signed out again; pill points to /platform/login | COVERED auth#staff |
| AUTH-12 | Platform staff at /platform/login | Positive | PA | /platform/login → OTP | /admin with tenant list (KS Farms visible) | COVERED auth#staff |
| AUTH-13 | Farm user at /platform/login | Negative | OWN | /platform/login with 98490 12345 | Signed out; "not staff" pill | GAP |
| AUTH-14 | Vendor at farm login lands on portal | Positive | VEN | /login with 99990 00003 | /vendor | COVERED market#journey |
| AUTH-15 | User with no role / no tenant | Negative | INV (role removed) | Delete INV's user_role_assignment, log in | /login?error=no-access with "no role" pill; no loop | GAP (unit: auth.test) |
| AUTH-16 | Signed-in user opens /login | Edge | OWN | While logged in open /login | Redirected to /home | GAP (unit) |
| AUTH-17 | Anonymous opens tenant page | Negative | ANON | Open /home, /money, /farm/batch/VKR-B-2026-14 | Redirect /login | GAP (unit) |
| AUTH-18 | Anonymous opens /admin | Negative | ANON | Open /admin, /admin/tenant/<id> | Redirect /platform/login | GAP (unit) |
| AUTH-19 | Anonymous opens /vendor | Negative | ANON | Open /vendor | Redirect /login | GAP |
| AUTH-20 | Anonymous opens /apply | Positive | ANON | Open /apply | Form shown, no redirect | COVERED onboard#journey |
| AUTH-21 | Platform user opens tenant URL | Role | PA | Open /home, /money | Redirect /admin | GAP (unit) |
| AUTH-22 | Platform user opens /apply | Role | PA | "+ Add tenant" → /apply | Allowed | COVERED tenants#suspend |
| AUTH-23 | Tenant user opens /admin | Role | OWN | Open /admin | Redirect /home | GAP (unit) |
| AUTH-24 | Tenant user opens /vendor | Role | OWN | Open /vendor | Redirect /home | GAP |
| AUTH-25 | Vendor opens tenant/admin URL | Role | VEN | Open /home, /admin, /apply | Redirect /vendor each time | GAP |
| AUTH-26 | Supervisor tabs + bounced from /money | Role | SUP | Login; open /money | No Money tab; /money → /home | COVERED auth#supMoney |
| AUTH-27 | Finance tabs and blocked tabs | Role | FIN | Login; open /farm, /log | Tabs Home/Money/More only; /farm and /log → /home | GAP |
| AUTH-28 | Labour lands on Log | Role | LAB | Login | Lands /log; only Log + More tabs; /home → /log | GAP |
| AUTH-29 | Store keeper tabs | Role | STK | Login; open /farm, /money, /log | Home/More only; others → /home | GAP |
| AUTH-30 | Auditor tabs | Role | AUD | Login; open /log | Home/Farm/Money/More; /log → /home | GAP |
| AUTH-31 | Vet tabs | Role | VET | Login; open /money | Home/Farm/Log/More; /money → /home | GAP |
| AUTH-32 | Unknown /more section | Negative | OWN | Open /more/xyz | 404 page | GAP |
| AUTH-33 | Cross-tenant batch URL | Role | KSO | Open /farm/batch/VKR-B-2026-14 | Not found / empty — no VKR data shown | GAP (SQL: hatchery/contract cross-tenant) |
| AUTH-34 | Cross-tenant support URL by tenant | Role | OWN | Open /admin/tenant/<KS id> | Redirect /home | GAP |
| AUTH-35 | Sign out | Positive | OWN | More → Sign out | /login; Back button does not show data; /home → /login | GAP |
| AUTH-36 | Offline copies cleared on login page | Edge | SUP then OWN | SUP saves log offline page, sign out, OWN logs in on same browser | No SUP cached pages/outbox shown to OWN | GAP |
| AUTH-37 | Session survives reload | Positive | OWN | Login, reload /money | Still signed in | GAP |
| AUTH-38 | Suspended tenant locked out | Role | KSO | PA suspends KS → KSO logs in | "Account suspended" alert; no app | COVERED tenants#suspend |
| AUTH-39 | Suspended tenant form via tamper | Role | KSO (suspended) | Tamper `addCustomer` and submit | "Your role cannot do this"; no row (DB read-only too) | GAP (SQL: suspension_test) |
| AUTH-40 | Reactivated tenant regains access | Positive | PA, KSO | Set KS back to active → KSO logs in | Normal /home | GAP |
| AUTH-41 | Suspension does not affect other tenant | Role | OWN | While KS suspended, OWN saves a form | Works | GAP (SQL: suspension_test) |
| AUTH-42 | Profile language applied at login | Positive | OWN | Clear cookies, login | UI in Telugu (`lang=te`) | COVERED i18n#langs |

### 3.2 Onboarding / apply (public, `/apply`, `apply-otp` edge function)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| APP-01 | Full application happy path | Positive | APP | Fill required fields, verify mobile, attach PDF, 2 sheds, consent, Submit | "Application received"; row phone_verified=true, 1 document | COVERED onboard#journey |
| APP-02 | PAN lower-case normalised | Edge | APP | PAN `abcde1234f` | Accepted, stored `ABCDE1234F` | COVERED onboard#journey |
| APP-03 | PAN invalid format | Negative | APP | PAN `ABCDE12345` / `ABCD1234F` / blank | "invalid" + PAN field red | GAP (unit: schemas) |
| APP-04 | GSTIN invalid length | Negative | APP | GSTIN `36AAECV1234K1Z` (14) / 16 chars / `36AAECV1234K1Z$` | GSTIN red | GAP |
| APP-05 | GSTIN optional + lower-case | Edge | APP | Blank GSTIN; then `36aaecv1234k1z5` | Blank OK; lower-case upper-cased | GAP |
| APP-06 | Email invalid | Negative | APP | `ravi@` / `ravi.example.com` | Email red | GAP |
| APP-07 | PIN code invalid | Negative | APP | `50211` / `5021100` / `50211A` | PIN red | GAP |
| APP-08 | Lat/Lng outside India | Negative | APP | lat `40`, lng `60` (bounds 6–38 / 68–98) | Fields red | GAP |
| APP-09 | Land acres bounds | Edge | APP | `0`, `-1`, `10001`, `10000` | First three red; 10000 OK | GAP |
| APP-10 | No farm type ticked | Negative | APP | Untick all farm types | farm_types red | GAP |
| APP-11 | Consent unchecked | Negative | APP | Leave consent unchecked, Submit | Refused; consent red | GAP |
| APP-12 | Shed row limits | Edge | APP | Shed capacity `0`; length `2001`; width `501`; name blank | Each refused | GAP |
| APP-13 | Shed count bounds | Edge | APP | Remove all sheds; add 61 sheds | 0 → refused (min 1); 61 → refused (max 60) | GAP |
| APP-14 | Counts out of range | Edge | APP | current_birds `1000001`, labour `-1`, `2.5` | Refused | GAP |
| APP-15 | Business name max length | Edge | APP | 121 chars; 120 chars; spaces only | 121 / spaces refused; 120 OK | GAP |
| APP-16 | Submit without verifying mobile | Negative | APP | Fill all, skip Verify, Submit | "Verify your mobile first"; phone field red (HP401) | GAP (SQL: apply_verify_test) |
| APP-17 | Send code with bad mobile | Negative | APP | Mobile `12345` → Send code | "Enter a 10-digit Indian mobile…" | GAP |
| APP-18 | Mobile starting 0–5 | Negative | APP | `5999000001` | bad_phone | GAP |
| APP-19 | Wrong apply OTP | Negative | APP | Send code → `000000` → Verify | "Wrong code. Try again." | GAP |
| APP-20 | 6th wrong attempt | Edge | APP | 5 wrong codes then correct one | Check burnt → "That code expired. Send a new one." | GAP |
| APP-21 | Code after 10 minutes | Edge | APP | Send, wait >10 min (or age row), Verify | expired | GAP |
| APP-22 | 4th code in 10 min | Edge | APP | Send code 4× | 4th: "Too many codes for this number. Wait 10 minutes." | GAP |
| APP-23 | Non-test number without SMS keys | Negative | ANON | Mobile 98765 43210 → Send | "SMS is not set up yet…" | GAP |
| APP-24 | Change mobile after verify | Edge | APP | Verify, then edit mobile, Submit | Must re-verify (verified flag cleared) — ⚠ verify | GAP |
| APP-25 | Upload JPG / PNG / PDF | Positive | APP | Attach one of each | Listed by name | COVERED onboard#journey (PDF only) |
| APP-26 | Upload wrong type | Negative | APP | Attach `.docx` / `.gif` (bypass accept) | "Only JPG, PNG or PDF up to 10 MB." | GAP |
| APP-27 | Upload >10 MB / 0 bytes | Edge | APP | 10.1 MB PDF; empty file | bad_file | GAP |
| APP-28 | 6th document | Edge | APP | Attach 6 files | "Up to 5 documents." | GAP |
| APP-29 | Upload before verify | Negative | APP | Attach before verifying | Not allowed (needs verified check) | GAP |
| APP-30 | Tampered document path | Negative | APP | Edit request `documents[0].path` to `applications/other/x.pdf` | "document not uploaded through this application" (HP402) | GAP (SQL: apply_verify_test) |
| APP-31 | Reuse a used check for a 2nd application | Negative | APP | Submit, then submit again same session | Refused (check used) → verifyFirst | GAP (SQL) |
| APP-32 | 4th application same phone / day | Edge | APP | Submit 3 OK, 4th | duplicate message (P0001) | GAP |
| APP-33 | Double-click Submit | Edge | APP | Double-click Submit fast | One application row only | GAP |
| APP-34 | Applicant cannot log in before approval | Negative | APP | /login 99990 00001 | "no account" | COVERED onboard#journey |
| APP-35 | Alt phone / WhatsApp invalid; WhatsApp blank defaults | Edge | APP | alt `123`; WhatsApp blank | alt red; whatsapp stored = phone | GAP |
| APP-36 | Apply page in Telugu and on phone | Edge | ANON | Switch language; 390px width | All labels translated; no horizontal overflow | GAP |

### 3.3 Welcome / farm-type picker & switcher

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| WEL-01 | Pick farm type first time | Positive | OWN | Login → /welcome → Layer | /home "Layer view"; next login skips picker | COVERED auth#picker |
| WEL-02 | Single farm type skips picker | Edge | APP (approved, broiler only) | Login | Straight to /home | COVERED onboard#journey |
| WEL-03 | Switch view from tenant chip | Positive | OWN | Switch view → Broiler | "Broiler view"; lists filter to broiler | COVERED auth#switch |
| WEL-04 | Hatchery view for KS | Positive | KSO | Switch view → Hatchery | Hatchery batches + hatch card | COVERED hatch#flow (set via DB) |
| WEL-05 | Picker only shows tenant's types | Edge | OWN | Open /welcome | Only Layer + Broiler (VKR has no hatchery) | GAP |
| WEL-06 | Tampered farm type | Negative | OWN | Call `setFarmType('duck')` via devtools/server action replay | Error "Unknown farm type"; no DB change | GAP |
| WEL-07 | /welcome when signed out | Negative | ANON | Open /welcome | Redirect /login | GAP |
| WEL-08 | Language picker on welcome | Positive | OWN | Change to Hindi on /welcome | Page re-renders in Hindi | GAP |
| WEL-09 | Supervisor picker | Role | SUP | First login | Picker then /home with SUP tabs | COVERED forms2#supBtns (type preset) |

### 3.4 Home

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| HOME-01 | Home renders with KPIs | Positive | OWN | /home (layer view) | "Good morning", Birds alive, eggs vs yesterday tiles | COVERED screens#all |
| HOME-02 | Broiler view tiles | Positive | OWN | Broiler view /home | FCR/day tile, broiler rate trend | GAP |
| HOME-03 | Quick action Mortality | Positive | OWN | Tap ☠️ | Mortality form for an active batch | GAP |
| HOME-04 | Quick action Sale / Payment / Attendance | Positive | OWN | Tap 🧾 / 💸 / 👷 | Sale form; payment form with open docs; navigates /more/people | GAP |
| HOME-05 | Quick actions hidden by role | Role | SUP, FIN | Open /home | SUP: no Sale/Payment; FIN: no Mortality | GAP |
| HOME-06 | Place batch button | Positive | OWN | Tap "Place batch" | addBatch form (free shed) | GAP |
| HOME-07 | Mortality spike alert tile | Edge | OWN | Raise today's mortality on VKR-B-2026-14 well above baseline | Tile "spike in <shed>" (crit colour) | GAP |
| HOME-08 | Notifications link + count | Positive | OWN | Tap "All (n) ›" | /more/notifications | GAP |
| HOME-09 | Empty tenant home | Edge | APP (new owner) | Login to fresh tenant | No crash; zeros/dashes, "Place batch" visible | GAP |

### 3.5 Farm (farms, sheds, batches, 3D, batch page)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| FARM-01 | Farm screen renders | Positive | OWN | /farm | "Farms & sheds", farm cards, 3D stage | COVERED screens#all |
| FARM-02 | addFarm happy | Positive | OWN | + Farm → name `Test Unit`, broiler, capacity 10000 | Toast "farm saved"; card appears | GAP |
| FARM-03 | addFarm validation | Negative | OWN | Name blank / 121 chars / spaces; capacity `0`, `-5`, `2.5` | invalid + red fields | GAP |
| FARM-04 | addFarm wrong role | Role | SUP, FIN | Tamper `addFarm` | "Your role cannot do this"; no row | GAP |
| FARM-05 | addShed happy | Positive | OWN | + Shed → farm, `Shed Z`, cage, capacity 5000, area 4000 | Shed card appears free | GAP |
| FARM-06 | addShed validation | Negative | OWN | Capacity blank / 0; area `-1`; name 121 chars | invalid | GAP |
| FARM-07 | addShed with no farms | Edge | APP-owner with farms deleted | + Shed | Intro "add a farm first", no fields | GAP |
| FARM-08 | addShed wrong role | Role | SUP, FIN | Tamper `addShed` | forbidden | GAP |
| FARM-09 | addBatch happy (place in free shed) | Positive | OWN | Shed B → code, 5000 chicks, ₹38 | Toast "vaccination schedule ready"; /farm/batch/<code>; Birds 5,000 | COVERED forms#batchMort |
| FARM-10 | addBatch with vendor + rate books chick bill | Positive | OWN | Place with DOC vendor + rate ₹40 × 1000 | Bill ₹40,000 category chick in Payables | GAP |
| FARM-11 | addBatch validation | Negative | OWN | Chicks `0`, `-1`, `1.5`; rate `-1`; code blank / 121 chars | invalid / 'chick count must be positive' | GAP |
| FARM-12 | addBatch duplicate code | Negative | OWN | Code `VKR-B-2026-14` | Friendly duplicate error (unique tenant+code) — ⚠ verify not raw "duplicate key" | GAP |
| FARM-13 | addBatch into busy shed (tamper) | Negative | OWN | Change shed_id to Shed A (active) | "shed already has an active batch" | GAP |
| FARM-14 | addBatch no free shed | Edge | OWN | All sheds busy → Place batch | Intro "no free shed", no fields | GAP |
| FARM-15 | addBatch future placed date | Edge | OWN | Placed = today+30 | ⚠ verify: should warn/refuse; currently accepted | GAP |
| FARM-16 | addBatch double-submit | Edge | OWN | Double-click Place batch | One batch (button disabled while busy) | GAP |
| FARM-17 | addBatch wrong role | Role | SUP | Tamper `addBatch` | "Your role cannot do this"; no row | COVERED forms#role |
| FARM-18 | Batch page renders | Positive | OWN | /farm/batch/VKR-L-2026-02 | Title, tiles, daily table, vacc schedule | COVERED screens#all |
| FARM-19 | Unknown batch code URL | Negative | OWN | /farm/batch/NOPE-1 | Not found page, no crash | GAP |
| FARM-20 | batchState happy | Positive | OWN | State → growing → Update stage | Age tile "Growing" | COVERED forms2#life |
| FARM-21 | batchState on closed batch | Negative | OWN | Tamper on VKR-B-2026-13 | "batch not found or already closed" | GAP |
| FARM-22 | batchState invalid value | Negative | OWN | Tamper state `closed` / `xyz` | `closed`: "use close_batch to close"; xyz: invalid | GAP |
| FARM-23 | batchState wrong role | Role | SUP | State button hidden; tamper `batchState` | Hidden + forbidden | COVERED forms2#supBtns (hidden) / GAP (server) |
| FARM-24 | closeBatch with buyer → invoice | Positive | OWN | Close → buyer, 4200 kg, ₹110 | Toast INV raised ₹4,62,000 product bird; state closed | COVERED forms2#life |
| FARM-25 | closeBatch layer → spent_hen invoice | Positive | OWN | Close a layer test batch with buyer | Invoice product spent_hen | GAP |
| FARM-26 | closeBatch without buyer / without rate | Edge | OWN | Close with no buyer; buyer but no rate | Closed, no invoice, toast "closed" | GAP |
| FARM-27 | closeBatch twice | Negative | OWN | Tamper close on VKR-B-2026-13 | "batch already closed" | GAP |
| FARM-28 | closeBatch validation | Negative | OWN | weight `-1`, rate `0` | invalid | GAP |
| FARM-29 | closeBatch wrong role | Role | SUP, FIN | Button hidden; tamper | Hidden; forbidden | COVERED forms2#supBtns (hidden) / GAP (server) |
| FARM-30 | Closed batch hides actions | Edge | OWN | Open VKR-B-2026-13 | "Closed" pill; no Close/State/Mortality buttons | GAP |
| FARM-31 | 3D viewer renders + opens shed | Positive | OWN | /farm → Shed A in 3D list | Canvas; panel "Expected vs actual" for VKR-B-2026-14 | COVERED farm3d#live |
| FARM-32 | 3D live mortality update | Positive | OWN | Update today's log in DB | Panel shows new "N today" in <5 s | COVERED farm3d#live |
| FARM-33 | 3D panel action + Esc order | Positive | OWN | Record mortality from panel; Esc twice | Form prefilled with batch; Esc closes form then panel | COVERED farm3d#live |
| FARM-34 | 3D on phone / no WebGL | Edge | OWN | 390px; disable WebGL | Renders or graceful fallback card; page usable | GAP |
| FARM-35 | 3D supervisor view-only | Role | SUP | /farm | 3D shed list view-only; no place-batch buttons on cards | COVERED forms#role |

### 3.6 Daily log (`/log`, logSave, mortality, photos, offline)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| LOG-01 | Daily log save (broiler) | Positive | OWN | /log?batch=VKR-B-2026-14 → mortality 7, avg wt 1612 → Save | /farm/batch/…, row shows 1612 | COVERED forms#log |
| LOG-02 | Layer log with egg trays by grade | Positive | OWN | Layer batch → trays jumbo 10, cracked 2 | Eggs = trays×30; hen-day %; egg_production rows | GAP |
| LOG-03 | Re-save same day overwrites | Edge | OWN | Save twice same date different values | One row (upsert), latest values, sync_version+1 | GAP (SQL: actions_test) |
| LOG-04 | Supervisor saves log | Role | SUP | Save log | Saved | GAP |
| LOG-05 | Labour / vet save log | Role | LAB, VET | Save log | Saved | GAP |
| LOG-06 | Finance / store keeper blocked | Role | FIN, STK | Open /log | Redirect /home (no Log tab) | GAP |
| LOG-07 | Negative numbers | Negative | SUP | Mortality `-1`, culls `-2`, feed bags `-1`, water `-5` | invalid, fields red | GAP |
| LOG-08 | Temperature bounds | Edge | SUP | tmin `-11`, tmax `61`; then `-10` / `60` | Out-of-range red; bounds accepted | GAP |
| LOG-09 | tmin > tmax | Edge | SUP | tmin 35, tmax 20 | ⚠ verify: should be refused; currently saved | GAP |
| LOG-10 | Humidity bounds | Edge | SUP | RH `101`, `-1`, `100` | 101/-1 red; 100 OK | GAP |
| LOG-11 | Avg weight 0 / decimal | Negative | SUP | avg_w `0`, `12.5` | invalid (int ≥1) | GAP |
| LOG-12 | Remarks 501 chars | Edge | SUP | Paste 501 chars | invalid; 500 OK | GAP |
| LOG-13 | Mortality more than birds alive | Edge | SUP | Mortality 999999 on a 10,200 batch | ⚠ verify: should refuse; DB has no guard (birds go negative) | GAP |
| LOG-14 | Future date log | Edge | SUP | Date = tomorrow (if picker allows / tamper) | ⚠ verify: should refuse | GAP |
| LOG-15 | Log on closed batch | Negative | SUP | Tamper batch_id = VKR-B-2026-13 | ⚠ verify: should refuse; save_daily_log has no closed check | GAP |
| LOG-16 | Invalid calendar date | Negative | SUP | Tamper date `2026-02-30` | Clean error (passes regex, Postgres rejects) — ⚠ verify message | GAP |
| LOG-17 | Other tenant's batch id | Role | KSO | Tamper batch_id = VKR-B-2026-14 id | "batch not found"; nothing written | GAP |
| LOG-18 | Offline save then sync | Positive | OWN | Go offline → Save | "No network — saved on this phone"; outbox 1; online → "1 offline entries synced" | COVERED offline#log |
| LOG-19 | Offline: several entries, reload while offline | Edge | SUP | Save 2 offline, reload page, back online | Both kept and synced once, in order | GAP |
| LOG-20 | Offline double-tap Save | Edge | SUP | Offline, tap Save 3× | Outbox does not create conflicting duplicates; final DB = one row | GAP |
| LOG-21 | Dead-bird photo upload | Positive | OWN | Photo (dead) → JPEG | Stored at evidence/<tenant>/<batch>/…; "AI check is not set up yet" | COVERED offline#photo |
| LOG-22 | Feed photo upload | Positive | SUP | Photo (feed) → PNG | "photo saved" toast; media row | GAP |
| LOG-23 | Photo while offline | Negative | SUP | Offline → pick photo | "photo needs network" toast; nothing queued | GAP |
| LOG-24 | Photo wrong type / huge | Edge | SUP | GIF via devtools; 25 MB JPEG | Refused or "photo failed" toast; no partial media row | GAP |
| LOG-25 | mort (Record mortality) happy | Positive | OWN | Batch → Mortality → 25 → Record | "25 deaths recorded"; Birds 4,975 | COVERED forms#batchMort |
| LOG-26 | mort validation | Negative | SUP | Count `0`, `-3`, `1.5`; notes 501 chars | invalid | GAP |
| LOG-27 | mort wrong role | Role | FIN, STK | Tamper `mort` | forbidden | GAP |
| LOG-28 | mort on closed batch | Edge | OWN | Tamper on VKR-B-2026-13 | ⚠ verify: should refuse; record_mortality has no closed check | GAP |
| LOG-29 | mort no active batch | Edge | APP-owner (no batches) | Mortality quick action | Intro "no active batch", no fields | GAP |

### 3.7 Labour shift entry (`/log?mode=shift`, shiftLog)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| SHIFT-01 | Morning entry adds to the day | Positive | OWN | Morning, dead +3, culls +1, 4 bags → Save | Day mortality +3, culls +1, feed +200 kg; temps untouched | COVERED shift#add |
| SHIFT-02 | Evening entry offline → sync | Positive | OWN | Offline Evening dead +2 → back online | Synced; mortality +5 total | COVERED shift#add |
| SHIFT-03 | Labour uses shift form | Role | LAB | Login → /log | Shift form usable, saves | GAP |
| SHIFT-04 | Night shift | Positive | SUP | Night entry | Saved, adds | GAP |
| SHIFT-05 | Feed bags limit | Edge | SUP | Bags `501`; `500`; `-1` | 501/-1 invalid; 500 OK | GAP |
| SHIFT-06 | Water limit | Edge | SUP | Water `100001`; `100000` | first invalid | GAP |
| SHIFT-07 | Offline replay is idempotent | Edge | SUP | Same op_id replayed twice (reload during sync) | Counted once | GAP (SQL: shift_log_test) |
| SHIFT-08 | Shift on closed batch | Negative | SUP | Tamper closed batch | "batch is closed" | GAP (SQL) |
| SHIFT-09 | Tampered shift name | Negative | SUP | shift `afternoon` | invalid | GAP |
| SHIFT-10 | Wrong role | Role | FIN | Tamper `shiftLog` | forbidden | GAP |
| SHIFT-11 | +/- buttons cannot go below 0 | Edge | LAB | Tap "Dead birds −" at 0 | Stays 0 | GAP |

### 3.8 Health (vaccinations, vet visits, disease cases — `/more/health`, batch page)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| HLT-01 | Health screen renders | Positive | OWN | /more/health | Schedule, visits, cases | COVERED screens#all |
| HLT-02 | addVacc happy | Positive | OWN | + Vaccination → batch, vaccine, due today+3 | Appears in schedule | GAP |
| HLT-03 | addVacc validation | Negative | OWN | Due blank; tampered vaccine_id `abc` | invalid | GAP |
| HLT-04 | addVacc wrong role | Role | FIN, LAB, STK | Tamper `addVacc` | forbidden | GAP |
| HLT-05 | vaccDone happy | Positive | SUP | Row → Done → date | done_on set; row marked done | GAP |
| HLT-06 | vaccDone validation | Negative | SUP | Date blank | invalid | GAP |
| HLT-07 | vaccDone wrong role | Role | FIN, LAB | Tamper with a vacc id | forbidden | GAP |
| HLT-08 | vaccDone other tenant id | Role | KSO | Tamper VKR vacc_id | No row updated — ⚠ verify UI shows error, not false "done" | GAP |
| HLT-09 | addVisit happy | Positive | VET | + Vet visit → batch, vet `Dr X`, findings | Visit listed | GAP |
| HLT-10 | addVisit validation | Negative | VET | Vet blank; findings 1001 chars | invalid | GAP |
| HLT-11 | addVisit unknown batch | Negative | OWN | Tamper batch_id random uuid | "not found" | GAP |
| HLT-12 | addVisit wrong role | Role | FIN, LAB | Tamper | forbidden | GAP |
| HLT-13 | confirmCase | Positive | VET | Open case → Confirm | vet_confirmed shown | GAP |
| HLT-14 | closeCase | Positive | OWN | Open case → Resolve | status resolved | GAP |
| HLT-15 | confirm/close wrong role | Role | SUP, FIN | Tamper `confirmCase` / `closeCase` | forbidden | GAP |
| HLT-16 | Overdue vaccination highlighting | Edge | OWN | Vacc due yesterday not done | Shown overdue (warn/crit) | GAP |
| HLT-17 | confirm/close case validation (tamper) | Negative | VET | case_id `abc`; random uuid | `abc` invalid; random uuid → ⚠ verify error, not false success | GAP |

### 3.9 Money (sales, bills, payments, approvals, AR/AP, rates, reminders, exports)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| MON-01 | Money views render | Positive | OWN | /money, ?view=ap, ar, pnl, rates | Each heading shown, no overflow | COVERED screens#all |
| MON-02 | saleOpen on credit → receivable | Positive | OWN | New sale 1000 × ₹6 | INV toast; AR row ₹6,000 | COVERED forms#sale |
| MON-03 | saleOpen linked to batch | Positive | FIN | Sale with batch VKR-L-2026-01 | Invoice batch_id set; batch P&L revenue up | GAP |
| MON-04 | saleOpen validation | Negative | OWN | qty `0`, `-1`; rate `0`; unit blank; qty `10000000001` | invalid | GAP |
| MON-05 | saleOpen no customers | Edge | APP-owner | New sale | Intro "add a customer first" | GAP |
| MON-06 | saleOpen wrong role | Role | SUP, STK | Tamper `saleOpen` | forbidden | GAP |
| MON-07 | saleOpen double-submit | Edge | OWN | Double-click Raise invoice | One invoice | GAP |
| MON-08 | addBill happy | Positive | FIN | + Bill → vendor, feed, ₹12,500, bill no `F-77` | Payables row; status unpaid | GAP |
| MON-09 | addBill validation | Negative | FIN | total `0`, `-1`; bill_no 41 chars | invalid | GAP |
| MON-10 | addBill wrong role | Role | SUP, STK | Tamper `addBill` | forbidden | GAP |
| MON-11 | payOpen full receipt | Positive | OWN | Receive full on invoice | Paid; leaves outstanding list | COVERED forms#sale |
| MON-12 | payOpen partial | Positive | FIN | Pay ₹1,000 of a ₹12,500 bill | status partial; outstanding ₹11,500 | GAP |
| MON-13 | payOpen exceeds outstanding | Negative | FIN | Pay ₹12,501 on ₹12,500 | "amount exceeds outstanding" | GAP |
| MON-14 | payOpen amount 0 / negative / UTR 41 chars | Negative | FIN | amount `0`, `-5`; UTR 41 chars | invalid | GAP |
| MON-15 | Bill >₹50,000 by finance → approval | Positive | FIN, OWN | FIN pays ₹60,000 bill → OWN Approve | "sent to the owner"; after approve paid 60000 | COVERED forms2#approval |
| MON-16 | Bill total exactly ₹50,000 by finance | Edge | FIN | Pay ₹50,000 bill | Paid directly (gate is total > 50000) | GAP |
| MON-17 | Bill ₹50,000.01 by finance | Edge | FIN | Pay | Pending approval | GAP |
| MON-18 | Small part-payment on big bill | Edge | FIN | ₹1,000 on ₹60,000 bill | Still needs approval (gate is on bill total) | GAP (SQL: approval_test) |
| MON-19 | Second request while one pending | Negative | FIN | Pay again on same big bill | "a payment on this bill is already waiting for owner approval" | GAP (SQL) |
| MON-20 | Owner pays big bill directly | Positive | OWN | Pay ₹60,000 bill | Paid immediately, no approval | GAP |
| MON-21 | Manager big payment needs owner | Role | MGR | Pay ₹60,000 bill | Pending approval | GAP |
| MON-22 | Owner rejects request | Positive | OWN | Reject on pending stripe | "rejected"; bill unpaid; FIN can request again | GAP |
| MON-23 | decidePay wrong role | Role | FIN, MGR | Tamper `decidePay` approve | forbidden / "only the owner can approve payments" | GAP (SQL) |
| MON-24 | decidePay already decided | Negative | OWN | Approve twice (two tabs) | "request not found or already decided" | GAP |
| MON-25 | payOpen wrong role | Role | SUP | Tamper `payOpen` | forbidden | GAP (SQL: roles_test) |
| MON-26 | Pay double-submit | Edge | OWN | Double-click Record payment | One payment | GAP |
| MON-27 | addCustomer happy | Positive | FIN | + Customer → `Ravi Traders`, trader, phone, limit 50000, days 7 | Listed | GAP |
| MON-28 | addCustomer validation | Negative | FIN | name blank; limit `-1`; days `-1`, `1.5`; phone 21 chars | invalid | GAP |
| MON-29 | addCustomer phone format | Edge | FIN | Phone `abcd` | ⚠ verify: should be refused (only max 20 enforced) — breaks WhatsApp link | GAP |
| MON-30 | addCustomer wrong role | Role | SUP, STK | Tamper | forbidden | GAP |
| MON-31 | addRate happy | Positive | FIN | Rates → egg, zone Hyderabad, ₹5.60 | Listed per_egg; home trend updates | GAP |
| MON-32 | addRate validation | Negative | FIN | rate `0`; zone blank | invalid | GAP |
| MON-33 | addRate duplicate same day | Edge | FIN | Same product/zone/date twice | Friendly error (unique) — ⚠ verify message | GAP |
| MON-34 | addRate wrong role | Role | SUP | Tamper | forbidden | GAP |
| MON-35 | WhatsApp reminder link + log | Positive | OWN | AR → WhatsApp reminders → te → Send | wa.me/91… Telugu text; "Reminder logged"; reminder_log row | COVERED remind#wa |
| MON-36 | Reminder in all 5 languages | Positive | FIN | Switch en/hi/ta/kn | Template text changes per language, amount in ₹ | GAP |
| MON-37 | Customer without phone | Edge | OWN | Customer with blank phone overdue | No broken wa.me link; send disabled/hint | GAP |
| MON-38 | remind wrong role / tamper | Role | SUP | Tamper `remind` | forbidden | GAP (SQL: reminders_test) |
| MON-39 | remind validation (tamper) | Negative | OWN | invoice_ids empty / 51 ids; amount `0`; lang `fr` | invalid | GAP |
| MON-40 | Batch P&L view | Positive | OWN | ?view=pnl | Per-batch revenue/cost/margin | COVERED screens#all (render) |
| MON-41 | Export Tally XML | Positive | OWN | GET /api/export/tally | 200 xml, Sales vouchers | COVERED forms2#exports |
| MON-42 | Export GSTR-1 JSON / statements / register / P&L CSV | Positive | OWN | GET gstr1, statements, register, pnl | 200 with expected content | COVERED forms2#exports |
| MON-43 | Exports by finance / auditor | Role | FIN, AUD | GET each kind | 200 (bankfile 200 FIN, 403 AUD) | GAP |
| MON-44 | Money exports refused for supervisor | Role | SUP | GET tally | 403; register 200 | COVERED forms2#exports |
| MON-45 | Export signed out / unknown kind | Negative | ANON, OWN | GET /api/export/tally signed out; /api/export/xyz | 401; 404 | GAP |
| MON-46 | CSV formula injection | Edge | OWN | Customer named `=HYPERLINK("x")` → statements CSV | Cell starts with `'` | GAP |
| MON-47 | Tally XML escaping | Edge | OWN | Customer `A & B <Traders>` → tally | Valid XML (`&amp;`, `&lt;`) opens in Tally | GAP |
| MON-48 | Exports in a month with no data | Edge | APP-owner | GET tally/gstr1 | Valid empty file, not 500 | GAP |
| MON-49 | Money exports while suspended | Edge | KSO (suspended) | GET statements | Read still allowed (suspension is read-only) — confirm intended | GAP |

### 3.10 People (workers, attendance, advances, wages, bank, payroll file)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| PPL-01 | People tabs render | Positive | OWN | /more/people, ?tab=month, ?tab=wages | Attendance, register, wages | COVERED screens#all |
| PPL-02 | addWorker happy | Positive | OWN | + Worker → `Ramu`, helper, farm, wage 450 | Listed in attendance | GAP |
| PPL-03 | addWorker validation | Negative | OWN | name blank; wage `0`, `-1`; phone 21 chars | invalid | GAP |
| PPL-04 | addWorker wrong role | Role | FIN, SUP | Tamper | forbidden | GAP |
| PPL-05 | attSet tap cycle H | Positive | OWN | Tap H | "Attendance saved"; H highlighted | COVERED forms#att |
| PPL-06 | attSet P/A/L and re-tap | Positive | SUP | Tap P then A then L | One row per worker/day (upsert), last status kept | GAP |
| PPL-07 | attSet past date in month register | Edge | OWN | Change a past day | Updated; payable days recalculated | GAP |
| PPL-08 | attSet wrong role | Role | FIN, LAB | Tamper `attSet` | forbidden | GAP |
| PPL-09 | Wages computed from attendance | Positive | OWN | Worker with 20 P + 2 H, wage 450 | Gross = 21 × 450 = ₹9,450 (H = ½ day — confirm in lib/kpi payslip) | GAP (unit: kpi) |
| PPL-10 | addAdvance happy | Positive | FIN | Advance ₹2,000 `festival` | Listed; wages net reduced by ₹2,000 | GAP |
| PPL-11 | addAdvance validation | Negative | FIN | amount `0`, `-1`; reason 201 chars | invalid | GAP |
| PPL-12 | Advance larger than wages | Edge | FIN | Advance ₹1,00,000 | Net ≤ 0 → worker excluded from bank file (net > 0 only) | GAP |
| PPL-13 | addAdvance wrong role | Role | SUP | Tamper | forbidden | GAP (SQL: roles_test) |
| PPL-14 | setBank happy + upper-case IFSC | Positive | OWN | Bank details → 12-digit acct, `sbin0001234` | Saved as SBIN0001234 | COVERED payroll#bank |
| PPL-15 | setBank account length | Negative | FIN | `12345678` (8), 19 digits, `12AB5678901` | "9–18 digits" | GAP |
| PPL-16 | setBank IFSC format | Negative | FIN | `SBIN1001234`, `SBI0001234`, `SBIN000123` | IFSC red "e.g. SBIN0001234" | GAP |
| PPL-17 | setBank update existing | Edge | OWN | Save again with new account | Replaced (upsert), file shows new | GAP |
| PPL-18 | setBank wrong role | Role | SUP | Tamper `setBank` | forbidden | GAP (SQL: worker_bank_test) |
| PPL-19 | Payroll bank file download | Positive | OWN | GET /api/export/bankfile | CSV salary-neft; header + account row | COVERED payroll#bank |
| PPL-20 | Bank file refused | Role | SUP, AUD | GET bankfile | 403 | COVERED payroll#bank (SUP) / GAP (AUD) |
| PPL-21 | Bank file excludes workers without bank details | Edge | OWN | Worker with no bank row | Not in file | GAP |
| PPL-22 | attSet validation (tamper) | Negative | OWN | status `late`; date blank; worker_id `abc` | invalid | GAP |

### 3.11 Equipment / assets / tickets (`/more/equipment`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| EQP-01 | Equipment renders | Positive | OWN | /more/equipment | Assets, open tickets, service due | COVERED screens#all |
| EQP-02 | addAsset happy | Positive | OWN | + Asset → fan, cost ₹18,000, next service +90d, vendor | Listed; equipment bill booked if cost+vendor — confirm | GAP |
| EQP-03 | addAsset validation | Negative | OWN | name blank; cost `-1`; next service blank | invalid | GAP |
| EQP-04 | addAsset next service in the past | Edge | OWN | next_service = yesterday | ⚠ verify: accepted and shown overdue, or refused | GAP |
| EQP-05 | addAsset wrong role | Role | SUP, STK, FIN | Tamper | forbidden | GAP |
| EQP-06 | reportIssue high → owner alerted | Positive | OWN | Report issue, high | "owner alerted"; 1 critical notification | COVERED forms2#equip |
| EQP-07 | reportIssue low/medium | Positive | LAB, SUP | Report, low | "issue logged", no critical alert | GAP |
| EQP-08 | reportIssue validation | Negative | SUP | Issue `ab` (2 chars), 501 chars, spaces | invalid (min 3, max 500) | GAP |
| EQP-09 | reportIssue wrong role | Role | FIN, VET | Tamper | forbidden | GAP |
| EQP-10 | closeTicket with cost + vendor books bill | Positive | OWN | Close, ₹4,321, vendor | "₹4,321 equipment bill booked" | COVERED forms2#equip |
| EQP-11 | closeTicket without vendor / cost | Edge | STK | Close with cost, no vendor; close with nothing | Closed, no bill, "ticket closed" | GAP |
| EQP-12 | closeTicket twice | Negative | OWN | Tamper close on closed ticket | "ticket already closed" | GAP |
| EQP-13 | closeTicket cost negative | Negative | OWN | cost `-1` | invalid | GAP |
| EQP-14 | closeTicket wrong role | Role | SUP, FIN | Tamper | forbidden | GAP |
| EQP-15 | serviceDone happy | Positive | STK | Service done → today, next +90d | Status ok, next date updated | GAP |
| EQP-16 | serviceDone next ≤ date | Negative | OWN | next = today | "next service must be after…" on next_service | GAP |
| EQP-17 | serviceDone wrong role | Role | SUP | Tamper | forbidden | GAP |

### 3.12 Stock / items / POs / GRN (`/more/stock`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| STK-01 | Stock renders | Positive | OWN | /more/stock | Balances, POs | COVERED screens#all |
| STK-02 | addItem happy | Positive | STK | + Item → `Layer mash`, feed, kg, reorder 500, GST 5 | Listed | GAP |
| STK-03 | addItem validation | Negative | STK | GST `29`, `-1`; unit blank / 21 chars; reorder `-1` | invalid | GAP |
| STK-04 | addItem duplicate name | Negative | OWN | Same name twice | Friendly error (unique tenant+name) — ⚠ verify | GAP |
| STK-05 | addItem wrong role | Role | SUP, FIN | Tamper | forbidden | GAP |
| STK-06 | raisePO happy | Positive | OWN | + PO → 77 × ₹100 | Toast PO-n | COVERED forms2#stock |
| STK-07 | raisePO validation | Negative | FIN | qty `0`; rate `-1`; expected blank | invalid | GAP |
| STK-08 | raisePO expected before PO date | Edge | FIN | expected = yesterday | ⚠ verify: should refuse | GAP |
| STK-09 | raisePO by store keeper / finance | Role | STK, FIN | Raise PO | Allowed | GAP |
| STK-10 | raisePO wrong role | Role | SUP | Tamper | forbidden | GAP |
| STK-11 | grnOpen variance flagged | Positive | OWN | Receive, bill +6% | "bill differs from PO"; stock +77; PO Received | COVERED forms2#stock |
| STK-12 | grnOpen within 1% | Positive | STK | Receive with bill = PO total | "received" without variance | GAP |
| STK-13 | grnOpen twice | Negative | OWN | Tamper on received PO | "purchase order already received" | GAP |
| STK-14 | grnOpen validation | Negative | STK | qty `0`; bill `0`; lot 41 chars | invalid | GAP |
| STK-15 | grnOpen expiry in past | Edge | STK | expiry yesterday | ⚠ verify: warn/refuse | GAP |
| STK-16 | grnOpen wrong role | Role | FIN, SUP | Tamper | forbidden (FIN is not in grnOpen roles) | GAP |
| STK-17 | Below reorder level shown | Edge | OWN | Item with balance < reorder | Low-stock flag | GAP |

### 3.13 Vendors (`/more/vendors`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| VND-01 | Vendors render | Positive | OWN | /more/vendors | List with dues | COVERED screens#all |
| VND-02 | addVendor with GSTIN → verified | Positive | FIN | `Sri Feeds`, feed, GSTIN `36AAECV1234K1Z5`, terms 15 | Listed with verified badge | GAP |
| VND-03 | addVendor without GSTIN | Positive | FIN | No GSTIN | Listed, not verified | GAP |
| VND-04 | addVendor GSTIN invalid | Negative | FIN | 14 chars; `36AAECV1234K1Z$` | invalid | GAP |
| VND-05 | GSTIN lower-case | Edge | FIN | `36aaecv1234k1z5` | Stored upper-case | GAP |
| VND-06 | addVendor terms / name | Negative | FIN | terms `-1`, `2.5`; name blank | invalid | GAP |
| VND-07 | addVendor wrong role | Role | SUP, STK | Tamper | forbidden | GAP |

### 3.14 Customers (`/more/customers`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| CUS-01 | Customers render | Positive | OWN | /more/customers | List with receivables | COVERED screens#all |
| CUS-02 | Credit limit exceeded warning | Edge | FIN | Sale pushing customer over credit_limit | Warning shown (or note none exists) — ⚠ verify | GAP |
| CUS-03 | Customer statements CSV | Positive | FIN | Reports → Trader statement | CSV downloads | GAP |
| (addCustomer cases: MON-27…30) | | | | | | |

### 3.15 Contract farming (KS)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| CON-01 | Add terms → link → settle | Positive | KSO | + Contract → link KS-B-2026-21 → settle 24300 birds / 38000 kg | GC invoice = settle() net | COVERED contract#settle |
| CON-02 | addContract validation | Negative | KSO | std FCR `0.9`, `4.1`; base rate `0`; bonus `101`; allowed mort `101`; mort penalty `10001` | invalid | GAP |
| CON-03 | addContract wrong role | Role | SUP | Tamper | forbidden | GAP |
| CON-04 | addContract other tenant customer | Role | OWN | Tamper customer_id = KS integrator | Refused | GAP (SQL: contract_test) |
| CON-05 | linkContract wrong role | Role | FIN | Tamper `linkContract` (FIN not allowed) | forbidden | GAP |
| CON-06 | linkContract to layer/hatchery batch | Edge | KSO | Tamper batch_id = KS-H-2026-37 | ⚠ verify: update matches 0 rows yet toast says "linked" — should error | GAP |
| CON-07 | Settle without contract | Negative | KSO | Settle on unlinked broiler batch (tamper) | "contract.none" message | GAP |
| CON-08 | Tiny lift → nothing to invoice | Edge | KSO | 10 birds / 15 kg | "contract.nothing" refused | GAP |
| CON-09 | Settle twice | Negative | KSO | Settle again | "batch already settled" | GAP (SQL) |
| CON-10 | settle validation | Negative | KSO | birds `0`, kg `0`, `-1` | invalid | GAP |
| CON-11 | settle wrong role | Role | SUP | Tamper | forbidden | GAP (SQL) |
| CON-12 | Estimate card before settle | Positive | KSO | Open linked batch | "Estimate if lifted today" | COVERED contract#settle |
| CON-13 | linkContract validation | Negative | KSO | contract_id `abc`; VKR's contract id | `abc` invalid; other tenant's → "contract belongs to another farm" | GAP (SQL: contract_test) |

### 3.16 Hatchery (KS-H-2026-37)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| HAT-01 | Candle → hatch → dispatch | Positive | KSO | Candle 4600/900; hatch 48000/1500/600; dispatch 10000 × ₹32 | 92%, 85.9%, 93.4%, 97%; 10,000 / 49,500 | COVERED hatch#flow |
| HAT-02 | Hatch count above fertile | Negative | KSO | Grade A 60000 | "exceed" error, saved numbers kept | COVERED hatch#flow |
| HAT-03 | Candle clears + dead germ > eggs set | Negative | KSO | Clears 57000, dead germ 1000 | "clears + dead germ exceed eggs set" | GAP (SQL) |
| HAT-04 | Candle date before set | Negative | KSO | Date before placed | "date is before the eggs were set" | GAP (SQL) |
| HAT-05 | Candle on non-hatchery batch | Negative | KSO | Tamper batch = KS-B-2026-21 | "not a hatchery setting" | GAP (SQL) |
| HAT-06 | Negative / decimal counts | Negative | KSO | clears `-1`, chicks `1.5` | invalid | GAP |
| HAT-07 | Supervisor records hatch | Role | KS supervisor (needs OTP) | Candle + hatch | Allowed | GAP |
| HAT-08 | Wrong role | Role | KS finance, vet | Tamper `hatchCandle` / `hatchResult` | forbidden | GAP (SQL) |
| HAT-09 | Dispatch more chicks than in stock | Edge | KSO | Dispatch 60000 | ⚠ verify: should refuse; sale has no stock check | GAP |

### 3.17 Reports (printable pages + CSV)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| REP-01 | Daily / weekly / vaccination / mortality pages | Positive | OWN | Reports → Generate each | /report/<kind>, heading, rows, print dialog | COVERED reports#print |
| REP-02 | Print media hides chrome (desktop) | Positive | OWN | Print emulation | Tabs + Save-as-PDF button hidden; A4 landscape PDF | COVERED reports#print |
| REP-03 | CSV report rows (P&L, vendor, trader, attendance) | Positive | OWN | Generate rPnl/rVendor/rTrader/rAtt | CSV downloads | GAP (exports covered via API only) |
| REP-04 | Supervisor can open reports | Role | SUP | /report/daily | Allowed | GAP |
| REP-05 | Roles without report access | Role | LAB, VET, STK | /report/daily | 404 | GAP |
| REP-06 | Unknown report kind | Negative | OWN | /report/xyz | 404 | GAP |
| REP-07 | Empty data | Edge | APP-owner | /report/weekly | "no rows" row, no crash | GAP |
| REP-08 | Report in Telugu, dates in locale | Edge | OWN (te) | /report/mortality | Translated headings; dd-mm dates | GAP |
| REP-09 | Report on phone | Edge | OWN | 390px | Table scrolls inside card | GAP |

### 3.18 Notifications / alerts / push

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| NOT-01 | Live alert toast | Positive | OWN | Insert critical notification | Pops up within 10 s | COVERED alerts#live |
| NOT-02 | Push toggle visible | Positive | OWN | /more/notifications with permission granted | "Turn on" button | COVERED alerts#live |
| NOT-03 | Turn push on (UI only) | Positive | OWN | Tap Turn on | Subscription saved, button → "Turn off" (delivery out of scope) | GAP |
| NOT-04 | Permission denied | Negative | OWN | Block notifications, tap Turn on | Explanatory message, no crash | GAP |
| NOT-05 | Unread badge clears on open | Positive | OWN | Open /more/notifications | Badge count → 0 (read_at set) | GAP |
| NOT-06 | Other tenant's alert not shown | Role | KSO | Insert VKR alert | KSO gets no toast | GAP (SQL: push_test) |
| NOT-07 | Notifications list renders | Positive | OWN | /more/notifications | List with severities | COVERED screens#all |

### 3.19 Users & invites (`/more/users`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| USR-01 | Invite supervisor | Positive | APP-owner | + Invite → name, 99990 00002, supervisor | "can now log in"; INV logs in with SUP tabs | COVERED onboard#journey |
| USR-02 | Invite each staff role | Positive | OWN | Invite INV as labour, auditor, vet, store_keeper, finance, farm_manager (one at a time) | Correct landing + tabs per role (AUTH-26…31) | GAP |
| USR-03 | Invite invalid phone | Negative | OWN | `12345`, `5999000002`, letters | invalid phone | GAP |
| USR-04 | Invite existing phone | Negative | OWN | 90000 33445 | Edge function error shown | GAP |
| USR-05 | Invite tenant_owner role (tamper) | Negative | OWN | role = tenant_owner | invalid (not in STAFF_ROLES) | GAP (SQL: roles_test) |
| USR-06 | Invite by non-owner | Role | MGR, FIN | Tamper `inviteUser` | forbidden | GAP |
| USR-07 | Invite with farm scope | Edge | OWN | Pick a farm | User sees only that farm — ⚠ verify | GAP |
| USR-08 | Users list renders | Positive | OWN | /more/users | Users + roles | COVERED screens#all |
| USR-09 | Invitee language | Edge | OWN | Invite with language hi | Invitee first login in Hindi | GAP |

### 3.20 Compliance docs (`/more/docs`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| DOC-01 | Document expiring in 20 days | Positive | OWN | + Document `Fire NOC`, expires +20d | "20 days" pill | COVERED forms2#docs |
| DOC-02 | Expired document | Edge | OWN | Expires yesterday | Expired/crit pill | GAP |
| DOC-03 | No expiry | Edge | OWN | Blank expiry | Saved, no pill | GAP |
| DOC-04 | Validation | Negative | OWN | Name blank; ref 61 chars | invalid | GAP |
| DOC-05 | Wrong role | Role | SUP, FIN | Tamper `addDoc` | forbidden | GAP |

### 3.21 Marketplace — farmer catalogue (`/more/marketplace`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| MKT-01 | Approved paid listing visible + contact | Positive | OWN | Open marketplace → Contact | Call link tel:+919999000003; lead recorded | COVERED market#journey |
| MKT-02 | Pending / rejected listing hidden | Negative | OWN | Vendor listing not approved | Not shown | GAP (SQL: marketplace_test) |
| MKT-03 | Approved but unpaid vendor hidden | Negative | OWN | Plan expired / never paid | Not shown | GAP (SQL) |
| MKT-04 | Contact tampered id | Negative | OWN | contactListing('abc') / random uuid | 'invalid' / 'not available' | GAP |
| MKT-05 | Contact message 600 chars | Edge | OWN | Long message | Trimmed to 500, saved | GAP |
| MKT-06 | Other roles can browse | Role | SUP, FIN | Open marketplace | Visible; contact works | GAP |
| MKT-07 | Empty catalogue | Edge | OWN | No approved listings | Empty-state text | GAP |

### 3.22 Vendor portal (`/vendor`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| VEN-01 | Add listing → In review | Positive | VEN | + Listing → title, price → Send for review | "In review" | COVERED market#journey |
| VEN-02 | Pay plan without keys | Positive | VEN | Pay ₹999 | "Online payment is not set up yet"; pending subscription | COVERED market#journey |
| VEN-03 | Webhook activates plan | Positive | VEN | Signed webhook | "visible to farmers until…" | COVERED market#journey |
| VEN-04 | Leads list | Positive | VEN | After farmer contact | Lead with listing title | COVERED market#journey |
| VEN-05 | Listing validation | Negative | VEN | Title `ab` / 121 chars; description 1001; price 61 | 'invalid' | GAP |
| VEN-06 | Edit approved listing → back to review | Edge | VEN | Change title | Status pending again; hidden from farmers | GAP (SQL) |
| VEN-07 | Delete listing | Positive | VEN | Delete | Gone; farmer no longer sees it | GAP |
| VEN-08 | Listing limit per plan | Edge | VEN | Add listings beyond plan limit | "listing limit for your plan reached" (HP451) | GAP |
| VEN-09 | Edit another vendor's listing (tamper id) | Role | VEN | saveListing with other id | No change / error | GAP (SQL) |
| VEN-10 | Bad webhook signature | Negative | — | POST webhook with wrong signature | Rejected, plan unchanged | GAP |

### 3.23 Platform console (`/admin`, `/admin/tenant/[id]`)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| PLT-01 | Approve application | Positive | PA | Open application → Approve & create account | "approved"; owner login works; farm + sheds created | COVERED onboard#journey |
| PLT-02 | Reject application with note | Positive | PA | Reject, note `Incomplete PAN` | Status rejected; leaves pending list | GAP |
| PLT-03 | Reject already decided | Edge | PA | Reject twice (two tabs) | Second has no effect (only 'submitted' rows) | GAP |
| PLT-04 | Approve invalid trial / plan (tamper) | Negative | PA | trialDays 91 / -1; plan `gold` | "invalid plan or trial" | GAP |
| PLT-05 | Approve twice | Edge | PA | Approve same application twice | Second refused; no duplicate tenant | GAP |
| PLT-06 | Change tenant plan | Positive | PA | Manage KS → plan growth → Save | "KS Farms updated"; plan stored | GAP |
| PLT-07 | Suspend tenant | Positive | PA | Status suspended → Save | Toast; owner locked out | COVERED tenants#suspend |
| PLT-08 | Reactivate / trial status | Positive | PA | Status active / trial | Saved; owner works | GAP |
| PLT-09 | updateTenant invalid status (tamper) | Negative | PA | status `deleted` | "invalid plan or status" | GAP |
| PLT-10 | Pipeline / usage / sync-health cards | Positive | PA | /admin | Three cards; usage lists VKR | COVERED console#all |
| PLT-11 | Support view audited + read-only | Positive | PA | View (logged) on VKR | "Read-only support view"; audit support.view row | COVERED console#all |
| PLT-12 | Support view has no write controls | Role | PA | Inspect /admin/tenant/<id> | No forms/buttons that write | GAP |
| PLT-13 | Audit log append-only | Negative | PA | Try delete/update audit row via API | Refused | GAP (SQL: audit_test) |
| PLT-14 | Marketplace approve listing | Positive | PA | Approve | "Listing approved" | COVERED market#journey |
| PLT-15 | Marketplace reject with note | Positive | PA | Reject, note | Listing rejected; vendor sees note | GAP |
| PLT-16 | + Advertiser creates vendor login | Positive | PA | Business name + mobile | "can now log in with OTP" | COVERED market#journey |
| PLT-17 | + Advertiser invalid / duplicate mobile | Negative | PA | `12345`; existing 99990 00003 | Error shown | GAP |
| PLT-18 | + Add tenant opens /apply | Positive | PA | Click + Add tenant | /apply | COVERED tenants#suspend |
| PLT-19 | Console on phone | Edge | PA | 390px | Usable, no overflow | GAP |
| PLT-R1 | Sales team limits | Role | platform_sales | Try Manage tenant (billing) | forbidden; applications + pipeline visible | GAP (no login) |
| PLT-R2 | Finance team limits | Role | platform_finance | Try approve application | forbidden; billing allowed | GAP (no login) |
| PLT-R3 | Support team limits | Role | platform_support | Support view only | No approve / billing / marketplace | GAP (no login) |
| PLT-R4 | Marketing team limits | Role | platform_marketing | Marketplace review only | Others forbidden | GAP (no login) |
| PLT-R5 | Ops team | Role | platform_ops | Sync health + applications | Billing forbidden | GAP (no login) |
| PLT-R6 | reviewListing by tenant user | Role | OWN | Call reviewListing via action replay | 'forbidden' | GAP |

### 3.24 i18n (en, te, hi, ta, kn)

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| I18N-01 | Switch all five languages | Positive | OWN | More → language picker → each | `html lang` + tab labels change; saved to profile | COVERED i18n#langs |
| I18N-02 | No leftover English on every screen | Edge | OWN | For each language visit all screens in screens#all list + forms | No English strings (except names/codes) | GAP (unit: messages key parity) |
| I18N-03 | Form validation / server errors translated | Edge | OWN (hi) | Trigger invalid + forbidden | Messages in Hindi | GAP |
| I18N-04 | Toasts translated | Edge | OWN (ta) | Save a sale | Tamil toast with ₹ amount | GAP |
| I18N-05 | Login / apply / vendor / console pages | Edge | ANON, PA, VEN | Switch language | Translated | GAP |
| I18N-06 | Long translations no overflow | Edge | OWN (ta, kn) | 390px all screens | No horizontal overflow | COVERED i18n#langs (home only) / GAP (others) |
| I18N-07 | Unsupported locale cookie | Negative | ANON | Set NEXT_LOCALE=fr | Falls back to en, no crash | GAP |
| I18N-08 | Device choice beats profile | Edge | OWN | Cookie hi, profile te → login | Stays Hindi | GAP |

### 3.25 Layout (phone 390px + desktop) & dark mode

| ID | Case | Type | Role(s) | Steps | Expected | Status |
|---|---|---|---|---|---|---|
| LAY-01 | Tenant screens no overflow | Edge | OWN | Every screen both viewports | scrollWidth ≤ innerWidth; cards fit | COVERED screens#all |
| LAY-02 | Login / welcome / home no overflow | Edge | OWN | Both viewports | No overflow | COVERED auth#overflow |
| LAY-03 | Every form sheet on phone | Edge | OWN | Open each form at 390px | Fields reachable, submit visible above keyboard | GAP |
| LAY-04 | Apply / vendor / admin / report pages | Edge | ANON, VEN, PA | 390px | No overflow | GAP |
| LAY-05 | Other roles' screens | Edge | SUP, FIN | Visit their tabs at 390px | No overflow | GAP |
| DARK-01 | Dark mode follows OS | Positive | OWN | Emulate `prefers-color-scheme: dark` | Dark tokens applied; text contrast OK | GAP |
| DARK-02 | All screens readable in dark | Edge | OWN | Visit all screens + forms + toasts in dark | No white-on-white / invisible pills; charts visible | GAP |
| DARK-03 | 3D viewer + reports in dark | Edge | OWN | /farm, /report/daily dark | Readable; print stays light | GAP |
| LAY-06 | PWA manifest / icons | Positive | ANON | GET /manifest.webmanifest | Name, icons, theme colours | GAP |

---

## 4. Summary

Counts are rows in the tables above (computed from this file).

| Area | Cases | COVERED | GAP |
|---|---|---|---|
| 3.1 Auth & routing | 42 | 10 | 32 |
| 3.2 Onboarding / apply | 36 | 4 | 32 |
| 3.3 Welcome / picker | 9 | 5 | 4 |
| 3.4 Home | 9 | 1 | 8 |
| 3.5 Farm | 35 | 12 | 23 |
| 3.6 Daily log | 29 | 4 | 25 |
| 3.7 Shift entry | 11 | 2 | 9 |
| 3.8 Health | 17 | 1 | 16 |
| 3.9 Money | 49 | 9 | 40 |
| 3.10 People | 22 | 5 | 17 |
| 3.11 Equipment | 17 | 3 | 14 |
| 3.12 Stock | 17 | 3 | 14 |
| 3.13 Vendors | 7 | 1 | 6 |
| 3.14 Customers | 3 | 1 | 2 |
| 3.15 Contract | 13 | 2 | 11 |
| 3.16 Hatchery | 9 | 2 | 7 |
| 3.17 Reports | 9 | 2 | 7 |
| 3.18 Notifications | 7 | 3 | 4 |
| 3.19 Users & invites | 9 | 2 | 7 |
| 3.20 Compliance docs | 5 | 1 | 4 |
| 3.21 Marketplace (farmer) | 7 | 1 | 6 |
| 3.22 Vendor portal | 10 | 4 | 6 |
| 3.23 Platform console | 25 | 7 | 18 |
| 3.24 i18n | 8 | 2 | 6 |
| 3.25 Layout & dark mode | 9 | 2 | 7 |
| **Total** | **414** | **89** | **325** |

Rows marked "COVERED … / GAP …" (part covered, part not) count as COVERED above.

### Prioritised gaps

**P1 — money, security, data loss**
1. MON-16/17/18/19/21/22/23/24 — ₹50,000 approval edges in the UI: exactly ₹50,000, ₹50,000.01, part-payment on a big bill, second pending request, manager payment, owner reject, finance/manager approve, double approve.
2. MON-13/14/26, MON-07 — overpayment, zero/negative amounts, double-submit of payments and sales.
3. AUTH-27…31, REP-05 — tab guards and direct-URL bounces for finance, labour, store keeper, auditor, vet (only supervisor is tested).
4. Server-side role refusal (tamper) for every act except `addBatch`: FARM-04/08/23/29, LOG-27, MON-06/10/25/30/34/38, PPL-04/08/13/18, EQP-05/09/14/17, STK-05/10/16, VND-07, CON-03/05/11, HLT-04/07/12/15, DOC-05, USR-06, HAT-08.
5. AUTH-33/34, LOG-17, HLT-08, CON-04 — cross-tenant ids and URLs through the UI.
6. AUTH-39/40/41 — suspended tenant writing through tampered forms, reactivation.
7. LOG-13/15, LOG-28 — mortality above birds alive and logs/mortality on a closed batch: **no guard in `record_mortality` / `save_daily_log`** (likely defect).
8. CON-06 — `linkContract` on a non-broiler batch updates 0 rows but reports success (likely defect).
9. HAT-09 — dispatching more chicks than are in stock is not checked (likely defect).
10. APP-16/19/20/22/26/27/28/30/32 — apply anti-abuse: unverified submit, wrong code, attempt limit, send limit, file type/size/count, tampered document path, 3/day limit.
11. MON-45/46/47, MON-43, PPL-20 (auditor) — export 401/404, CSV formula injection, Tally XML escaping, finance/auditor export access.
12. PPL-15/16/21, PPL-12 — bank account / IFSC rejects; bank file excludes workers without bank details or with net ≤ 0.
13. PLT-R1…R6, PLT-04/05/09 — platform team limits (no logins exist), approve/update tampering, double approve.
14. AUTH-03/04/13/35/36 — wrong OTP, farm user at staff login, sign-out, offline copies cleared between users.

**P2 — core daily workflows**
15. LOG-02 (layer eggs by grade), LOG-03/07–12/16, LOG-19/20/22/23 — daily log validation, multi-entry offline queue, feed photo, offline photo message.
16. FARM-02…07/10–16/21/22/25–28/30 — farm/shed creation, chick bill on placement, duplicate batch code message, busy shed, close without buyer, double close.
17. HLT-02…16 — vaccinations, vet visits, disease cases (no e2e at all).
18. PPL-02/03/06/07/09/10/11/17 — workers, attendance cycle, wages maths, advances.
19. EQP-02/03/07/08/11–16, STK-02/03/04/07/09/12–15/17 — assets, service, items, PO/GRN negatives.
20. MON-03/08/09/12/27/28/31/32/36/37, VND-02…06 — bills, customers, vendors, rates, reminders in 5 languages.
21. SHIFT-03…11, CON-02/07/08/10, HAT-03…07, USR-02…05/07/09, DOC-02…04, MKT-02…07, VEN-05…10, PLT-02/03/06/08/12/15/17, NOT-03/04/05, REP-03/04/06/07, HOME-02…09, WEL-05…08, APP rest.

**P3 — cosmetic**
22. I18N-02…08 (leftover English, translated errors/toasts), LAY-03/04/05/06, PLT-19, REP-08/09, FARM-34, APP-36, DARK-01/02/03.

### Likely defects found while reading (confirm with the cases flagged ⚠ verify)
- `record_mortality` and `save_daily_log` accept a closed batch and counts above birds alive (LOG-13, LOG-15, LOG-28).
- `linkContract` reports success when the batch is not a broiler batch (0 rows updated) (CON-06).
- Hatchery dispatch / any sale has no stock check (HAT-09).
- No date sanity anywhere: future log/placement dates, PO expected before PO date, past expiry, tmin > tmax (FARM-15, LOG-09, LOG-14, STK-08, STK-15).
- `date` regex accepts impossible dates such as `2026-02-30`; the user sees a raw Postgres error (LOG-16).
- Customer / worker / vendor phone only has a max length, so `abcd` is accepted and breaks the WhatsApp link (MON-29).
- Unique-key violations (batch code, item name, market rate) probably show raw "duplicate key" text (FARM-12, STK-04, MON-33).
