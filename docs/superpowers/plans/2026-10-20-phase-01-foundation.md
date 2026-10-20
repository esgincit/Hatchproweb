# Phase 1 — Web Foundation (auth, two portals, shell, farm-type picker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js web app in `apps/web/` on top of the existing Supabase schema, with:
- a phone-OTP login for farm users and a separate login for platform staff
- no self-signup
- a one-time farm-type picker (Broiler / Layer / Hatchery) that can be switched later
- the demo's app shell (top bar, 5 tabs that become a left rail on desktop), styled with the demo's own CSS.

**Architecture:**
- **Location:** Next.js App Router in `apps/web/`, beside the existing `supabase/`.
- **Auth:** `@supabase/ssr` cookies. Route protection lives in `middleware.ts`, which calls one pure, unit-tested function, `redirectFor()`.
- **Visuals:** the demo's CSS (`demo/index.html` lines 7–116) goes into `globals.css`, so React components emit the same class names and the UI matches the demo.
- **Tailwind:** v4, imported **without preflight** so it can't restyle the demo classes. It exposes the same tokens for new code.
- **Bottom sheet:** Radix Dialog styled with the demo's `.sheet/.panel` CSS.

**Tech stack:** Next.js 15 (App Router, TS strict), React 19, Tailwind v4 (theme + utilities only), `@supabase/supabase-js` v2 + `@supabase/ssr`, `@radix-ui/react-dialog`, Vitest, Playwright, Supabase CLI via `npx supabase@2`, Docker (installed), Deno (runs `scripts/create_demo_users.ts`).

**Conventions**
- `APP` = `C:\Users\funny\Documents\ESG\Hatchproweb` (repo root). Every path below is relative to `APP`.
- **Monorepo (pnpm workspaces):** `apps/web` (Next.js, this phase) and `apps/mobile` (Capacitor shell wrapping the web build, Phase 14). Shared Supabase backend in `supabase/`. The old Flutter scaffold in `mobile/` is superseded (brief) and kept only for reference.
- Shell commands use Git Bash syntax.
- Sources of truth: `BUILD-BRIEF.md` (stack, routes, roles, tokens) and `demo/index.html` (UI).

