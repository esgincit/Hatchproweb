import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, otp, login, vkr } from './helpers';

// Test plan P2b: platform console cases left over from P1 — reject with a note (PLT-02/03), plan and status changes (PLT-06/08),
// read-only support view (PLT-12), listing rejection with a note the vendor sees (PLT-15), + Advertiser errors (PLT-17),
// console on a phone (PLT-19). Needs `npx supabase@2 functions serve` for the + Advertiser form.
const APPLICANT = '+919999000001', VENDOR = '+919999000003';
const KS = 'b146bf5d-6213-556e-8e71-8d4c156ad36d';
const APP_NAME = 'E2E Reject Farm', LISTING = 'E2E rejected listing';
test.describe.configure({ mode: 'serial' });

async function platformLogin(page: Page) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await otp(page, '/platform/login', PHONES.platform);
  await expect(page).toHaveURL(/\/admin$/, { timeout: 30_000 });
}

async function cleanup() {
  await admin.from('onboarding_application').delete().eq('phone', APPLICANT);
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && '+' + u.phone.replace(/^\+/, '') === VENDOR) await admin.auth.admin.deleteUser(u.id); // cascades listings
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

test.describe('console, desktop', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'console flow; the phone layout has its own test below'); });

  test('PLT-02 / PLT-03: rejecting with a note stores it and clears the row; a second tab cannot decide it again', async ({ page, context }) => {
    test.setTimeout(120_000);
    const { data: app } = await admin.from('onboarding_application').insert({
      business_name: APP_NAME, owner_name: 'Rej Owner', phone: APPLICANT, farm_types: ['broiler'], state: 'Telangana', consent: true,
      sites: [{ name: 'Rej Unit', sheds: [{ name: 'a', capacity: 100 }] }],
    }).select('id').single();
    await platformLogin(page);
    const second = await context.newPage(); // the same admin, a stale tab that still shows the application
    await second.goto('/admin');
    await second.getByRole('button', { name: new RegExp(APP_NAME) }).click();

    await page.getByRole('button', { name: new RegExp(APP_NAME) }).click();
    await page.getByLabel('Reason for rejecting (saved with the application, optional)').fill('Incomplete PAN');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('Application rejected');
    await expect(page.getByRole('button', { name: new RegExp(APP_NAME) })).toHaveCount(0);
    const row = async () => (await admin.from('onboarding_application').select('status,review_note,reviewed_at').eq('id', app!.id).single()).data!;
    const done = await row();
    expect(done).toMatchObject({ status: 'rejected', review_note: 'Incomplete PAN' });

    await second.getByLabel('Reason for rejecting (saved with the application, optional)').fill('second tab');
    await second.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(second.locator('.toast').last()).toContainText('not found or already decided');
    expect(await row()).toEqual(done); // untouched: note and time are the first decision's
  });

  test('PLT-06 / PLT-08: change a tenant plan, then its status; the owner still works on trial and active', async ({ page }) => {
    test.setTimeout(180_000);
    const before = (await admin.from('tenant').select('plan,status').eq('id', KS).single()).data!;
    try {
      await platformLogin(page);
      const manage = async (plan: string, status: string) => {
        const row = page.locator('.item', { hasText: 'KS Farms' });
        await row.getByRole('button', { name: 'Manage' }).click();
        await row.getByLabel('Plan').selectOption(plan);
        await row.getByLabel('Status').selectOption(status);
        await row.getByRole('button', { name: 'Save' }).click();
        await expect(page.locator('.toast').last()).toContainText('KS Farms updated');
        await expect.poll(async () => (await admin.from('tenant').select('plan,status').eq('id', KS).single()).data).toEqual({ plan, status });
      };
      await manage('growth', 'trial'); // PLT-06 + trial
      await login(page, PHONES.ksOwner);
      await expect(page).not.toHaveURL(/no-access|suspended/);
      await expect(page.locator('.topbar .name')).toHaveText('KS Farms');
      await platformLogin(page);
      await manage('growth', 'active'); // PLT-08 reactivate
      await login(page, PHONES.ksOwner);
      await expect(page.locator('.topbar .name')).toHaveText('KS Farms');
    } finally {
      await admin.from('tenant').update(before).eq('id', KS);
    }
  });

  test('PLT-12: the support view of a farm has no form, input or write button', async ({ page }) => {
    const t = await vkr();
    await platformLogin(page);
    await page.goto(`/admin/tenant/${t.tenantId}`);
    await expect(page.getByRole('note')).toBeVisible();
    const main = page.locator('main');
    await expect(main.locator('form, input, select, textarea')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
  });

  test('PLT-15: rejecting a listing with a note shows the vendor that note', async ({ page }) => {
    test.setTimeout(120_000);
    const { data: u } = await admin.auth.admin.createUser({ phone: VENDOR, phone_confirm: true, app_metadata: { roles: ['vendor'], platform: false } });
    const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: 'E2E Reject Vendor', phone: VENDOR, category: 'feed' }).select('id').single();
    const { data: l } = await admin.from('product_listing').insert({ advertiser_id: adv!.id, title: LISTING, category: 'feed' }).select('id').single();
    await admin.from('product_listing').insert({ advertiser_id: adv!.id, title: 'E2E approved listing', category: 'feed', status: 'approved' });
    await platformLogin(page);
    const row = page.getByTestId('marketplace-review').locator('.item', { hasText: LISTING });
    await row.getByLabel('Reason for rejecting (shown to the vendor, optional)').fill('Photo missing');
    await row.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('Listing rejected');
    await expect(row).toHaveCount(0);
    expect((await admin.from('product_listing').select('status,review_note').eq('id', l!.id).single()).data).toEqual({ status: 'rejected', review_note: 'Photo missing' });
    await page.context().clearCookies(); // leave the platform session
    await otp(page, '/login', '9999000003');
    await expect(page).toHaveURL(/\/vendor$/, { timeout: 30_000 });
    await expect(page.getByTestId('listings')).toContainText('Photo missing');
    // approved but no paid plan: farmers cannot see it, so it must not say Live (found while walking the vendor portal)
    await expect(page.getByTestId('listings').locator('.item', { hasText: 'E2E approved listing' })).toContainText('Approved · needs a plan');
    await expect(page.getByTestId('listings')).not.toContainText('Live');
  });

  test('PLT-17: + Advertiser refuses a bad or already used mobile in plain words and creates nothing', async ({ page }) => {
    test.setTimeout(120_000);
    await cleanup(); // PLT-15 leaves its vendor on 9999000003
    await platformLogin(page);
    const review = page.getByTestId('marketplace-review');
    await review.getByRole('button', { name: '+ Advertiser' }).click();
    const submit = async (name: string, phone: string) => {
      await review.getByLabel('Business name').fill(name);
      await review.getByLabel('Mobile').fill(phone);
      await review.getByRole('button', { name: 'Create vendor login' }).click();
    };
    const advertisers = async () => (await admin.from('advertiser').select('id', { count: 'exact', head: true }).like('business_name', 'E2E Bad%')).count;
    for (const phone of ['12345', '5999000002']) {
      await submit('E2E Bad Mobile', phone);
      await expect(page.locator('.toast').last()).toContainText('Could not add vendor (enter a business name and a valid 10-digit mobile number)');
    }
    await submit('E2E Bad Dup', '99990 00003'); // creates the first vendor ...
    await expect(page.getByText('E2E Bad Dup can now log in with OTP')).toBeVisible({ timeout: 30_000 });
    await review.getByRole('button', { name: '+ Advertiser' }).click();
    await submit('E2E Bad Dup Again', '99990 00003'); // ... and the second is refused
    await expect(page.locator('.toast').last()).toContainText('Could not add vendor (this mobile number already has a login)');
    expect(await advertisers()).toBe(1);
  });
});

test('PLT-19: the console fits a 390px phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout');
  await platformLogin(page);
  await page.getByRole('button', { name: /Manage/ }).first().click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, 'horizontal overflow in px').toBeLessThanOrEqual(0);
  await page.goto('/admin/tenant/' + (await vkr()).tenantId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
