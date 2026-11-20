import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { admin, PHONES, FORBIDDEN, login, otp, setRole, tamper, uniq } from './helpers';

// ERP chick sales + dispatch (0043–0050) through the real screens, one role at a time (the KS owner's login is re-roled for each step):
// product -> customer tier -> setting product -> book (reserved / waiting list) -> availability -> finance verifies -> sales confirms ->
// sales allocates -> hatchery manager approves -> dispatch loads -> ops manager confirms (invoices) -> owner records delivery + POD ->
// DOA claim + approval -> trip completed -> trace; then role refusals, plan modules and the customer portal.
// Dates use the real clock (the DB checks the real clock; APP_TODAY only pins demo screens).
test.describe.configure({ mode: 'serial' });
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const KS = `(select id from tenant where name = 'KS Farms')`;
const PORTAL_PHONE = '9999000002';
const POD = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let tenant: string, hatchFarm: string, hatchShed: string, settingCode: string, settingId: string, productId: string, custA: string, custB: string;
const vals: { noA?: string; noB?: string; trip?: string; inv?: string } = {};

function sql(q: string) {
  execFileSync('docker', ['exec', 'supabase_db_poultryos', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `set session_replication_role = replica; ${q}`], { stdio: 'pipe' });
}
/** Locked rows cannot be deleted through the API, so cleanup goes around the triggers in SQL (replica role: no FK cascade, so children go first). */
function clean() {
  const lines = `select id from dispatch_line where dispatch_id in (select id from dispatch where tenant_id = ${KS} and driver_name like 'E2E-S%')`;
  const batch = `select id from batch where tenant_id = ${KS} and code like 'E2E-SS%'`;
  sql(`delete from doa_claim where dispatch_line_id in (${lines});
       delete from invoice where dispatch_line_id in (${lines});
       delete from invoice where customer_id in (select id from customer where name like 'E2E-S%');
       delete from dispatch_line where id in (${lines});
       delete from dispatch where tenant_id = ${KS} and driver_name like 'E2E-S%';
       delete from vehicle where tenant_id = ${KS} and reg_no like '%E2ES%';
       delete from order_allocation where batch_id in (${batch});
       delete from sales_order where customer_id in (select id from customer where name like 'E2E-S%');
       delete from customer_portal_user where customer_id in (select id from customer where name like 'E2E-S%');
       delete from customer where name like 'E2E-S%';
       delete from chick_vaccination where batch_id in (${batch}); delete from chick_quality_inspection where batch_id in (${batch});
       delete from hatch_record where batch_id in (${batch}); delete from batch_state_history where batch_id in (${batch});
       delete from vaccination_schedule where batch_id in (${batch});
       delete from batch where code like 'E2E-SS%';
       delete from chick_product where name like 'E2E-S%';
       delete from shed where name like 'E2E-SS%';
       delete from subscription where tenant_id = ${KS};
       delete from notification where tenant_id = ${KS} and (title like '%E2E-S%' or title like 'Space freed%' or title like 'Payment proof%')`);
}
async function dropPortalUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone === '91' + PORTAL_PHONE || u.phone === '+91' + PORTAL_PHONE) await admin.auth.admin.deleteUser(u.id);
}