**Deliberate deviations from BUILD-BRIEF.md**
1. **Sheet:** uses `@radix-ui/react-dialog` with the demo CSS instead of the shadcn `Sheet`. It's the same Radix primitive, but shadcn's styling would change the UI, and the user asked for the same UI.
2. **No Tailwind preflight:** preflight resets buttons and headings, which would change the demo look.
3. **Telugu sub-labels:** shown on tabs always, as in the demo. The i18n phase will switch them by locale.
4. **Phone gutter:** 16 px, the demo's in-frame look. The demo's `<760px` rule doubles the padding (`.app` + `.screen`); we keep only one.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0003_roles_and_prefs.sql` | Platform team roles, `labour` role, `app_user.email`, `app_user.active_farm_type` |
| `supabase/config.toml` (modify) | Disable self-signup; test OTPs; dummy SMS provider for local use |
| `apps/web/app/globals.css` | Demo CSS + shell layout + sheet CSS + Tailwind tokens |
| `apps/web/app/layout.tsx`, `apps/web/app/page.tsx` | Fonts and `<html>`; `/` redirects to `/home` |
| `apps/web/middleware.ts` | Session refresh + `redirectFor()` |
| `apps/web/lib/format.ts` | Demo number/date helpers (ported) |
| `apps/web/lib/farm-types.ts` | Farm-type list and labels |
| `apps/web/lib/supabase/{client,server,middleware}.ts` | Supabase clients |
| `apps/web/lib/auth/{claims,permissions,route-guard}.ts` | Claims, role → tabs, redirects |
| `apps/web/app/actions/farm-type.ts` | Server action that sets `active_farm_type` |
| `apps/web/components/auth/{OtpLogin,FarmTypePicker}.tsx` | Login form, picker |
| `apps/web/app/login/page.tsx`, `apps/web/app/platform/login/page.tsx`, `apps/web/app/welcome/page.tsx` | The two logins and the one-time picker page |
| `apps/web/components/ui/Sheet.tsx`, `apps/web/components/shell/{icons,AppShell,TenantSheet,SignOutButton}.tsx` | Shell |
| `apps/web/app/(app)/layout.tsx` + `(app)/{home,farm,log,money,more}/page.tsx` | Tenant app (pages are stubs until Phase 3) |
| `apps/web/app/(platform)/admin/page.tsx` | Platform console stub |
| `apps/web/tests/unit/*.test.ts`, `apps/web/e2e/auth.spec.ts`, `apps/web/{vitest,playwright}.config.ts` | Tests |

---

### Task 0: Branch and baseline

- [ ] **Step 1:**
```bash
cd /c/Users/funny/Documents/ESG/Hatchproweb
git checkout -b feat/web-foundation
git add -A
git commit -m "chore: import PoultryOS baseline (schema, functions, demo, brief)"
```
Expected: `git status` is clean.

---

### Task 1: Local Supabase with seed + demo auth users

**Files:** Modify `supabase/config.toml`

- [ ] **Step 1: Install the missing tools**
```bash
npm i -g pnpm@9
winget install --id DenoLand.Deno -e      # then restart the shell
pnpm --version && deno --version && docker info --format '{{.ServerVersion}}'
```
Expected: three version strings. Docker Desktop must be running.

- [ ] **Step 2: No self-signup + test OTPs.** Accounts are created only by the platform after approval. Admin `createUser` (used by `provision-tenant` and `create_demo_users.ts`) still works when signup is off.

In `[auth]`, add `enable_signup = false`. Replace the `[auth.sms]` and `[auth.sms.test_otp]` blocks with:
```toml
[auth.sms]
enable_signup = false
enable_confirmations = true
# provider = twilio | messagebird | textlocal | vonage  (MSG91 via custom hook)

# Local only: GoTrue needs a provider configured before it accepts phone OTP.
# Test numbers below never reach Twilio.
[auth.sms.twilio]
enabled = true
account_sid = "local-dev"
message_service_sid = "local-dev"
auth_token = "local-dev"

[auth.sms.test_otp]
919849012345 = "123456"   # Venkata Krishna Reddy — VKR owner
919000033445 = "123456"   # Mallesh — VKR shed supervisor
919849022334 = "123456"   # Rajitha Reddy — VKR finance
919440012121 = "123456"   # K. Srinivasulu — KS owner
919000000000 = "123456"   # Praveen G — platform admin
```

- [ ] **Step 3: Start Supabase and load the seed**
```bash
cd /c/Users/funny/Documents/ESG/Hatchproweb
npx supabase@2 start
npx supabase@2 db reset
npx supabase@2 status -o env
```
Expected: `db reset` ends with "Finished supabase db reset". `status -o env` prints `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`. If `start` rejects the twilio block, run `npx supabase@2 start --debug` and fix the key it names.

- [ ] **Step 4: Create auth users for the seed**
```bash
eval "$(npx supabase@2 status -o env | sed 's/^/export /')"
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" deno run -A scripts/create_demo_users.ts
```
Expected: 14 lines starting with `✓`. **Gotcha:** `db reset` wipes `auth.users`, so re-run this step after every reset.

- [ ] **Step 5: Confirm the RLS claim from README §6**
```bash
docker exec -i supabase_db_poultryos psql -U postgres -c "
set role authenticated;
set request.jwt.claims = '{\"app_metadata\":{\"tenant_id\":\"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c\"}}';
select count(*) from batch;"
```
Expected: `5`.

- [ ] **Step 6:** `git add supabase/config.toml && git commit -m "chore(supabase): disable self-signup, add local test OTPs"`

---

### Task 2: Migration 0003 — platform team roles, labour role, user prefs

**Files:** Create `supabase/migrations/0003_roles_and_prefs.sql`

- [ ] **Step 1:**
```sql
-- 0003: roles for the platform team (one platform login, different views per team),
-- a 'labour' role for shed workers with their own OTP login, and per-user preferences.
alter type app_role add value if not exists 'platform_finance';
alter type app_role add value if not exists 'platform_marketing';
alter type app_role add value if not exists 'platform_sales';
alter type app_role add value if not exists 'platform_ops';
alter type app_role add value if not exists 'labour';

alter table app_user
  add column if not exists email text,
  add column if not exists active_farm_type farm_type;   -- null = picker not done yet
```

- [ ] **Step 2: Apply and verify**
```bash
npx supabase@2 db reset
docker exec -i supabase_db_poultryos psql -U postgres -At -c "select enum_range(null::app_role)" -c "select column_name from information_schema.columns where table_name='app_user' and column_name in ('email','active_farm_type') order by 1"
```
Expected: the enum list ends with `…,platform_ops,labour`, followed by the rows `active_farm_type` and `email`. Re-run Task 1 Step 4.

- [ ] **Step 3:** `git add supabase/migrations/0003_roles_and_prefs.sql && git commit -m "feat(db): platform team roles, labour role, app_user prefs"`

---

### Task 3: Scaffold `apps/web/` with test tooling

- [ ] **Step 1: Scaffold**
```bash
npx create-next-app@15 apps/web --ts --eslint --tailwind --app --no-src-dir --import-alias "@/*" --use-pnpm --turbopack --yes
cd apps/web
pnpm add @supabase/supabase-js @supabase/ssr @radix-ui/react-dialog
pnpm add -D vitest @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: `apps/web/vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
```

- [ ] **Step 3:** In `apps/web/package.json` scripts, add `"test": "vitest run"` and `"e2e": "playwright test"`.

- [ ] **Step 4: `apps/web/.env.local`** (values from Task 1 Step 3; the service key is used only by the e2e tests)
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```
Check it's ignored: `git check-ignore apps/web/.env.local` prints the path.

- [ ] **Step 5:** `pnpm build` succeeds.
- [ ] **Step 6:** `cd ../.. && git add apps/web && git commit -m "chore(web): scaffold Next.js 15 + vitest + playwright"`

---

### Task 4: Port demo format helpers (TDD)

- [ ] **Step 1: Failing test, `apps/web/tests/unit/format.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { fmtINR, fmtL, fmtN, dmy, addDays, daysBetween } from '@/lib/format';

describe('format (ported from demo/index.html:153-160)', () => {
  it('rupees in Indian grouping', () => expect(fmtINR(124500)).toBe('₹1,24,500'));
  it('lakhs from 1e5', () => { expect(fmtL(296000)).toBe('₹2.96 L'); expect(fmtL(99999)).toBe('₹99,999'); });
  it('counts', () => expect(fmtN(65432.4)).toBe('65,432'));
  it('day-month', () => expect(dmy('2026-10-19')).toBe('19 Oct'));
  it('addDays across months', () => expect(addDays('2026-10-19', 14)).toBe('2026-11-02'));
  it('daysBetween', () => expect(daysBetween('2026-10-19', '2026-11-02')).toBe(14));
});
```
- [ ] **Step 2:** `cd apps/web && pnpm test` FAILS (module not found).
- [ ] **Step 3: `apps/web/lib/format.ts`**
```ts
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtINR = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const fmtL = (n: number) => (Math.abs(n) >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : fmtINR(n));
export const fmtN = (n: number) => Math.round(n).toLocaleString('en-IN');
export const dmy = (s: string) => { const [, m, d] = s.split('-'); return `${+d} ${MON[+m - 1]}`; };
export const addDays = (s: string, n: number) => {
  const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
export const daysBetween = (a: string, b: string) => Math.round((+new Date(b) - +new Date(a)) / 864e5);
```
- [ ] **Step 4:** `pnpm test` → 6 passed.
- [ ] **Step 5:** `git add apps/web/lib/format.ts apps/web/tests/unit/format.test.ts && git commit -m "feat(web): port demo formatters"`

---

### Task 5: Claims, permissions, route guard (TDD)

The role → tab matrix comes from BUILD-BRIEF §3, plus the new `labour` role. It only hides UI; RLS remains the real guard.

- [ ] **Step 1: Failing test, `apps/web/tests/unit/auth.test.ts`**
```ts
import { describe, it, expect } from 'vitest';
import { claimsFromUser } from '@/lib/auth/claims';
import { tabsFor } from '@/lib/auth/permissions';
import { redirectFor, landingFor } from '@/lib/auth/route-guard';

const owner = { tenantId: 't1', roles: ['tenant_owner'], platform: false };
const sup = { tenantId: 't1', roles: ['shed_supervisor'], platform: false };
const labour = { tenantId: 't1', roles: ['labour'], platform: false };
const admin = { tenantId: null, roles: ['platform_admin'], platform: true };
const orphan = { tenantId: 't1', roles: [], platform: false };

describe('claimsFromUser', () => {
  it('reads app_metadata', () =>
    expect(claimsFromUser({ app_metadata: { tenant_id: 't1', roles: ['finance'], platform: false } }))
      .toEqual({ tenantId: 't1', roles: ['finance'], platform: false }));
  it('is safe on missing/garbage metadata', () => {
    expect(claimsFromUser(null)).toEqual({ tenantId: null, roles: [], platform: false });
    expect(claimsFromUser({ app_metadata: { tenant_id: '', roles: 'x', platform: 'true' } }))
      .toEqual({ tenantId: null, roles: [], platform: false });
  });
});

describe('tabsFor', () => {
  it('owner sees all five', () => expect(tabsFor(['tenant_owner'])).toEqual(['home', 'farm', 'log', 'money', 'more']));
  it('supervisor has no Money', () => expect(tabsFor(['shed_supervisor'])).toEqual(['home', 'farm', 'log', 'more']));
  it('finance', () => expect(tabsFor(['finance'])).toEqual(['home', 'money', 'more']));
  it('unions roles in tab order', () => expect(tabsFor(['finance', 'labour'])).toEqual(['home', 'log', 'money', 'more']));
  it('unknown role sees nothing', () => expect(tabsFor(['nope'])).toEqual([]));
});

describe('redirectFor', () => {
  it('anonymous', () => {
    expect(redirectFor('/home', null)).toBe('/login');
    expect(redirectFor('/admin', null)).toBe('/platform/login');
    expect(redirectFor('/login', null)).toBeNull();
    expect(redirectFor('/platform/login', null)).toBeNull();
  });
  it('platform staff stay in /admin', () => {
    expect(redirectFor('/home', admin)).toBe('/admin');
    expect(redirectFor('/admin/tenants', admin)).toBeNull();
  });
  it('tenant users cannot open /admin or login pages', () => {
    expect(redirectFor('/admin', owner)).toBe('/home');
    expect(redirectFor('/login', owner)).toBe('/home');
  });
  it('tab gating', () => {
    expect(redirectFor('/money', sup)).toBe('/home');
    expect(redirectFor('/money/ap', sup)).toBe('/home');
    expect(redirectFor('/farm', sup)).toBeNull();
    expect(redirectFor('/home', labour)).toBe('/log');
  });
  it('welcome reachable', () => expect(redirectFor('/welcome', sup)).toBeNull());
  it('no loop for a user without roles', () => {
    expect(landingFor(orphan)).toBe('/login?error=no-access');
    expect(redirectFor('/home', orphan)).toBe('/login?error=no-access');
    expect(redirectFor('/login', orphan)).toBeNull();
  });
});
```
- [ ] **Step 2:** `pnpm test` FAILS.
- [ ] **Step 3: Implement**

`apps/web/lib/auth/claims.ts`:
```ts
export type Claims = { tenantId: string | null; roles: string[]; platform: boolean };

/** JWT app_metadata (set by provision-tenant / create_demo_users) → typed claims. RLS reads the same fields. */
export function claimsFromUser(user: { app_metadata?: Record<string, unknown> } | null): Claims {
  const m = user?.app_metadata ?? {};
  return {
    tenantId: typeof m.tenant_id === 'string' && m.tenant_id ? m.tenant_id : null,
    roles: Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string') : [],
    platform: m.platform === true,
  };
}
```
`apps/web/lib/auth/permissions.ts`:
```ts
export type Tab = 'home' | 'farm' | 'log' | 'money' | 'more';
export const TABS: Tab[] = ['home', 'farm', 'log', 'money', 'more'];

