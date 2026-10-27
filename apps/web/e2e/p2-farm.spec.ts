import { test, expect } from '@playwright/test';
import { admin, TODAY, login, openAct, tamper, uniq, dropBatch, vkr } from './helpers';

// Test plan P2 #16: farms, sheds, batch placement (chick bill, duplicate code, busy shed, future date, double submit),
// stage changes and closing a batch. Everything made here is removed afterwards.
const code = (tag: string) => `E2E-${tag}-${uniq()}`;
let I: Awaited<ReturnType<typeof vkr>>;
let shedA: string, shedB: string, layerFarm: string, tenant: string, chickVendor: string;
const codes: string[] = [];
const sheds: string[] = [];

test.beforeAll(async () => {
  I = await vkr();
  tenant = I.tenantId;
  const sh = async (name: string) => (await admin.from('shed').select('id').eq('name', name).eq('tenant_id', tenant).limit(1).single()).data!.id;
  shedA = await sh('Shed A'); shedB = await sh('Shed B');
  layerFarm = (await admin.from('farm').select('id').eq('tenant_id', tenant).eq('farm_type', 'layer').limit(1).single()).data!.id;
  chickVendor = (await admin.from('vendor').select('id').eq('tenant_id', tenant).eq('category', 'doc_hatchery').limit(1).single()).data!.id;
});

test.afterEach(async () => {
  for (const c of codes.splice(0)) await dropBatch(c);
  if (sheds.length) await admin.from('shed').delete().in('id', sheds.splice(0));
  const { data: f } = await admin.from('farm').select('id').like('name', 'E2E-%');
  if (f?.length) { await admin.from('shed').delete().in('farm_id', f.map((x) => x.id)); await admin.from('farm').delete().in('id', f.map((x) => x.id)); }
});

async function tempShed(farm = layerFarm) {
  const { data } = await admin.from('shed').insert({ tenant_id: tenant, farm_id: farm, name: `E2E-${uniq()}`, shed_type: 'cage', capacity_birds: 5000 }).select('id').single();
  sheds.push(data!.id);
  return data!.id;
}
const base = (c: string, shed = shedB) => ({ shed_id: shed, code: c, placed: TODAY, doc: 100, doc_rate: 0 });
const batchOf = async (c: string) => (await admin.from('batch').select('id,state,farm_type').eq('code', c).maybeSingle()).data;

test('FARM-02 / FARM-05: owner adds a farm, then a shed in it, through the forms', async ({ page }) => {
  const name = `E2E-Farm-${uniq()}`;
  await login(page);
  await page.goto('/farm');
  let sheet = await openAct(page, 'addFarm');
  await sheet.getByLabel('Farm name').fill(name);
  await sheet.getByLabel('Capacity (birds)').fill('10000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(`Farm added · ${name}`);
  const { data: farm } = await admin.from('farm').select('id,farm_type,capacity_birds').eq('name', name).single();
  expect(farm).toMatchObject({ farm_type: 'broiler', capacity_birds: 10000 });

  sheet = await openAct(page, 'addShed');
  await sheet.getByLabel('Farm', { exact: true }).selectOption({ label: name });
  await sheet.getByLabel('Shed name').fill('Shed Z');
  await sheet.getByLabel('Shed type').selectOption({ label: 'Cage' });
  await sheet.getByLabel('Capacity (birds)').fill('5000');
  await sheet.getByLabel('Area (sq ft)').fill('4000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast').last()).toContainText('Shed added · Shed Z');
  const { data: shed } = await admin.from('shed').select('shed_type,capacity_birds,area_sqft').eq('farm_id', farm!.id).single();
  expect(shed).toMatchObject({ shed_type: 'cage', capacity_birds: 5000, area_sqft: 4000 });
});

