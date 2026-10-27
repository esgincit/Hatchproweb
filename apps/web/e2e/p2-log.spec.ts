import { test, expect, type Page } from '@playwright/test';
import { admin, TODAY, PHONES, login, tamper, uniq, dropBatch, vkr } from './helpers';

// Test plan P2 #15: the daily log form as a shed supervisor uses it: layer egg grades, overwrite on re-save, field
// bounds, the DB temperature rule, invalid dates, several offline entries, feed photo. Runs on throw-away batches
// (so no seed log is touched); each is removed afterwards.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const INVALID = 'Please check the highlighted fields';
let I: Awaited<ReturnType<typeof vkr>>;
const codes: string[] = [];
const sheds: string[] = [];

test.beforeAll(async () => { I = await vkr(); });
test.afterEach(async () => {
  for (const c of codes.splice(0)) await dropBatch(c);
  if (sheds.length) await admin.from('shed').delete().in('id', sheds.splice(0));
});

/** A running batch placed 30 days before today, in its own new shed, made with the service role. */
async function tempBatch(type: 'broiler' | 'layer') {
  const farm = (await admin.from('farm').select('id').eq('tenant_id', I.tenantId).eq('farm_type', type).limit(1).single()).data!.id;
  const { data: s } = await admin.from('shed').insert({ tenant_id: I.tenantId, farm_id: farm, name: `E2E-${uniq()}`, shed_type: 'cage', capacity_birds: 5000 }).select('id').single();
  sheds.push(s!.id);
  const code = `E2E-LOG-${type[0]}-${uniq()}`;
  codes.push(code);
  const placed = new Date(Date.parse(TODAY) - 30 * 864e5).toISOString().slice(0, 10);
  const { data: b } = await admin.from('batch').insert({
    tenant_id: I.tenantId, farm_id: farm, shed_id: s!.id, code, farm_type: type, placed_on: placed, doc_count: 1000, state: type === 'layer' ? 'laying' : 'growing',
  }).select('id').single();
  return { id: b!.id, code };
}
const rows = async (batchId: string) => (await admin.from('daily_shed_log').select('*').eq('batch_id', batchId)).data!;

async function openLog(page: Page, code: string, mode: 'broiler' | 'layer' = 'broiler') {
  await login(page, PHONES.supervisor);
  await admin.from('app_user').update({ active_farm_type: mode }).eq('phone', '+91 90000 33445');
  await page.goto(`/log?batch=${code}`);
  await expect(page.getByLabel('Mortality')).toBeVisible();
}
const save = (page: Page) => page.getByRole('button', { name: /Save log/ }).click();
const fill = async (page: Page, v: Record<string, string>) => { for (const [l, x] of Object.entries(v)) await page.getByLabel(l, { exact: false }).first().fill(x); };

test('LOG-02: a layer log with egg trays by grade stores eggs = trays x 30 per grade', async ({ page }) => {
  const b = await tempBatch('layer');
  await openLog(page, b.code, 'layer');
  await fill(page, { Jumbo: '10', Cracked: '2' });
  await expect(page.getByText('360', { exact: false }).first()).toBeVisible(); // live total: 12 trays x 30
  await expect(page.getByText('36.0%')).toBeVisible(); // 360 / 1000 hens
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${b.code}$`), { timeout: 30_000 });
  const [log] = await rows(b.id);
  const { data: eggs } = await admin.from('egg_production').select('grade,count').eq('daily_log_id', log.id);
  expect(eggs).toHaveLength(2);
  expect(eggs).toEqual(expect.arrayContaining([{ grade: 'jumbo', count: 300 }, { grade: 'cracked', count: 60 }]));
});

test('LOG-03: saving the same day twice keeps one row with the latest values', async ({ page }) => {
  const b = await tempBatch('broiler');
  await openLog(page, b.code);
  await fill(page, { Mortality: '3', 'Avg weight': '800' });
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${b.code}$`), { timeout: 30_000 });
  await page.goto(`/log?batch=${b.code}`);
  await fill(page, { Mortality: '5', 'Avg weight': '850' });
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${b.code}$`), { timeout: 30_000 });
  const r = await rows(b.id);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ mortality: 5, avg_weight_g: 850, sync_version: 2 });
});

test('LOG-07 / 08 / 10 / 11 / 12: out-of-range numbers are refused in the form; the edge values are accepted', async ({ page }) => {
  const b = await tempBatch('broiler');
  await openLog(page, b.code);
  const toast = page.locator('.toast');
  const bad = async (v: Record<string, string>, field: string) => {
    await page.reload();
    await expect(page.getByLabel('Mortality')).toBeVisible();
    await fill(page, v);
    await save(page);
    await expect(toast.last()).toContainText(INVALID);
    await expect(page.getByLabel(field, { exact: false }).first()).toHaveAttribute('aria-invalid', 'true');
    expect(await rows(b.id)).toHaveLength(0);
  };
  await bad({ Mortality: '-1' }, 'Mortality');
  await bad({ Culls: '-2' }, 'Culls');
  await bad({ 'Feed (bags': '-1' }, 'Feed (bags');
  await bad({ 'Water (litres)': '-5' }, 'Water (litres)');
  await bad({ 'Min °C': '-11' }, 'Min °C'); // LOG-08
  await bad({ 'Max °C': '61' }, 'Max °C');
  await bad({ 'RH %': '101' }, 'RH %'); // LOG-10
  await bad({ 'RH %': '-1' }, 'RH %');
  await bad({ 'Avg weight': '0' }, 'Avg weight'); // LOG-11
  await bad({ 'Avg weight': '12.5' }, 'Avg weight');
  await bad({ Remarks: 'r'.repeat(501) }, 'Remarks'); // LOG-12

  await page.reload();
  await fill(page, { 'Min °C': '-10', 'Max °C': '60', 'RH %': '100', Remarks: 'r'.repeat(500) });
  await save(page);
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${b.code}$`), { timeout: 30_000 });
  expect(await rows(b.id)).toMatchObject([{ temp_min_c: -10, temp_max_c: 60, humidity_pct: 100 }]);
});