// BUILD-BRIEF §3 matrix (+ labour). UI hiding only — RLS is the real guard.
const BY_ROLE: Record<string, Tab[]> = {
  tenant_owner: TABS,
  farm_manager: TABS,
  finance: ['home', 'money', 'more'],
  shed_supervisor: ['home', 'farm', 'log', 'more'],
  labour: ['log', 'more'],
  veterinarian: ['home', 'farm', 'log', 'more'],
  store_keeper: ['home', 'more'],
  auditor: ['home', 'farm', 'money', 'more'],
};

export function tabsFor(roles: string[]): Tab[] {
  const allowed = new Set(roles.flatMap((r) => BY_ROLE[r] ?? []));
  return TABS.filter((t) => allowed.has(t));
}
```
`apps/web/lib/auth/route-guard.ts`:
```ts
import type { Claims } from './claims';
import { TABS, tabsFor, type Tab } from './permissions';

const PUBLIC = ['/login', '/platform/login', '/apply'];
const under = (path: string, base: string) => path === base || path.startsWith(base + '/');
const NO_ACCESS = '/login?error=no-access';

export function landingFor(c: Claims): string {
  if (c.platform) return '/admin';
  const first = tabsFor(c.roles)[0];
  return c.tenantId && first ? '/' + first : NO_ACCESS;
}

