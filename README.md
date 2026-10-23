# HatchPro — poultry farm operations SaaS (India)

Layer · broiler · hatchery farms: daily logs, batches, health, money, people, stock, a live 3D farm view and
WhatsApp payment reminders. Multi-tenant on Supabase (Postgres + RLS + Auth), web app in Next.js, mobile in Flutter.
Five languages: English, Telugu, Hindi, Tamil, Kannada.

> Setting up QA or production? Follow **[docs/QA.md](docs/QA.md)**.

## Repository

```
├─ apps/web/                      Next.js 15 web app (React 19, TypeScript, next-intl)
│  ├─ app/                        routes: /login, /apply, /home, /farm, /log, /money, /more, /admin (platform)
│  ├─ components/farm3d/          live 3D farm (three.js / React Three Fiber) + viewer UI
│  ├─ lib/                        data loader, KPIs, schemas, permissions, reminders
│  ├─ messages/                   en / te / hi / ta / kn
│  ├─ public/3d/                  CC0 textures, HDRI skies, Blender models (see public/3d/CREDITS.md)
│  ├─ scripts/                    fetch_assets.py (textures), blender/*.py (3D models, rebuild in Blender 5.2)
│  ├─ tests/unit/                 Vitest
│  └─ e2e/                        Playwright (phone 390 px + desktop 1280 px)
├─ supabase/
│  ├─ migrations/                 0001–0020: schema, RLS, role + suspension policies, actions, reminders
│  ├─ functions/                  edge functions: provision-tenant, invite-user, daily-alerts, market-rates, …
│  ├─ tests/                      SQL tests for RLS / roles / approvals / suspension / reminders
│  ├─ seed.sql                    demo data: VKR Poultry Farms + KS Farms
│  └─ config.toml                 local Supabase config (phone OTP, test numbers, signups off)
├─ mobile/                        Flutter app (Android first)
├─ scripts/                       gen_seed.py, create_demo_users.ts
├─ demo/                          original clickable UI spec (index.html)
├─ docs/                          QA guide, plans, research
└─ .github/workflows/             db.yml (manual migrate per environment), mobile.yml (Flutter build)
```

## Local development

Needs Node 20+, pnpm 9, Docker Desktop, and the Supabase CLI (`npx supabase@2 …`).

```bash
pnpm install
npx supabase@2 start                        # local Postgres + Auth + Storage (Docker); applies migrations + seed
npx supabase@2 functions serve              # edge functions (restart after supabase stop/start)
deno run -A --node-modules-dir=none scripts/create_demo_users.ts   # demo logins (needs SUPABASE_URL + SERVICE_ROLE_KEY)

cp apps/web/.env.example apps/web/.env.local   # fill from `npx supabase@2 status` (local values only)
cd apps/web && pnpm dev -p 3100             # http://localhost:3100
```

Demo logins (local, OTP `123456`): `9849012345` VKR owner · `9000033445` VKR supervisor · `9849022334` VKR finance ·
`9440012121` KS owner · `9000000000` platform admin (at `/platform/login`).

`apps/web/.env.local` must point at the **local** database: the tests reset data with the service-role key.
Live/QA keys go on the host (or `.env.production.local`), never in `.env.local`.

New migration: add `supabase/migrations/00NN_name.sql`, then `npx supabase@2 migration up --local`.

## Tests

```bash
cd apps/web
pnpm test                                   # unit (Vitest)
npx tsc --noEmit -p . && pnpm lint          # types + lint
pnpm exec playwright test                   # e2e against localhost:3100 (local Supabase running)

# SQL tests (local database)
docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/roles_test.sql
```

Every form action needs an entry in `apps/web/lib/auth/permissions.ts` (`ACT_ROLES`, enforced by a unit test) and a
matching database policy — the database is the real guard.

## Deploy

- **Database + functions:** GitHub → Actions → *Supabase migrate (manual)* → choose `qa` or `production`
  (secrets per GitHub environment). Nothing runs on push.
- **Web:** any Node host / Vercel with root `apps/web`, `pnpm build`, env `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Full checklist, auth settings and smoke tests: [docs/QA.md](docs/QA.md).

## Mobile (Flutter)

```bash
cd mobile
flutter pub get
dart run build_runner build -d
cp lib/env.example.dart lib/env.dart        # Supabase URL + anon key (never the service-role key)
flutter run
```

`.github/workflows/mobile.yml` builds Android/iOS releases on a `v*` tag.

## 3D assets

Textures and skies are CC0 (Poly Haven) — `python apps/web/scripts/fetch_assets.py` re-downloads them. Models are built
headless in Blender 5.2: `blender -b --factory-startup -P apps/web/scripts/blender/farm_assets.py -- all` (and
`convert_polyhaven.py -- all`, `birds.py`). Devices without hardware graphics get a notice instead of the 3D view.
