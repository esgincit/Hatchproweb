import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { admin, PHONES, login, otp, setRole, uniq } from './helpers';

// Requirement gaps (0061) through the real screens on the KS Farms tenant (the KS owner's login is re-roled per step):
// alert lifecycle, payment proof (staff, finance view, portal customer), requisition -> PO, the three dispatch print pages and breeder feed days.
// Fixtures are named E2E-G* and removed afterwards (SQL around the triggers; replica role: children first).
test.describe.configure({ mode: 'serial' });
const REAL = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const KS = `(select id from tenant where name = 'KS Farms')`;
const ALL_MODULES = ['core', 'breeder', 'hatchery', 'sales', 'dispatch', 'dashboards', 'portal', 'branches', 'api'];
const PORTAL_PHONE = '9999000003';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let tenant: string, hatchFarm: string, breederFarm: string, custA: string, custB: string, batchId: string, tripNo: string, flockCode: string;
let proofOrder: { id: string; no: string }, portalOrder: { id: string; no: string };

function sql(q: string) {
  execFileSync('docker', ['exec', 'supabase_db_poultryos', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `set session_replication_role = replica; ${q}`], { stdio: 'pipe' });
}
const BATCHES = `select id from batch where tenant_id = ${KS} and code like 'E2E-G%'`;
const PRS = `select po_id from purchase_requisition where tenant_id = ${KS} and purpose like 'E2E-G%' and po_id is not null`;
function clean() {
  const lines = `select id from dispatch_line where dispatch_id in (select id from dispatch where tenant_id = ${KS} and driver_name like 'E2E-G%')`;
  sql(`delete from invoice where dispatch_line_id in (${lines});
       delete from dispatch_line where id in (${lines});
       delete from dispatch where tenant_id = ${KS} and driver_name like 'E2E-G%';
       delete from vehicle where tenant_id = ${KS} and reg_no like '%E2EG%';
       delete from order_allocation where batch_id in (${BATCHES});
       delete from sales_order where customer_id in (select id from customer where name like 'E2E-G%');
       delete from customer_portal_user where customer_id in (select id from customer where name like 'E2E-G%');
       delete from customer where name like 'E2E-G%';
       delete from breeder_daily where batch_id in (${BATCHES});
       delete from batch_state_history where batch_id in (${BATCHES}); delete from vaccination_schedule where batch_id in (${BATCHES});
       delete from batch where tenant_id = ${KS} and code like 'E2E-G%';
       delete from chick_product where name like 'E2E-G%';
       delete from stock_movement where item_id in (select id from item where name like 'E2E-G%');
       delete from po_line where po_id in (${PRS});
       delete from purchase_order where id in (${PRS});
       delete from purchase_requisition where tenant_id = ${KS} and purpose like 'E2E-G%';
       delete from item where name like 'E2E-G%'; delete from store where name like 'E2E-G%';
       delete from shed where name like 'E2E-G%'; delete from farm where name like 'E2E-G%';
       delete from subscription where tenant_id = ${KS};
       delete from notification where tenant_id = ${KS} and (title like '%E2E-G%' or title like 'Feed running low%' or title like 'Payment proof%')`);
}
async function dropPortalUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone === '91' + PORTAL_PHONE || u.phone === '+91' + PORTAL_PHONE) await admin.auth.admin.deleteUser(u.id);
}
async function dropProofFiles() {
  for (const o of [proofOrder, portalOrder].filter(Boolean)) {
    const dir = `${tenant}/payment/${o.id}`;
    const { data } = await admin.storage.from('evidence').list(dir);
    if (data?.length) await admin.storage.from('evidence').remove(data.map((f) => `${dir}/${f.name}`));
  }
}