/** Where to send this request, or null to let it through. Pure: unit-tested, used by middleware. */
export function redirectFor(pathname: string, c: Claims | null): string | null {
  const isPublic = PUBLIC.some((p) => under(pathname, p));
  const isAdmin = under(pathname, '/admin');
  let to: string | null;
  if (!c) to = isPublic ? null : isAdmin ? '/platform/login' : '/login';
  else if (c.platform) to = isAdmin ? null : '/admin';
  else if (isAdmin || isPublic) to = landingFor(c);
  else {
    const seg = pathname.split('/')[1] as Tab;
    const land = landingFor(c);
    to = land === NO_ACCESS ? land : TABS.includes(seg) && !tabsFor(c.roles).includes(seg) ? land : null;
  }
  // never redirect to the page we are on (prevents loops, e.g. no-access → /login)
  return to && to.split('?')[0] === pathname ? null : to;
}
```
- [ ] **Step 4:** `pnpm test` → all pass.
- [ ] **Step 5:** `git add apps/web/lib/auth apps/web/tests/unit/auth.test.ts && git commit -m "feat(web): claims, role→tab permissions, route guard"`

---

### Task 6: Design system — demo CSS as `globals.css`, fonts

- [ ] **Step 1: Build `apps/web/app/globals.css` (replace it entirely) in this order**
1. Tailwind without preflight:
```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```
2. Copy **`demo/index.html` lines 7–14** verbatim (tokens + both dark blocks). Then replace the font variables on line 11 with:
`--display:var(--font-manrope),system-ui,sans-serif;--body:var(--font-plex),system-ui,sans-serif;--te:var(--font-telugu),var(--font-plex),sans-serif;--r:14px;`
3. Base (replaces demo lines 15–17):
```css
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:14px;line-height:1.45;margin:0}
*{box-sizing:border-box}
```
4. Copy **lines 18–20** verbatim.
5. Copy **lines 33–116** verbatim, then:
   - delete the `.app{…}` rule (line 33)
   - in `.toast{…}`, change `position:absolute` → `position:fixed`
   - change `.sheet .photo{` → `.sheet-panel .photo{`
   - delete lines 94–98 (the old `.sheet` rules)
6. Shell:
```css
/* App shell: phone = column + bottom tabs (as demo); ≥768px = left rail, content max 1120px (BUILD-BRIEF §4) */
.app{height:100dvh;display:flex;flex-direction:column;background:var(--surface)}
.col{flex:1 1 auto;display:flex;flex-direction:column;min-height:0;min-width:0}
.screen{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.screen>.wrap{width:100%;max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
a.tab,a.back,a.item,a.iconbtn{text-decoration:none;color:inherit}
@media (min-width:768px){
  .app{flex-direction:row}
  .tabs{order:-1;display:flex;flex-direction:column;gap:4px;width:92px;flex:0 0 92px;border-top:0;border-right:1px solid var(--line);padding:12px 8px}
  .tab{padding:10px 0}
  .toast{left:auto;right:24px;bottom:24px;width:360px}
}
```
7. Sheet (Radix renders the overlay and the content as siblings):
```css
.sheet{position:fixed;inset:0;background:rgba(20,14,5,.45);z-index:40}
.sheet-panel{position:fixed;left:0;right:0;bottom:0;z-index:41;background:var(--surface);border-radius:20px 20px 0 0;padding:14px 16px calc(20px + env(safe-area-inset-bottom,0px));max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:10px}
.sheet-panel .opt{display:flex;align-items:center;gap:10px;padding:12px 4px;border-top:1px solid var(--line);width:100%;background:none;border-left:0;border-right:0;border-bottom:0;text-align:left;color:inherit}
.sheet-panel .opt:first-of-type{border-top:0}
@media (min-width:768px){.sheet-panel{left:auto;top:0;width:480px;max-height:none;border-radius:0}}
```
8. Tokens for Tailwind utilities:
```css
@theme inline {
  --color-bg:var(--bg);--color-surface:var(--surface);--color-surface2:var(--surface2);--color-ink:var(--ink);--color-ink2:var(--ink2);
  --color-muted:var(--muted);--color-line:var(--line);--color-accent:var(--accent);--color-accent-ink:var(--accent-ink);--color-accent-soft:var(--accent-soft);
  --color-good:var(--good);--color-good-soft:var(--good-soft);--color-warn:var(--warn);--color-warn-soft:var(--warn-soft);
  --color-crit:var(--crit);--color-crit-soft:var(--crit-soft);--color-info:var(--info);--color-info-soft:var(--info-soft);--color-series2:var(--series2);
  --font-display:var(--display);--font-body:var(--body);
}
```
- [ ] **Step 2: Verify**
```bash
cd apps/web
grep -c "segs button.on.L" app/globals.css          # 1
grep -c "\.phone\|\.notch\|\.rail" app/globals.css   # 0
grep -c "sheet .panel" app/globals.css               # 0
```
- [ ] **Step 3: `apps/web/app/layout.tsx`** (replace)
```tsx
import type { Metadata, Viewport } from 'next';
import { Manrope, IBM_Plex_Sans, Noto_Sans_Telugu } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-manrope' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' });
const telugu = Noto_Sans_Telugu({ subsets: ['telugu'], weight: ['500'], variable: '--font-telugu' });

export const metadata: Metadata = { title: 'PoultryOS', description: 'Poultry farm operations — layer, broiler, hatchery' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${plex.variable} ${telugu.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```
`apps/web/app/page.tsx` (replace):
```tsx
import { redirect } from 'next/navigation';
export default function Root() { redirect('/home'); }
```
Delete `apps/web/app/page.module.css` if it exists.
- [ ] **Step 4:** `pnpm build` succeeds.
- [ ] **Step 5:** `git add -A apps/web/app && git commit -m "feat(web): demo design system as globals.css, fonts, shell + sheet CSS"`

---

### Task 7: Supabase clients + middleware

- [ ] **Step 1:** `apps/web/lib/supabase/client.ts`
```ts
import { createBrowserClient } from '@supabase/ssr';

export const createClient = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
```
`apps/web/lib/supabase/server.ts`
```ts
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Server Component: middleware refreshes the session instead */ }
      },
    },
  });
}
```
`apps/web/lib/supabase/middleware.ts`
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/** Refreshes the auth cookie and returns the verified user (getUser hits Auth, not just the cookie). */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return { response, user };
}
```
- [ ] **Step 2:** `apps/web/middleware.ts`
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { claimsFromUser } from '@/lib/auth/claims';
import { redirectFor } from '@/lib/auth/route-guard';

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const to = redirectFor(request.nextUrl.pathname, user ? claimsFromUser(user) : null);
  if (!to) return response;
  const url = request.nextUrl.clone();
  const [path, query] = to.split('?');
  url.pathname = path;
  url.search = query ? '?' + query : '';
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // keep refreshed session
  return redirect;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|ktx2|hdr|webmanifest)$).*)'],
};
```
- [ ] **Step 3:** `pnpm build` succeeds.
- [ ] **Step 4:** `git add apps/web/lib/supabase apps/web/middleware.ts && git commit -m "feat(web): supabase ssr clients and guarded middleware"`

---

### Task 8: Sheet, icons, OTP login, two login pages

- [ ] **Step 1:** `apps/web/components/ui/Sheet.tsx`
```tsx
'use client';
import * as Dialog from '@radix-ui/react-dialog';

