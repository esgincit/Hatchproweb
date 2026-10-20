import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Every ported demo screen renders real data, has its demo heading, and never scrolls sideways.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const SCREENS: [string, RegExp][] = [
  ['/home', /Good morning/], ['/farm', /Farms & sheds/], ['/farm/batch/VKR-L-2026-02', /VKR-L-2026-02/], ['/log', /Daily log/],
  ['/money', /^Money$/], ['/money?view=ap', /Payables/], ['/money?view=ar', /Receivables/], ['/money?view=pnl', /Batch P&L/], ['/money?view=rates', /Market rates/],
  ['/more', /^More$/], ['/more/people', /Attendance/], ['/more/people?tab=month', /register/], ['/more/people?tab=wages', /Wages/],
  ['/more/equipment', /Equipment/], ['/more/stock', /Stock/], ['/more/vendors', /Vendors/], ['/more/customers', /Customers/],
  ['/more/health', /Health/], ['/more/users', /Users/], ['/more/docs', /Compliance/], ['/more/reports', /Reports/], ['/more/notifications', /Notifications/],
];

test('all tenant screens render with data and no horizontal overflow', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]); // seed users prefer Telugu
  await admin.from('app_user').update({ active_farm_type: 'layer' }).eq('phone', '+91 98490 12345');
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9849012345');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('Birds alive')).toBeVisible();

  for (const [path, heading] of SCREENS) {
    await page.goto(path);
    await expect(page.locator('.h2').filter({ hasText: heading }).first(), path).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} overflows`).toBe(true);
    // every card fits the column (wide tables scroll inside)
    expect(await page.evaluate(() => [...document.querySelectorAll('.wrap > .card')].every((c) => c.getBoundingClientRect().width <= (c.parentElement as HTMLElement).getBoundingClientRect().width + 1)), `${path} card too wide`).toBe(true);
  }
});
