import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, openAct, tamper, uniq, vkr } from './helpers';

// Test plan P2 #20: bills, part-payments, customers, vendors, local rates, WhatsApp reminders in five languages,
// all as the finance user. Everything made here is "E2E-" named (or tagged) and removed afterwards.
const INVALID = 'Please check the highlighted fields';
const plus = (days: number) => new Date(Date.parse(TODAY) + days * 864e5).toISOString().slice(0, 10);
let I: Awaited<ReturnType<typeof vkr>>;
const billNos: string[] = [];
const invoiceIds: string[] = [];
test.beforeAll(async () => { I = await vkr(); });
test.afterEach(async () => {
  const { data: bills } = await admin.from('bill').select('id').in('bill_no', billNos.splice(0));
  if (bills?.length) { await admin.from('payment').delete().in('ref_id', bills.map((b) => b.id)); await admin.from('bill').delete().in('id', bills.map((b) => b.id)); }
  if (invoiceIds.length) { await admin.from('payment').delete().in('ref_id', invoiceIds); await admin.from('invoice').delete().in('id', invoiceIds.splice(0)); }
  const { data: c } = await admin.from('customer').select('id').like('name', 'E2E-%');
  if (c?.length) {
    await admin.from('reminder_log').delete().in('customer_id', c.map((x) => x.id));
    await admin.from('invoice').delete().in('customer_id', c.map((x) => x.id));
    await admin.from('customer').delete().in('id', c.map((x) => x.id));
  }
  await admin.from('vendor').delete().like('name', 'E2E-%');
  await admin.from('market_rate').delete().like('zone', 'E2E-%');
});

test('MON-03: a sale linked to a layer batch carries the batch on the invoice', async ({ page }) => {
  await login(page, PHONES.finance);
  await page.goto('/money');
  const sheet = await openAct(page, 'saleOpen');
  await sheet.getByLabel('Quantity').fill('100');
  await sheet.getByLabel('Rate (₹ per unit)').fill('6.25');
  await sheet.getByLabel('Batch (optional)').selectOption({ label: 'VKR-L-2026-01 · Shed 1' });
  await sheet.getByRole('button', { name: 'Raise invoice' }).click();
  await expect(page.locator('.toast')).toContainText('Invoice INV');
  const no = ((await page.locator('.toast').textContent()) ?? '').match(/INV\d+/)![0];
  const { data: inv } = await admin.from('invoice').select('id,batch_id,total').eq('invoice_no', no).single();
  invoiceIds.push(inv!.id);
  const { data: b } = await admin.from('batch').select('id').eq('code', 'VKR-L-2026-01').single();
  expect(inv).toMatchObject({ batch_id: b!.id, total: 625 });
});

