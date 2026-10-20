# Market scan and "beat the market" feature list (2026-10-20)

Evidence tags: [V] vendor page fetched · [S] vendor page in search snippet · [T] trade press/directory · [B] believed.

## Two things to act on first
1. **Name collision.** poultryos.com (InfraBeat Technologies, Pune, SAP Gold Partner) already sells a poultry ERP covering breeder, layer, broiler integration, hatchery, feedmill and retail [V]. Pick a different brand (e.g. HatchPro) before launch, and check the trademark.
2. **Peer benchmarking carries antitrust risk.** The US DOJ settled with Agri Stats (May 2026) over shared broiler data being used to suppress grower pay [T]. Benchmark only farm performance (FCR, EPEF, mortality), aggregated over 10 or more farms, with no prices and no grower pay.

## Who we compete with
| App | Segment | Strengths | Gap we exploit |
|---|---|---|---|
| PoulSoft (IN) [V] | Integrator, layer, hatchery, feedmill, trading | Offline supervisor app + GPS; WhatsApp/SMS alerts; Hindi/Telugu/Kannada | Desktop-era UX, no marketplace, no 3D/AI |
| PoultryOS / InfraBeat (IN) [V] | Enterprise ERP | 20 roles, approval chains, KPI alerts, IoT scales/setters, SAP/Tally | Enterprise sales motion, English/Marathi only |
| PoultryCare, Poloxy, Sahiwala/NewGen (IN) [T] | ERP | Feed formulation, accounts, HR | Generic, not mobile-first |
| FlockFarm, My Poultry Manager [T] | Small farms | Offline, simple, free | No finance depth, no team or integrator features |
| Farmbrite (US) [T] | Mixed livestock | Records + accounting, $29–59/month | Not poultry-specific, not India |
| Big Dutchman, Fancom, Munters, Maximus [S/T] | House controllers | Climate/feed/water control, alarms | Hardware-locked; no business layer |
| MSD Poultry Sense [T] | Sensors + AI | Wireless sensors, analytics | Hardware cost; broiler only |
| Petersime Eagle Trax, Pas Reform SmartCenter [V/S] | Hatchery | Incubator control, trolley traceability, fertility feedback | Tied to their machines; out of reach for small hatcheries |
| Aviagen / Cobb / Hy-Line apps [T] | Breed companies | Breed-standard benchmarks, EPEF calculators | Free calculators only, no operations |
| Pitik / Chickin (ID) [T] | Contract broiler ecosystem | IoT + input finance + offtake marketplace | Not in India |
| Livetec Livestock Protect (UK) [T] | Bird-flu zone alerts | Geofenced outbreak alerts | UK only |

**What everyone already has (table stakes, so we must have it too):** batch/flock records, mortality, feed, weights, vaccination, FCR/EPEF, layer production %, egg grading, hatch records, inventory, purchases, sales ledgers, P&L, mobile app, SMS/email alerts.

## Features that beat the market (mapped to roadmap phases)
| # | Feature | Who has it today | Phase |
|---|---|---|---|
| 1 | Realistic 3D farm digital twin: expected vs actual per shed/pen, with replay | nobody | 2, 9 |
| 2 | Labour entry built for the shed: icon + number UI, offline for days, photo + GPS + timestamp proof, anomaly score per entry | partial (PoulSoft) | 5 |
| 3 | Voice entry in Telugu/Hindi/Tamil/Kannada/Marathi (e.g. "12 birds died, 8 bags feed" spoken in Hindi or Telugu becomes records) | nobody | 5 |
| 4 | WhatsApp-first: daily entry by WhatsApp message/form; bot replies with anomalies; reports and dues reminders | alerts only (PoulSoft) | 5, 10 |
| 5 | AI photo triage (droppings, lesions, post-mortem) → vet escalation queue with confidence and vet confirmation | robot only (Faromatics) | 5 |
| 6 | Cough/sound triage from a phone recording (beta) | research only | 10+ |
| 7 | Predictive mortality and egg-drop from daily records + weather (no sensors needed) | sensor-based only | 10 |
| 8 | Integrator settlement engine: growing-charge formula, FCR/mortality slabs, chick/feed/medicine debits, grower statement on WhatsApp, UPI payout | claimed, never shown | 7 |
| 9 | Feed-cost optimiser using live mandi maize/soya rates (least-cost formulation) | static prices only | 8 |
| 10 | Sell-timing advisor: NECC egg / state broiler rates × projected weight → best lifting day | nobody | 7 |
| 11 | Bird-flu radius alerts for India (DAHD notices → 1 km / 10 km zones from farm GPS) + biosecurity checklist + visitor log | UK only | 10 |
| 12 | Heat-stress (THI) forecast alerts by shed and bird age | nobody (as SaaS) | 10 |
| 13 | Paid vendor marketplace: chicks, feed, vaccines, equipment, vets, lifting gangs; verified listings, lead fees | nobody in India | 12 |
| 14 | Buyer marketplace: traders bid on upcoming lifts / egg lots using projected weight and date | nobody in India | 12 |
| 15 | Safe peer benchmarking (≥10 farms, performance only) | breed apps vs standards only | 11 |
| 16 | Credit/insurance file: performance history packaged for NBFCs and livestock insurers | ID only (Pitik) | 11+ |
| 17 | Carbon/ESG per batch (public UGA method) for buyer requirements | nobody | 13+ |
| 18 | Small-hatchery traceability: breeder flock → egg lot → setter → hatch → chick dispatch, fertility feedback, no special hardware | big-machine vendors only | 4 |
| 19 | Controller and sensor plug-ins: read-only adapters for common controllers + cheap ESP32/LoRa kits, one alert system | scales/setters only | 10+ |
| 20 | Vet tele-consult inside the flock record | Eggoz own farms only | 8 |
| 21 | One-tap Tally XML + GSTR-1 + GST invoices for traders | enterprise only | 7 |
| 22 | Platform team console: per-team views, approvals, impersonation with audit | internal tooling | 11 |
| 23 | Telugu/Hindi-first UI with large tap targets, works on a ₹10k phone over 3G | partial | 13 |