/** Demo bottom sheet (phone) / 480px right drawer (≥768px). Radix gives focus trap + Esc + aria. */
export function Sheet({ open, onOpenChange, title, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet" />
        <Dialog.Content className="sheet-panel" aria-describedby={undefined}>
          <Dialog.Title className="eyebrow">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```
- [ ] **Step 2:** `apps/web/components/shell/icons.tsx` (paths from `demo/index.html:164-170`)
```tsx
import type { Tab } from '@/lib/auth/permissions';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
export const TAB_ICONS: Record<Tab, React.ReactNode> = {
  home: <svg viewBox="0 0 24 24" {...P}><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  farm: <svg viewBox="0 0 24 24" {...P}><path d="M3 20h18M4 20V9l8-5 8 5v11M9 20v-6h6v6M4 12h16" /></svg>,
  log: <svg viewBox="0 0 24 24" {...P}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  money: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 12h.01M17 12h.01" /></svg>,
  more: <svg viewBox="0 0 24 24" {...P}><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
};
export const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...P}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></svg>
);
```
- [ ] **Step 3:** `apps/web/components/auth/OtpLogin.tsx`. `shouldCreateUser: false` is the client half of "no self-signup"; Task 1 is the server half.
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { claimsFromUser } from '@/lib/auth/claims';
import { landingFor } from '@/lib/auth/route-guard';

export function OtpLogin({ portal }: { portal: 'farm' | 'platform' }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const e164 = '+91' + phone.replace(/\D/g, '').slice(-10);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await createClient().auth.signInWithOtp({ phone: e164, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return setErr(error.message.includes('Signups not allowed')
      ? 'This number has no account yet. Apply for access and the PoultryOS team will set you up.'
      : error.message);
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const sb = createClient();
    const { data, error } = await sb.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    if (error || !data.user) { setBusy(false); return setErr(error?.message ?? 'Invalid code'); }
    const c = claimsFromUser(data.user);
    if ((portal === 'platform') !== c.platform) {
      await sb.auth.signOut(); setBusy(false);
      return setErr(portal === 'platform'
        ? 'This number is not a PoultryOS staff account. Use the farm login.'
        : 'PoultryOS staff sign in at /platform/login.');
    }
    router.replace(landingFor(c));
    router.refresh();
  }

  return (
    <form className="card" onSubmit={sent ? verify : send} style={{ display: 'grid', gap: 10 }}>
      <div className="field">
        <label htmlFor="phone">Mobile number</label>
        <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98490 12345"
          value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent} required />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="otp">6-digit code</label>
          <input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
      )}
      {err && <div className="pill crit" role="alert" style={{ whiteSpace: 'normal' }}>{err}</div>}
      <button className="btn" disabled={busy}>{sent ? 'Verify' : 'Send OTP'}</button>
      {sent && <button type="button" className="btn secondary" onClick={() => { setSent(false); setCode(''); }}>Change number</button>}
    </form>
  );
}
```
- [ ] **Step 4:** `apps/web/app/login/page.tsx`
```tsx
import { OtpLogin } from '@/components/auth/OtpLogin';

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="screen" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="eyebrow">PoultryOS</div>
        <h1 className="h2">Sign in to your farm</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>Owners, managers, supervisors, labour and vets.</p>
        {error === 'no-access' && <div className="pill warn" style={{ whiteSpace: 'normal' }}>Your account has no role yet. Ask your farm owner.</div>}
        <OtpLogin portal="farm" />
      </div>
    </main>
  );
}
```
`apps/web/app/platform/login/page.tsx`
```tsx
import { OtpLogin } from '@/components/auth/OtpLogin';

export default function PlatformLogin() {
  return (
    <main className="screen" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="wrap" style={{ maxWidth: 420 }}>
        <div className="eyebrow">PoultryOS · staff</div>
        <h1 className="h2">Platform console</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>Admin, finance, marketing, sales, support and operations teams.</p>
        <OtpLogin portal="platform" />
      </div>
    </main>
  );
}
```
- [ ] **Step 5: Manual check.** Run `pnpm dev`, then open `/login`:
  - `9849012345` with code `123456` → redirected to `/home` (a 404 until Task 10)
  - `9999999999` → "no account yet"
