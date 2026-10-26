import { test, expect } from '@playwright/test';

// More › Reports → Generate opens a printable report and the browser's print dialog ("Save as PDF").
// window.print is stubbed (counted); desktop also renders the PDF through print media to check the chrome is hidden.
const REPORTS: [string, string, RegExp][] = [
  ['Daily farm summary', 'daily', /Vaccinations due/],
  ['Weekly batch report', 'weekly', /Days logged/],
  ['Vaccination compliance', 'vaccination', /% on time/],
  ['Mortality register (insurance)', 'mortality', /Last 90 days/],
];

test('owner generates each printable report', async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await context.clearCookies();
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.addInitScript(() => { (window as unknown as { printed: number }).printed = 0; window.print = () => { (window as unknown as { printed: number }).printed++; }; });
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill('9849012345');
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });

  for (const [name, kind, marker] of REPORTS) {
    await page.goto('/more/reports');
    await page.locator('.item', { hasText: name }).getByRole('button', { name: 'Generate' }).click();
    await expect(page).toHaveURL(new RegExp(`/report/${kind}$`), { timeout: 20_000 });
    const card = page.locator('.card.report');
    await expect(card.getByRole('heading', { name })).toBeVisible();
    await expect(card).toContainText(marker);
    await expect(card.locator('tbody tr').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBeGreaterThan(0);
    if (info.project.name === 'desktop') {
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('.tabs')).toBeHidden();
      await expect(card.getByRole('button', { name: 'Save as PDF' })).toBeHidden();
      await page.pdf({ path: info.outputPath(`${kind}.pdf`), format: 'A4', landscape: true, printBackground: true });
      await page.emulateMedia({ media: 'screen' });
    }
  }
});