test.beforeAll(async () => {
  clean();
  await dropPortalUser();
  tenant = (await admin.from('tenant').select('id').eq('name', 'KS Farms').single()).data!.id;
  hatchFarm = (await admin.from('farm').select('id').eq('tenant_id', tenant).eq('farm_type', 'hatchery').limit(1).single()).data!.id;
  hatchShed = (await admin.from('shed').insert({ tenant_id: tenant, farm_id: hatchFarm, name: 'E2E-SS-shed', shed_type: 'deep_litter', capacity_birds: 100000 }).select('id').single()).data!.id;
  settingCode = `E2E-SS-${uniq()}`;
  // a setting hatched today (1,000 saleable) with approved quality and one vaccine lot — the legacy flow needs no candling history
  const { data: b } = await admin.from('batch').insert({
    tenant_id: tenant, farm_id: hatchFarm, shed_id: hatchShed, code: settingCode, farm_type: 'hatchery', placed_on: new Date(Date.parse(TODAY) - 21 * 864e5).toISOString().slice(0, 10),
    doc_count: 1100, full_hatch_flow: false,
  }).select('id').single();
  settingId = b!.id;
  const vacc = (await admin.from('vaccine_master').select('id').order('name').limit(1).single()).data!.id;
  await admin.from('hatch_record').insert({ tenant_id: tenant, batch_id: settingId, hatched_on: TODAY, chicks_a: 900, chicks_b: 100, culls: 0 });
  await admin.from('hatch_record').update({ status: 'approved' }).eq('batch_id', settingId);
  await admin.from('chick_quality_inspection').insert({ tenant_id: tenant, batch_id: settingId, inspected_on: TODAY, sample_size: 100, dispatch_eligible: true });
  await admin.from('chick_quality_inspection').update({ status: 'approved' }).eq('batch_id', settingId);
  await admin.from('chick_vaccination').insert({ tenant_id: tenant, batch_id: settingId, vaccine_id: vacc, vaccine_lot: 'E2E-MD-1', expiry: new Date(Date.parse(TODAY) + 90 * 864e5).toISOString().slice(0, 10), qty: 1000 });
  const c = await admin.from('customer').insert({ tenant_id: tenant, name: 'E2E-S Credit', kind: 'trader', credit_limit: 1000000, credit_days: 15, tier: 'standard' }).select('id').single();
  custB = c.data!.id;
});
test.afterAll(async () => { clean(); await dropPortalUser(); });

