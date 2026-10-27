import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tempBatch, cleanTemp, vkr } from './helpers';

// Test plan P2b: the farm-type picker (WEL-05..08), home screen tiles and quick actions (HOME-02..08), report pages and
// CSV downloads (REP-03/04/06), and MON-03's "batch P&L revenue goes up". Everything made here is "E2E-" named.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'behaviour, not layout (layout is in the p3 specs)'); });
const day = (back: number) => new Date(Date.parse(TODAY) - back * 864e5).toISOString().slice(0, 10);
test.afterEach(async () => { await cleanTemp(); });

test('WEL-05 / WEL-07 / WEL-08: the picker lists only this farm\'s types, needs a login, and switches language', async ({ page, context }) => {
  await page.goto('/welcome');
  await expect(page).toHaveURL(/\/login/); // WEL-07: signed out
  await login(page, PHONES.owner);
  await page.goto('/welcome');
  const picker = page.locator('.menu');
  await expect(picker.getByRole('button')).toHaveCount(2); // WEL-05: VKR has layer and broiler farms, no hatchery
  await expect(picker).toContainText('Broiler');
  await expect(picker).toContainText('Layer');
  await expect(picker).not.toContainText('Hatchery');
  await page.getByLabel('Language').selectOption('hi'); // WEL-08
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('What do you want to manage now?');
  await expect(picker).not.toContainText('Broiler');
  await context.clearCookies();
});

