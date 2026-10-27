import { randomUUID as uuid } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tamper, uniq, vkr } from './helpers';

// Test plan P2 #19 (equipment half): assets, issues and tickets, service. Role refusals are in p1-roles.
// Works on new "E2E-" assets (removed afterwards, with their tickets and bills).
const INVALID = 'Please check the highlighted fields';
const plus = (days: number) => new Date(Date.parse(TODAY) + days * 864e5).toISOString().slice(0, 10);
let I: Awaited<ReturnType<typeof vkr>>;
test.beforeAll(async () => { I = await vkr(); });
test.afterEach(async () => {
  const { data: a } = await admin.from('asset').select('id').like('name', 'E2E-%');
  const ids = (a ?? []).map((x) => x.id);
  if (ids.length) {
    const { data: t } = await admin.from('maintenance_ticket').select('id').in('asset_id', ids);
    if (t?.length) await admin.from('notification').delete().in('entity_id', t.map((x) => x.id));
    await admin.from('maintenance_ticket').delete().in('asset_id', ids);
    await admin.from('asset').delete().in('id', ids);
  }
  const { data: b } = await admin.from('bill').select('id').eq('vendor_id', I.vendorId).eq('bill_date', TODAY).in('total', [18000, 777]);
  if (b?.length) { await admin.from('payment').delete().in('ref_id', b.map((x) => x.id)); await admin.from('bill').delete().in('id', b.map((x) => x.id)); }
});

async function newAsset(status = 'ok') {
  const name = `E2E-Fan-${uniq()}`;
  const { data } = await admin.from('asset').insert({ tenant_id: I.tenantId, farm_id: I.farmId, name, category: 'fan', next_service_on: plus(90), status }).select('id').single();
  return { id: data!.id, name };
}
async function newTicket(assetId: string, priority = 'medium') {
  const { data } = await admin.from('maintenance_ticket').insert({ tenant_id: I.tenantId, asset_id: assetId, opened_on: TODAY, issue: 'E2E belt slipping', priority }).select('id').single();
  await admin.from('asset').update({ status: 'fault' }).eq('id', assetId);
  return data!.id;
}
const ticket = async (id: string) => (await admin.from('maintenance_ticket').select('status,cost,closed_on').eq('id', id).single()).data!;
const billsFor = async (cost: number) => (await admin.from('bill').select('id,category').eq('vendor_id', I.vendorId).eq('total', cost).eq('bill_date', TODAY)).data!;