- [ ] **Step 6:** `git add apps/web/components apps/web/app/login apps/web/app/platform && git commit -m "feat(web): phone-OTP login for farm and platform portals"`

---

### Task 9: Farm-type picker (shown once) + switch action

Rules:
- The picker shows while `app_user.active_farm_type` is null **and** the tenant runs more than one type.
- A tenant with exactly one type skips the picker.
- A tenant with no farms sees all three core types.
- The choice is stored in the DB, so it shows once per user, not once per device.

- [ ] **Step 1:** `apps/web/lib/farm-types.ts`
```ts
export const FARM_TYPES = ['broiler', 'layer', 'hatchery', 'breeder'] as const;
export type FarmType = (typeof FARM_TYPES)[number];

export const FARM_TYPE_INFO: Record<FarmType, { label: string; te: string; blurb: string }> = {
  broiler: { label: 'Broiler', te: 'బ్రాయిలర్', blurb: 'Chicken growth · weight, FCR, lifting to shops' },
  layer: { label: 'Layer', te: 'లేయర్', blurb: 'Eggs laid per day · supply per day' },
  hatchery: { label: 'Hatchery', te: 'హాచరీ', blurb: 'Eggs set · hatch · chicks dispatched' },
  breeder: { label: 'Breeder', te: 'బ్రీడర్', blurb: 'Parent flock · hatching eggs' },
};

/** Types the picker offers: what the tenant runs, or the three core types for a brand-new tenant. */
export const pickerOptions = (tenantTypes: FarmType[]): FarmType[] =>
  tenantTypes.length ? FARM_TYPES.filter((t) => tenantTypes.includes(t)) : ['broiler', 'layer', 'hatchery'];
```
- [ ] **Step 2:** `apps/web/app/actions/farm-type.ts`
```ts
'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { landingFor } from '@/lib/auth/route-guard';
import { FARM_TYPES, type FarmType } from '@/lib/farm-types';

export async function setFarmType(ft: FarmType) {
  if (!FARM_TYPES.includes(ft)) throw new Error('Unknown farm type');
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { error } = await sb.from('app_user').update({ active_farm_type: ft }).eq('id', user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
  redirect(landingFor(claimsFromUser(user)));
}
```
- [ ] **Step 3:** `apps/web/components/auth/FarmTypePicker.tsx` (demo `.menu` grid)
```tsx
'use client';
import { useTransition } from 'react';
import { setFarmType } from '@/app/actions/farm-type';
import { FARM_TYPE_INFO, type FarmType } from '@/lib/farm-types';

export function FarmTypePicker({ options, current }: { options: FarmType[]; current?: FarmType | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="menu">
      {options.map((ft) => (
        <button key={ft} type="button" disabled={pending} onClick={() => start(() => setFarmType(ft))}
          style={ft === current ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}>
          <span className="t">{FARM_TYPE_INFO[ft].label} <small style={{ fontFamily: 'var(--te)', color: 'var(--muted)' }}>{FARM_TYPE_INFO[ft].te}</small></span>
          <span className="s">{FARM_TYPE_INFO[ft].blurb}</span>
        </button>
      ))}
    </div>
  );
}
```
- [ ] **Step 4:** `apps/web/app/welcome/page.tsx`
```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

export default async function Welcome() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: me }, { data: farms }] = await Promise.all([
    sb.from('app_user').select('full_name').eq('id', user.id).maybeSingle(),
    sb.from('farm').select('farm_type'),
  ]);
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  return (
    <main className="screen" style={{ minHeight: '100dvh', justifyContent: 'center' }}>
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="eyebrow">Welcome{me?.full_name ? `, ${me.full_name.split(' ')[0]}` : ''}</div>
        <h1 className="h2">What do you want to manage now?</h1>
        <p style={{ color: 'var(--ink2)', margin: 0 }}>You can switch any time from the farm name at the top.</p>
        <FarmTypePicker options={pickerOptions(types)} />
      </div>
    </main>
  );
}
```
- [ ] **Step 5:** `git add apps/web/lib/farm-types.ts apps/web/app/actions apps/web/components/auth/FarmTypePicker.tsx apps/web/app/welcome && git commit -m "feat(web): one-time farm-type picker"`

