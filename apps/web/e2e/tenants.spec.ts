import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Platform console: finance/admin change plan + status; a suspended farm sees a lock screen. Restores after.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const KS = 'b146bf5d-6213-556e-8e71-8d4c156ad36d';

async function otp(page: Page, path: string, mobile: string, lands: RegExp) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(lands, { timeout: 20_000 });
}

test('platform suspends a tenant → its owner is locked out; add tenant opens the application form', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'console flow; phone layout covered by screens spec');
  const { data: before } = await admin.from('tenant').select('plan,status').eq('id', KS).single();
  try {
    await otp(page, '/platform/login', '9000000000', /\/admin$/);
    await expect(page.locator('.topbar .sub')).toContainText('Super admin');
    const row = page.locator('.item', { hasText: 'KS Farms' });
    await row.getByRole('button', { name: 'Manage' }).click();
    await row.getByLabel('Status').selectOption('suspended');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toContainText('KS Farms updated');
    expect((await admin.from('tenant').select('status').eq('id', KS).single()).data!.status).toBe('suspended');

    await page.getByRole('link', { name: '+ Add tenant' }).click();
    await expect(page).toHaveURL(/\/apply$/);

    await otp(page, '/login', '9440012121', /\/home$/);
    await expect(page.getByRole('alert').filter({ hasText: 'Account suspended' })).toBeVisible();
  } finally {
    await admin.from('tenant').update(before!).eq('id', KS);
  }
});