async function order(customer: string, product: string, qty: number) {
  const no = `SO-E2EG-${uniq()}${qty}`;
  const { data, error } = await admin.from('sales_order').insert({ tenant_id: tenant, order_no: no, customer_id: customer, product_id: product, qty, hatch_date: REAL, price: 40 }).select('id').single();
  expect(error).toBeNull();
  return { id: data!.id as string, no };
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  clean();
  await dropPortalUser();
  tenant = (await admin.from('tenant').select('id').eq('name', 'KS Farms').single()).data!.id;
  expect((await admin.from('subscription').insert({ tenant_id: tenant, plan: 'pro', status: 'active', features: { modules: ALL_MODULES } })).error).toBeNull();
  hatchFarm = (await admin.from('farm').select('id').eq('tenant_id', tenant).eq('farm_type', 'hatchery').limit(1).single()).data!.id;
  const shed = (await admin.from('shed').insert({ tenant_id: tenant, farm_id: hatchFarm, name: 'E2E-GS-shed', shed_type: 'deep_litter', capacity_birds: 100000 }).select('id').single()).data!.id;
  batchId = (await admin.from('batch').insert({
    tenant_id: tenant, farm_id: hatchFarm, shed_id: shed, code: `E2E-GB-${uniq()}`, farm_type: 'hatchery', placed_on: new Date(Date.parse(REAL) - 21 * 864e5).toISOString().slice(0, 10), doc_count: 1100, full_hatch_flow: false,
  }).select('id').single()).data!.id;
  const product = (await admin.from('chick_product').insert({ tenant_id: tenant, name: 'E2E-G Broiler', category: 'broiler', price: 40 }).select('id').single()).data!.id;
  custA = (await admin.from('customer').insert({ tenant_id: tenant, name: 'E2E-G Alpha', kind: 'trader', credit_limit: 1000000, credit_days: 15, tier: 'gold', delivery_address: '12 Market Road, Guntur' }).select('id').single()).data!.id;
  custB = (await admin.from('customer').insert({ tenant_id: tenant, name: 'E2E-G Beta', kind: 'trader', credit_limit: 1000000, credit_days: 15, tier: 'standard' }).select('id').single()).data!.id;
  const [oa, ob] = [await order(custA, product, 120), await order(custB, product, 80)];
  proofOrder = await order(custA, product, 11);
  portalOrder = await order(custB, product, 12);
  sql(`update sales_order set payment_status = 'pending' where id = '${proofOrder.id}'; update sales_order set deposit_due = 500, payment_status = 'pending' where id = '${portalOrder.id}'`); // new orders without a deposit start as waived
  // an approved trip carrying both customers' approved allocations from the setting
  const [vehicle, trip, al1, al2] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  tripNo = `E2EG-T${uniq()}`;
  sql(`insert into vehicle (id, tenant_id, reg_no) values ('${vehicle}', ${KS}, 'AP21 E2EG 0001');
       insert into order_allocation (id, tenant_id, order_id, batch_id, qty, status) values
         ('${al1}', ${KS}, '${oa.id}', '${batchId}', 120, 'approved'), ('${al2}', ${KS}, '${ob.id}', '${batchId}', 80, 'approved');
       insert into dispatch (id, tenant_id, dispatch_no, vehicle_id, driver_name, planned_on, dispatched_at, status) values ('${trip}', ${KS}, '${tripNo}', '${vehicle}', 'E2E-G Driver', '${REAL}', now(), 'approved');
       insert into dispatch_line (tenant_id, dispatch_id, allocation_id, qty_loaded) values (${KS}, '${trip}', '${al1}', 120), (${KS}, '${trip}', '${al2}', 80)`);
  // a breeder flock with 200 kg of feed on hand and 120 kg/day of breeder feed logged: 1.7 days left, under the 3-day rule
  breederFarm = (await admin.from('farm').insert({ tenant_id: tenant, name: 'E2E-GF-farm', farm_type: 'breeder' }).select('id').single()).data!.id;
  const bshed = (await admin.from('shed').insert({ tenant_id: tenant, farm_id: breederFarm, name: 'E2E-GF-shed', shed_type: 'deep_litter', capacity_birds: 5000 }).select('id').single()).data!.id;
  flockCode = `E2E-GFL-${uniq()}`;
  const flock = await admin.from('batch').insert({
    tenant_id: tenant, farm_id: breederFarm, shed_id: bshed, code: flockCode, farm_type: 'breeder', placed_on: new Date(Date.parse(REAL) - 200 * 864e5).toISOString().slice(0, 10), doc_count: 1000, females_placed: 900, males_placed: 100,
  }).select('id').single();
  expect(flock.error).toBeNull();
  const store = (await admin.from('store').insert({ tenant_id: tenant, farm_id: breederFarm, name: 'E2E-G Feed store' }).select('id').single()).data!.id;
  const feed = (await admin.from('item').insert({ tenant_id: tenant, name: 'E2E-G Breeder feed', category: 'feed', unit: 'kg' }).select('id').single()).data!.id;
  sql(`insert into stock_movement (tenant_id, store_id, item_id, move_type, qty, moved_on) values (${KS}, '${store}', '${feed}', 'grn', 200, '${REAL}')`);
  const daily = await admin.from('breeder_daily').insert({ tenant_id: tenant, batch_id: flock.data!.id, log_date: REAL, feed_f_kg: 100, feed_m_kg: 20 });
  expect(daily.error).toBeNull();
});
test.afterAll(async () => { await dropProofFiles(); clean(); await dropPortalUser(); });

