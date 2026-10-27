import { test, expect, type Page } from '@playwright/test';
import { admin } from './helpers';

// Test plan P2b: the rest of the public application (APP-03..15, 17, 18, 21, 23, 24, 25, 29, 31, 33, 35). Field rules are
// checked on the form itself (the field is marked invalid) with one field changed at a time; the mobile-proof cases need
// `npx supabase@2 functions serve` and the local test OTP (123456) for +919999000001 / +919999000002.
const PHONE = '+919999000001', OTHER = '+919999000002', NON_TEST = '+919876543210';
const FN = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/apply-otp`;
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'form behaviour, not layout: one project is enough'); });

async function cleanup() {
  for (const phone of [PHONE, OTHER, NON_TEST]) {
    await admin.from('onboarding_application').delete().eq('phone', phone);
    const { data: checks } = await admin.from('apply_phone_check').select('id').eq('phone', phone);
    for (const c of checks ?? []) {
      const { data: files } = await admin.storage.from('documents').list(`applications/${c.id}`);
      if (files?.length) await admin.storage.from('documents').remove(files.map((f) => `applications/${c.id}/${f.name}`));
    }
    await admin.from('apply_phone_check').delete().eq('phone', phone);
  }
}
test.beforeEach(cleanup);
test.afterAll(cleanup);

const captchaReady = (page: Page) => page.waitForFunction(() => !!(window as unknown as { turnstile?: { getResponse: () => string } }).turnstile?.getResponse(), undefined, { timeout: 30_000 });
async function open(page: Page) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto('/apply');
  await expect(page.locator('#a_business_name')).toBeVisible();
}
async function fillAll(page: Page, mobile = '99990 00001') {
  await page.locator('#a_business_name').fill('E2E Apply Farm');
  await page.locator('#a_pan').fill('abcde1234f');
  await page.locator('#a_owner_name').fill('Ravi Teja');
  await page.locator('#a_phone').fill(mobile);
  await page.locator('#a_site_name').fill('Apply Unit');
  await page.locator('#a_district').fill('Medak');
  await page.locator('#a_pin').fill('502110');
  await page.locator('#s_0_name').fill('North Shed');
  await page.locator('#s_0_c').fill('8000');
  await page.getByRole('checkbox').check();
}
const box = (page: Page) => page.getByTestId('phone-verify');
async function verified(page: Page, mobile = '99990 00001') {
  await open(page);
  await fillAll(page, mobile);
  await captchaReady(page);
  await box(page).getByRole('button', { name: 'Send code by SMS' }).click();
  await box(page).getByLabel('6-digit code').fill('123456');
  await box(page).getByRole('button', { name: 'Verify' }).click();
  await expect(box(page)).toContainText('Mobile verified');
}
/** Submit and list which fields the form marked invalid ('farm_types' for the chip row). */
async function marked(page: Page) {
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Verify your mobile|highlighted|check/i })).toBeVisible();
  return page.locator('[aria-invalid="true"], [data-invalid="true"]').evaluateAll((els) => els.map((e) => e.id || 'farm_types'));
}
/** Put `value` in `sel`, submit, report whether that field was marked, then put the old value back. */
async function probe(page: Page, sel: string, value: string, good: string) {
  const f = page.locator(sel);
  await f.fill(value);
  const m = await marked(page);
  await f.fill(good);
  return m.includes(sel.slice(1));
}

test('APP-03..09, 12, 14, 15, 35: every field rule marks the right field, and the valid edge values pass', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await fillAll(page);
  const rules: [string, string, string, string[], string[]][] = [
    // [id, selector, valid value to restore, bad values, good values]
    ['APP-03 PAN', '#a_pan', 'abcde1234f', ['ABCDE12345', 'ABCD1234F', ''], ['abcde1234f']],
    ['APP-04/05 GSTIN', '#a_gstin', '', ['36AAECV1234K1Z', '36AAECV1234K1Z5X', '36AAECV1234K1Z$'], ['', '36aaecv1234k1z5']],
    ['APP-06 email', '#a_email', '', ['ravi@', 'ravi.example.com'], ['', 'ravi@example.com']],
    ['APP-07 PIN', '#a_pin', '502110', ['50211', '5021100', '50211A'], ['502110']],
    ['APP-09 acres', '#a_land_acres', '', ['0', '-1', '10001'], ['10000']],
    ['APP-12 shed capacity', '#s_0_c', '8000', ['0'], ['1']],
    ['APP-12 shed length', '#s_0_l', '', ['2001'], ['2000']],
    ['APP-12 shed width', '#s_0_w', '', ['501'], ['500']],
    ['APP-12 shed name', '#s_0_name', 'North Shed', [''], ['N']],
    ['APP-14 birds', '#a_current_birds', '', ['1000001', '-1'], ['1000000']],
    ['APP-14 labour', '#a_labour_worker', '', ['-1', '2.5'], ['0', '12']],
    ['APP-15 business name', '#a_business_name', 'E2E Apply Farm', ['x'.repeat(121), '   '], ['x'.repeat(120)]],
    ['APP-17 mobile', '#a_phone', '99990 00001', ['12345', '5999000001', '99990'], ['99990 00001']],
    ['APP-35 alt mobile', '#a_alt_phone', '', ['123'], ['', '98490 12345']],
    ['APP-35 WhatsApp', '#a_whatsapp', '', ['123'], ['']],
  ];
  for (const [name, sel, restore, bad, good] of rules) {
    for (const v of bad) expect(await probe(page, sel, v, restore), `${name}: "${v.slice(0, 20)}" should be marked`).toBe(true);
    for (const v of good) expect(await probe(page, sel, v, restore), `${name}: "${v.slice(0, 20)}" should pass`).toBe(false);
  }
  // nothing was ever stored: no submit passed the mobile proof
  expect((await admin.from('onboarding_application').select('id').eq('phone', PHONE)).data).toEqual([]);
});

test('APP-10 / APP-11 / APP-13: no farm type, no consent, and the shed count limits are refused and marked', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await fillAll(page);
  await page.getByRole('button', { name: 'Broiler' }).click(); // untick the only farm type
  expect(await marked(page)).toContain('farm_types');
  await page.getByRole('button', { name: 'Broiler' }).click();
  await page.getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.locator('label.card[style*="crit"]')).toBeVisible();
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: /✕ Remove/ })).toHaveCount(0); // one shed is the minimum: nothing to remove
  for (let i = 0; i < 60; i++) await page.getByRole('button', { name: '+ Shed' }).click(); // 61 sheds
  await expect(page.getByRole('button', { name: /✕ Remove/ })).toHaveCount(61);
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.locator('.pill.crit[role=alert]')).toBeVisible(); // 61 sheds is over the limit of 60
  expect((await admin.from('onboarding_application').select('id').in('phone', [PHONE, OTHER])).data).toEqual([]);
});

test('APP-08: a location outside India is marked; one inside is not', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await open(page);
  await fillAll(page);
  const gps = page.locator('span.s', { hasText: /\d+\.\d+, \d+\.\d+/ });
  await context.setGeolocation({ latitude: 40, longitude: 60 }); // central Asia
  await page.getByRole('button', { name: /Use my location/ }).click();
  await expect(gps).toContainText('40.000000, 60.000000');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(gps).toHaveAttribute('style', /crit/);
  await context.setGeolocation({ latitude: 17.7, longitude: 78.1 }); // Medak
  await page.getByRole('button', { name: /Use my location/ }).click();
  await expect(gps).toContainText('17.7');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Verify your mobile' })).toBeVisible(); // still unverified, but the location is no longer the problem
  await expect(gps).not.toHaveAttribute('style', /crit/);
});

test('APP-17 / APP-18 / APP-23: a bad mobile is refused before any code is sent; an ordinary number says SMS is not set up', async ({ page }) => {
  await open(page);
  await captchaReady(page);
  for (const m of ['12345', '5999000001']) {
    await page.locator('#a_phone').fill(m);
    await box(page).getByRole('button', { name: 'Send code by SMS' }).click();
    await expect(box(page)).toContainText('Enter a 10-digit Indian mobile number above first.');
  }
  await page.locator('#a_phone').fill('98765 43210');
  await box(page).getByRole('button', { name: 'Send code by SMS' }).click();
  await expect(box(page)).toContainText('SMS is not set up yet');
  await expect(box(page).getByLabel('6-digit code')).toHaveCount(0);
});

test('APP-21: a code older than 10 minutes is expired', async ({ page }) => {
  await open(page);
  await page.locator('#a_phone').fill('99990 00001');
  await captchaReady(page);
  await box(page).getByRole('button', { name: 'Send code by SMS' }).click();
  await expect(box(page)).toContainText('Code sent');
  await admin.from('apply_phone_check').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('phone', PHONE);
  await box(page).getByLabel('6-digit code').fill('123456');
  await box(page).getByRole('button', { name: 'Verify' }).click();
  await expect(box(page)).toContainText('That code expired. Send a new one.');
  await expect(box(page)).not.toContainText('Mobile verified');
});

test('APP-24: changing the mobile after it was verified is refused at submit', async ({ page }) => {
  await verified(page);
  await page.locator('#a_phone').fill('99990 00002');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('Verify your mobile number first')).toBeVisible();
  expect((await admin.from('onboarding_application').select('id').in('phone', [PHONE, OTHER])).data).toEqual([]);
});

test('APP-25: JPG, PNG and PDF are all accepted and listed', async ({ page }) => {
  await verified(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await box(page).locator('input[type=file]').setInputFiles([
    { name: 'licence.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: 'id.png', mimeType: 'image/png', buffer: png },
    { name: 'pan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
  ]);
  for (const n of ['licence.jpg', 'id.png', 'pan.pdf']) await expect(box(page)).toContainText(n);
});

test('APP-29: a file cannot be uploaded for a mobile that was never verified', async ({ page }) => {
  await open(page);
  await page.locator('#a_phone').fill('99990 00001');
  await captchaReady(page);
  await box(page).getByRole('button', { name: 'Send code by SMS' }).click();
  await expect(box(page)).toContainText('Code sent');
  await expect(box(page).locator('input[type=file]')).toHaveCount(0); // the UI does not offer it ...
  const { data: c } = await admin.from('apply_phone_check').select('id').eq('phone', PHONE).single();
  const r = await page.request.post(FN, { // ... and the function refuses it
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
    data: { action: 'upload-url', check_id: c!.id, name: 'f.pdf', type: 'application/pdf', size: 20 },
  });
  expect(r.status()).toBe(400);
  expect((await r.json()).error).toBeTruthy();
  const { data: files } = await admin.storage.from('documents').list(`applications/${c!.id}`);
  expect(files).toEqual([]);
});

test('APP-33 / APP-35 / APP-31: a double-click files one application, WhatsApp defaults to the mobile, and a replay with the used proof is refused', async ({ page }) => {
  test.setTimeout(120_000);
  await verified(page);
  let call: { id: string; body: string } | null = null;
  await page.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action'] && !call) call = { id: r.headers()['next-action'], body: r.postData()! };
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Submit application' }).dblclick();
  await expect(page.getByText('Application received')).toBeVisible({ timeout: 30_000 });
  const rows = (await admin.from('onboarding_application').select('whatsapp,alt_phone,phone_verified').eq('phone', PHONE)).data!;
  expect(rows).toEqual([{ whatsapp: PHONE, alt_phone: null, phone_verified: true }]); // one row; defaulted from the mobile
  await page.unroute('**/*');
  expect(call).not.toBeNull();
  const again = await page.request.post('/apply', { headers: { 'next-action': call!.id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' }, data: call!.body });
  expect(await again.text()).toContain('Verify your mobile number first');
  expect((await admin.from('onboarding_application').select('id').eq('phone', PHONE)).data).toHaveLength(1);
});
