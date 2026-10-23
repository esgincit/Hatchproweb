import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Money › Receivables → WhatsApp reminders: per-customer rows, message in the chosen language, Send opens wa.me
// and logs the reminder (reminder_log), the row then reads "Reminded today".
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CUSTOMER = 'Hyderabad Egg Traders (Begum Bazar)';

test('owner sends a WhatsApp payment reminder and it is logged', async ({ page, context }, info) => {
  test.setTimeout(90_000);
  const { data: cust } = await admin.from('customer').select('id').eq('name', CUSTOMER).single();
  const since = new Date().toISOString();
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'layer' }).eq('phone', '+91 98490 12345');
  await context.route('https://wa.me/**', (r) => r.fulfill({ body: 'whatsapp' })); // never leave the machine
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

    await page.goto('/money?view=ar');
    await page.getByRole('button', { name: /WhatsApp reminders for/ }).click();
    const sheet = page.getByRole('dialog', { name: 'WhatsApp reminders' });
    const row = sheet.getByTestId('remind-row').filter({ hasText: CUSTOMER });
    await expect(row).toContainText('overdue');
    await sheet.getByLabel('Message language').selectOption('te');
    const link = row.getByRole('link', { name: 'Send on WhatsApp' });
    const text = async () => decodeURIComponent(((await link.getAttribute('href')) ?? '').split('text=')[1] ?? '');
    await expect.poll(text).toContain('నమస్తే'); // Telugu template once the language switch re-renders
    expect(await link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919885030001\?text=/);
    expect(await text()).toContain('VKR Poultry Farms');
    await page.screenshot({ path: info.outputPath('remind-sheet.png') });

    const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
    expect(popup.url()).toContain('wa.me/919885030001');
    await expect(page.locator('.toast')).toContainText('Reminder logged');
    await expect(row).toContainText('Reminded today');
    const { data: logs } = await admin.from('reminder_log').select('lang,channel,amount,invoice_ids').eq('customer_id', cust!.id).gte('sent_at', since);
    expect(logs).toHaveLength(1);
    expect(logs![0]).toMatchObject({ lang: 'te', channel: 'wa_link' });
    expect(logs![0].invoice_ids.length).toBeGreaterThan(0);
  } finally {
    await admin.from('reminder_log').delete().eq('customer_id', cust!.id).gte('sent_at', since);
  }
});
