import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { admin, PHONES, FORBIDDEN, TODAY, login, setRole, tamper, uniq } from './helpers';

// ERP finance, procurement, settings, portal link and dashboards (0050-0056) through the real screens on the KS Farms tenant (plan pro).
// The KS owner's login is re-roled for the role steps. Fixtures are named E2E-F / E2E-P / E2E-S and removed afterwards.
test.describe.configure({ mode: 'serial' });
const REAL = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // the pm_due / ageing views use the database clock, not APP_TODAY
const KS = `(select id from tenant where name = 'KS Farms')`;
const ALL_MODULES = ['core', 'breeder', 'hatchery', 'sales', 'dispatch', 'dashboards', 'portal', 'branches', 'api'];
const PORTAL_EMAIL = 'e2e-p7-portal@example.test';
let tenant: string, farmId: string, custId: string, storeA: string, storeB: string, itemId: string, vendorId: string;

function sql(q: string) {
  execFileSync('docker', ['exec', 'supabase_db_poultryos', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `set session_replication_role = replica; ${q}`], { stdio: 'pipe' });
}
const ITEM = `select id from item where tenant_id = ${KS} and name like 'E2E-P%'`;
const STORES = `select id from store where tenant_id = ${KS} and name like 'E2E-P%'`;
/** Locked rows cannot be deleted through the API: cleanup goes around the triggers in SQL (replica role: children first). */
function clean() {
  sql(`delete from refund where customer_id in (select id from customer where name like 'E2E-F%');
       delete from credit_note where customer_id in (select id from customer where name like 'E2E-F%');
       delete from invoice where customer_id in (select id from customer where name like 'E2E-F%');
       delete from customer_portal_user where customer_id in (select id from customer where name like 'E2E-F%');
       delete from customer where name like 'E2E-F%';
       delete from tenant_rule where tenant_id = ${KS} and key in ('books_locked_until', 'po_approval_above', 'finance_owner_above');
       delete from purchase_requisition where tenant_id = ${KS} and purpose like 'E2E-P%';
       delete from stock_movement where item_id in (${ITEM});
       delete from po_line where item_id in (${ITEM});
       delete from purchase_order where tenant_id = ${KS} and id not in (select po_id from po_line);
       delete from stock_count_line where item_id in (${ITEM});
       delete from stock_count where store_id in (${STORES});
       delete from stock_transfer where item_id in (${ITEM});
       delete from item where id in (${ITEM});
       delete from store where id in (${STORES});
       update farm set branch_id = null where tenant_id = ${KS};
       delete from branch where tenant_id = ${KS} and name like 'E2E-S%';
       delete from pm_schedule where tenant_id = ${KS} and task like 'E2E-S%';
       delete from api_key where tenant_id = ${KS} and name like 'E2E-S%';
       delete from webhook_subscription where tenant_id = ${KS} and url like 'https://e2e-s.example.test%';
       delete from support_access_grant where tenant_id = ${KS} and reason like 'E2E-S%';
       delete from approval_delegation where tenant_id = ${KS} and reason like 'E2E-S%';
       delete from subscription where tenant_id = ${KS};
       delete from notification where tenant_id = ${KS} and (title like '%E2E-%' or title like 'Maintenance due%E2E%')`);
}
async function dropAuthUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.email === PORTAL_EMAIL) await admin.auth.admin.deleteUser(u.id);
}
const modules = async (mods: string[]) => {
  await admin.from('subscription').delete().eq('tenant_id', tenant);
  expect((await admin.from('subscription').insert({ tenant_id: tenant, plan: 'pro', status: 'active', features: { modules: mods } })).error).toBeNull();
};

