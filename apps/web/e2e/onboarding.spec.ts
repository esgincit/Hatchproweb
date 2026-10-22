import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// R3 end to end: apply (no login) → platform approves → owner logs in to a pre-built farm → owner invites a
// supervisor → supervisor logs in with limited tabs. Uses test OTP numbers 9999000001 / 9999000002.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLICANT = '+919999000001', INVITEE = '+919999000002';
test.describe.configure({ mode: 'serial' });

async function cleanup() {
  const { data: apps } = await admin.from('onboarding_application').select('id,tenant_id').eq('phone', APPLICANT);
  for (const a of apps ?? []) {
    await admin.from('onboarding_application').delete().eq('id', a.id);
    if (a.tenant_id) {
      await admin.from('audit_log').delete().eq('tenant_id', a.tenant_id);
      await admin.from('tenant').delete().eq('id', a.tenant_id); // cascades farms, sheds, users, roles, subscription
    }
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && ['+' + u.phone.replace(/^\+/, '')].some((p) => p === APPLICANT || p === INVITEE)) await admin.auth.admin.deleteUser(u.id);
}

async function otp(page: Page, path: string, mobile: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const alert = page.locator('.pill[role=alert]');
  await expect(page.getByLabel('6-digit code').or(alert)).toBeVisible();
  if (await alert.filter({ hasText: 'only request this after' }).isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  if (!(await page.getByLabel('6-digit code').isVisible())) return; // refused (e.g. no account yet)
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

test('apply → approve → owner gets farm + sheds → invites a supervisor', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one full journey is enough; phone layout is covered elsewhere');
  test.setTimeout(240_000);

  // 1. public application
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto('/apply');
  await page.getByLabel('Farm / business name *').fill('E2E Sunrise Poultry');
  await page.getByLabel('PAN *').fill('abcde1234f');
  await page.getByLabel('Owner name *').fill('Ravi Teja');
  await page.getByLabel('Mobile (your login) *').fill('99990 00001');
  await page.getByLabel('Site name *').fill('Sunrise Broiler Unit');
  await page.getByLabel('District *').fill('Medak');
  await page.getByLabel('PIN code *').fill('502110');
  await page.getByLabel('Shed name').first().fill('North Shed');
  await page.getByLabel('Max birds *').first().fill('8000');
  await page.getByRole('button', { name: '+ Shed' }).click();
  await page.getByLabel('Max birds *').nth(1).fill('6000');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('Application received')).toBeVisible();

  // 2. not a login yet: OTP for the applicant is refused
  await otp(page, '/login', '9999000001');
  await expect(page.locator('.pill[role=alert]')).toContainText('no account');

  // 3. platform admin approves
  await otp(page, '/platform/login', '9000000000');
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
  await page.getByRole('button', { name: /E2E Sunrise Poultry/ }).click();
  await expect(page.getByText('2 · 14,000')).toBeVisible(); // sheds · capacity
  await page.getByRole('button', { name: 'Approve & create account' }).click();
  await expect(page.locator('.toast')).toContainText('approved', { timeout: 20_000 });

  // 4. new owner logs in; farm + sheds came from the application
  await otp(page, '/login', '9999000001');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 }); // single farm type → no picker
  await page.goto('/farm');
  await expect(page.getByText('Sunrise Broiler Unit')).toBeVisible();
  await expect(page.locator('.card').getByText('North Shed').first()).toBeVisible(); // farm card, not the 3D viewer's list

  // 5. owner invites a supervisor
  await page.goto('/more/users');
  await page.getByRole('button', { name: '+ Invite' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name').fill('Suresh Supervisor');
  await sheet.getByLabel('Mobile number').fill('9999000002');
  await sheet.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.locator('.toast')).toContainText('can now log in', { timeout: 20_000 });
  await expect(page.getByText('Suresh Supervisor')).toBeVisible();

  // 6. supervisor logs in to the same tenant with supervisor tabs (no Money)
  await otp(page, '/login', '9999000002');
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
  await expect(page.locator('.topbar .name')).toHaveText('E2E Sunrise Poultry');
  await expect(page.getByRole('link', { name: 'Money' })).toHaveCount(0);
});