---

### Task 10: App shell + stub tabs + admin stub

- [ ] **Step 1:** `apps/web/components/shell/SignOutButton.tsx`
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton({ to = '/login' }: { to?: string }) {
  const router = useRouter();
  return (
    <button className="btn secondary" type="button"
      onClick={async () => { await createClient().auth.signOut(); router.replace(to); router.refresh(); }}>
      Sign out
    </button>
  );
}
```
- [ ] **Step 2:** `apps/web/components/shell/TenantSheet.tsx` (this is the user's "shift to other forms")
```tsx
'use client';
import { Sheet } from '@/components/ui/Sheet';
import { FarmTypePicker } from '@/components/auth/FarmTypePicker';
import { SignOutButton } from './SignOutButton';
import type { FarmType } from '@/lib/farm-types';

export function TenantSheet({ open, onOpenChange, modes, mode }: {
  open: boolean; onOpenChange: (o: boolean) => void; modes: FarmType[]; mode: FarmType;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Switch view">
      {modes.length > 1 && <FarmTypePicker options={modes} current={mode} />}
      <SignOutButton />
    </Sheet>
  );
}
```
- [ ] **Step 3:** `apps/web/components/shell/AppShell.tsx`. The markup mirrors `demo/index.html:137-143` and `renderTabs`/`renderHeader` (:222-227).
```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TAB_ICONS, BellIcon } from './icons';
import { TenantSheet } from './TenantSheet';
import { FARM_TYPE_INFO, type FarmType } from '@/lib/farm-types';
import type { Tab } from '@/lib/auth/permissions';

const TAB_LABELS: Record<Tab, [string, string]> = {
  home: ['Home', 'హోమ్'], farm: ['Farm', 'ఫారం'], log: ['Log', 'నమోదు'], money: ['Money', 'డబ్బు'], more: ['More', 'మరిన్ని'],
};

export function AppShell({ tenantName, sub, unread, tabs, mode, modes, children }: {
  tenantName: string; sub: string; unread: number; tabs: Tab[]; mode: FarmType; modes: FarmType[]; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = tenantName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <button className="tenant" aria-label="Switch view" onClick={() => setOpen(true)}>
            <span className="avatar">{initials}</span>
            <span style={{ minWidth: 0 }}>
              <div className="name">{tenantName}</div>
              <div className="sub">{FARM_TYPE_INFO[mode].label} view · {sub}</div>
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>▾</span>
          </button>
          <Link className="iconbtn" href="/more" aria-label="Notifications">
            <BellIcon />
            {unread > 0 && <span className="badge">{unread}</span>}
          </Link>
        </header>
        <main className="screen"><div className="wrap">{children}</div></main>
      </div>
      <nav className="tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => (
          <Link key={t} href={'/' + t} aria-label={TAB_LABELS[t][0]}
            className={`tab ${path === '/' + t || path.startsWith('/' + t + '/') ? 'active' : ''}`}>
            {TAB_ICONS[t]}<span>{TAB_LABELS[t][0]}</span><small>{TAB_LABELS[t][1]}</small>
          </Link>
        ))}
      </nav>
      <TenantSheet open={open} onOpenChange={setOpen} modes={modes} mode={mode} />
    </div>
  );
}
```
- [ ] **Step 4:** `apps/web/app/(app)/layout.tsx`
```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { tabsFor } from '@/lib/auth/permissions';
import { AppShell } from '@/components/shell/AppShell';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

const ROLE_LABEL: Record<string, string> = {
  tenant_owner: 'Owner', farm_manager: 'Manager', finance: 'Finance', shed_supervisor: 'Supervisor',
  labour: 'Labour', veterinarian: 'Vet', store_keeper: 'Store', auditor: 'Auditor',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const c = claimsFromUser(user);
  if (!c.tenantId) redirect('/login?error=no-access');

  const [{ data: me }, { data: tenant }, { count: unread }, { data: farms }] = await Promise.all([
    sb.from('app_user').select('active_farm_type').eq('id', user.id).maybeSingle(),
    sb.from('tenant').select('name, state, plan, status').eq('id', c.tenantId).maybeSingle(),
    sb.from('notification').select('id', { count: 'exact', head: true }).is('read_at', null),
    sb.from('farm').select('farm_type'),
  ]);
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  const mode = (me?.active_farm_type as FarmType | null) ?? (types.length === 1 ? types[0] : null);
  if (!mode) redirect('/welcome');

  const plan = tenant?.plan ? tenant.plan[0].toUpperCase() + tenant.plan.slice(1) : '';
  const sub = [ROLE_LABEL[c.roles[0]] ?? c.roles[0], tenant?.state, plan + (tenant?.status === 'trial' ? ' trial' : '')]
    .filter(Boolean).join(' · ');

  return (
    <AppShell tenantName={tenant?.name ?? 'PoultryOS'} sub={sub} unread={unread ?? 0}
      tabs={tabsFor(c.roles)} mode={mode} modes={pickerOptions(types)}>
      {children}
    </AppShell>
  );
}
```
- [ ] **Step 5: Stub pages** (Phase 3 replaces them). Create `apps/web/app/(app)/home/page.tsx`:
```tsx
export default function Page() { return <div className="h2">Home</div>; }
```
and the same for `farm` ("Farm"), `log` ("Log"), `money` ("Money") and `more` ("More").
- [ ] **Step 6:** `apps/web/app/(platform)/admin/page.tsx` (header copy from `demo/index.html:224`)
```tsx
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/shell/SignOutButton';