test.beforeAll(async () => {
  test.setTimeout(120_000);
  clean();
  await dropAuthUser();
  tenant = (await admin.from('tenant').select('id').eq('name', 'KS Farms').single()).data!.id;
  farmId = (await admin.from('farm').select('id').eq('tenant_id', tenant).order('created_at').limit(1).single()).data!.id;
  vendorId = (await admin.from('vendor').select('id').eq('tenant_id', tenant).limit(1).single()).data!.id;
  custId = (await admin.from('customer').insert({ tenant_id: tenant, name: 'E2E-F Customer', kind: 'trader', credit_limit: 1000000, credit_days: 15 }).select('id').single()).data!.id;
  // an invoice 40 days overdue: lands in the 31-60 ageing column
  const day = (n: number) => new Date(Date.parse(REAL) + n * 864e5).toISOString().slice(0, 10);
  const inv = await admin.from('invoice').insert({
    tenant_id: tenant, farm_id: farmId, customer_id: custId, invoice_no: `E2EF-${uniq()}`, invoice_date: day(-55), due_date: day(-40), product: 'doc', qty: 100, unit: 'chick', rate: 80, total: 8000,
  });
  expect(inv.error).toBeNull();
  storeA = (await admin.from('store').insert({ tenant_id: tenant, farm_id: farmId, name: 'E2E-P Store A' }).select('id').single()).data!.id;
  storeB = (await admin.from('store').insert({ tenant_id: tenant, farm_id: farmId, name: 'E2E-P Store B' }).select('id').single()).data!.id;
  itemId = (await admin.from('item').insert({ tenant_id: tenant, name: 'E2E-P Item', category: 'other', unit: 'kg' }).select('id').single()).data!.id;
});
test.afterAll(async () => { clean(); await dropAuthUser(); });

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
/** Submit and expect the DB's own refusal inside the open form. */
async function refused(dlg: Locator, text: string | RegExp, button = 'Save') {
  await dlg.getByRole('button', { name: button, exact: true }).click();
  await expect(dlg).toContainText(text, { timeout: 20_000 });
  await expect(dlg).toBeVisible();
}
const fill = (dlg: Locator, label: string | RegExp, v: string | number) => dlg.getByLabel(label, { exact: typeof label === 'string' }).fill(String(v));
/** Run `fn` signed in as the KS login holding exactly this role. */
async function as(page: Page, role: string, fn: () => Promise<void>) {
  const restore = await setRole(PHONES.ksOwner, role);
  try { await login(page, PHONES.ksOwner); await fn(); } finally { await restore(); }
}
const toast = (page: Page) => page.locator('.toast');
const row = (page: Page, testid: string, text: string) => page.getByTestId(testid).filter({ hasText: text });
const status = (r: Locator) => r.getByTestId('doc-status');

