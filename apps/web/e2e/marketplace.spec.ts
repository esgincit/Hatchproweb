import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Phase 12 marketplace, end to end: platform adds a vendor → vendor logs in, lists a product, starts a plan →
// Razorpay webhook (signed, simulated locally) activates it → platform approves the listing → a farmer sees it and
// contacts the vendor → the vendor sees the lead.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const VENDOR = '+919999000003';
const TITLE = 'E2E Broiler starter crumbs';

async function otp(page: Page, path: string, mobile: string, landing: RegExp) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(landing, { timeout: 20_000 });
}

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) if (u.phone && '+' + u.phone.replace(/^\+/, '') === VENDOR) await admin.auth.admin.deleteUser(u.id); // cascades advertiser → listings, subs, leads
}

test('vendor lists, pays, gets approved; farmer contacts; vendor sees the lead', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one journey is enough');
  test.setTimeout(240_000);
  await cleanup();
  try {
    // 1. platform admin adds the vendor
    await otp(page, '/platform/login', '9000000000', /\/admin$/);
    const review = page.getByTestId('marketplace-review');
    await review.getByRole('button', { name: '+ Advertiser' }).click();
    await review.getByLabel('Business name').fill('E2E Feeds Pvt Ltd');
    await review.getByLabel('Mobile').fill('99990 00003');
    await review.getByRole('button', { name: 'Create vendor login' }).click();
    await expect(page.getByText('E2E Feeds Pvt Ltd can now log in with OTP')).toBeVisible({ timeout: 20_000 });

    // 2. vendor: lands on the portal, lists a product, starts a plan (no Razorpay keys locally → recorded, not charged)
    await otp(page, '/login', '9999000003', /\/vendor$/);
    await expect(page.getByTestId('plan-status')).toContainText('No paid plan yet');
    await page.getByRole('button', { name: '+ Listing' }).click();
    await page.getByLabel('Product / service').fill(TITLE);
    await page.getByLabel('Price (e.g. ₹1,850 / bag)').fill('₹1,850 / bag');
    await page.getByRole('button', { name: 'Send for review' }).click();
    await expect(page.getByTestId('listings')).toContainText('In review', { timeout: 20_000 });
    await page.getByTestId('plans').getByRole('button', { name: 'Pay ₹999' }).click();
    await expect(page.getByText('Online payment is not set up yet')).toBeVisible({ timeout: 20_000 });

    // 3. Razorpay captures the payment → signed webhook → plan active (same path production uses)
    const { data: adv } = await admin.from('advertiser').select('id').eq('phone', VENDOR).single();
    const { data: sub } = await admin.from('ad_subscription').select('id').eq('advertiser_id', adv!.id).eq('status', 'pending').single();
    const secret = readFileSync('../../supabase/functions/.env', 'utf8').match(/^RAZORPAY_WEBHOOK_SECRET=(.*)$/m)![1].trim();
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_E2E${Date.now()}`, amount: 99900, method: 'upi', created_at: Math.floor(Date.now() / 1000), notes: { ref_type: 'ad', ref_id: sub!.id } } } } });
    const hook = await page.request.post('http://127.0.0.1:54321/functions/v1/razorpay-webhook', {
      data: body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex') },
    });
    expect(await hook.json()).toEqual({ result: 'applied' });
    await page.reload();
    await expect(page.getByTestId('plan-status')).toContainText('visible to farmers until');

    // 4. platform approves the listing
    await otp(page, '/platform/login', '9000000000', /\/admin$/);
    const row = page.getByTestId('marketplace-review').locator('.item', { hasText: TITLE });
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Listing approved')).toBeVisible({ timeout: 20_000 });

    // 5. farmer sees it and contacts the vendor
    await admin.from('app_user').update({ active_farm_type: 'layer' }).eq('phone', '+91 98490 12345');
    await otp(page, '/login', '9849012345', /\/home$/);
    await page.goto('/more/marketplace');
    const offer = page.locator('.item', { hasText: TITLE });
    await expect(offer).toContainText('E2E Feeds Pvt Ltd');
    await offer.getByRole('button', { name: 'Contact' }).click();
    await expect(offer.getByRole('link', { name: 'Call' })).toHaveAttribute('href', /tel:\+919999000003/);

    // 6. vendor sees the lead
    await otp(page, '/login', '9999000003', /\/vendor$/);
    await expect(page.getByTestId('leads')).toContainText(TITLE);
  } finally {
    await cleanup();
  }
});
