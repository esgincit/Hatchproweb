import { test, expect, type Page, type Route } from '@playwright/test';
import { admin, PHONES, otp, login } from './helpers';

// Test plan P2 #21 (marketplace rows) plus the regression for commit 1ba090a: saveListing / deleteListing on ANOTHER
// vendor's listing must answer "not found", never ok. Vendor B logs in; vendor A only exists in the database.
// Server actions are replayed by id (captured from the real button, request aborted) with other arguments.
const B = '+919999000003', A = '+919999000004';
const T = { a: 'E2E-Listing-A', b: 'E2E-Listing-B', ab: 'E2E-Listing-A-renamed' };
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'server-side behaviour; one project is enough'); });

let advA = '', advB = '', listingA = '', listingB = '';
type Res = { ok: boolean; error?: string; phone?: string };

async function wipe() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && [A, B].includes('+' + u.phone.replace(/^\+/, ''))) await admin.auth.admin.deleteUser(u.id); // cascades advertiser, listings, plans, leads
}
async function vendor(phone: string, name: string) {
  const { data: u } = await admin.auth.admin.createUser({ phone, phone_confirm: true, app_metadata: { roles: ['vendor'], platform: false } });
  const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: name, phone, category: 'feed' }).select('id').single();
  return adv!.id as string;
}
const paid = (advertiser: string) => admin.from('ad_subscription').insert({
  advertiser_id: advertiser, plan_id: 'basic', amount: 999, status: 'active', starts_on: new Date().toISOString().slice(0, 10), ends_on: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
});
async function listing(adv: string, title: string, status = 'pending') {
  const { data } = await admin.from('product_listing').insert({ advertiser_id: adv, title, category: 'feed', status }).select('id').single();
  return data!.id as string;
}
const status = async (id: string) => (await admin.from('product_listing').select('status,title').eq('id', id).maybeSingle()).data;