async function open(page: Page, btn: Locator) {
  const dlg = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dlg.isVisible())) await btn.click();
    await expect(dlg).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  return dlg;
}
async function send(dlg: Locator, button = 'Save') {
  await dlg.getByRole('button', { name: button, exact: true }).click();
  try { await expect(dlg).toBeHidden({ timeout: 20_000 }); } catch { throw new Error('form stayed open: ' + (await dlg.innerText())); }
}
async function as(page: Page, role: string, fn: () => Promise<void>) {
  const restore = await setRole(PHONES.ksOwner, role);
  try { await login(page, PHONES.ksOwner); await fn(); } finally { await restore(); }
}
const stub = (page: Page) => page.addInitScript(() => { window.print = () => {}; }); // the print pages open the print dialog on load

test('GAP-01: an alert goes open -> acknowledged -> actioned -> resolved; a note is required; escalations show', async ({ page }) => {
  test.setTimeout(240_000);
  const k = uniq();
  const [t1, t2, t3] = [`E2E-G alert one ${k}`, `E2E-G alert two ${k}`, `Not acknowledged: E2E-G alert old ${k}`];
  const ins = await admin.from('notification').insert([
    { tenant_id: tenant, kind: 'alert', severity: 'warning', title: t1, dedupe_key: `e2eg:1:${k}` },
    { tenant_id: tenant, kind: 'alert', severity: 'warning', title: t2, dedupe_key: `e2eg:2:${k}` },
    { tenant_id: tenant, kind: 'alert', severity: 'critical', title: t3, entity_type: 'escalation', dedupe_key: `e2eg:3:${k}` },
  ]);
  expect(ins.error).toBeNull();
  await admin.from('notification').update({ escalated_at: new Date().toISOString() }).eq('dedupe_key', `e2eg:2:${k}`);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/notifications');
  const row = (title: string) => page.getByTestId('notif-row').filter({ hasText: title });
  const state = (title: string) => row(title).getByTestId('alert-state');

  // one: step by step
  await expect(state(t1)).toHaveText('Open');
  await row(t1).getByRole('button', { name: 'Acknowledge' }).click(); // one tap, no form
  await expect(state(t1)).toHaveText('Acknowledged', { timeout: 20_000 });
  await expect(page.locator('.toast')).toContainText('Saved.');
  let dlg = await open(page, row(t1).getByRole('button', { name: 'Record action' }));
  await dlg.getByRole('button', { name: 'Record action', exact: true }).click(); // blank note: refused, form stays
  await expect(dlg.locator('[role=alert]')).toBeVisible({ timeout: 10_000 });
  await dlg.getByLabel('Action taken').fill('Called the electrician');
  await send(dlg, 'Record action');
  await expect(state(t1)).toHaveText('Actioned', { timeout: 20_000 });
  await expect(row(t1).getByTestId('alert-note')).toContainText('Called the electrician');
  dlg = await open(page, row(t1).getByRole('button', { name: 'Resolve' }));
  await send(dlg, 'Resolve'); // the note is optional once an action is recorded
  await expect(state(t1)).toHaveText('Resolved', { timeout: 20_000 });
  await expect(row(t1).getByTestId('alert-resolved')).toBeVisible();
  await expect(row(t1).getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  expect((await admin.from('notification').select('acknowledged_at,actioned_at,resolved_at,resolved_by').eq('dedupe_key', `e2eg:1:${k}`).single()).data).toMatchObject({ acknowledged_at: expect.any(String), actioned_at: expect.any(String), resolved_at: expect.any(String) });

  // two (escalated): resolving straight away needs a note
  await expect(row(t2).getByTestId('alert-escalated')).toHaveText('Escalated');
  dlg = await open(page, row(t2).getByRole('button', { name: 'Resolve' }));
  await dlg.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(dlg.locator('[role=alert]')).toBeVisible({ timeout: 10_000 });
  await dlg.getByLabel('Action taken').fill('False alarm');
  await send(dlg, 'Resolve');
  await expect(state(t2)).toHaveText('Resolved', { timeout: 20_000 });

  // the escalation alert itself is just displayed (and can be worked like any alert)
  await expect(row(t3)).toBeVisible();
  await expect(state(t3)).toHaveText('Open');
});

test('GAP-02: the sales officer records a payment with a proof image; finance opens the proof', async ({ page }) => {
  test.setTimeout(240_000);
  await as(page, 'sales_officer', async () => {
    await page.goto(`/more/sales?order=${proofOrder.no}`);
    const detail = page.getByTestId('order-detail');
    const dlg = await open(page, detail.getByRole('button', { name: 'Record payment' }));
    await dlg.getByLabel('UTR / reference').fill('UTR-E2EG-1');
    await dlg.getByLabel(/Payment proof/).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a proof') });
    await dlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dlg).toContainText('JPG, PNG, WebP or PDF', { timeout: 20_000 }); // wrong type is refused before anything is saved
    await dlg.getByLabel(/Payment proof/).setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG });
    await send(dlg);
    await expect(page.locator('.toast')).toContainText('Payment recorded', { timeout: 20_000 });
    await expect(detail.getByTestId('order-pay')).toHaveText('Payment submitted', { timeout: 20_000 });
    await expect(detail.getByTestId('pay-proof')).toBeVisible();
  });
  const o = (await admin.from('sales_order').select('payment_ref,payment_status,payment_proof_path').eq('id', proofOrder.id).single()).data!;
  expect(o).toMatchObject({ payment_ref: 'UTR-E2EG-1', payment_status: 'submitted' });
  expect(o.payment_proof_path).toMatch(new RegExp(`^${tenant}/payment/${proofOrder.id}/[0-9a-f-]{36}\\.png$`));

  await as(page, 'finance', async () => {
    await page.goto(`/more/sales?order=${proofOrder.no}`);
    const proof = page.getByTestId('order-detail').getByTestId('pay-proof');
    const link = proof.getByRole('link', { name: 'View proof' });
    await expect(link).toBeVisible();
    await expect(proof.locator('img')).toBeVisible();
    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  });
});

