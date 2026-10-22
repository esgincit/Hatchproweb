import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Batch lifecycle, equipment, stock and compliance flows through the real forms. Each test cleans up.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function login(page: Page, phone = '9849012345', profilePhone = '+91 98490 12345') {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', profilePhone);
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 }); // first hit compiles the page in dev
}

async function dropBatch(code: string) {
  const { data: b } = await admin.from('batch').select('id').eq('code', code).maybeSingle();
  if (!b) return;
  const { data: invs } = await admin.from('invoice').select('id').eq('batch_id', b.id);
  if (invs?.length) await admin.from('payment').delete().in('ref_id', invs.map((i) => i.id));
  for (const t of ['vaccination_schedule', 'mortality_event', 'bill', 'invoice', 'vet_visit']) await admin.from(t).delete().eq('batch_id', b.id);
  await admin.from('daily_shed_log').delete().eq('batch_id', b.id);
  await admin.from('batch').delete().eq('id', b.id);
}

test('batch lifecycle: place → change stage → close with lifting invoice', async ({ page }, info) => {
  const code = `E2E-L-${info.project.name}-${Date.now() % 100000}`;
  await login(page);
  try {
    await page.goto('/farm');
    await page.getByRole('button', { name: /Shed B/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Batch code').fill(code);
    await sheet.getByLabel('Chicks placed').fill('2000');
    await sheet.getByRole('button', { name: 'Place batch' }).click();
    await expect(page).toHaveURL(new RegExp(`/farm/batch/${code}$`));

    await page.locator('.quick button', { hasText: 'State' }).click();
    await sheet.getByLabel('Stage').selectOption('growing');
    await sheet.getByRole('button', { name: 'Update stage' }).click();
    await expect(page.locator('.tile', { hasText: 'Age' })).toContainText('Growing');

    await page.getByRole('button', { name: /Close batch/ }).click();
    await sheet.getByLabel('Buyer (optional)').selectOption({ index: 1 });
    await sheet.getByLabel('Total weight (kg)').fill('4200');
    await sheet.getByLabel('Rate (₹/kg)').fill('110');
    await sheet.getByRole('button', { name: 'Close batch' }).click();
    await expect(page.locator('.toast')).toContainText(/invoice INV\d+ raised/);
    await expect(page.locator('.pill', { hasText: 'Closed' }).first()).toBeVisible();
    const { data: b } = await admin.from('batch').select('id,state').eq('code', code).single();
    const { data: inv } = await admin.from('invoice').select('total,product').eq('batch_id', b!.id).single();
    expect(b!.state).toBe('closed');
    expect(inv).toEqual({ total: 462000, product: 'bird' });
  } finally {
    await dropBatch(code);
  }
});

test('equipment: high-priority issue alerts the owner; closing with a cost books a bill', async ({ page }) => {
  await login(page);
  const { data: asset } = await admin.from('asset').select('id,name,status').order('name').limit(1).single();
  let ticketId = '';
  try {
    await page.goto('/more/equipment');
    const row = page.locator('.item', { hasText: asset!.name }).filter({ has: page.getByRole('button', { name: 'Report issue' }) });
    await row.getByRole('button', { name: 'Report issue' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('What is wrong?').fill('E2E fan bearing noise');
    await sheet.getByLabel('Priority').selectOption('high');
    await sheet.getByRole('button', { name: 'Report' }).click();
    await expect(page.locator('.toast')).toContainText('owner alerted');
    const { data: tk } = await admin.from('maintenance_ticket').select('id').eq('issue', 'E2E fan bearing noise').single();
    ticketId = tk!.id;
    const { count } = await admin.from('notification').select('id', { count: 'exact', head: true }).eq('entity_id', ticketId).eq('severity', 'critical');
    expect(count).toBe(1);

    const open = page.locator('.item', { hasText: 'E2E fan bearing noise' });
    await open.getByRole('button', { name: 'Close' }).click();
    await sheet.getByLabel('Repair cost (₹)').fill('4321');
    await sheet.getByLabel('Paid to (optional)').selectOption({ index: 1 });
    await sheet.getByRole('button', { name: 'Close ticket' }).click();
    await expect(page.locator('.toast')).toContainText('₹4,321 equipment bill booked');
    const { data: bill } = await admin.from('bill').select('id,category').eq('total', 4321).single();
    expect(bill!.category).toBe('equipment');
    await admin.from('bill').delete().eq('id', bill!.id);
  } finally {
    if (ticketId) {
      await admin.from('notification').delete().eq('entity_id', ticketId);
      await admin.from('maintenance_ticket').delete().eq('id', ticketId);
    }
    await admin.from('asset').update({ status: asset!.status }).eq('id', asset!.id);
  }
});

test('stock: raise a PO, receive it with a bill above the PO → variance flagged, stock up', async ({ page }) => {
  await login(page);
  let poNo = '';
  try {
    await page.goto('/more/stock');
    await page.getByRole('button', { name: '+ PO' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Quantity').fill('77');
    await sheet.getByLabel('Rate (₹)').fill('100');
    await sheet.getByRole('button', { name: 'Raise PO' }).click();
    await expect(page.locator('.toast')).toContainText(/PO-\d+/);
    poNo = ((await page.locator('.toast').textContent()) ?? '').match(/PO-\d+/)?.[0] ?? '';
    const { data: po } = await admin.from('purchase_order').select('id,total,po_line(item_id)').eq('po_no', poNo).single();
    const itemId = (po!.po_line as { item_id: string }[])[0].item_id;
    const { data: before } = await admin.from('v_stock_balance').select('qty').eq('item_id', itemId);
    const qtyBefore = (before ?? []).reduce((a, r) => a + Number(r.qty), 0);

    await page.locator('.item', { hasText: poNo }).getByRole('button', { name: 'Receive' }).click();
    await sheet.getByLabel('Bill amount (₹)').fill(String(Math.round(Number(po!.total) * 1.06)));
    await sheet.getByRole('button', { name: 'Post GRN' }).click();
    await expect(page.locator('.toast')).toContainText('bill differs from PO');
    const { data: after } = await admin.from('v_stock_balance').select('qty').eq('item_id', itemId);
    expect((after ?? []).reduce((a, r) => a + Number(r.qty), 0)).toBe(qtyBefore + 77);
    await expect(page.locator('.item', { hasText: poNo })).toContainText('Received');
  } finally {
    if (poNo) {
      const { data: po } = await admin.from('purchase_order').select('id').eq('po_no', poNo).maybeSingle();
      if (po) {
        await admin.from('stock_movement').delete().eq('ref_id', po.id);
        await admin.from('bill').delete().eq('po_id', po.id);
        await admin.from('po_line').delete().eq('po_id', po.id);
        await admin.from('purchase_order').delete().eq('id', po.id);
      }
    }
  }
});

test('compliance: a document expiring soon shows a days-left pill', async ({ page }) => {
  await login(page);
  try {
    await page.goto('/more/docs');
    await page.getByRole('button', { name: '+ Document' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Document').fill('E2E Fire NOC');
    const soon = new Date(Date.parse((process.env.APP_TODAY ?? new Date().toISOString().slice(0, 10)) + 'T00:00:00Z') + 20 * 864e5).toISOString().slice(0, 10);
    await sheet.getByLabel('Expires on').fill(soon);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.item', { hasText: 'E2E Fire NOC' })).toContainText('20 days');
  } finally {
    await admin.from('tenant_document').delete().eq('name', 'E2E Fire NOC');
  }
});

test('roles: a supervisor does not see owner-only buttons', async ({ page }) => {
  await login(page, '9000033445', '+91 90000 33445');
  await page.goto('/farm/batch/VKR-B-2026-14');
  await expect(page.locator('.quick button', { hasText: 'Mortality' })).toBeVisible(); // allowed
  await expect(page.getByRole('button', { name: /Close batch/ })).toHaveCount(0);     // owner/manager only
  await expect(page.locator('.quick button', { hasText: 'State' })).toHaveCount(0);
});

test('exports download real files; a supervisor is refused money exports', async ({ page }) => {
  await login(page);
  for (const [kind, type, must] of [
    ['tally', 'application/xml', '<VOUCHER VCHTYPE="Sales"'], ['gstr1', 'application/json', '"invoices"'],
    ['statements', 'text/csv', 'Receivable'], ['register', 'text/csv', 'Payable days'], ['pnl', 'text/csv', 'VKR-B-2026-14'],
  ] as const) {
    const r = await page.request.get(`/api/export/${kind}`);
    expect(r.status(), kind).toBe(200);
    expect(r.headers()['content-type']).toContain(type);
    expect(r.headers()['content-disposition']).toContain('attachment');
    expect(await r.text()).toContain(must);
  }
  await page.context().clearCookies();
  await login(page, '9000033445', '+91 90000 33445');
  expect((await page.request.get('/api/export/tally')).status()).toBe(403);
  expect((await page.request.get('/api/export/register')).status()).toBe(200); // supervisors keep the attendance register
});

test('payment over ₹50,000 by finance waits for the owner, who approves it', async ({ page, browser }, info) => {
  const no = `E2E-AP-${info.project.name}-${Date.now() % 100000}`;
  const { data: v } = await admin.from('vendor').select('id,tenant_id,name').limit(1).single();
  const { data: f } = await admin.from('farm').select('id').eq('tenant_id', v!.tenant_id).limit(1).single();
  const { data: bill } = await admin.from('bill').insert({ tenant_id: v!.tenant_id, farm_id: f!.id, vendor_id: v!.id, bill_no: no, bill_date: '2026-10-19', due_date: '2026-11-19', category: 'feed', total: 60000 }).select('id').single();
  try {
    await login(page, '9849022334', '+91 98490 22334'); // finance
    await page.goto('/money?view=ap');
    await page.locator('.item', { hasText: no }).getByRole('button', { name: 'Pay' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('.toast')).toContainText('sent to the owner');
    expect((await admin.from('bill').select('paid').eq('id', bill!.id).single()).data!.paid).toBe(0);

    const owner = await (await browser.newContext()).newPage();
    await login(owner);
    await owner.goto('/money?view=ap');
    await owner.locator('.stripe .item', { hasText: no }).getByRole('button', { name: 'Approve' }).click();
    await expect(owner.locator('.toast')).toContainText('approved');
    expect((await admin.from('bill').select('status,paid').eq('id', bill!.id).single()).data).toEqual({ status: 'paid', paid: 60000 });
  } finally {
    await admin.from('payment').delete().eq('ref_id', bill!.id);
    await admin.from('payment_approval').delete().eq('bill_id', bill!.id);
    await admin.from('bill').delete().eq('id', bill!.id);
  }
});
