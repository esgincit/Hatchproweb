import { test, expect, type Page } from '@playwright/test';
import { admin, TODAY, PHONES, login } from './helpers';

// Test plan P1 #14: wrong / short OTP, farm user at the staff login, sign-out, offline copies between users.
const CODE = 'VKR-B-2026-14';
test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
});

async function sendOtp(page: Page, path: string, mobile: string) {
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await expect(page.getByLabel('6-digit code')).toBeVisible();
}

test('AUTH-03 / AUTH-04: a wrong or short code is refused and no session starts', async ({ page }) => {
  await sendOtp(page, '/login', PHONES.owner);
  for (const code of ['000000', '12345']) {
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('.pill[role=alert]'), code).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  }
  expect((await page.goto('/home'))!.url()).toMatch(/\/login$/); // still signed out
  await sendOtp(page, '/login', PHONES.owner); // and the right code still works afterwards
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
});

test('AUTH-13: a farm owner at the staff login is signed out with a clear message', async ({ page }) => {
  await sendOtp(page, '/platform/login', PHONES.owner);
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('.pill[role=alert]')).toContainText('not a HatchPro staff account');
  await expect(page).toHaveURL(/\/platform\/login$/);
  expect((await page.goto('/home'))!.url()).toMatch(/\/login$/); // no session was left behind
});

async function signOut(page: Page) {
  await page.locator('.topbar .tenant').click(); // the farm name opens the "Switch view" sheet
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
}

test('AUTH-35: sign out ends the session; Back and direct URLs go to the login page', async ({ page }) => {
  await login(page);
  await expect(page.getByText('VKR Poultry Farms').first()).toBeVisible();
  await signOut(page);
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  for (const path of ['/home', '/money', '/farm']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login$/);
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('VKR Poultry Farms')).toHaveCount(0);
});

test('AUTH-36: offline page copies and queued entries of one user are not shown or sent for the next user', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'one browser is enough');
  test.setTimeout(150_000);
  const mark = `auth36-${Date.now() % 100000}`;
  const { data: b } = await admin.from('batch').select('id').eq('code', CODE).single();
  const { data: before } = await admin.from('daily_shed_log').select('*').eq('batch_id', b!.id).eq('log_date', TODAY).maybeSingle();
  const cacheKeys = () => page.evaluate(async () => (await caches.keys()).length);
  try {
    // supervisor: browse so the service worker copies pages, then save a log with no network
    await login(page, PHONES.supervisor);
    await page.goto(`/log?batch=${CODE}`);
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 20_000 }).toBe(true);
    await page.reload();
    await page.goto('/farm');
    await expect.poll(cacheKeys, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.goto(`/log?batch=${CODE}`);
    await expect(page.getByLabel('Mortality')).toBeVisible();
    await context.setOffline(true);
    await page.getByLabel('Mortality').fill('4');
    await page.getByLabel('Remarks').fill(mark);
    await page.getByRole('button', { name: /Save log/ }).click();
    await expect(page.getByTestId('outbox')).toContainText('1 entries saved offline');

    // the phone is handed to the next person: back online, but the replay is blocked so the entry is still queued when the session ends
    const block = (route: import('@playwright/test').Route) => (route.request().method() === 'POST' && route.request().headers()['next-action'] ? route.abort() : route.fallback());
    await page.route('**/*', block);
    await context.setOffline(false);
    await page.locator('.topbar .tenant').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
    await expect.poll(cacheKeys, { timeout: 10_000 }).toBe(0); // supervisor's page copies are gone

    await page.unroute('**/*', block);
    await login(page); // owner, same browser profile
    await page.goto('/home');
    await expect(page.getByTestId('outbox')).toHaveCount(0); // the supervisor's entry is not shown to the owner
    await page.waitForTimeout(4000); // long enough for any replay
    expect((await admin.from('daily_shed_log').select('id').eq('remarks', mark)).data).toHaveLength(0); // and not sent under the owner's name
  } finally {
    await context.setOffline(false);
    await page.evaluate(() => indexedDB.deleteDatabase('hatchpro')).catch(() => {});
    if (before) await admin.from('daily_shed_log').update({ mortality: before.mortality, culls: before.culls, avg_weight_g: before.avg_weight_g, feed_kg: before.feed_kg, water_litres: before.water_litres, remarks: before.remarks }).eq('id', before.id);
    else await admin.from('daily_shed_log').delete().eq('batch_id', b!.id).eq('log_date', TODAY);
  }
});