test('EQP-02 / EQP-03: owner adds an asset with a cost and vendor (equipment bill booked); bad fields refused', async ({ page }) => {
  const name = `E2E-Fan-${uniq()}`;
  await login(page);
  await page.goto('/more/equipment');
  const sheet = await openAct(page, 'addAsset');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Cost (₹)').fill('18000');
  await sheet.getByLabel('Paid to (optional)').selectOption(I.vendorId);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(`Asset added · ${name}`);
  await expect(page.locator('.item', { hasText: name })).toContainText('fan');
  const { data: a } = await admin.from('asset').select('cost,next_service_on,status').eq('name', name).single();
  expect(a).toEqual({ cost: 18000, next_service_on: plus(90), status: 'ok' });
  expect(await billsFor(18000)).toMatchObject([{ category: 'equipment' }]);

  const ok = { farm_id: I.farmId, name: 'E2E-bad', category: 'fan', next_service: plus(90), date: TODAY };
  for (const o of [{ name: '' }, { cost: -1 }, { next_service: '' }]) {
    expect(await tamper(page, 'addAsset', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('asset').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('EQP-07 / EQP-08: a supervisor logs a low issue (no critical alert); too short, too long or blank issue refused', async ({ page }) => {
  const a = await newAsset();
  await login(page, PHONES.supervisor);
  await page.goto('/more/equipment');
  const sheet = await openAct(page, 'reportIssue', { asset: a.id, name: a.name });
  await sheet.getByLabel('What is wrong?').fill('Belt is loose');
  await sheet.getByLabel('Priority').selectOption('low');
  await sheet.getByRole('button', { name: 'Report' }).click();
  await expect(page.locator('.toast')).toContainText('Ticket opened');
  await expect(page.locator('.toast')).not.toContainText('owner alerted');
  const { data: t } = await admin.from('maintenance_ticket').select('id,priority,status').eq('asset_id', a.id);
  expect(t).toMatchObject([{ priority: 'low', status: 'open' }]);
  expect((await admin.from('notification').select('id').eq('entity_id', t![0].id)).data).toEqual([]);

  const ok = { asset_id: a.id, issue: 'Belt is loose', priority: 'low', date: TODAY };
  for (const issue of ['ab', 'i'.repeat(501), '   ']) {
    expect(await tamper(page, 'reportIssue', { ...ok, issue }), issue.length + '').toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('maintenance_ticket').select('id').eq('asset_id', a.id)).data).toHaveLength(1);
});

test('EQP-11 / EQP-12 / EQP-13: a store keeper closes tickets with and without cost; twice and negative cost refused', async ({ page }) => {
  test.setTimeout(90_000);
  const a = await newAsset();
  const costly = await newTicket(a.id), plain = await newTicket(a.id);
  const restore = await setRole(PHONES.finance, 'store_keeper');
  try {
    await login(page, PHONES.finance);
    await page.goto('/more/equipment');
    // cost but no vendor: closed, no bill
    let sheet = await openAct(page, 'closeTicket', { ticket: costly, name: a.name });
    await sheet.getByLabel('Repair cost (₹)').fill('777');
    await sheet.getByRole('button', { name: 'Close ticket' }).click();
    await expect(page.locator('.toast')).toContainText('Ticket closed');
    await expect(page.locator('.toast')).not.toContainText('bill booked');
    expect(await ticket(costly)).toMatchObject({ status: 'closed', cost: 777 });
    expect(await billsFor(777)).toEqual([]);
    await expect(page.getByRole('dialog')).toBeHidden();
    // nothing at all
    sheet = await openAct(page, 'closeTicket', { ticket: plain, name: a.name });
    await sheet.getByRole('button', { name: 'Close ticket' }).click();
    await expect(page.locator('.toast').last()).toContainText('Ticket closed');
    await expect.poll(async () => (await ticket(plain)).status).toBe('closed');
    expect((await ticket(plain)).cost).toBeNull();
    expect((await admin.from('asset').select('status').eq('id', a.id).single()).data!.status).toBe('ok'); // last open ticket gone

    await expect(page.getByRole('dialog')).toBeHidden(); // the close form must be gone before a tampered call borrows the dialog
    expect(await tamper(page, 'closeTicket', { ticket_id: plain, date: TODAY })).toMatchObject({ ok: false, error: 'ticket already closed' });
    const open = await newTicket(a.id);
    await page.keyboard.press('Escape'); // close the carrier form the previous tampered call left open
    expect(await tamper(page, 'closeTicket', { ticket_id: open, date: TODAY, cost: -1 })).toMatchObject({ ok: false, error: INVALID });
    expect((await ticket(open)).status).toBe('open');
  } finally { await restore(); }
});

test('EQP-15 / EQP-16: service done moves the next service date and clears the fault; next service must be after today', async ({ page }) => {
  const a = await newAsset('fault');
  await login(page);
  await page.goto('/more/equipment');
  const sheet = await openAct(page, 'serviceDone', { asset: a.id, name: a.name });
  await sheet.getByLabel('Next service').fill(TODAY); // EQP-16
  await sheet.getByRole('button', { name: 'Save service' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Next service must be after today');
  expect(await admin.from('asset').select('status,next_service_on').eq('id', a.id).single().then((r) => r.data)).toEqual({ status: 'fault', next_service_on: plus(90) });

  await sheet.getByLabel('Next service').fill(plus(120));
  await sheet.getByRole('button', { name: 'Save service' }).click();
  await expect(page.locator('.toast')).toContainText('Service recorded');
  expect(await admin.from('asset').select('status,next_service_on').eq('id', a.id).single().then((r) => r.data)).toEqual({ status: 'ok', next_service_on: plus(120) });
  expect(await tamper(page, 'serviceDone', { asset_id: uuid(), date: TODAY, next_service: plus(5) })).toMatchObject({ ok: false, error: 'Not found' });
});
