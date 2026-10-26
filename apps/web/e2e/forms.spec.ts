import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Real writes through the forms. Each test removes what it created so the suite can re-run.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TODAY = process.env.APP_TODAY ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function login(page: Page) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', '+91 98490 12345');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9849012345');
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
  for (const t of ['vaccination_schedule', 'mortality_event', 'bill', 'invoice', 'vet_visit']) await admin.from(t).delete().eq('batch_id', b.id);
  const { data: logs } = await admin.from('daily_shed_log').select('id').eq('batch_id', b.id);
  if (logs?.length) await admin.from('egg_production').delete().in('daily_log_id', logs.map((l) => l.id));
  await admin.from('daily_shed_log').delete().eq('batch_id', b.id);
  await admin.from('batch').delete().eq('id', b.id);
}

test('place a batch in a free shed, then record mortality on it', async ({ page }, info) => {
  test.setTimeout(60_000); // several saves, each re-rendering pages on the dev server
  const code = `E2E-${info.project.name}-${Date.now() % 100000}`;
  await login(page);
  try {
    await page.goto('/farm');
    await page.locator('.card').getByRole('button', { name: /Shed B/ }).click(); // empty shed (farm card) → place batch form
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Place a batch')).toBeVisible();
    await sheet.getByLabel('Batch code').fill(code);
    await sheet.getByLabel('Chicks placed').fill('5000');
    await sheet.getByLabel('Rate per chick (₹)').fill('38');
    await sheet.getByRole('button', { name: 'Place batch' }).click();
    // the toast lives 2.8 s and fires before navigating — check it first, not after the (slow, dev) batch page render
    await expect(page.locator('.toast')).toContainText('vaccination schedule ready', { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`/farm/batch/${code}$`), { timeout: 20_000 }); // save + first render of the batch page (dev)
    await expect(page.locator('.h2', { hasText: code })).toBeVisible();
    await expect(page.locator('.eyebrow', { hasText: 'Vaccination schedule' })).toBeVisible();
    await expect(page.locator('.tile', { hasText: 'Birds' }).locator('.val')).toHaveText('5,000');

    await page.locator('.quick button', { hasText: 'Mortality' }).click();
    await sheet.getByLabel('Birds dead').fill('25');
    await sheet.getByRole('button', { name: 'Record' }).click();
    await expect(page.locator('.toast')).toContainText('25 deaths recorded');
    await expect(page.locator('.tile', { hasText: 'Birds' }).locator('.val')).toHaveText('4,975');
  } finally {
    await dropBatch(code);
  }
});

test('daily log saves and shows in the batch table', async ({ page }) => {
  await login(page);
  const { data: b } = await admin.from('batch').select('id').eq('code', 'VKR-B-2026-14').single();
  const { data: before } = await admin.from('daily_shed_log').select('*').eq('batch_id', b!.id).eq('log_date', TODAY).maybeSingle();
  try {
    await page.goto('/log?batch=VKR-B-2026-14');
    await page.getByLabel('Mortality').fill('7');
    await page.getByLabel('Avg weight (g) · 50 birds').fill('1612');
    await page.getByRole('button', { name: /Save log/ }).click();
    await expect(page).toHaveURL(/\/farm\/batch\/VKR-B-2026-14$/, { timeout: 20_000 }); // save + batch page render (dev)
    await expect(page.locator('tbody tr').first()).toContainText('1612');
  } finally {
    if (before) {
      await admin.from('daily_shed_log').update({ mortality: before.mortality, culls: before.culls, avg_weight_g: before.avg_weight_g, feed_kg: before.feed_kg, remarks: before.remarks }).eq('id', before.id);
    } else {
      await admin.from('daily_shed_log').delete().eq('batch_id', b!.id).eq('log_date', TODAY);
    }
  }
});

test('sale on credit appears in receivables, receiving it in full marks it paid', async ({ page }) => {
  await login(page);
  let invoiceNo = '';
  try {
    await page.goto('/money');
    await page.locator('.quick button', { hasText: 'New sale' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Quantity').fill('1000');
    await sheet.getByLabel('Rate (₹ per unit)').fill('6');
    await sheet.getByRole('button', { name: 'Raise invoice' }).click();
    await expect(page).toHaveURL(/view=ar/);
    await expect(page.locator('.toast')).toContainText('INV');
    invoiceNo = ((await page.locator('.toast').textContent()) ?? '').match(/INV\d+/)?.[0] ?? '';
    const row = page.locator('.item', { hasText: invoiceNo });
    await expect(row).toContainText('₹6,000');
    await row.getByRole('button', { name: 'Receive' }).click();
    await sheet.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.locator('.toast')).toContainText('₹6,000');
    await expect(page.locator('.item', { hasText: invoiceNo })).toHaveCount(0); // paid → leaves the outstanding list
    const { data: inv } = await admin.from('invoice').select('status,paid').eq('invoice_no', invoiceNo).single();
    expect(inv).toEqual({ status: 'paid', paid: 6000 });
  } finally {
    if (invoiceNo) {
      const { data: inv } = await admin.from('invoice').select('id').eq('invoice_no', invoiceNo).maybeSingle();
      if (inv) { await admin.from('payment').delete().eq('ref_id', inv.id); await admin.from('invoice').delete().eq('id', inv.id); }
    }
  }
});

test('attendance: tapping H marks the worker half-day today', async ({ page }) => {
  await login(page);
  const { data: w } = await admin.from('worker').select('id,name').order('name').limit(1).single();
  const { data: before } = await admin.from('attendance').select('status').eq('worker_id', w!.id).eq('att_date', TODAY).maybeSingle();
  try {
    await page.goto('/more/people');
    const row = page.locator('.item', { hasText: w!.name });
    await row.getByRole('button', { name: 'H', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Attendance saved');
    await expect(row.locator('button.on.H')).toBeVisible();
  } finally {
    if (before) await admin.from('attendance').update({ status: before.status }).eq('worker_id', w!.id).eq('att_date', TODAY);
    else await admin.from('attendance').delete().eq('worker_id', w!.id).eq('att_date', TODAY);
  }
});

test('server refuses actions outside the role (supervisor cannot place a batch)', async ({ page }) => {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', '+91 90000 33445');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9000033445');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 }); // first hit compiles the page in dev
  await page.goto('/farm');
  // the button is hidden for supervisors; open the form the way a tampered page would, the server must still refuse
  await expect(page.locator('.card').getByRole('button', { name: /Shed B/ })).toHaveCount(0); // the 3D viewer's shed list is view-only
  const sheet = page.getByRole('dialog');
  await expect(async () => { // the form host listens only once the page has hydrated
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('hp-act', { detail: { act: 'addBatch', ctx: {} } })));
    await expect(sheet.getByLabel('Batch code')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await sheet.getByLabel('Batch code').fill('E2E-FORBIDDEN');
  await sheet.getByLabel('Chicks placed').fill('100');
  await sheet.getByRole('button', { name: 'Place batch' }).click();
  await expect(sheet.locator('[role=alert]')).toContainText('Your role cannot do this');
  const { data } = await admin.from('batch').select('id').eq('code', 'E2E-FORBIDDEN');
  expect(data).toEqual([]);
});
