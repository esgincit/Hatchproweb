import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login, otp, openAct, vkr } from './helpers';
import { LOCALES, SCREENS, englishOnly, findEnglish, openForm } from './p3-helpers';

// Test plan P3: language coverage. I18N-02 (no English left on screens and forms), I18N-03 (errors), I18N-04 (toast with the
// rupee amount), I18N-05 (login, apply, vendor and console pages), I18N-07 / I18N-08 (cookie handling).
// "English left over" means: an English string from messages/en.json shown, as it is, in a language that has its own wording.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'language, not layout (layout is in p3-layout)'); });

/** Log in (the login page itself is English-labelled), then continue in `locale`. */
async function inLocale(page: Page, mobile: string, locale: string) {
  await login(page, mobile);
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3100' }]);
}
const say = (locale: string) => englishOnly(locale);

for (const loc of LOCALES) {
  test(`I18N-02 (${loc}): no screen or form of the owner shows an English UI string`, async ({ page }) => {
    test.setTimeout(900_000);
    await inLocale(page, PHONES.owner, loc);
    const english = say(loc);
    const left: string[] = [];
    const acts = new Set<string>();
    for (const path of SCREENS) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', loc);
      await page.waitForTimeout(400);
      for (const s of await findEnglish(page, english)) left.push(`${path}: ${s}`);
      const names = await page.$$eval('[data-act]', (bs) => bs.map((b, i) => ({ i, act: b.getAttribute('data-act')! })));
      for (const { i, act } of names) {
        if (acts.has(act) || /^(tally|gstr|stmt|payroll|report|attToday|attCycle|attSubmit|attSet|closeCase)$/.test(act)) continue;
        acts.add(act);
        const dlg = await openForm(page, i);
        if (!dlg) continue;
        for (const s of await findEnglish(page, english)) left.push(`${path} [${act}]: ${s}`);
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
      }
    }
    expect(left, `English left over in ${loc}`).toEqual([]);
  });
}

test('I18N-03: a refused form and a forbidden action answer in Hindi', async ({ page }) => {
  test.setTimeout(180_000);
  const refuse = async (mobile: string, name: string) => {
    await inLocale(page, mobile, 'hi');
    await page.goto('/more/docs');
    const sheet = await openAct(page, 'addDoc');
    if (name) await sheet.locator('[name=name]').fill(name);
    await sheet.locator('button[type=submit]').click();
    return sheet.getByRole('alert');
  };
  const invalid = await refuse(PHONES.owner, '');
  await expect(invalid).toBeVisible();
  expect(await invalid.textContent()).toMatch(/[ऀ-ॿ]/);
  expect(await invalid.textContent()).not.toMatch(/[A-Za-z]{4}/);
  const forbidden = await refuse(PHONES.supervisor, 'E2E-hindi doc'); // supervisors may not add compliance documents
  await expect(forbidden).toBeVisible();
  expect(await forbidden.textContent()).toMatch(/[ऀ-ॿ]/);
  expect(await forbidden.textContent()).not.toMatch(/[A-Za-z]{4}/);
  expect((await admin.from('tenant_document').select('id').like('name', 'E2E-hindi%')).data).toEqual([]);
});

test('I18N-04: the toasts after saving a sale and a payment are Tamil, and the payment one carries the rupee amount', async ({ page }) => {
  test.setTimeout(180_000);
  const t = await vkr();
  let no: string | undefined;
  try {
    await inLocale(page, PHONES.owner, 'ta');
    await page.goto('/money');
    const sale = await openAct(page, 'saleOpen');
    await sale.locator('[name=qty]').fill('100');
    await sale.locator('[name=rate]').fill('6.25');
    await sale.locator('button[type=submit]').click();
    const toast = page.locator('.toast').last();
    await expect(toast).toBeVisible({ timeout: 20_000 });
    const text = (await toast.textContent()) ?? '';
    no = text.match(/INV\d+/)?.[0];
    expect(text).toMatch(/[\u0B80-\u0BFF]/); // Tamil script
    expect(text).not.toMatch(/Invoice|raised/i);
    await expect(sale).toBeHidden();

    const pay = await openAct(page, 'payOpen');
    const value = await pay.locator('[name=doc] option', { hasText: no! }).getAttribute('value');
    await pay.locator('[name=doc]').selectOption(value!);
    await pay.locator('button[type=submit]').click();
    await expect(page.locator('.toast').filter({ hasText: '625' }).last()).toBeVisible({ timeout: 20_000 });
    const paid = (await page.locator('.toast').filter({ hasText: '625' }).last().textContent()) ?? '';
    expect(paid).toMatch(/[\u0B80-\u0BFF]/);
    expect(paid).toMatch(/₹\s?625/);
    expect(paid).not.toMatch(/Payment|recorded/i);
  } finally {
    const { data: inv } = no ? await admin.from('invoice').select('id').eq('invoice_no', no).eq('tenant_id', t.tenantId) : { data: [] as { id: string }[] };
    for (const i of inv ?? []) { await admin.from('payment').delete().eq('ref_id', i.id); await admin.from('invoice').delete().eq('id', i.id); }
  }
});

