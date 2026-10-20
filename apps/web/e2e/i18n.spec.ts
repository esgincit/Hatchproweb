import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// One translated anchor per locale, checked on Home (tab label) and More (menu title).
const LOCALES: [code: string, home: string, more: string][] = [
  ['en', 'Home', 'More'], ['te', 'హోమ్', 'మరిన్ని'], ['hi', 'होम', 'और'], ['ta', 'முகப்பு', 'மேலும்'], ['kn', 'ಮುಖಪುಟ', 'ಇನ್ನಷ್ಟು'],
];

test('profile language applies at login, picker switches all five languages', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.clearCookies(); // no device choice → profile language (seed owner = Telugu)
  await admin.from('app_user').update({ active_farm_type: 'layer', language: 'te' }).eq('phone', '+91 98490 12345');
  await page.goto('/login');
  await page.locator('#phone').fill('9849012345');
  await page.locator('form button.btn').first().click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.locator('#otp').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.locator('form button.btn').first().click(); }
  await page.locator('#otp').fill('123456');
  await page.locator('form button.btn').first().click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'te');
  await expect(page.locator('.tab.active')).toContainText('హోమ్');

  for (const [code, home, more] of LOCALES) {
    await page.goto('/more');
    await page.locator('#lang').selectOption(code);
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.locator('.h2').first()).toHaveText(more);
    await page.goto('/home');
    await expect(page.locator('.tab.active')).toContainText(home);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${code} overflows`).toBe(true);
  }
  // choice is saved to the profile for the next device
  const { data } = await admin.from('app_user').select('language').eq('phone', '+91 98490 12345').single();
  expect(data?.language).toBe('kn');
});
