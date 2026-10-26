import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { settle } from '../lib/settlement';

// Phase 7 contract broiler: owner adds integrator terms, links a batch, settles at harvest; the growing-charge invoice
// equals settle() on the batch's own placed / dead / feed numbers.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CODE = 'KS-B-2026-21';

async function login(page: Page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', '+91 94400 12121');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9440012121'); // KS Farms owner
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test('contract terms → link batch → settle with integrator', async ({ page }, info) => {
  test.setTimeout(150_000);
  const name = `E2E terms ${info.project.name} ${Date.now() % 100000}`;
  const { data: b } = await admin.from('batch').select('id,doc_count').eq('code', CODE).single();
  try {
    await login(page);
    await page.goto('/more/customers');
    await page.getByRole('button', { name: '+ Contract' }).click();
    let sheet = page.getByRole('dialog', { name: 'Contract terms' });
    await sheet.getByLabel('Integrator').selectOption({ label: 'SKR Integrators Pvt. Ltd.' });
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByLabel('Base rate (₹/kg)').fill('6.5');
    await sheet.getByLabel('Allowed mortality %').fill('5');
    await sheet.getByLabel('Charge per extra dead bird (₹)').fill('20');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Contract saved · ${name}`)).toBeVisible({ timeout: 20_000 });

    await page.goto(`/farm/batch/${CODE}`);
    await page.getByRole('button', { name: 'Link to a contract (integrator)' }).click();
    sheet = page.getByRole('dialog', { name: 'Link batch to a contract' });
    await sheet.getByLabel('Contract').selectOption({ label: name });
    await sheet.getByRole('button', { name: 'Save' }).click();
    const card = page.getByTestId('contract-card');
    await expect(card).toContainText('Estimate if lifted today', { timeout: 20_000 });

    await card.getByRole('button', { name: 'Settle with integrator' }).click();
    sheet = page.getByRole('dialog', { name: 'Settle with integrator' });
    // realistic harvest for 25,500 placed / ~65,000 kg feed: FCR ≈ 1.72 → ₹6.30/kg (a tiny lift would hit the ₹0 floor → refused)
    await sheet.getByLabel('Birds lifted').fill('24300');
    await sheet.getByLabel('Live weight lifted (kg)').fill('38000');
    await sheet.getByRole('button', { name: 'Settle & invoice' }).click();
    await expect(page.getByText(/Settled · invoice/)).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Settled', { timeout: 20_000 });

    const { data: k } = await admin.from('v_batch_kpi').select('cum_mortality,feed_kg').eq('batch_id', b!.id).single();
    const { data: c } = await admin.from('contract').select('*').eq('name', name).single();
    const want = settle(
      { base_rate: +c!.base_rate, std_fcr: +c!.std_fcr, fcr_bonus: +c!.fcr_bonus, fcr_penalty: +c!.fcr_penalty, min_rate: +c!.min_rate, allowed_mort_pct: +c!.allowed_mort_pct, mort_penalty: +c!.mort_penalty },
      { placed: b!.doc_count, dead: +k!.cum_mortality, liftedBirds: 24300, liftedKg: 38000, feedKg: +k!.feed_kg })!;
    expect(want.net).toBeGreaterThan(0);
    const { data: s } = await admin.from('contract_settlement').select('net,invoice_no').eq('batch_id', b!.id).single();
    expect(+s!.net).toBe(want.net);
    const { data: inv } = await admin.from('invoice').select('total,product').eq('invoice_no', s!.invoice_no!).single();
    expect([+inv!.total, inv!.product]).toEqual([want.net, 'gc']);
  } finally {
    const { data: s } = await admin.from('contract_settlement').select('invoice_no').eq('batch_id', b!.id).maybeSingle();
    await admin.from('contract_settlement').delete().eq('batch_id', b!.id);
    if (s?.invoice_no) await admin.from('invoice').delete().eq('invoice_no', s.invoice_no);
    await admin.from('batch').update({ contract_id: null }).eq('id', b!.id);
    await admin.from('contract').delete().eq('name', name);
  }
});
