import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login, otp, openAct } from './helpers';

// Test plan P2b: invite flows that need the `invite-user` edge function (`npx supabase@2 functions serve`):
// USR-02 (each staff role), USR-04 (existing phone), USR-07 (farm scope), USR-09 (invitee language).
// 9999000002 has a local test OTP, so the invitee can log in. The seed owner invites; the invitee is deleted afterwards.
const INVITEE = '+919999000002';
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'form behaviour, not layout: one project is enough'); });

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && '+' + u.phone.replace(/^\+/, '') === INVITEE) await admin.auth.admin.deleteUser(u.id);
  await admin.from('app_user').delete().eq('phone', INVITEE);
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

async function invite(page: Page, o: { name: string; phone?: string; role: string; language?: string; farm?: string }) {
  await login(page, PHONES.owner);
  await page.goto('/more/users');
  const sheet = await openAct(page, 'inviteUser');
  await sheet.getByLabel('Name').fill(o.name);
  await sheet.getByLabel('Mobile number').fill(o.phone ?? '9999000002');
  await sheet.getByLabel('Role').selectOption(o.role);
  if (o.language) await sheet.getByLabel('Language').selectOption(o.language);
  if (o.farm) await sheet.getByLabel('Farm access').selectOption({ label: o.farm });
  await sheet.getByRole('button', { name: 'Send invite' }).click();
}
/** The invitee's profile has no farm type yet, so the first login would stop at the picker. */
const pickBroiler = () => admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', INVITEE);

const ROLES: { role: string; land: RegExp; tabs: string[] }[] = [
  { role: 'labour', land: /\/log$/, tabs: ['Log', 'More'] },
  { role: 'auditor', land: /\/home$/, tabs: ['Home', 'Farm', 'Money', 'More'] },
  { role: 'veterinarian', land: /\/home$/, tabs: ['Home', 'Farm', 'Log', 'More'] },
  { role: 'store_keeper', land: /\/home$/, tabs: ['Home', 'More'] },
  { role: 'finance', land: /\/home$/, tabs: ['Home', 'Money', 'More'] },
  { role: 'farm_manager', land: /\/home$/, tabs: ['Home', 'Farm', 'Log', 'Money', 'More'] },
];

for (const r of ROLES) {
  test(`USR-02: an owner invites ${r.role}; they land correctly with the right tabs`, async ({ page }) => {
    test.setTimeout(120_000);
    await cleanup();
    await invite(page, { name: `E2E ${r.role}`, role: r.role });
    await expect(page.locator('.toast').last()).toContainText('can now log in', { timeout: 30_000 });
    await pickBroiler();
    await login(page, '9999000002');
    await expect(page).toHaveURL(r.land, { timeout: 30_000 });
    const tabs = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').evaluateAll((a) => a.map((x) => x.getAttribute('aria-label')));
    expect(tabs).toEqual(r.tabs);
  });
}

test('USR-04: inviting a number that already has an account shows the error and creates nothing', async ({ page }) => {
  await cleanup();
  await invite(page, { name: 'E2E Dup', phone: '9000033445', role: 'labour' });
  await expect(page.getByRole('dialog')).toContainText('this number already has an account', { timeout: 30_000 });
  expect((await admin.from('app_user').select('id').eq('full_name', 'E2E Dup')).data).toEqual([]);
});

test('USR-07: an invitee given one farm is stored with that farm scope and still lands on a working app', async ({ page }) => {
  test.setTimeout(120_000);
  await cleanup();
  const { data: farms } = await admin.from('farm').select('id,name,tenant_id').eq('tenant_id', (await admin.from('app_user').select('tenant_id').eq('phone', '+91 98490 12345').single()).data!.tenant_id);
  expect(farms!.length).toBeGreaterThan(1);
  const farm = farms![0];
  await invite(page, { name: 'E2E Scoped', role: 'shed_supervisor', farm: farm.name });
  await expect(page.locator('.toast').last()).toContainText('can now log in', { timeout: 30_000 });
  const { data: u } = await admin.from('app_user').select('id').eq('phone', INVITEE).single();
  const { data: a } = await admin.from('user_role_assignment').select('scope_type,scope_id,role').eq('user_id', u!.id);
  expect(a).toEqual([{ role: 'shed_supervisor', scope_type: 'farm', scope_id: farm.id }]);
  await pickBroiler();
  await login(page, '9999000002');
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
});

test('USR-09: an invitee set to Hindi sees Hindi on the first login', async ({ page }) => {
  test.setTimeout(120_000);
  await cleanup();
  await invite(page, { name: 'E2E Hindi', role: 'shed_supervisor', language: 'hi' });
  await expect(page.locator('.toast').last()).toContainText('can now log in', { timeout: 30_000 });
  await pickBroiler();
  await page.context().clearCookies(); // no device choice: the profile language decides
  await otp(page, '/login', '9999000002');
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link').first()).toHaveAttribute('aria-label', 'होम'); // the small line stays bilingual
});
