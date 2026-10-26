import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 5 (web): a daily log saved with no network waits on the phone and syncs itself when the network is back;
// a dead-bird photo goes to the tenant's private evidence folder (0027) and is sent to AI triage
// (locally there is no ANTHROPIC_API_KEY, so the app must say the AI check isn't set up — not crash).
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TODAY = process.env.APP_TODAY ?? '2026-10-19';
const CODE = 'VKR-B-2026-14';
// 1×1 white JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function login(page: Page) {
  await page.context().clearCookies();
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
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test('daily log saved offline syncs when back online', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  const mark = `offline-e2e-${info.project.name}-${Date.now() % 100000}`;
  const { data: b } = await admin.from('batch').select('id').eq('code', CODE).single();
  const { data: before } = await admin.from('daily_shed_log').select('*').eq('batch_id', b!.id).eq('log_date', TODAY).maybeSingle();
  try {
    await login(page);
    await page.goto(`/log?batch=${CODE}`);
    await expect(page.getByLabel('Mortality')).toBeVisible();
    await context.setOffline(true);
    await page.getByLabel('Mortality').fill('6');
    await page.getByLabel('Remarks').fill(mark);
    await page.getByRole('button', { name: /Save log/ }).click();
    await expect(page.getByText('No network — saved on this phone')).toBeVisible();
    await expect(page.getByTestId('outbox')).toContainText('1 entries saved offline');
    expect((await admin.from('daily_shed_log').select('id').eq('remarks', mark)).data).toHaveLength(0); // nothing sent yet

    await context.setOffline(false);
    await expect(page.getByText('1 offline entries synced')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('outbox')).toHaveCount(0);
    await expect.poll(async () => (await admin.from('daily_shed_log').select('mortality').eq('remarks', mark).maybeSingle()).data?.mortality).toBe(6);
  } finally {
    await context.setOffline(false);
    if (before) await admin.from('daily_shed_log').update({ mortality: before.mortality, culls: before.culls, avg_weight_g: before.avg_weight_g, feed_kg: before.feed_kg, water_litres: before.water_litres, remarks: before.remarks }).eq('id', before.id);
    else await admin.from('daily_shed_log').delete().eq('batch_id', b!.id).eq('log_date', TODAY);
  }
});

test('dead-bird photo is stored privately and sent to AI triage', async ({ page }) => {
  test.setTimeout(120_000);
  const { data: b } = await admin.from('batch').select('id,tenant_id').eq('code', CODE).single();
  const since = new Date(Date.now() - 1000).toISOString();
  try {
    await login(page);
    await page.goto(`/log?batch=${CODE}`);
    await page.getByTestId('photo-dead').locator('input[type=file]').setInputFiles({ name: 'dead.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(page.getByText(/AI check is not set up yet|AI: /)).toBeVisible({ timeout: 30_000 });
    const { data: m } = await admin.from('media').select('storage_path').eq('entity_id', b!.id).gte('created_at', since);
    expect(m).toHaveLength(1);
    expect(m![0].storage_path.startsWith(`${b!.tenant_id}/${b!.id}/`)).toBe(true); // tenant folder
  } finally {
    const { data: m } = await admin.from('media').select('id,storage_path').eq('entity_id', b!.id).gte('created_at', since);
    if (m?.length) {
      await admin.storage.from('evidence').remove(m.map((x) => x.storage_path));
      await admin.from('media').delete().in('id', m.map((x) => x.id));
    }
  }
});
