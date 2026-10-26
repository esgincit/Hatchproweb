import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 10: a new notification row (as daily-alerts writes) pops as a toast while the app is open, and the
// Notifications screen offers "turn on alerts on this phone". (Real Web Push delivery needs a browser push
// service — headless Chromium has none — so subscribing is checked by hand; see docs/QA.md.)
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test('a new alert pops up live and push can be turned on', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const key = `e2e:${info.project.name}:${Date.now()}`;
  const title = `E2E heat stress ${info.project.name} ${Date.now() % 100000}`;
  await context.clearCookies();
  await context.grantPermissions(['notifications']); // headless phone emulation defaults to "denied"
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  try {
    await page.goto('/login');
    await page.getByLabel('Mobile number').fill('9849012345');
    await page.getByRole('button', { name: 'Send OTP' }).click();
    const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
    await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
    if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
    await expect(page.locator('body[data-alerts="live"]')).toHaveCount(1, { timeout: 30_000 }); // realtime joined

    const { data: t } = await admin.from('tenant').select('id').eq('name', 'VKR Poultry Farms').single();
    const { error } = await admin.from('notification').insert({ tenant_id: t!.id, kind: 'alert', severity: 'critical', title, dedupe_key: key });
    expect(error).toBeNull();
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });

    await page.goto('/more/notifications');
    await expect(page.getByRole('button', { name: /Turn on/ })).toBeVisible();
  } finally {
    await admin.from('notification').delete().eq('dedupe_key', key);
  }
});
