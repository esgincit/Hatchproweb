import { test, expect, type Page } from '@playwright/test';
import { admin, freshTenant, dropFresh, otp, openAct } from './helpers';

// Test plan P2b: what a brand-new owner sees before any batch, customer or even farm exists — HOME-09, MON-05, LOG-29, REP-07,
// MON-48, FARM-07. One throw-away tenant is approved through the same edge function the console uses (needs
// `npx supabase@2 functions serve`); its owner is 9999000001 (local test OTP). Everything is deleted afterwards.
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'empty states, not layout'); });
let tenantId = '';
test.beforeAll(async () => { tenantId = await freshTenant(); });
test.afterAll(dropFresh);

async function owner(page: Page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/login', '9999000001');
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
}

test('HOME-09: a new owner sees the setup steps, not a crash or empty tiles', async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  await expect(page.getByText('Set up E2E Fresh Farm')).toBeVisible();
  for (const step of [/farm/i, /shed/i, /batch/i, /invite/i, /vendor/i]) await expect(page.locator('.card [data-act]').filter({ hasText: step }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/NaN|undefined|Application error/);
  await page.locator('.card [data-act="addBatch"]').click(); // the step opens the real form with the two free sheds
  await expect(page.getByRole('dialog').getByLabel('Shed')).toContainText('North');
  await page.keyboard.press('Escape');
});

test('MON-05 / LOG-29: with no customer or batch the forms say what to add first and show no fields', async ({ page }) => {
  await owner(page);
  const sale = await openAct(page, 'saleOpen');
  await expect(sale).toContainText('Add a customer first');
  await expect(sale.locator('input, select')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sale).toBeHidden();
  const mort = await openAct(page, 'mort');
  await expect(mort).toContainText('No active batch');
  await expect(mort.locator('input, select')).toHaveCount(0);
});

test('REP-07: an empty weekly report says there is nothing to report', async ({ page }) => {
  await owner(page);
  await page.goto('/report/weekly');
  await expect(page.locator('.card.report')).toContainText('Nothing to report.');
  await expect(page.locator('body')).not.toContainText(/NaN|Application error/);
});

test('MON-48: tally and GSTR-1 exports for a month with no data are valid empty files', async ({ page }) => {
  await owner(page);
  const tally = await page.request.get('/api/export/tally');
  expect(tally.status()).toBe(200);
  const xml = await tally.text();
  expect(xml).toMatch(/^<\?xml[^>]*\?>\s*<ENVELOPE>[\s\S]*<REQUESTDATA><\/REQUESTDATA>[\s\S]*<\/ENVELOPE>\s*$/);
  const g = await page.request.get('/api/export/gstr1');
  expect(g.status()).toBe(200);
  expect((await g.json()).totals).toEqual({ count: 0, value: 0, nil_rated: 0 });
  const s = await page.request.get('/api/export/statements');
  expect((await s.text()).trim().split(/\r?\n/)).toHaveLength(1); // header only
});

test('FARM-07: with no farm at all, + Shed says to add a farm first', async ({ page }) => {
  test.setTimeout(120_000);
  await admin.from('farm').delete().eq('tenant_id', tenantId);
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/login', '9999000001');
  await expect(page).toHaveURL(/\/welcome$/, { timeout: 30_000 }); // no farm, so no farm type to infer: the picker offers all three
  await expect(page.getByRole('button', { name: /Hatchery/ })).toBeVisible();
  await page.getByRole('button', { name: /Broiler/ }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
  await page.locator('[data-act="addShedPick"]').click();
  const shed = page.getByRole('dialog');
  await expect(shed).toContainText('Add a farm first');
  await expect(shed.locator('input, select')).toHaveCount(0);
});