/** Click a real button but abort its server-action request: all we want is the action id. */
async function actionId(page: Page, click: () => Promise<void>) {
  let id = '';
  const handler = async (route: Route) => {
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action']) { id = r.headers()['next-action']; return route.abort(); }
    return route.fallback();
  };
  await page.route('**/*', handler);
  try { await click(); await expect.poll(() => id, { timeout: 15_000 }).not.toBe(''); } finally { await page.unroute('**/*', handler); }
  await page.reload();
  return id;
}
async function call(page: Page, id: string, args: unknown[]): Promise<Res> {
  const r = await page.request.post(page.url(), { headers: { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' }, data: JSON.stringify(args) });
  const m = (await r.text()).match(/^1:(\{.*\})$/m);
  expect(m, `action reply (HTTP ${r.status()})`).not.toBeNull();
  return JSON.parse(m![1]);
}

test.beforeAll(async () => {
  await wipe();
  advA = await vendor(A, 'E2E Vendor A');
  advB = await vendor(B, 'E2E Vendor B');
  listingA = await listing(advA, T.a, 'approved');
  listingB = await listing(advB, T.b);
});
test.afterAll(wipe);

test('MKT-02 / MKT-03 / MKT-07: pending, and approved-but-unpaid, listings are hidden from farmers; the empty state shows', async ({ page }) => {
  await admin.from('product_listing').update({ status: 'approved' }).eq('id', listingB); // approved, but neither vendor has paid
  await login(page);
  await page.goto('/more/marketplace');
  await expect(page.getByText('No offers in your area yet.')).toBeVisible();
  await expect(page.getByText('E2E-Listing')).toHaveCount(0);
  await admin.from('product_listing').update({ status: 'pending' }).eq('id', listingB);
  await paid(advB); // paid, but still waiting for review
  await page.reload();
  await expect(page.getByText('E2E-Listing')).toHaveCount(0);
});

test('VEN-05 / VEN-06 / VEN-07: vendor B: bad listing fields refused; editing a live listing sends it back to review; delete removes it', async ({ page }) => {
  test.setTimeout(120_000);
  await otp(page, '/login', '9999000003');
  await expect(page).toHaveURL(/\/vendor$/, { timeout: 30_000 });
  const list = page.getByTestId('listings');
  const add = async (fields: { title: string; price?: string; description?: string }) => {
    await list.getByRole('button', { name: '+ Listing' }).click();
    await list.getByLabel('Product / service').fill(fields.title);
    if (fields.price) await list.getByLabel('Price (e.g. ₹1,850 / bag)').fill(fields.price);
    if (fields.description) await list.getByLabel('Details').fill(fields.description);
    await list.getByRole('button', { name: 'Send for review' }).click();
  };
  for (const f of [{ title: 'ab' }, { title: 'x'.repeat(121) }, { title: 'E2E valid title', description: 'd'.repeat(1001) }, { title: 'E2E valid title', price: 'p'.repeat(61) }]) {
    await add(f);
    await expect(page.locator('.toast').last()).toContainText('Check the fields');
    await list.getByRole('button', { name: 'Cancel' }).click();
  }
  expect((await admin.from('product_listing').select('id').eq('advertiser_id', advB)).data).toHaveLength(1); // still only the seeded one

  await admin.from('product_listing').update({ status: 'approved' }).eq('id', listingB);
  await page.reload();
  const row = list.locator('.item', { hasText: T.b });
  await expect(row).toContainText('Live');
  await row.getByRole('button', { name: 'Edit' }).click();
  await list.getByLabel('Product / service').fill(T.b + ' v2');
  await list.getByRole('button', { name: 'Send for review' }).click();
  await expect(list.locator('.item', { hasText: T.b + ' v2' })).toContainText('In review'); // VEN-06
  expect(await status(listingB)).toEqual({ status: 'pending', title: T.b + ' v2' });

  await list.locator('.item', { hasText: T.b + ' v2' }).getByRole('button', { name: 'Delete' }).click(); // VEN-07
  await expect(page.locator('.toast').last()).toContainText('Listing deleted');
  expect(await status(listingB)).toBeNull();
  listingB = await listing(advB, T.b); // put one back for the next tests
});

test('VEN-09 regression (1ba090a): vendor B editing or deleting vendor A\'s listing is told "not found", and nothing changes', async ({ page }) => {
  test.setTimeout(120_000);
  await otp(page, '/login', '9999000003');
  await expect(page).toHaveURL(/\/vendor$/, { timeout: 30_000 });
  const row = () => page.getByTestId('listings').locator('.item', { hasText: T.b });
  const save = await actionId(page, async () => { await row().getByRole('button', { name: 'Edit' }).click(); await page.getByRole('button', { name: 'Send for review' }).click(); });
  const del = await actionId(page, () => row().getByRole('button', { name: 'Delete' }).click());
  expect(save).not.toBe(del);

  const before = await status(listingA);
  expect(before).toEqual({ status: 'approved', title: T.a });
  expect(await call(page, save, [{ id: listingA, title: T.ab, category: 'feed' }])).toEqual({ ok: false, error: 'not found' });
  expect(await call(page, del, [listingA])).toEqual({ ok: false, error: 'not found' });
  expect(await status(listingA)).toEqual(before); // title and approval untouched, still there
  // controls: the same calls on its own listing do work, and an id that exists nowhere is "not found" too
  expect(await call(page, del, ['00000000-0000-4000-8000-000000000000'])).toEqual({ ok: false, error: 'not found' });
  expect(await call(page, save, [{ id: listingB, title: T.b + ' ok', category: 'feed' }])).toEqual({ ok: true });
  expect(await status(listingB)).toMatchObject({ title: T.b + ' ok' });
});

test('MKT-04 / MKT-05 / MKT-06: a farmer\'s contact call with a bad id is refused; a 600-character message is trimmed to 500; a supervisor can browse and contact', async ({ page }) => {
  test.setTimeout(120_000);
  await admin.from('product_listing').update({ status: 'approved' }).eq('id', listingB);
  await login(page, PHONES.supervisor); // MKT-06: any farm role sees the catalogue
  await page.goto('/more/marketplace');
  const offer = page.locator('.item', { hasText: T.b });
  await expect(offer).toBeVisible();
  const contact = await actionId(page, () => page.locator('.item', { hasText: T.b }).getByRole('button', { name: 'Contact' }).click());

  expect(await call(page, contact, ['abc'])).toEqual({ ok: false, error: 'invalid' });
  expect(await call(page, contact, ['00000000-0000-4000-8000-000000000000'])).toEqual({ ok: false, error: 'not available' });
  expect(await call(page, contact, [listingA, 'unpaid vendor'])).toEqual({ ok: false, error: 'not available' }); // approved, vendor A never paid
  const r = await call(page, contact, [listingB, 'm'.repeat(600)]);
  expect(r).toMatchObject({ ok: true, phone: B });
  const { data: leads } = await admin.from('listing_lead').select('message').eq('listing_id', listingB);
  expect(leads).toHaveLength(1);
  expect(leads![0].message).toHaveLength(500);
});
