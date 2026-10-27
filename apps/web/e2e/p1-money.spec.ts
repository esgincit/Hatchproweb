import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login, setRole } from './helpers';

// Test plan P1 #1 and #2: the ₹50,000 approval gate (it is on the bill TOTAL, not on the amount paid), overpayment,
// bad amounts and double-submits, all through the real forms. Every bill / invoice made here is removed afterwards.
const made: { bills: string[]; invoices: string[] } = { bills: [], invoices: [] };
let tenantId: string, farmId: string, vendorId: string, customerId: string;

test.beforeAll(async () => {
  const { data: v } = await admin.from('vendor').select('id,tenant_id').limit(1).single();
  tenantId = v!.tenant_id; vendorId = v!.id;
  farmId = (await admin.from('farm').select('id').eq('tenant_id', tenantId).limit(1).single()).data!.id;
  customerId = (await admin.from('customer').select('id').eq('tenant_id', tenantId).limit(1).single()).data!.id;
});

test.afterEach(async () => {
  for (const id of made.bills) {
    await admin.from('payment').delete().eq('ref_id', id);
    await admin.from('payment_approval').delete().eq('bill_id', id);
    await admin.from('bill').delete().eq('id', id);
  }
  for (const id of made.invoices) {
    await admin.from('payment').delete().eq('ref_id', id);
    await admin.from('invoice').delete().eq('id', id);
  }
  made.bills = []; made.invoices = [];
});

async function bill(total: number, tag: string) {
  const no = `E2E-${tag}-${Date.now() % 1e6}`;
  const { data } = await admin.from('bill').insert({ tenant_id: tenantId, farm_id: farmId, vendor_id: vendorId, bill_no: no, bill_date: '2026-10-19', due_date: '2026-11-19', category: 'feed', total }).select('id').single();
  made.bills.push(data!.id);
  return { id: data!.id, no };
}
async function invoice(total: number, tag: string) {
  const no = `E2E-${tag}-${Date.now() % 1e6}`;
  const { data } = await admin.from('invoice').insert({ tenant_id: tenantId, farm_id: farmId, customer_id: customerId, invoice_no: no, invoice_date: '2026-10-19', due_date: '2026-11-19', product: 'egg', qty: 1, unit: 'egg', rate: total, total }).select('id').single();
  made.invoices.push(data!.id);
  return { id: data!.id, no };
}
const state = async (id: string) => (await admin.from('bill').select('status,paid').eq('id', id).single()).data!;
const approvals = async (id: string, status = 'pending') => (await admin.from('payment_approval').select('id,amount').eq('bill_id', id).eq('status', status)).data!;

/** Pay a bill from /money?view=ap; amount left alone means "the whole outstanding". */
async function pay(page: Page, no: string, amount?: string) {
  await page.goto('/money?view=ap');
  await page.locator('.item', { hasText: no }).getByRole('button', { name: 'Pay' }).click();
  const sheet = page.getByRole('dialog');
  if (amount !== undefined) await sheet.getByLabel('Amount (₹)').fill(amount);
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  return sheet;
}

test('MON-16: a bill of exactly ₹50,000 is paid by finance without approval', async ({ page }, info) => {
  const b = await bill(50000, 'M16');
  await login(page, PHONES.finance);
  await pay(page, b.no);
  await expect(page.locator('.toast')).toContainText('Payment of ₹50,000 recorded');
  expect(await state(b.id)).toEqual({ status: 'paid', paid: 50000 });
  expect(await approvals(b.id)).toHaveLength(0);
});

test('MON-17: a bill of ₹50,000.01 waits for the owner', async ({ page }) => {
  const b = await bill(50000.01, 'M17');
  await login(page, PHONES.finance);
  await pay(page, b.no);
  await expect(page.locator('.toast')).toContainText('sent to the owner');
  expect(await state(b.id)).toEqual({ status: 'unpaid', paid: 0 });
  expect(await approvals(b.id)).toHaveLength(1);
});

test('MON-18 / MON-19: a small part-payment on a big bill still needs approval, and a second request is refused', async ({ page }) => {
  const b = await bill(60000, 'M18');
  await login(page, PHONES.finance);
  await pay(page, b.no, '1000');
  await expect(page.locator('.toast')).toContainText('₹1,000 sent to the owner');
  expect((await approvals(b.id)).map((a) => Number(a.amount))).toEqual([1000]);
  expect((await state(b.id)).paid).toBe(0);

  const sheet = await pay(page, b.no, '2000'); // MON-19: one request at a time per bill
  await expect(sheet.getByRole('alert')).toContainText('already waiting for owner approval');
  expect(await approvals(b.id)).toHaveLength(1);
});

test('MON-20: the owner pays a big bill directly', async ({ page }) => {
  const b = await bill(60000, 'M20');
  await login(page);
  await pay(page, b.no);
  await expect(page.locator('.toast')).toContainText('Payment of ₹60,000 recorded');
  expect(await state(b.id)).toEqual({ status: 'paid', paid: 60000 });
  expect(await approvals(b.id)).toHaveLength(0);
});

test('MON-21: a farm manager paying a big bill also waits for the owner', async ({ page }) => {
  const b = await bill(60000, 'M21');
  const restore = await setRole(PHONES.finance, 'farm_manager');
  try {
    await login(page, PHONES.finance);
    await pay(page, b.no);
    await expect(page.locator('.toast')).toContainText('sent to the owner');
    expect(await approvals(b.id)).toHaveLength(1);
  } finally { await restore(); }
});