test('GAP-03: a portal customer sends a payment reference with a proof file', async ({ page }) => {
  test.setTimeout(240_000);
  const u = await admin.auth.admin.createUser({ phone: '+91' + PORTAL_PHONE, phone_confirm: true });
  expect(u.error).toBeNull();
  expect((await admin.from('customer_portal_user').insert({ user_id: u.data.user!.id, tenant_id: tenant, customer_id: custB })).error).toBeNull();
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/login', PORTAL_PHONE);
  await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });
  const mine = page.getByTestId('portal-order').filter({ hasText: portalOrder.no });
  const form = mine.getByTestId('pay-form');
  await expect(form).toBeVisible({ timeout: 20_000 });
  await form.getByRole('textbox').fill('UTR-PORTAL-G');
  await form.locator('input[type=file]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await form.getByRole('button', { name: 'Send payment reference' }).click();
  await expect(page.locator('.toast')).toContainText('The hatchery will verify', { timeout: 30_000 });
  await page.reload();
  await expect(mine.getByTestId('portal-pay')).toHaveText('Payment submitted');
  const o = (await admin.from('sales_order').select('payment_ref,payment_status,payment_proof_path').eq('id', portalOrder.id).single()).data!;
  expect(o).toMatchObject({ payment_ref: 'UTR-PORTAL-G', payment_status: 'submitted' });
  expect(o.payment_proof_path).toMatch(new RegExp(`^${tenant}/payment/${portalOrder.id}/[0-9a-f-]{36}\\.png$`));
  expect((await admin.storage.from('evidence').createSignedUrl(o.payment_proof_path!, 60)).data?.signedUrl).toBeTruthy(); // the file really is in the bucket
});

