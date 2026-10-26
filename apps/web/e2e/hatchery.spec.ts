import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Phase 4 hatchery: setting KS-H-2026-37 (57,600 eggs) → candling → hatch results → dispatch chicks (a 'doc' sale).
// KPIs on the card must match the hand calculation: fertility 92%, hatchability 85.9%, hatch of fertile 93.4%, grade A 97%.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const CODE = 'KS-H-2026-37';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9440012121'); // KS Farms owner
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test('hatchery: candle, hatch and dispatch a setting', async ({ page, context }) => {
  test.setTimeout(150_000);
  const { data: b } = await admin.from('batch').select('id').eq('code', CODE).single();
  const docSales = async () => ((await admin.from('invoice').select('id').eq('batch_id', b!.id).eq('product', 'doc')).data ?? []).map((x) => x.id);
  const before = await docSales();
  await admin.from('hatch_record').delete().eq('batch_id', b!.id);
  await admin.from('app_user').update({ active_farm_type: 'hatchery' }).eq('phone', '+91 94400 12121');
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  try {
    await login(page);
    await page.goto(`/farm/batch/${CODE}`);
    const card = page.getByTestId('hatch-card');
    await expect(card).toContainText('Eggs set');
    await expect(card).toContainText('57,600');

    await card.getByRole('button', { name: /Candling/ }).click();
    let sheet = page.getByRole('dialog', { name: 'Candling' });
    await sheet.getByLabel('Clears (infertile)').fill('4600');
    await sheet.getByLabel('Dead germ').fill('900');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Candling saved')).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('92%', { timeout: 20_000 });

    await card.getByRole('button', { name: /Hatch results/ }).click();
    sheet = page.getByRole('dialog', { name: 'Hatch results' });
    await sheet.getByLabel('Grade A chicks').fill('48000');
    await sheet.getByLabel('Grade B chicks').fill('1500');
    await sheet.getByLabel('Culls').fill('600');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('49500 saleable chicks recorded')).toBeVisible({ timeout: 20_000 });
    for (const v of ['85.9%', '93.4%', '97%']) await expect(card).toContainText(v, { timeout: 20_000 });

    await card.getByRole('button', { name: /Dispatch chicks/ }).click();
    sheet = page.getByRole('dialog', { name: 'New sale' });
    await expect(sheet.getByLabel('Quantity')).toHaveValue('49500'); // chicks in stock prefilled
    await sheet.getByLabel('Quantity').fill('10000');
    await sheet.getByLabel('Rate (₹ per unit)').fill('32');
    await sheet.getByRole('button', { name: 'Raise invoice' }).click();
    await expect(page.getByText(/Invoice .* raised/)).toBeVisible({ timeout: 20_000 }); // sale opens Money; come back
    await page.goto(`/farm/batch/${CODE}`);
    await expect(card).toContainText('10,000 / 49,500', { timeout: 20_000 });

    // a count above the eggs left is refused by the database, and the saved numbers stay
    await card.getByRole('button', { name: /Hatch results/ }).click();
    sheet = page.getByRole('dialog', { name: 'Hatch results' });
    await sheet.getByLabel('Grade A chicks').fill('60000');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toContainText('exceed', { timeout: 20_000 });
  } finally {
    await admin.from('hatch_record').delete().eq('batch_id', b!.id);
    const made = (await docSales()).filter((id) => !before.includes(id));
    if (made.length) expect((await admin.from('invoice').delete().in('id', made)).error).toBeNull();
  }
});