test('MON-22: the owner rejects a request; the bill stays unpaid and finance can ask again', async ({ page, browser }) => {
  const b = await bill(60000, 'M22');
  await login(page, PHONES.finance);
  await pay(page, b.no);
  await expect(page.locator('.toast')).toContainText('sent to the owner');

  const owner = await (await browser.newContext()).newPage();
  await login(owner);
  await owner.goto('/money?view=ap');
  await owner.locator('.stripe .item', { hasText: b.no }).getByRole('button', { name: 'Reject' }).click();
  await expect(owner.locator('.toast')).toContainText('rejected');
  await owner.context().close();
  expect(await state(b.id)).toEqual({ status: 'unpaid', paid: 0 });
  expect(await approvals(b.id)).toHaveLength(0);
  expect(await approvals(b.id, 'rejected')).toHaveLength(1);

  await pay(page, b.no); // asking again is allowed once the first one is decided
  await expect(page.locator('.toast').last()).toContainText('sent to the owner');
  expect(await approvals(b.id)).toHaveLength(1);
});

test('MON-24: approving the same request twice (second tab) is refused', async ({ page, browser }) => {
  const b = await bill(60000, 'M24');
  await login(page, PHONES.finance);
  await pay(page, b.no);
  await expect(page.locator('.toast')).toContainText('sent to the owner');

  const ctx = await browser.newContext();
  const one = await ctx.newPage();
  await login(one);
  await one.goto('/money?view=ap');
  const two = await ctx.newPage(); // second tab, loaded while the request is still pending
  await two.goto('/money?view=ap');
  await expect(two.locator('.stripe .item', { hasText: b.no })).toBeVisible();

  await one.locator('.stripe .item', { hasText: b.no }).getByRole('button', { name: 'Approve' }).click();
  await expect(one.locator('.toast')).toContainText('approved');
  await two.locator('.stripe .item', { hasText: b.no }).getByRole('button', { name: 'Approve' }).click();
  await expect(two.locator('.toast')).toContainText('already decided');
  await ctx.close();
  expect(await state(b.id)).toEqual({ status: 'paid', paid: 60000 }); // paid once, not twice
});

test('MON-13: paying ₹12,501 on a ₹12,500 bill is refused', async ({ page }) => {
  const b = await bill(12500, 'M13');
  await login(page, PHONES.finance);
  const sheet = await pay(page, b.no, '12501');
  await expect(sheet.getByRole('alert')).toContainText('amount exceeds outstanding');
  expect(await state(b.id)).toEqual({ status: 'unpaid', paid: 0 });
});

test('MON-14: zero, negative amounts and a 41-character UTR are refused', async ({ page }) => {
  const b = await bill(12500, 'M14');
  await login(page, PHONES.finance);
  await page.goto('/money?view=ap');
  await page.locator('.item', { hasText: b.no }).getByRole('button', { name: 'Pay' }).click();
  const sheet = page.getByRole('dialog');
  for (const [amount, utr] of [['0', ''], ['-5', ''], ['100', 'U'.repeat(41)]]) {
    await sheet.getByLabel('Amount (₹)').fill(amount);
    await sheet.getByLabel('Reference / UTR (optional)').fill(utr);
    await sheet.getByRole('button', { name: 'Record payment' }).click();
    await expect(sheet.getByRole('alert')).toContainText('Please check the highlighted fields');
  }
  expect(await state(b.id)).toEqual({ status: 'unpaid', paid: 0 });
  expect((await admin.from('payment').select('id').eq('ref_id', b.id)).data).toEqual([]);
});

test('MON-26: double-clicking Record payment records one payment', async ({ page }) => {
  const inv = await invoice(10000, 'M26');
  await login(page);
  await page.goto('/money?view=ar');
  await page.locator('.item', { hasText: inv.no }).getByRole('button', { name: 'Receive' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Amount (₹)').fill('4000'); // part-payment: a second submit would NOT hit "exceeds outstanding"
  await sheet.getByRole('button', { name: 'Record payment' }).dblclick();
  await expect(page.locator('.toast').first()).toContainText('₹4,000');
  await page.waitForTimeout(1500); // let a duplicate request land if there is one
  const { data } = await admin.from('payment').select('amount').eq('ref_id', inv.id);
  expect(data!.map((p) => Number(p.amount))).toEqual([4000]);
  expect((await admin.from('invoice').select('paid').eq('id', inv.id).single()).data!.paid).toBe(4000);
});

test('MON-07: double-clicking Raise invoice raises one invoice', async ({ page }) => {
  await login(page);
  const find = () => admin.from('invoice').select('id,invoice_no').eq('total', 8638).eq('product', 'egg');
  await admin.from('invoice').delete().eq('total', 8638).eq('product', 'egg');
  try {
    await page.goto('/money');
    await page.locator('.quick button', { hasText: 'New sale' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Quantity').fill('1234');
    await sheet.getByLabel('Rate (₹ per unit)').fill('7');
    await sheet.getByRole('button', { name: 'Raise invoice' }).dblclick();
    await expect(page).toHaveURL(/view=ar/);
    await page.waitForTimeout(1500);
    expect((await find()).data).toHaveLength(1);
  } finally {
    for (const i of (await find()).data ?? []) { await admin.from('payment').delete().eq('ref_id', i.id); await admin.from('invoice').delete().eq('id', i.id); }
  }
});
