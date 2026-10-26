import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 11 platform console: pipeline / usage / sync-health cards for the platform admin, and the read-only
// support view of a tenant, which records an audit row before showing anything.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test('platform console sections and audited support view', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'console is a desktop tool; phone layout covered by screens.spec');
  test.setTimeout(120_000);
  const since = new Date(Date.now() - 1000).toISOString();
  const { data: vkr } = await admin.from('tenant').select('id').eq('name', 'VKR Poultry Farms').single();
  try {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await page.goto('/platform/login');
    await page.getByLabel('Mobile number').fill('9000000000');
    await page.getByRole('button', { name: 'Send OTP' }).click();
    const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
    await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
    if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
    await page.getByLabel('6-digit code').fill('123456');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });

    for (const id of ['pipeline', 'usage', 'sync-health']) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('usage')).toContainText('VKR Poultry Farms');

    await page.locator('.item', { hasText: 'VKR Poultry Farms' }).getByRole('link', { name: 'View (logged)' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/tenant/${vkr!.id}$`));
    await expect(page.getByText('Read-only support view')).toBeVisible();
    await expect(page.getByTestId('audit')).toContainText('support.view');
    const { data: rows } = await admin.from('audit_log').select('user_id').eq('tenant_id', vkr!.id).eq('action', 'support.view').gte('created_at', since);
    expect(rows?.length).toBeGreaterThan(0);
    expect(rows![0].user_id).toBeTruthy();
  } finally {
    await admin.from('audit_log').delete().eq('action', 'support.view').gte('created_at', since);
  }
});
