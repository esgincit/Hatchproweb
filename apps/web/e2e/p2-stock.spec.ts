import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tamper, uniq, vkr } from './helpers';

// Test plan P2 #19 (stock half): items, purchase orders and goods receipt, with the negatives.
// Works on new "E2E-" items; their POs, stock movements and bills are removed afterwards.
const INVALID = 'Please check the highlighted fields';
const plus = (days: number) => new Date(Date.parse(TODAY) + days * 864e5).toISOString().slice(0, 10);
let I: Awaited<ReturnType<typeof vkr>>;
test.beforeAll(async () => { I = await vkr(); });
test.afterEach(async () => {
  const { data: items } = await admin.from('item').select('id').like('name', 'E2E-%');
  const ids = (items ?? []).map((x) => x.id);
  if (!ids.length) return;
  const { data: lines } = await admin.from('po_line').select('po_id').in('item_id', ids);
  const pos = [...new Set((lines ?? []).map((l) => l.po_id))];
  await admin.from('stock_movement').delete().in('item_id', ids);
  if (pos.length) {
    const { data: bills } = await admin.from('bill').select('id').in('po_id', pos);
    if (bills?.length) { await admin.from('payment').delete().in('ref_id', bills.map((b) => b.id)); await admin.from('bill').delete().in('id', bills.map((b) => b.id)); }
    await admin.from('po_line').delete().in('po_id', pos);
    await admin.from('purchase_order').delete().in('id', pos);
  }
  await admin.from('item').delete().in('id', ids);
});

async function newItem(gst = 5) {
  const name = `E2E-Mash-${uniq()}`;
  const { data } = await admin.from('item').insert({ tenant_id: I.tenantId, name, category: 'feed', unit: 'kg', reorder_level: 500, gst_pct: gst }).select('id').single();
  return { id: data!.id, name };
}
const po = async (no: string) => (await admin.from('purchase_order').select('id,status,total').eq('po_no', no).single()).data!;
const onHand = async (itemId: string) => ((await admin.from('stock_movement').select('qty').eq('item_id', itemId)).data ?? []).reduce((s, m) => s + Number(m.qty), 0);