test('MON-08 / MON-09 / MON-12: finance books a bill (unpaid), refuses bad totals, then a part-payment leaves it partial', async ({ page }) => {
  const no = `E2E-F77-${uniq()}`;
  billNos.push(no);
  await login(page, PHONES.finance);
  await page.goto('/money?view=ap');
  const sheet = await openAct(page, 'addBill');
  await sheet.getByLabel('Vendor', { exact: true }).selectOption(I.vendorId);
  await sheet.getByLabel('Amount (₹)').fill('12500');
  await sheet.getByLabel('Vendor bill no. (optional)').fill(no);
  await sheet.getByRole('button', { name: 'Book bill' }).click();
  await expect(page.locator('.toast')).toContainText('booked');
  const { data: b } = await admin.from('bill').select('id,status,total,paid,category').eq('bill_no', no).single();
  expect(b).toMatchObject({ status: 'unpaid', total: 12500, paid: 0, category: 'feed' });
  await expect(page.locator('.item', { hasText: no }).first()).toContainText('₹12,500');

  const ok = { vendor_id: I.vendorId, category: 'feed', total: 100, date: TODAY };
  for (const o of [{ total: 0 }, { total: -1 }, { bill_no: 'B'.repeat(41) }]) {
    expect(await tamper(page, 'addBill', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }

  // MON-12: pay 1,000 of 12,500
  await page.keyboard.press('Escape'); // close the carrier form the tampered calls used
  await expect(page.getByRole('dialog')).toBeHidden();
  const row = page.locator('.item', { hasText: no });
  await row.getByRole('button', { name: 'Pay' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByLabel('Amount (₹)').fill('1000');
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.locator('.toast').last()).toContainText('Payment of ₹1,000 recorded');
  expect((await admin.from('bill').select('status,paid').eq('id', b!.id).single()).data).toEqual({ status: 'partial', paid: 1000 });
  await expect(page.locator('.item', { hasText: no })).toContainText('₹11,500'); // outstanding
});

test('MON-27 / MON-28: finance adds a customer; blank name, negative limit or days, decimal days, long phone refused', async ({ page }) => {
  const name = `E2E-Ravi-${uniq()}`;
  await login(page, PHONES.finance);
  await page.goto('/more/customers');
  const sheet = await openAct(page, 'addCustomer');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Phone').fill('9885012345');
  await sheet.getByLabel('Credit limit (₹)').fill('50000');
  await sheet.getByLabel('Credit days').fill('7');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(`Customer added · ${name}`);
  expect((await admin.from('customer').select('kind,credit_limit,credit_days,phone').eq('name', name).single()).data).toMatchObject({ kind: 'trader', credit_limit: 50000, credit_days: 7 });
  await expect(page.locator('.item', { hasText: name })).toBeVisible();

  const ok = { name: 'E2E-bad', kind: 'trader', phone: '9885012345', credit_limit: 0, credit_days: 7 };
  for (const o of [{ name: '' }, { credit_limit: -1 }, { credit_days: -1 }, { credit_days: 1.5 }, { phone: '9'.repeat(21) }, { phone: 'abcd' }]) {
    expect(await tamper(page, 'addCustomer', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('customer').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('MON-31 / MON-32: finance saves a local egg rate (per egg); zero rate or blank zone refused', async ({ page }) => {
  const zone = `E2E-Zone-${uniq()}`;
  await login(page, PHONES.finance);
  await page.goto('/money?view=rates');
  const sheet = await openAct(page, 'addRate');
  await sheet.getByLabel('Market / zone').fill(zone);
  await sheet.getByLabel('Rate (₹)').fill('5.60');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Rate saved');
  expect((await admin.from('market_rate').select('product,rate,unit,source').eq('zone', zone).single()).data).toEqual({ product: 'egg', rate: 5.6, unit: 'per_egg', source: 'tenant' });

  for (const o of [{ rate: 0 }, { zone: '' }]) {
    expect(await tamper(page, 'addRate', { product: 'egg', zone, rate: 5, date: TODAY, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('market_rate').select('id').eq('zone', zone)).data).toHaveLength(1);
});

test('VND-02 / 03 / 04 / 05 / 06: vendors with and without GSTIN, lower-case GSTIN stored upper-case, bad GSTIN and terms refused', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = uniq();
  await login(page, PHONES.finance);
  await page.goto('/more/vendors');
  const add = async (name: string, gstin: string) => {
    const sheet = await openAct(page, 'addVendor');
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByLabel('GSTIN (optional)').fill(gstin);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast').last()).toContainText(`Vendor added · ${name}`);
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  const row = (n: string) => page.locator('.item', { hasText: n });
  await add(`E2E-Feeds-${tag}`, '36AAECV1234K1Z5'); // VND-02
  await expect(row(`E2E-Feeds-${tag}`)).toContainText('GST ✓');
  expect((await admin.from('vendor').select('is_verified,payment_terms_days,gstin').eq('name', `E2E-Feeds-${tag}`).single()).data).toEqual({ is_verified: true, payment_terms_days: 15, gstin: '36AAECV1234K1Z5' });
  await add(`E2E-Plain-${tag}`, ''); // VND-03
  await expect(row(`E2E-Plain-${tag}`)).not.toContainText('GST ✓');
  expect((await admin.from('vendor').select('is_verified,gstin').eq('name', `E2E-Plain-${tag}`).single()).data).toEqual({ is_verified: false, gstin: null });
  await add(`E2E-Lower-${tag}`, '36aaecv1234k1z5'); // VND-05
  expect((await admin.from('vendor').select('gstin').eq('name', `E2E-Lower-${tag}`).single()).data!.gstin).toBe('36AAECV1234K1Z5');

  const ok = { name: 'E2E-bad', category: 'feed', phone: '', terms: 15 };
  for (const o of [{ gstin: '36AAECV1234K1Z' }, { gstin: '36AAECV1234K1Z$' }, { terms: -1 }, { terms: 2.5 }, { name: '' }]) { // VND-04, 06
    expect(await tamper(page, 'addVendor', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('vendor').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('MON-36 / MON-37: the WhatsApp reminder reads in all five languages with the amount; a customer without a phone has no send link', async ({ page, context }) => {
  test.setTimeout(90_000);
  const tag = uniq();
  const mk = async (label: string, phone: string | null) => {
    const { data: c } = await admin.from('customer').insert({ tenant_id: I.tenantId, name: `E2E-${label}-${tag}`, kind: 'trader', phone, credit_limit: 0, credit_days: 7 }).select('id,name').single();
    const { data: i } = await admin.from('invoice').insert({
      tenant_id: I.tenantId, farm_id: I.farmId, customer_id: c!.id, invoice_no: `E2E-${label}-${tag}`, invoice_date: plus(-30), due_date: plus(-10), product: 'egg', qty: 1, unit: 'egg', rate: 12345, total: 12345,
    }).select('id').single();
    invoiceIds.push(i!.id);
    return c!.name;
  };
  const withPhone = await mk('Phone', '9885000077');
  const noPhone = await mk('NoPhone', null);
  await context.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' })); // never leave the machine
  await login(page, PHONES.finance);
  await page.goto('/money?view=ar');
  await page.getByRole('button', { name: /WhatsApp reminders for/ }).click();
  const sheet = page.getByRole('dialog', { name: 'WhatsApp reminders' });
  const link = sheet.getByTestId('remind-row').filter({ hasText: withPhone }).getByRole('link', { name: 'Send on WhatsApp' });
  const text = async () => decodeURIComponent(((await link.getAttribute('href')) ?? '').split('text=')[1] ?? '');
  const greeting = { en: 'Namaste', te: 'నమస్తే', hi: 'नमस्ते', ta: 'வணக்கம்', kn: 'ನಮಸ್ಕಾರ' };
  const seen = new Set<string>();
  for (const [lang, hello] of Object.entries(greeting)) {
    await sheet.getByLabel('Message language').selectOption(lang);
    await expect.poll(text).toContain(hello);
    const msg = await text();
    expect(msg, lang).toContain('₹12,345');
    expect(msg, lang).toContain(withPhone);
    seen.add(msg);
  }
  expect(seen.size).toBe(5);

  const bare = sheet.getByTestId('remind-row').filter({ hasText: noPhone }); // MON-37
  await expect(bare).toBeVisible();
  await expect(bare.getByRole('link')).toHaveCount(0);
  await expect(bare).toContainText('No mobile number'); // the hint instead of a broken wa.me link
});