test('WEL-06: replaying the farm-type action with an unknown type is refused and the profile is unchanged', async ({ page }) => {
  await login(page, PHONES.owner);
  await page.goto('/welcome');
  let id = '';
  await page.route('**/*', async (route) => { // all we want from a real tap is the action id
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action']) { id = r.headers()['next-action']; return route.abort(); }
    return route.fallback();
  });
  await page.getByRole('button', { name: /Layer/ }).click();
  await expect.poll(() => id).not.toBe('');
  await page.unroute('**/*');
  const mode = async () => (await admin.from('app_user').select('active_farm_type').eq('phone', '+91 98490 12345').single()).data!.active_farm_type;
  expect(await mode()).toBe('broiler');
  const r = await page.request.post('/welcome', { headers: { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component' }, data: JSON.stringify(['duck']), maxRedirects: 0 });
  expect(r.status()).toBe(500);
  expect(await r.text()).not.toContain('"ok"');
  expect(await mode()).toBe('broiler');
});

test('HOME-02: the broiler view shows weight / FCR and farm-gate tiles', async ({ page }) => {
  await login(page, PHONES.owner);
  const tiles = page.locator('.grid2 .tile');
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(1)).toContainText('Avg weight');
  await expect(tiles.nth(1)).toContainText(/FCR [\d.—]+ · day \d+/);
  await expect(tiles.nth(2)).toContainText('Broiler farm-gate');
  await expect(tiles.nth(2)).toContainText(/₹\d+\/kg/);
  await expect(tiles.nth(2)).toContainText(/(▲|▼) .*vs last week/);
  await expect(page.locator('body')).not.toContainText(/NaN|undefined/);
});

test('HOME-03 / 04 / 06: quick actions open their forms and Attendance goes to People', async ({ page }) => {
  await login(page, PHONES.owner);
  const quick = page.locator('.quick');
  await quick.getByRole('button', { name: 'Mortality' }).click();
  await expect(page.getByRole('dialog')).toContainText('Record mortality');
  await expect(page.getByRole('dialog').getByLabel('Batch')).toContainText(/\w+-\w+-\d{4}-\d+/); // an active batch
  await page.keyboard.press('Escape');
  await quick.getByRole('button', { name: 'Sale' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Raise invoice' })).toBeVisible();
  await page.keyboard.press('Escape');
  await quick.getByRole('button', { name: 'Payment' }).click();
  await expect(page.getByRole('dialog').getByLabel('Bill / invoice')).toContainText('₹'); // open bills and invoices to settle
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ Place batch' }).click();
  await expect(page.getByRole('dialog')).toContainText('Place a batch');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await quick.getByRole('button', { name: 'Attendance' }).click();
  await expect(page).toHaveURL(/\/more\/people$/);
});

test('HOME-05: quick actions follow the role — supervisor has no Sale / Payment, finance has no Mortality', async ({ page }) => {
  test.setTimeout(120_000);
  const names = async () => (await page.locator('.quick button').allInnerTexts()).map((s) => s.replace(/^\S+\s/, '').trim());
  await login(page, PHONES.supervisor);
  expect(await names()).toEqual(['Mortality', 'Attendance']);
  const restore = await setRole(PHONES.finance, 'finance');
  try {
    await login(page, PHONES.finance);
    expect(await names()).toEqual(['Sale', 'Payment', 'Attendance']);
  } finally { await restore(); }
});

test('HOME-07 / HOME-08: a mortality spike turns the tile red and names the shed; the bell link opens notifications', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PHONES.owner);
  const mortTile = page.locator('.tile', { hasText: 'Mortality today' });
  await expect(mortTile).toContainText('within baseline');
  const b = await tempBatch('broiler');
  const shed = (await admin.from('shed').select('name').eq('id', (await admin.from('batch').select('shed_id').eq('id', b.id).single()).data!.shed_id).single()).data!.name;
  const rows = Array.from({ length: 14 }, (_, i) => ({ // a quiet week, then ten times the deaths for a week
    tenant_id: b.tenantId, batch_id: b.id, shed_id: undefined as unknown as string, log_date: day(13 - i), birds_opening: 1000, mortality: i < 7 ? 2 : 20, feed_kg: 100,
  }));
  const shedId = (await admin.from('batch').select('shed_id').eq('id', b.id).single()).data!.shed_id;
  expect((await admin.from('daily_shed_log').insert(rows.map((r) => ({ ...r, shed_id: shedId })))).error).toBeNull();
  await page.reload();
  await expect(mortTile.locator('.delta')).toHaveText(`spike in ${shed}`);
  await expect(mortTile.locator('.delta')).toHaveClass(/down/);
  await page.getByRole('link', { name: /^All \d+ ›$/ }).click(); // HOME-08
  await expect(page).toHaveURL(/\/more\/notifications$/);
});

test('batch page: the Vaccinate quick action exists only while a vaccination is still to do (found by the walk-through: it was a dead button)', async ({ page }) => {
  await login(page, PHONES.owner);
  const { data: all } = await admin.from('vaccination_schedule').select('batch_id,done_on');
  const open = new Set((all ?? []).filter((v) => !v.done_on).map((v) => v.batch_id));
  const { data: batches } = await admin.from('batch').select('id,code').neq('state', 'closed').in('code', ['VKR-L-2026-01', 'VKR-B-2026-14']);
  expect(batches!.some((b) => open.has(b.id)) && batches!.some((b) => !open.has(b.id)), 'seed has one of each').toBe(true);
  for (const b of batches!) {
    await page.goto(`/farm/batch/${b.code}`);
    await expect(page.locator('.quick').getByRole('button', { name: 'Mortality' })).toBeVisible();
    await expect(page.locator('.quick').getByRole('button', { name: 'Vaccinate' }), b.code).toHaveCount(open.has(b.id) ? 1 : 0);
    if (open.has(b.id)) { // and it does open the form for the next vaccine
      await page.locator('.quick').getByRole('button', { name: 'Vaccinate' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    }
  }
});

test('REP-04 / REP-06: a supervisor can open a report; an unknown report is a 404', async ({ page }) => {
  await login(page, PHONES.supervisor);
  await page.goto('/report/daily');
  await expect(page.locator('.card.report').getByRole('heading', { name: 'Daily farm summary' })).toBeVisible();
  await login(page, PHONES.owner);
  const r = await page.goto('/report/xyz');
  expect(r!.status()).toBe(404);
  await expect(page.locator('.card.report')).toHaveCount(0);
});

test('REP-03: the four CSV report rows download a real CSV with a header', async ({ page }) => {
  await login(page, PHONES.owner);
  const files: [string, RegExp, RegExp][] = [
    ['Monthly P&L', /batch-pnl-.*\.csv$/, /^.?Batch,Shed,Type,State,Chick cost,Bills,Revenue/],
    ['Vendor statements', /statements-.*\.csv$/, /^.?Type,Party,Document,Date,Due,Total,Paid,Outstanding,Status/],
    ['Trader statements', /statements-.*\.csv$/, /^.?Type,Party,Document/],
    ['Attendance & wage register', /attendance-.*\.csv$/, /^.?Worker,Role,1,2,3/],
  ];
  for (const [name, fileRe, headRe] of files) {
    await page.goto('/more/reports');
    const dl = page.waitForEvent('download');
    await page.locator('.item', { hasText: name }).getByRole('button', { name: 'Generate' }).click();
    const d = await dl;
    expect(d.suggestedFilename(), name).toMatch(fileRe);
    const body = (await (await import('node:fs/promises')).readFile((await d.path())!, 'utf8'));
    expect(body.split(/\r?\n/)[0], name).toMatch(headRe);
    expect(body.split(/\r?\n/).length, name).toBeGreaterThan(1);
  }
});

test('MON-03: raising a sale on a batch adds its amount to that batch\'s P&L revenue', async ({ page }) => {
  test.setTimeout(120_000);
  const t = await vkr();
  const revenue = async () => {
    const csv = await (await page.request.get('/api/export/pnl')).text();
    const line = csv.split(/\r?\n/).find((l) => l.startsWith('VKR-L-2026-01,'))!;
    return Number(line.split(',')[6]);
  };
  await login(page, PHONES.owner);
  const before = await revenue();
  await page.goto('/money');
  const sheet = await openAct(page, 'saleOpen');
  await sheet.getByLabel('Quantity').fill('100');
  await sheet.getByLabel('Rate (₹ per unit)').fill('6.25');
  await sheet.getByLabel('Batch (optional)').selectOption({ label: 'VKR-L-2026-01 · Shed 1' });
  await sheet.getByRole('button', { name: 'Raise invoice' }).click();
  await expect(page.locator('.toast').last()).toContainText('Invoice INV');
  const no = ((await page.locator('.toast').last().textContent()) ?? '').match(/INV\d+/)![0];
  try { expect(await revenue()).toBe(before + 625); }
  finally {
    const { data: inv } = await admin.from('invoice').select('id').eq('invoice_no', no).eq('tenant_id', t.tenantId).single();
    await admin.from('payment').delete().eq('ref_id', inv!.id);
    await admin.from('invoice').delete().eq('id', inv!.id);
  }

});
