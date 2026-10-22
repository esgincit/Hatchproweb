import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 9 exit test: live 3D farm renders, a shed opens to expected-vs-actual, and logged mortality shows up in < 5 s.
// real GPU: software WebGL (SwiftShader) starves the main thread and delays the refresh ~15 s
test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] } });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

test('live 3D farm: open a shed, mortality updates live', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', '+91 98490 12345');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9849012345');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/home$/);

  await page.goto('/farm');
  await expect(page.getByTestId('farm3d').locator('canvas')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: info.outputPath('farm3d-overview.png') });

  await page.getByRole('button', { name: /Shed A/ }).first().click();
  const panel = page.getByTestId('farm3d-panel');
  await expect(panel).toContainText('VKR-B-2026-14');
  await expect(panel).toContainText('expected');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: info.outputPath('farm3d-shed.png') });

  const { data: b } = await admin.from('batch').select('id').eq('code', 'VKR-B-2026-14').single();
  const { data: l } = await admin.from('daily_shed_log').select('id,mortality').eq('batch_id', b!.id).order('log_date', { ascending: false }).limit(1).single();
  try {
    await admin.from('daily_shed_log').update({ mortality: l!.mortality + 5 }).eq('id', l!.id);
    await expect(panel).toContainText(`${l!.mortality + 5} today`, { timeout: 5_000 });
  } finally {
    await admin.from('daily_shed_log').update({ mortality: l!.mortality }).eq('id', l!.id);
  }
});