async function open(page: Page, btn: Locator, name: string | RegExp) {
  const dlg = page.getByRole('dialog', { name });
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
const fill = (dlg: Locator, label: string | RegExp, v: string | number) => dlg.getByLabel(label, { exact: typeof label === 'string' }).fill(String(v));
/** Run `fn` signed in as the KS login holding exactly this role (roles ride in the JWT, so sign in again). */
async function as(page: Page, role: string, fn: () => Promise<void>) {
  const restore = await setRole(PHONES.ksOwner, role);
  try { await login(page, PHONES.ksOwner); await fn(); } finally { await restore(); }
}
const toast = (page: Page) => page.locator('.toast');
const orderNo = async (customer: string, qty: number) =>
  (await admin.from('sales_order').select('order_no').eq('customer_id', customer).eq('qty', qty).single()).data!.order_no as string;
const orderRow = (page: Page, no: string) => page.getByTestId('order-row').filter({ hasText: no });
const detail = (page: Page) => page.getByTestId('order-detail');

test('SAL-01: owner sets up the product, customer tier and setting, then books a reserved and a waiting-list order', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);

  // ---- product master
  await page.goto('/more/sales?tab=products');
  let dlg = await open(page, page.getByRole('button', { name: '+ Product' }), 'Add chick product');
  await fill(dlg, 'Product name', 'E2E-S Broiler'); await fill(dlg, /^List price/, 40);
  await send(dlg);
  await expect(page.getByTestId('product-row').filter({ hasText: 'E2E-S Broiler' })).toContainText('₹40', { timeout: 20_000 });
  productId = (await admin.from('chick_product').select('id').eq('name', 'E2E-S Broiler').single()).data!.id;

  // ---- the hatched setting sells as that product (owner / manager only)
  const row = page.getByTestId('setting-row').filter({ hasText: settingCode });
  dlg = await open(page, row.getByRole('button', { name: 'Set product' }), /^Chick product ·/);
  await dlg.getByLabel('Product').selectOption({ label: 'E2E-S Broiler' });
  await send(dlg);
  await expect(row).toContainText('E2E-S Broiler', { timeout: 20_000 });

  // ---- customer with a tier
  await page.goto('/more/sales?tab=customers');
  dlg = await open(page, page.getByRole('button', { name: '+ Customer' }), 'Add customer');
  await fill(dlg, 'Name', 'E2E-S Platinum'); await dlg.getByLabel('Customer tier').selectOption('gold');
  await send(dlg);
  const cust = page.getByTestId('customer-row').filter({ hasText: 'E2E-S Platinum' });
  await expect(cust.getByTestId('tier')).toHaveText('Gold', { timeout: 20_000 });
  dlg = await open(page, cust.getByRole('button', { name: 'Tier' }), /^Tier ·/);
  await dlg.getByLabel('Customer tier').selectOption('platinum');
  await send(dlg);
  await expect(cust.getByTestId('tier')).toHaveText('Platinum', { timeout: 20_000 });
  custA = (await admin.from('customer').select('id').eq('name', 'E2E-S Platinum').single()).data!.id;

  // ---- book: 600 of the 1,000 chicks -> reserved, 50 % deposit
  await page.goto('/more/sales');
  dlg = await open(page, page.getByRole('button', { name: '+ New order' }), 'New order');
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-S Platinum' });
  await dlg.getByLabel('Product').selectOption({ label: 'E2E-S Broiler · ₹40' });
  await fill(dlg, /^Quantity/, 600); await fill(dlg, /^Hatch/, TODAY);
  await dlg.getByRole('button', { name: 'Book order', exact: true }).click();
  await expect(toast(page)).toContainText(/Order SO\d+ reserved\. Held until/, { timeout: 20_000 });
  vals.noA = await orderNo(custA, 600);
  await expect(orderRow(page, vals.noA)).toContainText('Reserved', { timeout: 20_000 });
  await expect(orderRow(page, vals.noA)).toContainText('Payment pending');

  // ---- 500 more the same week do not fit -> waiting list (the toast says so; no later week has supply)
  dlg = await open(page, page.getByRole('button', { name: '+ New order' }), 'New order');
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-S Credit' });
  await dlg.getByLabel('Product').selectOption({ label: 'E2E-S Broiler · ₹40' });
  await fill(dlg, /^Quantity/, 500); await fill(dlg, /^Hatch/, TODAY);
  await dlg.getByRole('button', { name: 'Book order', exact: true }).click();
  await expect(toast(page)).toContainText(/Order SO\d+ is on the waiting list/, { timeout: 20_000 });
  vals.noB = await orderNo(custB, 500);
  await expect(orderRow(page, vals.noB)).toContainText('Waiting list', { timeout: 20_000 });

  // ---- filters
  await page.getByRole('link', { name: 'Waiting list', exact: true }).click();
  await expect(orderRow(page, vals.noB)).toBeVisible();
  await expect(orderRow(page, vals.noA)).toHaveCount(0);
  await page.goto('/more/sales?pay=pending');
  await expect(orderRow(page, vals.noA)).toBeVisible();
  await page.goto(`/more/sales?order=${vals.noB}`);
  await expect(detail(page)).toContainText('Waiting list');
  await expect(detail(page).getByRole('button', { name: 'Move in (space free)' })).toBeVisible();

  // ---- availability: 1,000 expected, 600 held -> 400 left this week
  await page.goto('/more/sales?tab=availability');
  const first = page.getByTestId('avail-E2E-S Broiler').locator('tbody tr').first();
  await expect(first).toContainText('1,000');
  await expect(first.getByTestId('avail-n')).toHaveText('400');
  await expect(page.getByTestId('avail-E2E-S Broiler').locator('tbody tr')).toHaveCount(12);
});

