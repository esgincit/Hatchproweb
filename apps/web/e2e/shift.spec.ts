import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Labour mode (Phase 5): big-button shift entries ADD to the day's log (add_shift_log, 0028) without touching the
// supervisor's temperature/weight; an entry saved offline syncs once when the network is back.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TODAY = process.env.APP_TODAY ?? '2026-10-19';
const CODE = 'VKR-B-2026-14';

async function login(page: Page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', '+91 90000 33445');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9000033445'); // shed supervisor
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test('shift entries add to the day, also offline', async ({ page, context }) => {
  test.setTimeout(150_000);
  const { data: b } = await admin.from('batch').select('id').eq('code', CODE).single();
  const day = () => admin.from('daily_shed_log').select('*').eq('batch_id', b!.id).eq('log_date', TODAY).maybeSingle().then((r) => r.data);
  const before = await day();
  try {
    await login(page);
    await page.goto(`/log?batch=${CODE}&mode=shift`);
    const form = page.getByTestId('shift-form');
    await form.getByRole('radio', { name: 'Morning' }).click();
    for (let i = 0; i < 3; i++) await form.getByRole('button', { name: 'Dead birds +' }).click();
    await form.getByRole('button', { name: 'Culls +' }).click();
    await form.getByLabel('Feed bags (50 kg)', { exact: true }).fill('4');
    await form.getByRole('button', { name: 'Save Morning entry' }).click();
    await expect(page.getByText('Morning entry saved')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await day())?.mortality).toBe((before?.mortality ?? 0) + 3);
    const mid = await day();
    expect(mid!.culls).toBe((before?.culls ?? 0) + 1);
    expect(Number(mid!.feed_kg)).toBe(Number(before?.feed_kg ?? 0) + 200);
    expect(mid!.temp_max_c).toEqual(before?.temp_max_c ?? null); // supervisor's reading untouched

    await context.setOffline(true);
    await form.getByRole('radio', { name: 'Evening' }).click();
    for (let i = 0; i < 2; i++) await form.getByRole('button', { name: 'Dead birds +' }).click();
    await form.getByRole('button', { name: 'Save Evening entry' }).click();
    await expect(page.getByText('No network — saved on this phone')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('1 offline entries synced')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await day())?.mortality).toBe((before?.mortality ?? 0) + 5);
  } finally {
    await context.setOffline(false);
    if (before) await admin.from('daily_shed_log').update({ mortality: before.mortality, culls: before.culls, feed_kg: before.feed_kg, water_litres: before.water_litres, remarks: before.remarks }).eq('id', before.id);
    else await admin.from('daily_shed_log').delete().eq('batch_id', b!.id).eq('log_date', TODAY);
  }
});