test('FARM-03 / FARM-06: bad farm and shed fields are refused by the server', async ({ page }) => {
  await login(page);
  const farm = (name: string, capacity?: unknown) => ({ name, farm_type: 'broiler', capacity });
  for (const [n, cap] of [['', 100], ['   ', 100], ['x'.repeat(121), 100], ['E2E-bad', 0], ['E2E-bad', -5], ['E2E-bad', 2.5]] as const) {
    const r = await tamper(page, 'addFarm', farm(n, cap));
    expect(r, `${JSON.stringify([n.length, cap])}`).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  }
  const shed = (o: Record<string, unknown>) => ({ farm_id: layerFarm, name: 'E2E-bad', shed_type: 'cage', capacity: 100, ...o });
  for (const o of [{ capacity: '' }, { capacity: 0 }, { area_sqft: -1 }, { name: 'x'.repeat(121) }]) {
    expect(await tamper(page, 'addShed', shed(o)), JSON.stringify(o)).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  }
  expect((await admin.from('farm').select('id').like('name', 'E2E-bad%')).data).toEqual([]);
  expect((await admin.from('shed').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('FARM-10 / FARM-14: placing with a supplier and rate books the chick bill; then no shed is free', async ({ page }) => {
  const c = code('F10'); codes.push(c);
  await login(page);
  await page.goto('/farm');
  const sheet = await openAct(page, 'addBatch', { shed: shedB });
  await sheet.getByLabel('Batch code').fill(c);
  await sheet.getByLabel('Chicks placed').fill('1000');
  await sheet.getByLabel('Rate per chick (₹)').fill('40');
  await sheet.getByLabel('Hatchery / supplier').selectOption(chickVendor);
  await sheet.getByRole('button', { name: 'Place batch' }).click();
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${c}$`), { timeout: 30_000 });
  const b = await batchOf(c);
  const { data: bills } = await admin.from('bill').select('category,total,status,vendor_id').eq('batch_id', b!.id);
  expect(bills).toEqual([{ category: 'chick', total: 40000, status: 'unpaid', vendor_id: chickVendor }]);

  const again = await openAct(page, 'addBatch');
  await expect(again.getByText('Every shed has an active batch')).toBeVisible(); // FARM-14: Shed A and B are both busy now
  await expect(again.getByLabel('Batch code')).toHaveCount(0);
});

test('FARM-11 / FARM-12 / FARM-13 / FARM-15: placement refused for bad numbers, a used code, a busy shed and a future date', async ({ page }) => {
  await login(page);
  const c = code('F11'); codes.push(c);
  for (const o of [{ doc: 0 }, { doc: -1 }, { doc: 1.5 }, { doc_rate: -1 }, { code: '' }, { code: 'x'.repeat(121) }]) {
    expect(await tamper(page, 'addBatch', { ...base(c), ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  }
  const dup = await tamper(page, 'addBatch', base('VKR-B-2026-14')); // FARM-12: friendly text, not "duplicate key value violates…"
  expect(dup).toMatchObject({ ok: false, error: 'This code or name is already used — pick another.' });
  const busy = await tamper(page, 'addBatch', base(c, shedA)); // FARM-13
  expect(busy).toMatchObject({ ok: false, error: 'shed already has an active batch' });
  const future = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10); // FARM-15: refused, not saved
  expect(await tamper(page, 'addBatch', { ...base(c), placed: future })).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  expect(await batchOf(c)).toBeNull();
});

test('FARM-16: double-clicking Place batch places one batch', async ({ page }) => {
  const c = code('F16'); codes.push(c);
  await login(page);
  await page.goto('/farm');
  const sheet = await openAct(page, 'addBatch', { shed: shedB });
  await sheet.getByLabel('Batch code').fill(c);
  await sheet.getByLabel('Chicks placed').fill('300');
  await sheet.getByRole('button', { name: 'Place batch' }).dblclick();
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${c}$`), { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect((await admin.from('batch').select('id').eq('code', c)).data).toHaveLength(1);
});

test('FARM-21 / FARM-22 / FARM-27 / FARM-28: a closed batch cannot change stage or be closed again; bad close numbers refused', async ({ page }) => {
  await login(page);
  const { data: closed } = await admin.from('batch').select('id').eq('code', 'VKR-B-2026-13').single();
  const id = closed!.id;
  expect(await tamper(page, 'batchState', { batch_id: id, state: 'growing', date: TODAY })).toMatchObject({ ok: false, error: 'batch not found or already closed' });
  for (const state of ['closed', 'xyz']) { // not a stage: closing goes through closeBatch only
    expect(await tamper(page, 'batchState', { batch_id: id, state, date: TODAY }), state).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  }
  expect(await tamper(page, 'closeBatch', { batch_id: id, date: TODAY })).toMatchObject({ ok: false, error: 'batch already closed' });
  expect(await tamper(page, 'closeBatch', { batch_id: id, date: TODAY, weight_kg: -1 })).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  expect(await tamper(page, 'closeBatch', { batch_id: id, date: TODAY, rate: 0 })).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
});

test('FARM-30: a closed batch shows Closed and offers no actions', async ({ page }) => {
  await login(page);
  await page.goto('/farm/batch/VKR-B-2026-13');
  await expect(page.locator('.tile', { hasText: 'Closed' })).toBeVisible();
  await expect(page.locator('.quick')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Close batch/ })).toHaveCount(0);
  await page.goto('/farm/batch/VKR-B-2026-14'); // control: an active batch has them
  await expect(page.locator('.quick button', { hasText: 'Mortality' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Close batch/ })).toBeVisible();
});

test('FARM-25 / FARM-26: closing a layer batch raises a spent-hen invoice; without buyer or rate it only closes', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const place = async (tag: string) => {
    const c = code(tag); codes.push(c);
    expect(await tamper(page, 'addBatch', base(c, await tempShed()))).toMatchObject({ ok: true });
    return (await batchOf(c))!;
  };
  const invoices = async (id: string) => (await admin.from('invoice').select('product,total,qty,unit').eq('batch_id', id)).data;

  const withBuyer = await place('F25');
  expect(withBuyer.farm_type).toBe('layer');
  const r = await tamper(page, 'closeBatch', { batch_id: withBuyer.id, date: TODAY, customer_id: I.customerId, weight_kg: 100, rate: 50 });
  expect(r).toMatchObject({ ok: true });
  expect(await invoices(withBuyer.id)).toEqual([{ product: 'spent_hen', total: 5000, qty: 100, unit: 'kg' }]);

  const none = await place('F26a');
  expect(await tamper(page, 'closeBatch', { batch_id: none.id, date: TODAY })).toMatchObject({ ok: true, msg: 'Batch closed' });
  expect(await invoices(none.id)).toEqual([]);
  expect((await admin.from('batch').select('state').eq('id', none.id).single()).data!.state).toBe('closed');

  const noRate = await place('F26b');
  expect(await tamper(page, 'closeBatch', { batch_id: noRate.id, date: TODAY, customer_id: I.customerId, weight_kg: 100 })).toMatchObject({ ok: true, msg: 'Batch closed' });
  expect(await invoices(noRate.id)).toEqual([]);
});
