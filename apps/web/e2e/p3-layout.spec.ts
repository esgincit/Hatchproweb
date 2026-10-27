import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login, otp, vkr } from './helpers';
import { SCREENS, englishOnly, findEnglish, overflowX, openForm } from './p3-helpers';

// Test plan P3: layout on a 390px phone. I18N-06 (long Tamil / Kannada words), LAY-03 (every form sheet), LAY-04 (apply, vendor,
// console, report pages), LAY-05 (supervisor and finance screens), LAY-06 (manifest), REP-08 / REP-09 (reports), FARM-34 (3D
// fallback), APP-36 (apply in Telugu). Run with --project=phone; the manifest test also runs on desktop.
const phoneOnly = () => test.beforeEach(({}, info) => { test.skip(info.project.name !== 'phone', 'phone layout'); });

/** The page does not scroll sideways and every top-level card fits its column. */
async function fits(page: Page, where: string) {
  expect(await overflowX(page), `${where}: horizontal scroll`).toBe(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('.wrap > .card')].every((c) => c.getBoundingClientRect().width <= (c.parentElement as HTMLElement).getBoundingClientRect().width + 1)), `${where}: card wider than its column`).toBe(true);
}
async function inLocale(page: Page, mobile: string, locale: string) {
  await login(page, mobile);
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3100' }]);
}