test('SAL-02: finance verifies the deposit, sales confirms and proposes the allocation (DB limits shown as written)', async ({ page }) => {
  test.setTimeout(240_000);
  await as(page, 'finance', async () => {
    await page.goto(`/more/sales?order=${vals.noA}`);
    await expect(detail(page).getByRole('button', { name: 'Confirm order' })).toHaveCount(0); // finance verifies, sales confirms
    const dlg = await open(page, detail(page).getByRole('button', { name: 'Verify payment' }), /^Verify payment/);
    await expect(dlg.getByLabel(/^Deposit received/)).toHaveValue('12000');
    await fill(dlg, /^Payment reference/, 'UTR-E2E-1');
    await send(dlg);
    await expect(orderRow(page, vals.noA!).getByTestId('order-pay')).toHaveText('Payment verified', { timeout: 20_000 });
    await expect(detail(page).getByTestId('deposit')).toContainText('₹12,000 paid of ₹12,000');
  });

  await as(page, 'sales_officer', async () => {
    await page.goto(`/more/sales?order=${vals.noA}`);
    await expect(detail(page).getByRole('button', { name: 'Verify payment' })).toHaveCount(0);
    await expect(detail(page).getByRole('button', { name: 'Change price' })).toHaveCount(0); // owner only
    const dlg = await open(page, detail(page).getByRole('button', { name: 'Confirm order' }), /^Confirm order ·/);
    await dlg.getByRole('button', { name: 'Confirm order', exact: true }).click();
    await expect(dlg).toBeHidden({ timeout: 20_000 });
    await expect(orderRow(page, vals.noA!).getByTestId('order-status')).toHaveText('Confirmed', { timeout: 20_000 });
    await expect(detail(page)).toContainText('price locked');

    // ---- allocation queue: over-allocation is refused with the DB's own words, then 600 goes through
    await page.goto('/more/sales?tab=allocation');
    const ord = page.getByTestId('alloc-order').filter({ hasText: vals.noA! });
    await expect(page.getByTestId('alloc-stock').getByTestId('stock-code').filter({ hasText: settingCode })).toBeVisible();
    const d2 = await open(page, ord.getByRole('button', { name: 'Allocate from setting' }), /^Allocate chicks/);
    await fill(d2, /^Quantity/, 1001);
    await d2.getByRole('button', { name: 'Propose allocation', exact: true }).click();
    await expect(d2.getByRole('alert')).toContainText('over-allocation blocked', { timeout: 20_000 });
    await fill(d2, /^Quantity/, 600);
    await send(d2, 'Propose allocation');
    await expect(ord.getByTestId('alloc-status')).toHaveText('Awaiting approval', { timeout: 20_000 });
    await expect(ord).toContainText('600 of 600 allocated');
    // sales cannot approve (no button, and the server refuses a tampered call)
    await expect(ord.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const al = (await admin.from('order_allocation').select('id').eq('batch_id', settingId).single()).data!.id;
    expect(await tamper(page, 'decideAlloc', { id: al, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
    expect(await tamper(page, 'verifyPayment', { order_id: (await admin.from('sales_order').select('id').eq('order_no', vals.noB!).single()).data!.id, result: 'verified', deposit_paid: 100 }))
      .toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
});

test('SAL-03: hatchery manager approves, dispatch loads the trip, ops manager confirms it and the invoice appears', async ({ page }) => {
  test.setTimeout(300_000);
  await as(page, 'hatchery_manager', async () => {
    await page.goto('/more/sales?tab=allocation');
    const ord = page.getByTestId('alloc-order').filter({ hasText: vals.noA! });
    await ord.getByRole('button', { name: 'Approve' }).click();
    await expect(ord.getByTestId('alloc-status')).toHaveText('Approved', { timeout: 20_000 });
    await page.goto('/more/sales');
    await expect(orderRow(page, vals.noA!).getByTestId('order-status')).toHaveText('Allocated', { timeout: 20_000 });
  });

  await as(page, 'dispatch_officer', async () => {
    await page.goto('/more/dispatch?tab=vehicles');
    let dlg = await open(page, page.getByRole('button', { name: '+ Vehicle' }), 'Add vehicle');
    await fill(dlg, 'Registration no.', 'AP21 E2ES 0001'); await fill(dlg, /^Capacity/, 80); await dlg.getByLabel('Temperature controlled').selectOption('yes');
    await send(dlg);
    await expect(page.getByTestId('vehicle-row').filter({ hasText: 'AP21 E2ES 0001' })).toContainText('Cold chain', { timeout: 20_000 });

    await page.goto('/more/dispatch');
    dlg = await open(page, page.getByRole('button', { name: '+ New trip' }), 'New trip');
    await dlg.getByLabel('Vehicle').selectOption({ label: 'AP21 E2ES 0001' });
    await fill(dlg, 'Driver', 'E2E-S Suresh'); await fill(dlg, 'Route', 'Nandyal - Kurnool');
    await send(dlg);
    await expect(page.getByTestId('trip-row').filter({ hasText: 'E2E-S Suresh' })).toHaveCount(1, { timeout: 20_000 });
    vals.trip = (await admin.from('dispatch').select('dispatch_no').eq('driver_name', 'E2E-S Suresh').single()).data!.dispatch_no;
    await page.goto(`/more/dispatch?trip=${vals.trip}`);
    const trip = page.getByTestId('trip-detail');
    await expect(trip.getByRole('button', { name: 'Submit trip' })).toHaveCount(0); // nothing loaded yet
    dlg = await open(page, trip.getByRole('button', { name: 'Add load' }), 'Add load');
    await expect(dlg.getByLabel(/^Chicks loaded/)).toHaveValue('600');
    await send(dlg);
    await expect(trip.getByTestId('line-order')).toContainText(vals.noA!, { timeout: 20_000 });
    await trip.getByRole('button', { name: 'Submit trip' }).click();
    await expect(page.getByTestId('trip-row').filter({ hasText: vals.trip! }).getByTestId('trip-status')).toContainText('Loaded', { timeout: 20_000 });
    await expect(trip.getByRole('button', { name: 'Approve' })).toHaveCount(0); // confirmation belongs to the ops manager
    const id = (await admin.from('dispatch').select('id').eq('dispatch_no', vals.trip!).single()).data!.id;
    expect(await tamper(page, 'decideTrip', { id, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });

  await as(page, 'hatchery_ops_manager', async () => {
    await page.goto(`/more/dispatch?trip=${vals.trip}`);
    const trip = page.getByTestId('trip-detail');
    await trip.getByRole('button', { name: 'Approve' }).click();
    await expect(toast(page)).toContainText('invoices created', { timeout: 20_000 });
    await expect(page.getByTestId('trip-row').filter({ hasText: vals.trip! }).getByTestId('trip-status')).toHaveText('On the road', { timeout: 20_000 });
    await expect(page.getByTestId('trip-invoices')).toContainText('₹24,000');
    vals.inv = (await page.getByTestId('trip-invoices').innerText()).match(/INV\d+/)![0];
  });

  // ---- the invoice shows up for finance in Money
  await as(page, 'finance', async () => {
    await page.goto('/money');
    await expect(page.getByText(vals.inv!).first()).toBeVisible({ timeout: 20_000 });
  });
});

test('SAL-04: delivery with a POD photo, DOA claim and approval, completion and the one-click trace', async ({ page }) => {
  test.setTimeout(300_000);
  // the evidence bucket (0027) lets the owner write, not the dispatch roles: the owner records the delivery with the photo
  await login(page, PHONES.ksOwner);
  await page.goto(`/more/dispatch?trip=${vals.trip}`);
  const trip = page.getByTestId('trip-detail');
  const dlg = await open(page, trip.getByRole('button', { name: 'Record delivery' }), /^Record delivery/);
  await fill(dlg, 'Received by', 'Ramesh');
  await fill(dlg, /^Delivered/, 595); await fill(dlg, 'Short', 5); await fill(dlg, 'Dead on arrival', 5);
  await dlg.getByLabel(/^Proof of delivery photo/).setInputFiles({ name: 'pod.png', mimeType: 'image/png', buffer: POD });
  await send(dlg, 'Record delivery');
  await expect(trip.getByTestId('receiver')).toHaveText('Ramesh', { timeout: 20_000 });
  await expect(trip.getByTestId('pod')).toContainText('View photo');
  const pod = (await admin.from('dispatch').select('pod_path').eq('dispatch_no', vals.trip!).single()).data!.pod_path as string;
  expect(pod).toMatch(new RegExp(`^${tenant}/`));
  await admin.storage.from('evidence').remove([pod]);

  // ---- sales raises the DOA claim; the hatchery manager approves it with a resolution
  await as(page, 'sales_officer', async () => {
    await page.goto(`/more/dispatch?trip=${vals.trip}`);
    const t2 = page.getByTestId('trip-detail');
    const d = await open(page, t2.getByRole('button', { name: 'Claim DOA' }), /^DOA claim/);
    await expect(d.getByLabel(/^Chicks claimed/)).toHaveValue('595'); // everything delivered is claimable at most
    await fill(d, /^Chicks claimed/, 5);
    await send(d, 'Submit claim');
    await expect(t2.getByTestId('claim-row')).toContainText('5 dead on arrival', { timeout: 20_000 });
    await expect(t2.getByTestId('claim-row').getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
  await as(page, 'hatchery_manager', async () => {
    await page.goto(`/more/dispatch?trip=${vals.trip}`);
    const claim = page.getByTestId('claim-row');
    const d = await open(page, claim.getByRole('button', { name: 'Approve' }), 'Approve claim');
    await d.getByLabel('Resolution').selectOption('credit_note');
    await send(d, 'Approve');
    await expect(claim).toContainText('Credit note', { timeout: 20_000 });
    await expect(claim.getByTestId('claim-status')).toHaveText('Claim approved');
  });

  // ---- completion, order status, trace
  await as(page, 'dispatch_officer', async () => {
    await page.goto(`/more/dispatch?trip=${vals.trip}`);
    await page.getByTestId('trip-detail').getByRole('button', { name: 'Complete trip' }).click();
    await expect(page.getByTestId('trip-row').filter({ hasText: vals.trip! }).getByTestId('trip-status')).toHaveText('Completed', { timeout: 20_000 });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/sales');
  await expect(orderRow(page, vals.noA!).getByTestId('order-status')).toHaveText('Completed', { timeout: 20_000 });
  await page.goto(`/more/dispatch?trip=${vals.trip}`);
  await page.getByTestId('trace-btn').click();
  const trace = page.getByTestId('trace');
  await expect(trace.getByTestId('trace-setting')).toContainText(settingCode, { timeout: 20_000 });
  await expect(trace.getByTestId('trace-vaccines')).toContainText('E2E-MD-1');
  await expect(trace).toContainText('E2E-S Platinum');
});

test('SAL-05: the owner changes a price (with a reason) and cancels an order (with a reason)', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PHONES.ksOwner);
  await page.goto(`/more/sales?order=${vals.noB}`);
  await expect(detail(page).getByRole('button', { name: 'Waive deposit' })).toHaveCount(0); // only a reserved order has a deposit to waive here
  const pr = await open(page, detail(page).getByRole('button', { name: 'Change price' }), /^Change price ·/);
  await fill(pr, /^New price/, 45);
  await pr.getByRole('button', { name: 'Save', exact: true }).click(); // a reason is required: the form refuses
  await expect(pr).toBeVisible();
  await pr.getByLabel('Reason').fill('volume agreed by phone');
  await send(pr);
  await expect(detail(page)).toContainText('₹45', { timeout: 20_000 });
  const dlg = await open(page, detail(page).getByRole('button', { name: 'Cancel order' }), /^Cancel order ·/);
  await dlg.getByRole('button', { name: 'Cancel order', exact: true }).click(); // reason is required: the form refuses, nothing changes
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Reason').fill('customer postponed');
  await send(dlg, 'Cancel order');
  await expect(orderRow(page, vals.noB!).getByTestId('order-status')).toHaveText('Cancelled', { timeout: 20_000 });
  await expect(detail(page)).toContainText('customer postponed');
  await page.getByRole('link', { name: 'Cancelled', exact: true }).click();
  await expect(orderRow(page, vals.noB!)).toBeVisible();
});

test('SAL-06: the Sales and Dispatch screens disappear when the plan has no such module', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Chick sales/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dispatch/ })).toBeVisible();
  expect((await admin.from('subscription').insert({ tenant_id: tenant, plan: 'pro', status: 'active', features: { modules: ['core', 'breeder', 'hatchery'] } })).error).toBeNull();
  try {
    await page.goto('/more');
    await expect(page.getByRole('link', { name: /Chick sales/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Dispatch/ })).toHaveCount(0);
    await page.goto('/more/sales');
    await expect(page.getByText('could not be found')).toBeVisible();
    await page.goto('/more');
    // and the database refuses the write behind the screen
    expect(await tamper(page, 'addProduct', { name: 'E2E-S Blocked', category: 'broiler' })).toMatchObject({ ok: false });
  } finally {
    await admin.from('subscription').delete().eq('tenant_id', tenant);
  }
  expect((await admin.from('chick_product').select('id').eq('name', 'E2E-S Blocked')).data).toHaveLength(0);
});

test('SAL-07: a linked customer sees only their orders, invoices and availability, and sends a payment reference', async ({ page }) => {
  test.setTimeout(240_000);
  // a customer order with a deposit due (the waiting-list order was cancelled above, so book a fresh small-deposit one for this customer)
  const { error } = await admin.from('sales_order').insert({ tenant_id: tenant, order_no: `SO-E2E-${uniq()}`, customer_id: custB, product_id: productId, qty: 501, hatch_date: TODAY, price: 40 }); // 501 > the 400 left this week: waiting list, with a 50 % deposit pending
  expect(error).toBeNull();
  const u = await admin.auth.admin.createUser({ phone: '+91' + PORTAL_PHONE, phone_confirm: true });
  expect(u.error).toBeNull();

  // ---- a login that is not linked to a customer
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/login', PORTAL_PHONE);
  await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });
  await expect(page.getByTestId('not-customer')).toBeVisible();

  // ---- linked: sees its own customer's rows only
  expect((await admin.from('customer_portal_user').insert({ user_id: u.data.user!.id, tenant_id: tenant, customer_id: custB })).error).toBeNull();
  await page.goto('/portal');
  await expect(page.getByTestId('portal-orders')).toBeVisible();
  const mine = page.getByTestId('portal-order');
  await expect(mine).toHaveCount(2); // the cancelled order and the new one; none of E2E-S Platinum's
  await expect(page.getByTestId('portal-orders')).not.toContainText(vals.noA!);
  const fresh = mine.filter({ has: page.getByTestId('pay-form') });
  await expect(fresh).toHaveCount(1);
  await expect(page.getByTestId('portal-availability')).toBeVisible();

  // ---- payment reference: refused while the plan lacks the portal module, accepted once it has it
  expect((await admin.from('subscription').insert({ tenant_id: tenant, plan: 'pro', status: 'active', features: { modules: ['core', 'sales', 'dispatch'] } })).error).toBeNull();
  const form = fresh.getByTestId('pay-form');
  await form.getByRole('textbox').fill('UTR-PORTAL-1');
  await form.getByRole('button', { name: 'Send payment reference' }).click();
  await expect(form.getByRole('status')).toContainText('portal is not enabled', { timeout: 20_000 });
  expect((await admin.from('subscription').update({ features: { modules: ['core', 'sales', 'dispatch', 'portal'] } }).eq('tenant_id', tenant)).error).toBeNull();
  await form.getByRole('button', { name: 'Send payment reference' }).click();
  await expect(toast(page)).toContainText('The hatchery will verify', { timeout: 20_000 });
  await page.reload();
  await expect(mine.getByTestId('portal-pay').filter({ hasText: 'Payment submitted' })).toHaveCount(1);
  expect((await admin.from('sales_order').select('payment_ref,payment_status').eq('customer_id', custB).eq('qty', 501).single()).data).toMatchObject({ payment_ref: 'UTR-PORTAL-1', payment_status: 'submitted' });
  // a farm user cannot open the portal
  await login(page, PHONES.ksOwner);
  await page.goto('/portal');
  await expect(page).not.toHaveURL(/\/portal/);
});
