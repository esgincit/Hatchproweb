import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, otp, login, setRole } from './helpers';

// Test plan P1 #13: platform team limits (PLT-R1..R6), approve / update tampering (PLT-04, PLT-09), double approve (PLT-05).
// No platform logins exist besides the super admin, so each team is that admin's JWT given one team role for the test.
// Server actions are replayed by id (captured from the real button, request aborted) with other arguments or another login.
const APPLICANT = '+919999000001', VENDOR = '+919999000003';
const KS = 'b146bf5d-6213-556e-8e71-8d4c156ad36d';
const APP_NAME = 'E2E Platform Farm', LISTING = 'E2E platform listing';
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'console flow; phone layout is covered by the screens spec'); });

const ids: Record<'update' | 'approve' | 'reject' | 'review', string> = { update: '', approve: '', reject: '', review: '' };
let appId = '', listingId = '';

async function platformLogin(page: Page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/platform/login', PHONES.platform);
  await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
}

/** Click a real button but abort the server-action request: all we want is its action id. */
async function actionId(page: Page, click: () => Promise<void>) {
  let id = '';
  const handler = async (route: import('@playwright/test').Route) => {
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action']) { id = r.headers()['next-action']; return route.abort(); }
    return route.fallback();
  };
  await page.route('**/*', handler);
  try { await click(); await expect.poll(() => id, { timeout: 15_000 }).not.toBe(''); } finally { await page.unroute('**/*', handler); }
  await page.reload(); // the aborted call leaves the dev error overlay up
  return id;
}