test.describe('phone', () => {
  phoneOnly();

  for (const loc of ['ta', 'kn']) {
    test(`I18N-06 (${loc}): long words never push any owner screen sideways`, async ({ page }) => {
      test.setTimeout(400_000);
      await inLocale(page, PHONES.owner, loc);
      for (const path of SCREENS) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('lang', loc);
        await page.waitForTimeout(300);
        await fits(page, `${loc} ${path}`);
      }
    });
  }

  test('LAY-03: every form sheet fits the phone and its save button can be reached', async ({ page }) => {
    test.setTimeout(600_000);
    await login(page, PHONES.owner);
    const acts = new Set<string>();
    const problems: string[] = [];
    for (const path of SCREENS) {
      await page.goto(path);
      await page.waitForTimeout(300);
      const names = await page.$$eval('[data-act]', (bs) => bs.map((b, i) => ({ i, act: b.getAttribute('data-act')! })));
      for (const { i, act } of names) {
        if (acts.has(act) || /^(tally|gstr|stmt|payroll|report|attToday|attCycle|attSubmit|attSet|closeCase)$/.test(act)) continue;
        acts.add(act);
        const dlg = await openForm(page, i);
        if (!dlg) continue;
        await page.waitForTimeout(250);
        const box = await dlg.boundingBox();
        if (!box || box.x < -1 || box.x + box.width > 391) problems.push(`${act}: sheet is ${JSON.stringify(box)}`);
        if (await dlg.evaluate((d) => d.scrollWidth > d.clientWidth + 1)) problems.push(`${act}: sheet scrolls sideways`);
        const submit = dlg.locator('button[type=submit]');
        if (await submit.count()) {
          await submit.scrollIntoViewIfNeeded();
          const b = await submit.boundingBox();
          if (!b || b.y + b.height > 844 || b.y < 0) problems.push(`${act}: save button not reachable ${JSON.stringify(b)}`);
        }
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
      }
    }
    expect(acts.size, 'forms opened').toBeGreaterThan(25);
    expect(problems).toEqual([]);
  });

  test('LAY-04 / REP-09: apply, reports and the console fit the phone; a wide report table scrolls inside its card', async ({ page }) => {
    test.setTimeout(240_000);
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    for (const p of ['/apply', '/login', '/platform/login']) { await page.goto(p); await fits(page, p); }
    await login(page, PHONES.owner);
    for (const kind of ['daily', 'weekly', 'vaccination', 'mortality']) {
      await page.goto(`/report/${kind}`);
      await fits(page, `/report/${kind}`);
    }
    await page.goto('/report/weekly'); // 12 columns: wider than 390px
    const wrap = page.locator('.card.report .tablewrap').first();
    expect(await wrap.evaluate((e) => ({ over: e.scrollWidth > e.clientWidth, ox: getComputedStyle(e).overflowX }))).toEqual({ over: true, ox: expect.stringMatching(/auto|scroll/) });
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await otp(page, '/platform/login', PHONES.platform);
    await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
    await fits(page, '/admin');
    await page.goto('/admin/tenant/' + (await vkr()).tenantId);
    await fits(page, 'support view');
  });

  test('LAY-04 (vendor portal): fits the phone', async ({ page }) => {
    test.setTimeout(120_000);
    const PH = '+919999000003';
    const gone = async () => { const { data } = await admin.auth.admin.listUsers({ perPage: 200 }); for (const u of data?.users ?? []) if (u.phone && '+' + u.phone.replace(/^\+/, '') === PH) await admin.auth.admin.deleteUser(u.id); };
    await gone();
    const { data: u } = await admin.auth.admin.createUser({ phone: PH, phone_confirm: true, app_metadata: { roles: ['vendor'], platform: false } });
    try {
      const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: 'E2E Layout Vendor With A Rather Long Business Name Pvt Ltd', phone: PH, category: 'feed' }).select('id').single();
      await admin.from('product_listing').insert([
        { advertiser_id: adv!.id, title: 'E2E layout product with a rather long title that has to wrap', category: 'feed', description: 'x'.repeat(200), price_text: '₹1,850 / bag', status: 'approved' },
        { advertiser_id: adv!.id, title: 'E2E layout rejected', category: 'other', status: 'rejected', review_note: 'Photo missing and the description is much too short to be useful' },
      ]);
      await page.context().clearCookies();
      await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
      await otp(page, '/login', '9999000003');
      await expect(page).toHaveURL(/\/vendor$/, { timeout: 30_000 });
      await fits(page, '/vendor');
      await page.getByRole('button', { name: '+ Listing' }).click();
      await expect(page.getByLabel('Product / service')).toBeVisible();
      await fits(page, '/vendor new listing');
    } finally { await gone(); }
  });

  for (const [who, mobile, role] of [['LAY-05 supervisor', PHONES.supervisor, null], ['LAY-05 finance', PHONES.finance, 'finance']] as const) {
    test(`${who}: every tab and More screen they can open fits the phone`, async ({ page }) => {
      test.setTimeout(240_000);
      const restore = role ? await (await import('./helpers')).setRole(PHONES.finance, role) : async () => {};
      try {
        await login(page, mobile);
        const tabs = await page.locator('nav.tabs a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
        const seen = new Set<string>();
        for (const tab of tabs) {
          await page.goto(tab);
          await fits(page, `${who} ${tab}`);
          const more = tab === '/more' ? await page.$$eval('a[href^="/more/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')!))]) : [];
          for (const m of more) { if (seen.has(m)) continue; seen.add(m); await page.goto(m); await fits(page, `${who} ${m}`); }
        }
        expect(tabs.length).toBeGreaterThan(1);
      } finally { await restore(); }
    });
  }

  test('REP-08: a report in Telugu has translated headings and Telugu month names in its dates', async ({ page }) => {
    await inLocale(page, PHONES.owner, 'te');
    await page.goto('/report/mortality');
    const card = page.locator('.card.report');
    await expect(card).toBeVisible();
    expect(await findEnglish(page, englishOnly('te'))).toEqual([]);
    const text = (await card.innerText());
    expect(text).toMatch(/[ఀ-౿]/);
    expect(text).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/); // ISO dates are for machines
    expect(text).toMatch(/\b\d{1,2} [ఀ-౿]+/); // day and month name in Telugu, e.g. "24 ఆగ"
  });

  test('FARM-34: on a phone without 3D the farm page still works and says why', async ({ page }) => {
    await login(page, PHONES.owner);
    await page.goto('/farm');
    const viewer = page.locator('canvas').first();
    const fallback = page.getByText("3D view isn't available on this device");
    await expect(viewer.or(fallback)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '+ Shed' }).first()).toBeVisible(); // the plain farm and shed cards are always there
    await fits(page, '/farm');
    await page.getByRole('button', { name: '+ Farm' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('APP-36: the application page in Telugu on a phone has no English labels and no sideways scroll', async ({ page }) => {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'te', url: 'http://localhost:3100' }]);
    await page.goto('/apply');
    await expect(page.locator('html')).toHaveAttribute('lang', 'te');
    expect(await findEnglish(page, englishOnly('te'))).toEqual([]);
    await fits(page, '/apply te');
    for (const k of ['farmType']) expect(await findEnglish(page, englishOnly('te', k))).toEqual([]);
  });
});

test('LAY-06: the app can be installed — manifest has a name, icons and theme colours', async ({ request }) => {
  const r = await request.get('/manifest.webmanifest');
  expect(r.status()).toBe(200);
  const m = await r.json();
  expect(m).toMatchObject({ name: 'HatchPro', short_name: 'HatchPro', start_url: '/home', display: 'standalone' });
  expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).status(), i.src).toBe(200);
});