test('LOG-09 / LOG-16: min above max temperature and an impossible date are refused with a clean message', async ({ page }) => {
  const b = await tempBatch('broiler');
  await openLog(page, b.code);
  await fill(page, { 'Min °C': '35', 'Max °C': '20' });
  await save(page);
  await expect(page.locator('.toast').last()).toContainText('minimum temperature is above the maximum');
  const input = { batch_id: b.id, mortality: 0, culls: 0, feed_bags: 1 };
  expect(await tamper(page, 'logSave', { ...input, date: '2026-02-30' })).toMatchObject({ ok: false, error: INVALID, fields: ['date'] });
  expect(await tamper(page, 'logSave', { ...input, date: '2026-13-01' })).toMatchObject({ ok: false, error: INVALID });
  expect(await rows(b.id)).toHaveLength(0);
});

test('LOG-19 / LOG-20: entries saved offline (even double-tapped) sync in order into one row', async ({ page, context }) => {
  test.setTimeout(120_000);
  const b = await tempBatch('broiler');
  await openLog(page, b.code);
  await context.setOffline(true);
  try {
    await fill(page, { Mortality: '2' });
    await save(page);
    await expect(page.getByText('No network — saved on this phone')).toBeVisible();
    await fill(page, { Mortality: '4' });
    await page.getByRole('button', { name: /Save log/ }).dblclick(); // LOG-20: double tap
    await expect(page.getByTestId('outbox')).toContainText('entries saved offline');
    expect(await rows(b.id)).toHaveLength(0);
  } finally { await context.setOffline(false); }
  await expect(page.getByText(/offline entries synced/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('outbox')).toHaveCount(0);
  await expect.poll(async () => (await rows(b.id)).map((r) => r.mortality)).toEqual([4]); // the later entry wins, one row
});

test('LOG-22 / LOG-23: a feed photo is saved online; offline it is refused and nothing is queued', async ({ page, context }) => {
  const b = await tempBatch('broiler');
  await openLog(page, b.code);
  const pick = () => page.getByTestId('photo-feed').locator('input[type=file]').setInputFiles({ name: 'feed.png', mimeType: 'image/png', buffer: PNG });
  await context.setOffline(true);
  try {
    await pick();
    await expect(page.locator('.toast').last()).toContainText('Photos need network');
  } finally { await context.setOffline(false); }
  expect((await admin.from('media').select('id').eq('entity_id', b.id)).data).toEqual([]);
  await expect(page.getByTestId('outbox')).toHaveCount(0);

  await pick();
  await expect(page.locator('.toast').last()).toContainText('Photo saved', { timeout: 20_000 });
  const { data: m } = await admin.from('media').select('id,storage_path').eq('entity_id', b.id);
  expect(m).toHaveLength(1);
  expect(m![0].storage_path.endsWith('.png')).toBe(true);
  await admin.storage.from('evidence').remove([m![0].storage_path]);
  await admin.from('media').delete().eq('id', m![0].id);
});
