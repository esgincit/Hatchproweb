import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// More › People › Wages: owner saves a worker's bank details, then the salary bank file (NEFT CSV) carries them.
// Supervisors never get the bank file (account numbers: worker_bank RLS, 0022).
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function login(page: Page, phone: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test('owner adds bank details and downloads the salary bank file', async ({ page }) => {
  test.setTimeout(120_000);
  const account = String(100000000000 + (Date.now() % 1e9));
  let workerId = '';
  try {
    await login(page, '9849012345');
    await page.goto('/more/people?tab=wages');
    await page.getByRole('button', { name: /Bank details/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Worker bank details' });
    workerId = await sheet.getByLabel('Worker').inputValue();
    await sheet.getByLabel('Account number').fill(account);
    await sheet.getByLabel('IFSC').fill('sbin0001234'); // stored upper-case
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Bank details saved')).toBeVisible({ timeout: 20_000 });

    const r = await page.request.get('/api/export/bankfile');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-disposition']).toContain('salary-neft');
    const body = await r.text();
    expect(body).toContain('Beneficiary Name,Account Number,IFSC,Amount,Narration');
    expect(body).toContain(`,${account},SBIN0001234,`);

    await login(page, '9000033445'); // supervisor
    expect((await page.request.get('/api/export/bankfile')).status()).toBe(403);
  } finally {
    if (workerId) await admin.from('worker_bank').delete().eq('worker_id', workerId);
  }
});