export default async function Admin() {
  const sb = await createClient();
  const { data: tenants } = await sb.from('tenant').select('id, name, plan, status').order('name');
  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <div className="tenant">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>PO</span>
            <span><div className="name">PoultryOS Platform</div><div className="sub">Platform admin · all tenants</div></span>
          </div>
        </header>
        <main className="screen"><div className="wrap">
          <div className="h2">Tenants</div>
          <div className="card"><div className="list">
            {(tenants ?? []).map((t) => (
              <div className="item" key={t.id}>
                <div><div className="t">{t.name}</div><div className="s">{t.plan} · {t.status}</div></div>
              </div>
            ))}
          </div></div>
          <SignOutButton to="/platform/login" />
        </div></main>
      </div>
    </div>
  );
}
```
- [ ] **Step 7: Manual check.**
  - **VKR owner:** `/welcome` offers Layer and Broiler. Picking one lands on `/home` with the demo top bar and 5 bottom tabs.
  - **Wide window (≥768 px):** the tabs become a left rail. The farm-name chip opens the switcher sheet.
  - **Staff login** (`/platform/login`, `9000000000`): `/admin` lists 2 tenants.
- [ ] **Step 8:** `git add apps/web/components/shell "apps/web/app/(app)" "apps/web/app/(platform)" && git commit -m "feat(web): demo app shell, role tabs, view switcher, admin stub"`

---

### Task 11: E2E acceptance (phone 390×844 + desktop 1280×800)

- [ ] **Step 1:** `apps/web/playwright.config.ts`
```ts
import { defineConfig } from '@playwright/test';

process.loadEnvFile('.env.local'); // Node ≥ 20.12

export default defineConfig({
  testDir: 'e2e',
  workers: 1,            // tests reset shared seed rows
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3000' },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
```
- [ ] **Step 2:** `apps/web/e2e/auth.spec.ts`
```ts
import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function login(page: Page, path: string, phone: string) {
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  const { error } = await admin.from('app_user').update({ active_farm_type: null }).not('id', 'is', null);
  expect(error).toBeNull();
});

test('owner picks a farm type once, then lands on Home directly', async ({ page, context }) => {
  await login(page, '/login', '9849012345');
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole('button', { name: /Layer/ }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('VKR Poultry Farms')).toBeVisible();
  await expect(page.getByText(/Layer view/)).toBeVisible();
  await context.clearCookies();
  await login(page, '/login', '9849012345');
  await expect(page).toHaveURL(/\/home$/);
});

test('view can be switched from the tenant chip', async ({ page }) => {
  await login(page, '/login', '9849012345');
  await page.getByRole('button', { name: /Layer/ }).click();
  await page.getByRole('button', { name: 'Switch view' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Broiler/ }).click();
  await expect(page.getByText(/Broiler view/)).toBeVisible();
});

test('supervisor has no Money tab and is bounced from /money', async ({ page }) => {
  await login(page, '/login', '9000033445');
  await page.getByRole('button', { name: /Broiler/ }).click();
  await expect(page.getByRole('link', { name: 'Money' })).toHaveCount(0);
  await page.goto('/money');
  await expect(page).toHaveURL(/\/home$/);
});

test('platform admin uses the staff login; farm login rejects them', async ({ page }) => {
  await login(page, '/login', '9000000000');
  await expect(page.getByRole('alert')).toContainText('/platform/login');
  await login(page, '/platform/login', '9000000000');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('KS Farms')).toBeVisible();
});

test('unknown number cannot self-register', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9999999999');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await expect(page.getByRole('alert')).toContainText('no account');
});

test('no horizontal overflow on login, welcome, home', async ({ page }) => {
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/login'); await noOverflow();
  await login(page, '/login', '9849012345'); await noOverflow();
  await page.getByRole('button', { name: /Layer/ }).click(); await noOverflow();
});
```
If GoTrue's sign-up error text differs, log it once and update the `includes('Signups not allowed')` match in `OtpLogin.tsx`. Don't loosen the test.
- [ ] **Step 3:** `cd apps/web && pnpm e2e` → 12 passed (6 tests × 2 viewports). Supabase must be running, with demo users created.
- [ ] **Step 4:** `pnpm test && pnpm lint && pnpm build` all green.
- [ ] **Step 5:** `git add apps/web/playwright.config.ts apps/web/e2e && git commit -m "test(web): e2e for logins, picker, role tabs, overflow"`

---

## Self-review (Phase 1 slice of the user's requirements)

| Requirement | Where |
|---|---|
| Two logins | Task 8 + Task 5 guard (the vendor portal gets its own phase) |
| No self-signup | Task 1 Step 2, Task 8 `shouldCreateUser:false`, e2e "unknown number" |
| Platform team, one login | Task 2 roles; per-team views come in the Platform phase |
| Broiler/Layer/Hatchery picker once + switch | Task 9, Task 10 sheet, e2e |
| Labour own OTP login | Task 2 `labour` role, Task 5 labour → Log |
| Same UI as demo | Task 6 (demo CSS verbatim), Task 10 (demo markup) |
| Responsive | Task 6 shell CSS, e2e on two viewports + overflow test |
