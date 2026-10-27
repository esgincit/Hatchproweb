import { test, expect, type Page } from '@playwright/test';
import { admin, PHONES, login } from './helpers';
import { SCREENS, lowContrast, openForm } from './p3-helpers';

// Test plan P3: dark mode. DARK-01 (follows the OS), DARK-02 (every screen, form, toast and chart readable), DARK-03 (3D page and
// reports in dark; print stays light). "Readable" = text has a contrast ratio of at least 3 against what is behind it.
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'colours, not layout'); });
test.afterEach(async () => { await admin.from('tenant_document').delete().like('name', 'E2E-%'); });

const shade = (page: Page) => page.evaluate(() => {
  const rgb = (s: string) => s.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
  return { bg: rgb(getComputedStyle(document.body).backgroundColor), ink: rgb(getComputedStyle(document.body).color) };
});
const light = (c: number[]) => (c[0] + c[1] + c[2]) / 3 > 128;

test('DARK-01: the app follows the OS and turns dark with readable text', async ({ page }) => {
  await login(page, PHONES.owner);
  const lightShade = await shade(page);
  expect(light(lightShade.bg) && !light(lightShade.ink)).toBe(true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/home');
  const dark = await shade(page);
  expect(!light(dark.bg) && light(dark.ink), JSON.stringify(dark)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  expect(await lowContrast(page)).toEqual([]);
});

test('DARK-02: every screen, form, toast and chart is readable in dark', async ({ page }) => {
  test.setTimeout(600_000);
  await login(page, PHONES.owner);
  await page.emulateMedia({ colorScheme: 'dark' });
  const bad: string[] = [];
  const acts = new Set<string>();
  for (const path of SCREENS) {
    await page.goto(path);
    await page.waitForTimeout(400);
    for (const l of await lowContrast(page)) bad.push(`${path}: ${l}`);
    const names = await page.$$eval('[data-act]', (bs) => bs.map((b, i) => ({ i, act: b.getAttribute('data-act')! })));
    for (const { i, act } of names) {
      if (acts.has(act) || /^(tally|gstr|stmt|payroll|report|attToday|attCycle|attSubmit|attSet|closeCase)$/.test(act)) continue;
      acts.add(act);
      const dlg = await openForm(page, i);
      if (!dlg) continue;
      for (const l of await lowContrast(page)) bad.push(`${path} [${act}]: ${l}`);
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
    }
  }
  // a toast
  await page.goto('/more/docs');
  await page.locator('[data-act="addDoc"]').first().click();
  await page.getByRole('dialog').locator('[name=name]').fill('E2E-dark doc');
  await page.getByRole('dialog').locator('button[type=submit]').click();
  const toast = page.locator('.toast').last();
  await expect(toast).toBeVisible({ timeout: 20_000 });
  for (const l of await lowContrast(page)) bad.push(`toast: ${l}`);
  // charts: every drawn line / bar stands out from the card it sits on
  await page.goto('/money?view=pnl');
  const faint = await page.evaluate(() => {
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const nums = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const bgOf = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const m = getComputedStyle(e).backgroundColor; if (m && !/rgba\(.*, 0\)|transparent/.test(m)) return nums(m); } return [255, 255, 255]; };
    const out: string[] = [];
    for (const el of document.querySelectorAll('svg path[stroke], svg polyline, svg rect[fill], svg circle[fill]')) {
      const cs = getComputedStyle(el), paint = el.tagName === 'path' || el.tagName === 'polyline' ? cs.stroke : cs.fill;
      if (!paint || paint === 'none' || el.getAttribute('fill-opacity') === '0') continue;
      const p = nums(paint); if (p.length < 3) continue;
      const a = lum(p), b = lum(bgOf(el)), r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (r < 1.5 && !/line|grid/i.test(String((el as SVGElement).className?.baseVal ?? ''))) out.push(`${el.tagName} ${paint} (${r.toFixed(1)})`);
    }
    return [...new Set(out)].slice(0, 6);
  });
  for (const f of faint) bad.push(`chart: ${f}`);
  expect(acts.size).toBeGreaterThan(25);
  expect(bad).toEqual([]);
});

test('DARK-03: the farm page and reports are readable in dark, and printing is light again', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, PHONES.owner);
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/farm', '/report/daily', '/report/weekly']) {
    await page.goto(path);
    await expect(page.locator('.card').first()).toBeVisible();
    expect(await lowContrast(page), path).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'dark', media: 'print' });
  const p = await shade(page);
  expect(light(p.bg) && !light(p.ink), `print: ${JSON.stringify(p)}`).toBe(true);
});