test('STK-02 / STK-03 / STK-04 / STK-17: store keeper adds an item; bad fields and a duplicate name refused; empty stock is flagged', async ({ page }) => {
  const name = `E2E-Layer-${uniq()}`;
  const restore = await setRole(PHONES.finance, 'store_keeper');
  try {
    await login(page, PHONES.finance);
    await page.goto('/more/stock');
    const sheet = await openAct(page, 'addItem');
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByLabel('Unit').fill('kg');
    await sheet.getByLabel('Reorder level').fill('500');
    await sheet.getByLabel('GST %').fill('5');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toContainText(`Item added · ${name}`);
    expect((await admin.from('item').select('unit,reorder_level,gst_pct').eq('name', name).single()).data).toEqual({ unit: 'kg', reorder_level: 500, gst_pct: 5 });
    // STK-17: 0 on hand is below the reorder level of 500
    await expect(page.locator('tbody tr', { hasText: name }).getByRole('button', { name: 'Reorder' })).toBeVisible();

    const ok = { name: 'E2E-bad', category: 'feed', unit: 'kg' };
    for (const o of [{ gst: 29 }, { gst: -1 }, { unit: '' }, { unit: 'u'.repeat(21) }, { reorder: -1 }]) {
      expect(await tamper(page, 'addItem', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
    }
    expect(await tamper(page, 'addItem', { ...ok, name })).toMatchObject({ ok: false, error: 'This code or name is already used — pick another.' }); // STK-04
    expect((await admin.from('item').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
    expect((await admin.from('item').select('id').eq('name', name)).data).toHaveLength(1);
  } finally { await restore(); }
});

test('STK-07 / STK-09: finance raises a purchase order through the form (GST added); bad quantity, rate and dates refused', async ({ page }) => {
  const it = await newItem(5);
  await login(page, PHONES.finance);
  await page.goto('/more/stock');
  const sheet = await openAct(page, 'raisePO');
  await sheet.getByLabel('Vendor').selectOption(I.vendorId);
  await sheet.getByLabel('Item').selectOption({ label: `${it.name} · kg` });
  await sheet.getByLabel('Quantity').fill('100');
  await sheet.getByLabel('Rate (₹)').fill('10');
  await sheet.getByRole('button', { name: 'Raise PO' }).click();
  await expect(page.locator('.toast')).toContainText('Purchase order PO-');
  const no = ((await page.locator('.toast').textContent()) ?? '').match(/PO-\d+/)![0];
  expect(await po(no)).toMatchObject({ status: 'approved', total: 1050 }); // 100 x 10 + 5% GST
  await expect(page.locator('.item', { hasText: no })).toBeVisible();

  const ok = { vendor_id: I.vendorId, item_id: it.id, qty: 10, rate: 10, expected: plus(3), date: TODAY };
  for (const o of [{ qty: 0 }, { rate: -1 }, { expected: '' }, { expected: plus(-1) }]) { // last: expected before the PO date
    expect(await tamper(page, 'raisePO', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('po_line').select('id').eq('item_id', it.id)).data).toHaveLength(1);
});

test('STK-12 / STK-13 / STK-14 / STK-15: receiving goods matches the PO, can happen once, and refuses bad numbers and expired stock', async ({ page }) => {
  test.setTimeout(90_000);
  const it = await newItem(5);
  const restore = await setRole(PHONES.finance, 'store_keeper');
  try {
    await login(page, PHONES.finance);
    await page.goto('/more/stock');
    const raise = async () => {
      const r = await tamper(page, 'raisePO', { vendor_id: I.vendorId, item_id: it.id, qty: 100, rate: 10, expected: plus(3), date: TODAY });
      expect(r).toMatchObject({ ok: true });
      return (r.msg!.match(/PO-\d+/))![0];
    };
    const first = await raise();
    const second = await raise();
    const A = (await po(first)).id, B = (await po(second)).id;

    // STK-14: nothing is received on bad numbers
    const ok = { po_id: A, qty: 100, bill_amount: 1050, date: TODAY };
    for (const o of [{ qty: 0 }, { bill_amount: 0 }, { lot: 'L'.repeat(41) }]) {
      expect(await tamper(page, 'grnOpen', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
    }
    expect(await onHand(it.id)).toBe(0);

    // STK-15: expired on arrival is refused in the form, a future expiry is accepted (second PO)
    let sheet = await openAct(page, 'grnOpen', { po: B });
    await sheet.getByLabel('Bill amount (₹)').fill('1050');
    await sheet.getByLabel('Expiry').fill(plus(-1));
    await sheet.getByRole('button', { name: 'Post GRN' }).click();
    await expect(sheet.getByRole('alert')).toContainText(INVALID);
    expect(await onHand(it.id)).toBe(0);
    await sheet.getByLabel('Expiry').fill(plus(60));
    await sheet.getByLabel('Lot / batch no.').fill('LOT-E2E');
    await sheet.getByRole('button', { name: 'Post GRN' }).click();
    await expect(page.locator('.toast')).toContainText('3-way match OK');
    expect(await onHand(it.id)).toBe(100);
    await expect(page.getByRole('dialog')).toBeHidden();

    // STK-12: bill equal to the PO total, no variance warning
    sheet = await openAct(page, 'grnOpen', { po: A });
    await sheet.getByLabel('Bill amount (₹)').fill('1050');
    await sheet.getByRole('button', { name: 'Post GRN' }).click();
    await expect(page.locator('.toast').last()).toContainText('GRN posted · stock +100 · bill booked · 3-way match OK');
    await expect.poll(() => onHand(it.id)).toBe(200);
    expect((await po(first)).status).toBe('closed');
    await expect(page.getByRole('dialog')).toBeHidden();

    // STK-13: the same PO cannot be received twice
    expect(await tamper(page, 'grnOpen', ok)).toMatchObject({ ok: false, error: 'purchase order already received' });
    expect(await onHand(it.id)).toBe(200);
  } finally { await restore(); }
});
