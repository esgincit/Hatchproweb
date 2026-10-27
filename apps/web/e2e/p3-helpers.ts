import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Shared by the p3-*.spec.ts files (I18N / LAY / DARK).
export const LOCALES = ['te', 'hi', 'ta', 'kn'] as const;

/** Every owner screen the screens spec walks. */
export const SCREENS = [
  '/home', '/farm', '/farm/batch/VKR-L-2026-02', '/log', '/money', '/money?view=ap', '/money?view=ar', '/money?view=pnl', '/money?view=rates',
  '/more', '/more/people', '/more/people?tab=month', '/more/people?tab=wages', '/more/equipment', '/more/stock', '/more/vendors', '/more/customers',
  '/more/health', '/more/users', '/more/docs', '/more/reports', '/more/notifications', '/more/marketplace', '/report/daily', '/report/weekly', '/report/mortality',
];

// seed data that happens to read like a label (a vendor's contact is called Manager; an item is Soya DOC 46%): not a translation gap
const DATA_LOOKALIKES = new Set(['Manager', 'Soya DOC 46%']);
type Tree = { [k: string]: string | Tree };
const load = (l: string) => JSON.parse(readFileSync(`messages/${l}.json`, 'utf8')) as Tree;
const flat = (t: Tree, p = ''): [string, string][] => Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[p + k, v] as [string, string]] : flat(v, `${p}${k}.`)));

/**
 * English UI strings from messages/en.json that this language translates differently. Seeing one of them on a screen in that
 * language means a string was shown untranslated. (Plain texts only: no {placeholders}, at least three letters.)
 */
export function englishOnly(locale: string, namespace = ''): string[] {
  const loc = new Map(flat(load(locale)));
  return flat(load('en')).filter(([k, v]) => !DATA_LOOKALIKES.has(v) && k.startsWith(namespace) && loc.has(k) && loc.get(k) !== v && !v.includes('{') && /[A-Za-z]{3}/.test(v) && v.trim().length >= 3).map(([, v]) => v);
}

/** Visible text (and placeholder / aria-label / title) on the page that is exactly one of `english`. */
export function findEnglish(page: Page, english: string[]): Promise<string[]> {
  return page.evaluate((en) => {
    const set = new Set(en), hit = new Set<string>();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || ['SCRIPT', 'STYLE', 'OPTION'].includes(p.tagName) || p.closest('nav.tabs small')) continue; // the tab bar's small line is bilingual on purpose
      const t = (n.textContent ?? '').trim();
      if (set.has(t)) hit.add(t);
    }
    for (const e of document.querySelectorAll('[aria-label], [placeholder], [title]'))
      for (const a of ['aria-label', 'placeholder', 'title']) { const v = e.getAttribute(a)?.trim(); if (v && set.has(v)) hit.add(`@${a}: ${v}`); }
    return [...hit];
  }, english);
}

/** Text that sits on a background it cannot be read against (contrast ratio below `min`), as "text (ratio)". */
export function lowContrast(page: Page, min = 3): Promise<string[]> {
  return page.evaluate((min) => {
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const parse = (s: string) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
    const bgOf = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0.6) return p.rgb; } return [255, 255, 255]; };
    const low: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest('canvas, [data-nextjs-toast], nextjs-portal')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const a = lum(fg.rgb), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < min) low.push(`${(el.textContent ?? '').trim().slice(0, 30)} (${ratio.toFixed(1)})`);
    }
    return low;
  }, min);
}

/** Tap the i-th action button on the page; the open form, or null when that button opens nothing (and the page is left as it was). */
export async function openForm(page: Page, i: number) {
  await page.locator('[data-act]').nth(i).click();
  const dlg = page.getByRole('dialog');
  const shown = await dlg.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
  if (!shown) await page.keyboard.press('Escape');
  return shown ? dlg : null;
}

/** Pixels the page is wider than the window (0 when nothing scrolls sideways). */
export const overflowX = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