test('GAP-04: an approved requisition becomes a purchase order and shows its PO number', async ({ page }) => {
  test.setTimeout(240_000);
  const farm = (await admin.from('farm').select('id').eq('tenant_id', tenant).order('created_at').limit(1).single()).data!.id;
  const item = (await admin.from('item').select('id').eq('name', 'E2E-G Breeder feed').single()).data!.id;
  const vendor = (await admin.from('vendor').select('id,name').eq('tenant_id', tenant).limit(1).single()).data!;
  sql(`insert into purchase_requisition (tenant_id, farm_id, item_id, qty, needed_by, est_rate, purpose, status) values (${KS}, '${farm}', '${item}', 25, '${REAL}', 12, 'E2E-G requisition', 'approved')`);
  await as(page, 'procurement_officer', async () => {
    await page.goto('/more/procurement');
    const req = page.getByTestId('req-row').filter({ hasText: 'E2E-G Breeder feed' });
    const dlg = await open(page, req.getByRole('button', { name: 'Raise PO' }));
    await expect(dlg.getByLabel('Rate per unit')).toHaveValue('12'); // default: the estimated rate
    await dlg.getByLabel('Vendor').selectOption({ label: vendor.name });
    await dlg.getByLabel('Rate per unit').fill('0');
    await dlg.getByRole('button', { name: 'Raise PO', exact: true }).click();
    await expect(dlg.locator('[role=alert]')).toBeVisible({ timeout: 10_000 }); // a zero rate is refused in the form
    await dlg.getByLabel('Rate per unit').fill('13.5');
    await send(dlg, 'Raise PO');
    await expect(page.locator('.toast')).toContainText(/Purchase order PO-[0-9]+ raised/, { timeout: 20_000 });
    await expect(req.getByTestId('doc-status')).toHaveText('Ordered', { timeout: 20_000 });
    const po = await req.getByTestId('req-po').innerText();
    const no = po.replace('PO ', '');
    expect(no).toMatch(/^PO-\d+$/);
    await expect(req.getByRole('button', { name: 'Raise PO' })).toHaveCount(0);
    await page.goto('/more/procurement?tab=orders');
    await expect(page.getByTestId('po-row').filter({ hasText: no })).toContainText(vendor.name);
  });
});

test('GAP-05: delivery note, dispatch list and allocation list print pages show the right rows', async ({ page }) => {
  test.setTimeout(240_000);
  await stub(page);
  await login(page, PHONES.ksOwner);
  await page.goto(`/more/dispatch?trip=${tripNo}`);
  const links = page.getByTestId('print-links');
  await expect(links.getByTestId('note-link')).toHaveCount(2); // one note per customer on the trip
  await links.getByTestId('note-link').filter({ hasText: 'E2E-G Alpha' }).click();
  const note = page.getByTestId('doc-delivery-note');
  await expect(note).toContainText('Delivery note');
  await expect(note.getByTestId('doc-head')).toContainText(tripNo);
  await expect(note.getByTestId('doc-head')).toContainText('AP21 E2EG 0001');
  await expect(note.getByTestId('doc-head')).toContainText('E2E-G Driver');
  await expect(note.getByTestId('doc-head')).toContainText('E2E-G Alpha');
  await expect(note.getByTestId('doc-head')).toContainText('12 Market Road, Guntur');
  await expect(note.getByTestId('doc-row')).toHaveCount(1);
  await expect(note.getByTestId('doc-row')).toContainText('E2E-G Broiler');
  await expect(note.getByTestId('doc-total')).toHaveText('120');
  await expect(note).not.toContainText('E2E-G Beta');
  await expect(note).toContainText('Receiver signature');
  expect(await note.getByTestId('doc-head').innerText()).not.toMatch(/Dispatched at\s*–/);

  await page.goto(`/print/dispatch-list?batch=${batchId}`);
  const list = page.getByTestId('doc-dispatch-list');
  await expect(list.getByTestId('doc-row')).toHaveCount(2);
  await expect(list).toContainText('E2E-G Alpha'); await expect(list).toContainText('E2E-G Beta');
  await expect(list).toContainText(tripNo);
  await expect(list.getByTestId('doc-total')).toHaveText('200');

  await page.goto(`/print/allocation-list?batch=${batchId}`);
  const alloc = page.getByTestId('doc-allocation-list');
  await expect(alloc.getByTestId('doc-row')).toHaveCount(2);
  await expect(alloc.getByTestId('doc-row').filter({ hasText: 'E2E-G Alpha' })).toContainText('Gold');
  await expect(alloc.getByTestId('doc-row').filter({ hasText: 'E2E-G Beta' })).toContainText('Standard');
  await expect(alloc.getByTestId('doc-row').filter({ hasText: 'E2E-G Alpha' })).toContainText('Approved');
  await expect(alloc.getByTestId('doc-total')).toHaveText('200');

  // roles that cannot see Dispatch do not get the page
  await as(page, 'finance', async () => {
    expect((await page.goto(`/print/allocation-list?batch=${batchId}`))?.status()).toBe(404);
  });
});

test('GAP-06: the breeder flock page shows feed days left with a warning, and the DB alert is in Notifications', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);
  await page.goto(`/farm/batch/${flockCode}`);
  const line = page.getByTestId('feed-days');
  await expect(line).toContainText('Feed: 1.7 days left (200 kg on hand, 120 kg/day)', { timeout: 30_000 });
  await expect(line.getByTestId('feed-low')).toBeVisible();
  await page.goto('/more/notifications');
  await expect(page.getByTestId('notif-row').filter({ hasText: 'Feed running low' }).first()).toContainText('days of feed left');
});