type Res = { ok: boolean; error?: string };
async function call(page: Page, id: string, args: unknown[]): Promise<Res> {
  const r = await page.request.post('/admin', { headers: { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' }, data: JSON.stringify(args) });
  const m = (await r.text()).match(/^1:(\{.*\})$/m);
  expect(m, `action reply (HTTP ${r.status()})`).not.toBeNull();
  return JSON.parse(m![1]);
}

async function cleanup() {
  const { data: apps } = await admin.from('onboarding_application').select('id,tenant_id').eq('phone', APPLICANT);
  for (const a of apps ?? []) {
    await admin.from('onboarding_application').delete().eq('id', a.id);
    if (a.tenant_id) { await admin.from('audit_log').delete().eq('tenant_id', a.tenant_id); await admin.from('tenant').delete().eq('id', a.tenant_id); }
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && ['+' + u.phone.replace(/^\+/, '')].some((p) => p === APPLICANT || p === VENDOR)) await admin.auth.admin.deleteUser(u.id); // vendor cascades listings
  await admin.from('apply_phone_check').delete().eq('phone', APPLICANT);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

test('setup: an application and a pending listing exist, and the real buttons give us their action ids', async ({ page }) => {
  test.setTimeout(120_000);
  const sheds = [{ name: 'North', type: 'deep_litter', housing: 'open', floor: 'deep_litter', capacity: 1000 }];
  const { data: app, error } = await admin.from('onboarding_application').insert({
    business_name: APP_NAME, owner_name: 'Plat Owner', phone: APPLICANT, whatsapp: APPLICANT, language: 'en', farm_types: ['broiler'], state: 'Telangana', district: 'Medak',
    consent: true, sites: [{ name: 'Plat Unit', district: 'Medak', state: 'Telangana', pin: '502110', sheds }],
  }).select('id').single();
  expect(error).toBeNull();
  appId = app!.id;
  const { data: u } = await admin.auth.admin.createUser({ phone: VENDOR, phone_confirm: true });
  const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: 'E2E Platform Vendor', phone: VENDOR, category: 'feed' }).select('id').single();
  const { data: l } = await admin.from('product_listing').insert({ advertiser_id: adv!.id, title: LISTING, category: 'feed' }).select('id').single();
  listingId = l!.id;

  await platformLogin(page);
  const row = page.locator('.item', { hasText: 'KS Farms' });
  ids.update = await actionId(page, async () => { await row.getByRole('button', { name: 'Manage' }).click(); await row.getByRole('button', { name: 'Save' }).click(); });
  const open = () => page.getByRole('button', { name: new RegExp(APP_NAME) }).click();
  await open();
  ids.approve = await actionId(page, () => page.getByRole('button', { name: 'Approve & create account' }).click());
  await open();
  ids.reject = await actionId(page, () => page.getByRole('button', { name: 'Reject', exact: true }).first().click());
  ids.review = await actionId(page, () => page.getByTestId('marketplace-review').locator('.item', { hasText: LISTING }).getByRole('button', { name: 'Approve' }).click());
  expect(Object.values(ids).every(Boolean) && new Set(Object.values(ids)).size === 4).toBe(true);
  expect((await admin.from('onboarding_application').select('status').eq('id', appId).single()).data!.status).toBe('submitted'); // nothing ran
});

test('PLT-04: approving with an unknown plan or a trial outside 0-90 days is refused', async ({ page }) => {
  await platformLogin(page);
  const tenants = async () => (await admin.from('tenant').select('id', { count: 'exact', head: true })).count;
  const n = await tenants();
  for (const [plan, days] of [['gold', 30], ['starter', 91], ['starter', -1]] as const) {
    expect(await call(page, ids.approve, [appId, plan, days]), `${plan} / ${days}`).toEqual({ ok: false, error: 'invalid plan or trial' });
  }
  expect(await tenants()).toBe(n);
});

test('PLT-09: updating a tenant to a status or plan that does not exist is refused', async ({ page }) => {
  await platformLogin(page);
  const before = (await admin.from('tenant').select('plan,status').eq('id', KS).single()).data;
  expect(await call(page, ids.update, [KS, 'starter', 'deleted'])).toEqual({ ok: false, error: 'invalid plan or status' });
  expect(await call(page, ids.update, [KS, 'gold', 'active'])).toEqual({ ok: false, error: 'invalid plan or status' });
  expect((await admin.from('tenant').select('plan,status').eq('id', KS).single()).data).toEqual(before);
});

test('PLT-05: approving the same application twice does not create a second farm; rejecting it afterwards is refused', async ({ page }) => {
  test.setTimeout(120_000);
  await platformLogin(page);
  await page.getByRole('button', { name: new RegExp(APP_NAME) }).click();
  await page.getByRole('button', { name: 'Approve & create account' }).click();
  await expect(page.locator('.toast')).toContainText('approved', { timeout: 30_000 });
  const farms = async () => (await admin.from('tenant').select('id').eq('name', APP_NAME)).data!;
  expect(await farms()).toHaveLength(1);

  const again = await call(page, ids.approve, [appId, 'starter', 14]);
  expect(again.ok).toBe(false);
  expect(await farms()).toHaveLength(1);
  const rej = await call(page, ids.reject, [appId, 'late']);
  expect(rej.ok).toBe(false);
  expect((await admin.from('onboarding_application').select('status').eq('id', appId).single()).data!.status).toBe('approved');
});

const SECTIONS = { pipeline: 'pipeline', usage: 'usage', sync: 'sync-health', market: 'marketplace-review' } as const;
const TEAMS: { id: string; role: string; sees: (keyof typeof SECTIONS)[]; manage: boolean; add: boolean; view: boolean }[] = [
  { id: 'PLT-R1', role: 'platform_sales', sees: ['pipeline', 'usage'], manage: false, add: true, view: false },
  { id: 'PLT-R2', role: 'platform_finance', sees: [], manage: true, add: false, view: false },
  { id: 'PLT-R3', role: 'platform_support', sees: [], manage: false, add: false, view: true },
  { id: 'PLT-R4', role: 'platform_marketing', sees: ['market'], manage: false, add: false, view: false },
  { id: 'PLT-R5', role: 'platform_ops', sees: ['sync', 'pipeline'], manage: false, add: true, view: false },
];
for (const g of TEAMS) {
  test(`${g.id}: ${g.role} sees only its own tools and the server refuses the rest`, async ({ page }) => {
    test.setTimeout(120_000);
    await admin.from('product_listing').update({ status: 'pending' }).eq('id', listingId);
    const restore = await setRole(PHONES.platform, g.role);
    try {
      await platformLogin(page);
      for (const [k, tid] of Object.entries(SECTIONS)) await expect(page.getByTestId(tid), `${g.role} ${k}`).toHaveCount(g.sees.includes(k as keyof typeof SECTIONS) ? 1 : 0);
      expect(await page.getByRole('button', { name: 'Manage' }).count() > 0).toBe(g.manage);
      expect(await page.getByRole('link', { name: '+ Add tenant' }).count() > 0).toBe(g.add);
      expect(await page.getByRole('link', { name: 'View (logged)' }).count() > 0).toBe(g.view);

      const ks = (await admin.from('tenant').select('plan,status').eq('id', KS).single()).data!;
      const upd = await call(page, ids.update, [KS, ks.plan, ks.status]);
      if (g.manage) expect(upd.ok, 'billing team may update').toBe(true); else expect(upd).toEqual({ ok: false, error: 'forbidden' });
      const mayApprove = g.add; // the applications team: sales and ops (the admin has every team)
      const app = await call(page, ids.approve, ['00000000-0000-0000-0000-000000000000', 'gold', 0]);
      expect(app.error, `${g.role} approve`).toBe(mayApprove ? 'invalid plan or trial' : 'forbidden'); // allowed teams get past the role gate to validation
      const rev = await call(page, ids.review, [listingId, false]);
      if (g.role === 'platform_marketing') expect(rev.ok, 'marketing may review').toBe(true); else expect(rev, `${g.role} review`).toEqual({ ok: false, error: 'forbidden' });
      expect((await admin.from('product_listing').select('status').eq('id', listingId).single()).data!.status).toBe(g.role === 'platform_marketing' ? 'rejected' : 'pending');
      if (g.view) { // support can open the logged read-only tenant page
        expect((await page.goto(`/admin/tenant/${KS}`))!.status()).toBe(200);
      }
    } finally { await restore(); }
  });
}

test('PLT-R6: a farm owner replaying the platform actions is refused', async ({ page }) => {
  const before = (await admin.from('tenant').select('plan,status').eq('id', KS).single()).data;
  await login(page); // VKR owner
  expect(await call(page, ids.review, [listingId, true])).toEqual({ ok: false, error: 'forbidden' });
  expect(await call(page, ids.update, [KS, 'enterprise', 'suspended'])).toEqual({ ok: false, error: 'forbidden' });
  expect(await call(page, ids.approve, [appId, 'starter', 1])).toEqual({ ok: false, error: 'forbidden' });
  expect((await admin.from('tenant').select('plan,status').eq('id', KS).single()).data).toEqual(before);
});