test('FIN-01: credit notes: raised, approved by finance, above the limit only the owner; the sales officer cannot approve', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/finance');
  let dlg = await open(page, page.getByRole('button', { name: '+ Credit note' }));
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-F Customer' });
  await fill(dlg, 'Amount (₹)', 500); await fill(dlg, 'Reason', 'E2E-F small credit');
  await send(dlg);
  const small = row(page, 'note-row', 'E2E-F small credit');
  await expect(status(small)).toHaveText('Awaiting approval', { timeout: 20_000 });
  dlg = await open(page, page.getByRole('button', { name: '+ Credit note' }));
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-F Customer' });
  await fill(dlg, 'Amount (₹)', 60000); await fill(dlg, 'Reason', 'E2E-F large credit');
  await send(dlg);
  const large = row(page, 'note-row', 'E2E-F large credit');
  await expect(status(large)).toHaveText('Awaiting approval', { timeout: 20_000 });

  // the sales officer raises but cannot approve (button hidden, and the server refuses a tampered call)
  await as(page, 'sales_officer', async () => {
    await page.goto('/more/finance');
    await expect(row(page, 'note-row', 'E2E-F small credit')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const id = (await admin.from('credit_note').select('id').eq('reason', 'E2E-F small credit').single()).data!.id;
    expect(await tamper(page, 'decideCreditNote', { id, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
  // finance approves the small one; the large one is above the owner threshold (₹50,000): refused with the DB's message
  await as(page, 'finance', async () => {
    await page.goto('/more/finance');
    await row(page, 'note-row', 'E2E-F small credit').getByRole('button', { name: 'Approve' }).click();
    await expect(status(row(page, 'note-row', 'E2E-F small credit'))).toHaveText('Approved', { timeout: 20_000 });
    await row(page, 'note-row', 'E2E-F large credit').getByRole('button', { name: 'Approve' }).click();
    await expect(toast(page)).toContainText(/need the owner/, { timeout: 20_000 });
    await expect(status(row(page, 'note-row', 'E2E-F large credit'))).toHaveText('Awaiting approval');
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/finance');
  const lg = row(page, 'note-row', 'E2E-F large credit');
  await lg.getByRole('button', { name: 'Reject' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Reject', exact: true }).click(); // reason is required: the form refuses, nothing changes
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Reason').fill('E2E-F too large');
  await send(dlg, 'Reject');
  await expect(status(lg)).toHaveText('Rejected', { timeout: 20_000 });
  await expect(lg).toContainText('E2E-F too large');
});

test('FIN-02: refund approval, receivables ageing, customer balance (open invoices minus approved credits)', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/finance?tab=refunds');
  const dlg = await open(page, page.getByRole('button', { name: '+ Refund' }));
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-F Customer' });
  await fill(dlg, 'Amount (₹)', 250); await fill(dlg, /^Reference/, 'E2E-F-UTR');
  await send(dlg);
  const r = row(page, 'refund-row', 'E2E-F Customer');
  await expect(status(r)).toHaveText('Awaiting approval', { timeout: 20_000 });
  await r.getByRole('button', { name: 'Approve' }).click();
  await expect(status(r)).toHaveText('Approved', { timeout: 20_000 });

  await page.goto('/more/finance?tab=ageing');
  const ag = page.getByTestId('ageing').locator('tr', { hasText: 'E2E-F Customer' });
  await expect(ag.locator('td').nth(3)).toHaveText('₹8,000', { timeout: 20_000 }); // 31–60 column
  await expect(ag.locator('td').nth(6)).toHaveText('₹8,000');

  await page.goto('/more/finance?tab=balances');
  const bal = page.getByTestId('balances').locator('tr', { hasText: 'E2E-F Customer' });
  await expect(bal.locator('td').nth(1)).toHaveText('₹8,000', { timeout: 20_000 }); // open invoices
  await expect(bal.locator('td').nth(2)).toHaveText('₹500'); // the one approved credit note
  await expect(bal.getByTestId('balance-amt')).toHaveText('₹7,500');
});

test('FIN-03: the owner locks the books; a dated entry is refused with the DB message; reopening works; finance cannot set it', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/finance?tab=lock');
  await expect(page.getByTestId('lock-state')).toHaveText('Books are open (no lock set)');
  let dlg = await open(page, page.getByRole('button', { name: 'Change' }));
  await fill(dlg, 'Closed up to', TODAY);
  await send(dlg);
  await expect(page.getByTestId('lock-state')).toContainText('closed up to', { timeout: 20_000 });
  expect((await admin.from('tenant_rule').select('value').eq('tenant_id', tenant).eq('key', 'books_locked_until').single()).data!.value).toBe(TODAY);

  await page.goto('/more/finance');
  dlg = await open(page, page.getByRole('button', { name: '+ Credit note' }));
  await dlg.getByLabel('Customer').selectOption({ label: 'E2E-F Customer' });
  await fill(dlg, 'Amount (₹)', 100); await fill(dlg, 'Reason', 'E2E-F locked day');
  await refused(dlg, /books are closed up to/);
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  await as(page, 'finance', async () => {
    await page.goto('/more/finance?tab=lock');
    await expect(page.getByTestId('lock-state')).toContainText('closed up to');
    await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
    expect(await tamper(page, 'setLock', { date: '' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/finance?tab=lock');
  dlg = await open(page, page.getByRole('button', { name: 'Change' }));
  await dlg.getByLabel('Closed up to').fill('');
  await send(dlg);
  await expect(page.getByTestId('lock-state')).toHaveText('Books are open (no lock set)', { timeout: 20_000 });
});

test('PRO-01: purchase requisitions: draft, submit, approve; reject needs a reason; a supervisor cannot approve', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/procurement');
  for (const [purpose, qty, send_] of [['E2E-P approve me', 10, 'Draft'], ['E2E-P reject me', 20, 'Submit for approval']] as const) {
    const dlg = await open(page, page.getByRole('button', { name: '+ Requisition' }));
    await dlg.getByLabel('Item').selectOption({ label: 'E2E-P Item · kg' });
    await fill(dlg, 'Quantity', qty); await fill(dlg, 'Purpose', purpose);
    await dlg.getByLabel('Save as').selectOption({ label: send_ });
    await send(dlg);
    await expect(row(page, 'req-row', purpose)).toBeVisible({ timeout: 20_000 });
  }
  const a = row(page, 'req-row', 'E2E-P approve me'), b = row(page, 'req-row', 'E2E-P reject me');
  await expect(status(a)).toHaveText('Draft');
  await expect(status(b)).toHaveText('Awaiting approval');
  await a.getByRole('button', { name: 'Submit' }).click();
  await expect(status(a)).toHaveText('Awaiting approval', { timeout: 20_000 });

  await as(page, 'shed_supervisor', async () => { // may raise a requisition, may not approve it
    await page.goto('/more/procurement');
    await expect(row(page, 'req-row', 'E2E-P approve me')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const id = (await admin.from('purchase_requisition').select('id').eq('purpose', 'E2E-P approve me').single()).data!.id;
    expect(await tamper(page, 'decideReq', { id, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/procurement');
  await a.getByRole('button', { name: 'Approve' }).click();
  await expect(status(a)).toHaveText('Approved', { timeout: 20_000 });
  await b.getByRole('button', { name: 'Reject' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Reject', exact: true }).click(); // no reason: the form refuses
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Reason').fill('E2E-P not needed');
  await send(dlg, 'Reject');
  await expect(status(b)).toHaveText('Rejected', { timeout: 20_000 });
  await expect(b).toContainText('E2E-P not needed');
});

test('PRO-02: a purchase order above the limit waits for approval; only the owner approves; the limit is set in Settings', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/settings');
  let dlg = await open(page, page.locator('[data-limit="po_approval_above"]').getByRole('button', { name: 'Change' }));
  await fill(dlg, 'Amount (₹)', 1000);
  await send(dlg);
  await expect(page.locator('[data-limit="po_approval_above"]').getByTestId('limit-value')).toHaveText('₹1,000', { timeout: 20_000 });

  await page.goto('/more/stock');
  const exp = new Date(Date.parse(TODAY) + 3 * 864e5).toISOString().slice(0, 10);
  const r = await tamper(page, 'raisePO', { vendor_id: vendorId, item_id: itemId, qty: 100, rate: 50, expected: exp, date: TODAY }); // 5,000 + GST 0: above the limit
  expect(r.ok, r.error).toBe(true);
  const poNo = r.msg!.match(/PO-\d+/)![0];
  await page.goto('/more/procurement?tab=orders');
  const po = row(page, 'po-row', poNo);
  await expect(page.getByTestId('po-limit')).toContainText('₹1,000');
  await expect(status(po)).toHaveText('Awaiting approval', { timeout: 20_000 });

  await as(page, 'store_keeper', async () => { // raises and cancels POs, but approval is the owner's
    await page.goto('/more/procurement?tab=orders');
    await expect(row(page, 'po-row', poNo)).toBeVisible({ timeout: 20_000 });
    await expect(row(page, 'po-row', poNo).getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const id = (await admin.from('purchase_order').select('id').eq('po_no', poNo).single()).data!.id;
    expect(await tamper(page, 'approvePO', { id })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/procurement?tab=orders');
  await row(page, 'po-row', poNo).getByRole('button', { name: 'Approve' }).click();
  await expect(status(row(page, 'po-row', poNo))).toHaveText('Approved', { timeout: 20_000 });
  expect((await admin.from('purchase_order').select('status').eq('po_no', poNo).single()).data!.status).toBe('approved');

  // supplier KPIs are on screen
  await page.goto('/more/procurement?tab=suppliers');
  await expect(page.getByTestId('suppliers')).toContainText('On time', { timeout: 20_000 });

  // put the limit back (blank = off)
  await page.goto('/more/settings');
  dlg = await open(page, page.locator('[data-limit="po_approval_above"]').getByRole('button', { name: 'Change' }));
  await dlg.getByLabel('Amount (₹)').fill('');
  await send(dlg);
  await expect(page.locator('[data-limit="po_approval_above"]').getByTestId('limit-value')).toHaveText('Off', { timeout: 20_000 });
});

test('PRO-03: stock count sheet: counted, submitted, approved -> book stock adjusted; a store transfer moves stock in transit', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/procurement?tab=counts');
  let dlg = await open(page, page.getByRole('button', { name: '+ Count sheet' }));
  await dlg.getByLabel('Store').selectOption({ label: 'E2E-P Store A' });
  await fill(dlg, 'Notes', 'E2E-P count');
  await fill(dlg, /^E2E-P Item/, 10);
  await send(dlg);
  const c = row(page, 'count-row', 'E2E-P count');
  await expect(status(c)).toHaveText('Draft', { timeout: 20_000 });
  await c.getByRole('button', { name: 'Submit' }).click();
  await expect(status(c)).toHaveText('Awaiting approval', { timeout: 20_000 });
  await expect(c.getByTestId('count-line')).toContainText('book 0');
  await c.getByRole('button', { name: 'Approve' }).click();
  await expect(status(c)).toHaveText('Approved', { timeout: 20_000 });
  await expect(c.getByTestId('count-line')).toContainText('difference 10.00');
  const mv = (await admin.from('stock_movement').select('qty,move_type').eq('item_id', itemId).eq('store_id', storeA)).data!;
  expect(mv.map((m) => [m.move_type, Number(m.qty)])).toEqual([['count', 10]]);

  await page.goto('/more/procurement?tab=transfers');
  dlg = await open(page, page.getByRole('button', { name: '+ Transfer' }));
  await dlg.getByLabel('From store').selectOption({ label: 'E2E-P Store A' });
  await dlg.getByLabel('To store').selectOption({ label: 'E2E-P Store B' });
  await dlg.getByLabel('Item').selectOption({ label: 'E2E-P Item · kg' });
  await fill(dlg, 'Quantity', 4);
  await send(dlg);
  const x = row(page, 'xfer-row', 'E2E-P Item');
  await expect(status(x)).toHaveText('Awaiting approval', { timeout: 20_000 });
  await x.getByRole('button', { name: 'Approve' }).click();
  await expect(status(x)).toHaveText('Approved', { timeout: 20_000 });
  dlg = await open(page, x.getByRole('button', { name: 'Send' }));
  await send(dlg);
  await expect(status(x)).toHaveText('In transit', { timeout: 20_000 });
  dlg = await open(page, x.getByRole('button', { name: 'Receive' }));
  await fill(dlg, 'Quantity received', 4);
  await send(dlg);
  await expect(status(x)).toHaveText('Received', { timeout: 20_000 });
  const sum = async (store: string) => ((await admin.from('stock_movement').select('qty').eq('item_id', itemId).eq('store_id', store)).data ?? []).reduce((a, m) => a + Number(m.qty), 0);
  expect(await sum(storeA)).toBe(6);
  expect(await sum(storeB)).toBe(4);

  // moving more than the store holds is refused with the DB message
  await page.goto('/more/procurement?tab=transfers');
  dlg = await open(page, page.getByRole('button', { name: '+ Transfer' }));
  await dlg.getByLabel('From store').selectOption({ label: 'E2E-P Store A' });
  await dlg.getByLabel('To store').selectOption({ label: 'E2E-P Store B' });
  await dlg.getByLabel('Item').selectOption({ label: 'E2E-P Item · kg' });
  await fill(dlg, 'Quantity', 500);
  await send(dlg);
  const big = page.getByTestId('xfer-row').filter({ hasText: '500' });
  await big.getByRole('button', { name: 'Approve' }).click();
  await expect(status(big)).toHaveText('Approved', { timeout: 20_000 });
  dlg = await open(page, big.getByRole('button', { name: 'Send' }));
  await dlg.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dlg).toContainText(/./, { timeout: 20_000 });
  await expect(status(big)).toHaveText('Approved');
});

test('SET-01: settings: modules list, branches, maintenance schedule + due list, support access grant and revoke', async ({ page }) => {
  test.setTimeout(300_000);
  await modules(['core', 'breeder', 'hatchery', 'sales', 'dispatch', 'dashboards', 'portal', 'branches', 'api']);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/settings');
  const mods = page.getByTestId('modules');
  await expect(mods.locator('[data-module]')).toHaveCount(ALL_MODULES.length, { timeout: 20_000 });
  for (const m of ALL_MODULES) await expect(mods.locator(`[data-module="${m}"]`)).toContainText('Included');

  // branch + assign the first farm to it
  let dlg = await open(page, page.getByTestId('branches').getByRole('button', { name: '+ Branch' }));
  await fill(dlg, 'Name', 'E2E-S Branch'); await fill(dlg, 'Code', 'E2E');
  await send(dlg);
  await expect(row(page, 'branch-row', 'E2E-S Branch')).toBeVisible({ timeout: 20_000 });
  const farmName = (await admin.from('farm').select('name').eq('id', farmId).single()).data!.name;
  dlg = await open(page, page.locator('[data-testid="farm-branch-row"]', { hasText: farmName }).getByRole('button', { name: 'Branch' }));
  await dlg.getByLabel('Branch').selectOption({ label: 'E2E-S Branch' });
  await send(dlg);
  await expect(page.locator('[data-testid="farm-branch-row"]', { hasText: farmName })).toContainText('E2E-S Branch', { timeout: 20_000 });
  await row(page, 'branch-row', 'E2E-S Branch').getByRole('button', { name: 'Deactivate' }).click();
  await expect(row(page, 'branch-row', 'E2E-S Branch')).toContainText('Inactive', { timeout: 20_000 });

  // PM schedule: every 2 days, last done 10 days ago -> due; mark done -> not due
  dlg = await open(page, page.getByTestId('pm').getByRole('button', { name: '+ Schedule' }));
  await fill(dlg, 'Task', 'E2E-S Calibrate sensors'); await fill(dlg, 'Every (days)', 2);
  await fill(dlg, 'Last done', new Date(Date.parse(REAL) - 10 * 864e5).toISOString().slice(0, 10));
  await send(dlg);
  const pm = page.locator('[data-testid="pm-row"][data-task="E2E-S Calibrate sensors"]');
  await expect(pm).toHaveAttribute('data-due', 'yes', { timeout: 20_000 });
  dlg = await open(page, pm.getByRole('button', { name: 'Mark done' }));
  await fill(dlg, 'Date', REAL);
  await send(dlg);
  await expect(pm).toHaveAttribute('data-due', 'no', { timeout: 20_000 });

  // support access
  dlg = await open(page, page.getByTestId('support').getByRole('button', { name: 'Grant access' }));
  await fill(dlg, 'Reason', 'E2E-S billing question');
  await send(dlg);
  const g = row(page, 'grant-row', 'E2E-S billing question');
  await expect(g.getByTestId('grant-state')).toHaveText('Open', { timeout: 20_000 });
  await g.getByRole('button', { name: 'Revoke' }).click();
  await expect(g.getByTestId('grant-state')).toHaveText('Revoked', { timeout: 20_000 });
});

test('SET-02: an API key and a webhook secret are shown once, never again; keys list prefix and scopes and can be revoked', async ({ page }) => {
  test.setTimeout(240_000);
  await modules(ALL_MODULES);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/settings');
  await page.getByTestId('new-key').click();
  const form = page.getByTestId('form-key');
  await form.getByLabel('Key name').fill('E2E-S key');
  await form.getByRole('checkbox', { name: 'orders:read' }).check();
  await form.getByRole('button', { name: 'Create' }).click();
  const secret = (await page.getByTestId('secret-value').textContent())!.trim();
  expect(secret).toMatch(/^[0-9a-f]{48}$/);
  await expect(page.getByTestId('secret-once')).toContainText('only once');
  await page.getByTestId('secret-once').getByRole('button', { name: 'Done' }).click();
  const k = row(page, 'key-row', 'E2E-S key');
  await expect(k.getByTestId('key-prefix')).toHaveText(`${secret.slice(0, 8)}…`, { timeout: 20_000 });
  await expect(k).toContainText('readings:write, orders:read');
  await page.reload();
  expect(await page.content()).not.toContain(secret); // nothing keeps the plain key
  const stored = (await admin.from('api_key').select('key_hash,prefix').eq('name', 'E2E-S key').single()).data!;
  expect(stored.key_hash).not.toContain(secret);
  expect(stored.prefix).toBe(secret.slice(0, 8));
  await k.getByRole('button', { name: 'Revoke' }).click();
  await expect(k.getByTestId('key-state')).toHaveText('Revoked', { timeout: 20_000 });

  await page.getByTestId('new-hook').click();
  const hf = page.getByTestId('form-hook');
  await hf.getByLabel('Address (https)').fill('http://insecure.example.test/x'); // browser pattern is not enough: the server and the DB check it too
  await hf.getByLabel('Address (https)').fill('https://e2e-s.example.test/hook');
  await hf.getByRole('button', { name: 'Create' }).click();
  const hook = (await page.getByTestId('secret-value').textContent())!.trim();
  expect(hook).toMatch(/^[0-9a-f]{64}$/);
  await page.getByTestId('secret-once').getByRole('button', { name: 'Done' }).click();
  const w = page.locator('[data-testid="hook-row"][data-url="https://e2e-s.example.test/hook"]');
  await expect(w).toBeVisible({ timeout: 20_000 });
  await page.reload();
  expect(await page.content()).not.toContain(hook);
  await w.getByRole('button', { name: 'Pause' }).click();
  await expect(w.getByTestId('hook-state')).toHaveText('Paused', { timeout: 20_000 });
});

test('SET-03: approval delegation (a manager hands a role to a colleague); the owner cannot; labour has no settings', async ({ page }) => {
  test.setTimeout(240_000);
  const finance = (await admin.from('app_user').select('full_name').eq('tenant_id', tenant).eq('phone', '+91 94400 23232').single()).data!.full_name;
  await as(page, 'farm_manager', async () => {
    await page.goto('/more/settings');
    await expect(page.getByTestId('delegation')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('api-keys')).toHaveCount(0); // owner-only cards stay hidden
    const dlg = await open(page, page.getByTestId('delegation').getByRole('button', { name: '+ Delegate' }));
    await dlg.getByLabel('Hand over to').selectOption({ label: finance });
    await fill(dlg, 'Reason', 'E2E-S on leave');
    await send(dlg);
    const d = row(page, 'delegation-row', 'E2E-S on leave');
    await expect(d).toContainText('Active', { timeout: 20_000 });
    await d.getByRole('button', { name: 'Revoke' }).click();
    await expect(d).toContainText('Revoked', { timeout: 20_000 });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/settings');
  await expect(page.getByTestId('delegation').getByRole('button', { name: '+ Delegate' })).toHaveCount(0); // the owner cannot delegate ownership
  await as(page, 'labour', async () => {
    await page.goto('/more/settings');
    await expect(page.getByText('could not be found')).toBeVisible();
  });
});

test('SET-04: modules decide what is on screen: no api / branches / dashboards in the plan', async ({ page }) => {
  test.setTimeout(180_000);
  await modules(['core', 'breeder', 'hatchery', 'sales', 'dispatch']);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/settings');
  await expect(page.getByTestId('modules').locator('[data-module="api"]')).toContainText('Not in your plan', { timeout: 20_000 });
  await expect(page.getByTestId('api-off')).toBeVisible();
  await expect(page.getByTestId('branches-off')).toBeVisible();
  await expect(page.getByTestId('new-key')).toHaveCount(0);
  await expect(page.getByTestId('new-hook')).toHaveCount(0);
  await page.goto('/more');
  await expect(page.getByRole('link', { name: /Dashboards/ })).toHaveCount(0);
  await page.goto('/more/dashboards');
  await expect(page.getByText('could not be found')).toBeVisible();
  // the database refuses the write behind the hidden screen too
  await page.goto('/more/settings');
  expect((await tamper(page, 'addBranch', { name: 'E2E-S Blocked' })).ok).toBe(false);
  expect((await admin.from('branch').select('id').eq('tenant_id', tenant).eq('name', 'E2E-S Blocked')).data).toHaveLength(0);
  await modules(ALL_MODULES);
});

test('POR-01: the owner links a customer to a portal login by email, sees the link and removes it; others cannot; a wrong email shows the DB message', async ({ page }) => {
  test.setTimeout(240_000);
  const u = await admin.auth.admin.createUser({ email: PORTAL_EMAIL, email_confirm: true });
  expect(u.error).toBeNull();
  await login(page, PHONES.ksOwner);
  await page.goto('/more/sales?tab=customers');
  const cust = page.getByTestId('customer-row').filter({ hasText: 'E2E-F Customer' });
  const dlg = await open(page, cust.getByRole('button', { name: 'Give portal access' }));
  await fill(dlg, 'Customer email', 'nobody-e2e@example.test');
  await refused(dlg, 'cannot link that email: the customer must sign up first with this email', 'Give access');
  await fill(dlg, 'Customer email', PORTAL_EMAIL);
  await send(dlg, 'Give access');
  await expect(cust.getByTestId('portal-linked')).toBeVisible({ timeout: 20_000 });
  expect((await admin.from('customer_portal_user').select('user_id').eq('customer_id', custId).single()).data!.user_id).toBe(u.data.user!.id);

  await as(page, 'sales_officer', async () => {
    await page.goto('/more/sales?tab=customers');
    await expect(page.getByTestId('customer-row').filter({ hasText: 'E2E-F Customer' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Give portal access' })).toHaveCount(0);
    expect(await tamper(page, 'linkPortal', { customer_id: custId, email: PORTAL_EMAIL })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
  });
  await login(page, PHONES.ksOwner);
  await page.goto('/more/sales?tab=customers');
  await cust.getByRole('button', { name: 'Remove access' }).click();
  await expect(cust.getByTestId('portal-linked')).toHaveCount(0, { timeout: 20_000 });
  expect((await admin.from('customer_portal_user').select('user_id').eq('customer_id', custId)).data).toHaveLength(0);
});

test('DASH-01: dashboards (plan with the module, allowed role); hidden for a supervisor and for a plan without the module', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more');
  await page.getByRole('link', { name: /Dashboards/ }).click();
  for (const id of ['dash-week', 'dash-day', 'dash-month', 'dash-vaccines']) await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Farms and flocks' }).click();
  for (const id of ['dash-farms', 'dash-age']) await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Sales', exact: true }).click();
  for (const id of ['dash-perf', 'dash-demand']) await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Alerts' }).click();
  for (const id of ['dash-mort', 'dash-egg']) await expect(page.getByTestId(id)).toBeVisible({ timeout: 30_000 });

  await as(page, 'shed_supervisor', async () => {
    await page.goto('/more');
    await expect(page.getByRole('link', { name: /Dashboards/ })).toHaveCount(0);
    await page.goto('/more/dashboards');
    await expect(page.getByText('could not be found')).toBeVisible();
  });
  await modules(['core', 'breeder', 'hatchery', 'sales', 'dispatch']);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/dashboards');
  await expect(page.getByText('could not be found')).toBeVisible();
  await modules(ALL_MODULES);
});