for (const loc of LOCALES) {
  test(`I18N-05 (${loc}): login, apply, vendor and console pages are translated`, async ({ page }) => {
    test.setTimeout(240_000);
    const english = say(loc);
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: loc, url: 'http://localhost:3100' }]);
    for (const path of ['/login', '/apply', '/platform/login']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', loc);
      expect(await findEnglish(page, english), `${path} in ${loc}`).toEqual([]);
    }
    // console (platform admin) and vendor portal: log in in English, then switch the language
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await otp(page, '/platform/login', PHONES.platform);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: loc, url: 'http://localhost:3100' }]);
    await page.goto('/admin');
    await expect(page.locator('html')).toHaveAttribute('lang', loc);
    expect(await findEnglish(page, english), `/admin in ${loc}`).toEqual([]);
    await page.goto('/admin/tenant/' + (await vkr()).tenantId);
    expect(await findEnglish(page, english), `support view in ${loc}`).toEqual([]);
  });
}

test('I18N-05 (vendor portal): every language', async ({ page }) => {
  test.setTimeout(240_000);
  const PH = '+919999000003';
  const gone = async () => { const { data } = await admin.auth.admin.listUsers({ perPage: 200 }); for (const u of data?.users ?? []) if (u.phone && '+' + u.phone.replace(/^\+/, '') === PH) await admin.auth.admin.deleteUser(u.id); };
  await gone();
  const { data: u } = await admin.auth.admin.createUser({ phone: PH, phone_confirm: true, app_metadata: { roles: ['vendor'], platform: false } });
  try {
    const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: 'E2E Lang Vendor', phone: PH, category: 'feed' }).select('id').single();
    await admin.from('product_listing').insert([
      { advertiser_id: adv!.id, title: 'E2E lang feed', category: 'feed', status: 'approved' },
      { advertiser_id: adv!.id, title: 'E2E lang pending', category: 'other', status: 'pending' },
    ]);
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await otp(page, '/login', '9999000003');
    await expect(page).toHaveURL(/\/vendor$/, { timeout: 30_000 });
    for (const loc of LOCALES) {
      await page.context().addCookies([{ name: 'NEXT_LOCALE', value: loc, url: 'http://localhost:3100' }]);
      await page.goto('/vendor');
      await expect(page.locator('html')).toHaveAttribute('lang', loc);
      expect(await findEnglish(page, say(loc)), `/vendor in ${loc}`).toEqual([]);
    }
  } finally { await gone(); }
});

test('I18N-07: an unsupported language cookie falls back to English without a crash', async ({ page }) => {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'fr', url: 'http://localhost:3100' }]);
  const r = await page.goto('/login');
  expect(r!.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Mobile number')).toBeVisible();
});

test('I18N-08: the language chosen on this device beats the profile language at login', async ({ page }) => {
  test.setTimeout(120_000);
  await admin.from('app_user').update({ language: 'te', active_farm_type: 'broiler' }).eq('phone', '+91 98490 12345');
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'hi', url: 'http://localhost:3100' }]);
  await page.goto('/login'); // the page is in Hindi, so find the boxes by id
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.locator('#phone').fill(PHONES.owner);
  await page.locator('form button.btn').first().click();
  await expect(page.locator('#otp')).toBeVisible();
  await page.locator('#otp').fill('123456');
  await page.locator('form button.btn').first().click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi'); // not the profile's Telugu
  await expect(page.locator('.tab.active')).toContainText('होम');
  await admin.from('app_user').update({ language: 'te' }).eq('phone', '+91 98490 12345');
});
