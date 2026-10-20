import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function login(page: Page, path: string, phone: string) {
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  // GoTrue allows one OTP per number per second (local max_frequency); back-to-back logins retry once
  const rateLimited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(rateLimited)).toBeVisible();
  if (await rateLimited.isVisible()) {
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Send OTP' }).click();
  }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  const { error } = await admin.from('app_user').update({ active_farm_type: null }).not('id', 'is', null);
  expect(error).toBeNull();
});

test('owner picks a farm type once, then lands on Home directly', async ({ page, context }) => {
  await login(page, '/login', '9849012345');
  await expect(page).toHaveURL(/\/welcome$/);
  await page.getByRole('button', { name: /Layer/ }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByText('VKR Poultry Farms')).toBeVisible();
  await expect(page.getByText(/Layer view/)).toBeVisible();
  await context.clearCookies();
  await login(page, '/login', '9849012345');
  await expect(page).toHaveURL(/\/home$/); // picker not shown again
});

test('view can be switched from the tenant chip', async ({ page }) => {
  await login(page, '/login', '9849012345');
  await page.getByRole('button', { name: /Layer/ }).click();
  await page.getByRole('button', { name: 'Switch view' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Broiler/ }).click();
  await expect(page.getByText(/Broiler view/)).toBeVisible();
});

test('supervisor has no Money tab and is bounced from /money', async ({ page }) => {
  await login(page, '/login', '9000033445');
  await page.getByRole('button', { name: /Broiler/ }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('link', { name: 'Money' })).toHaveCount(0);
  await page.goto('/money');
  await expect(page).toHaveURL(/\/home$/);
});

test('platform admin uses the staff login; farm login rejects them', async ({ page }) => {
  await login(page, '/login', '9000000000');
  await expect(page.locator('.pill[role=alert]')).toContainText('/platform/login');
  await login(page, '/platform/login', '9000000000');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('KS Farms')).toBeVisible();
});

test('unknown number cannot self-register', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9999999999');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await expect(page.locator('.pill[role=alert]')).toContainText('no account');
});

test('no horizontal overflow on login, welcome, home', async ({ page }) => {
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto('/login');
  await noOverflow();
  await login(page, '/login', '9849012345');
  await expect(page).toHaveURL(/\/welcome$/);
  await noOverflow();
  await page.getByRole('button', { name: /Layer/ }).click();
  await expect(page).toHaveURL(/\/home$/);
  await noOverflow();
});
