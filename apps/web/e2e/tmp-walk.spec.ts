import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { admin, PHONES, login, otp } from './helpers';

// THROWAWAY exploratory walker (deleted before finishing). WALK=<persona> WALK_LOCALE=en|te|hi|ta|kn WALK_DARK=1
const OUT = 'C:/Users/funny/.claude/jobs/05820e9a/tmp/shots';
const WHO = process.env.WALK ?? 'owner-layer';
const LOC = process.env.WALK_LOCALE ?? 'en';
const DARK = !!process.env.WALK_DARK;
const MAX_PAGES = Number(process.env.WALK_MAX ?? 45);
const FORMS = process.env.WALK_FORMS !== '0';
fs.mkdirSync(OUT, { recursive: true });

type Finding = { where: string; kind: string; detail: string };

async function setup(page: Page) {
  if (WHO.startsWith('owner') || WHO.startsWith('ks-') || WHO === 'supervisor' || WHO === 'finance') {
    const [mobile, ft] = ({
      'owner-layer': [PHONES.owner, 'layer'], 'owner-broiler': [PHONES.owner, 'broiler'], 'ks-broiler': [PHONES.ksOwner, 'broiler'],
      'ks-hatchery': [PHONES.ksOwner, 'hatchery'], supervisor: [PHONES.supervisor, 'layer'], finance: [PHONES.finance, 'layer'],
    } as Record<string, [string, string]>)[WHO];
    await page.context().clearCookies();
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    const phone = `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
    await admin.from('app_user').update({ active_farm_type: ft }).eq('phone', phone);
    await otp(page, '/login', mobile);
    await page.waitForURL(/\/(home|log|money)/, { timeout: 40_000 });
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: LOC, url: 'http://localhost:3100' }]); return page.url();
  }
  if (WHO === 'platform') {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await otp(page, '/platform/login', PHONES.platform);
    await page.waitForURL(/\/admin/, { timeout: 40_000 });
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: LOC, url: 'http://localhost:3100' }]); return page.url();
  }
  if (WHO === 'vendor') {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of data?.users ?? []) if (u.phone === '919999000003') await admin.auth.admin.deleteUser(u.id);
    const { data: u } = await admin.auth.admin.createUser({ phone: '+919999000003', phone_confirm: true, app_metadata: { roles: ['vendor'], platform: false } });
    const { data: adv } = await admin.from('advertiser').insert({ user_id: u.user!.id, business_name: 'E2E Walk Vendor', phone: '+919999000003', category: 'feed' }).select('id').single();
    await admin.from('product_listing').insert([
      { advertiser_id: adv!.id, title: 'E2E walk feed', category: 'feed', description: 'Starter crumbs', price_text: '₹1,850 / bag', status: 'approved' },
      { advertiser_id: adv!.id, title: 'E2E walk pending', category: 'medicine', status: 'pending' },
      { advertiser_id: adv!.id, title: 'E2E walk rejected', category: 'other', status: 'rejected', review_note: 'Photo missing' },
    ]);
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
    await otp(page, '/login', '9999000003');
    await page.waitForURL(/\/vendor/, { timeout: 40_000 });
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: LOC, url: 'http://localhost:3100' }]); return page.url();
  }
  throw new Error('unknown persona');
}

const checks = () => {
  const out: { kind: string; detail: string }[] = [];
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth) out.push({ kind: 'overflow-x', detail: `scrollWidth ${de.scrollWidth} > ${window.innerWidth}` });
  // elements poking out of the viewport on the right
  const wide = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 2 && !e.closest('.tablewrap, .scroll, [data-scroll], canvas, .chips, nav.tabs') && getComputedStyle(e).position !== 'fixed'; });
  if (wide.length) out.push({ kind: 'poke-out', detail: wide.slice(0, 3).map((e) => `${e.tagName}.${(e as HTMLElement).className}`.slice(0, 60) + ' "' + (e.textContent ?? '').trim().slice(0, 30) + '"').join(' | ') });
  // clipped text: single-line elements whose text is wider than the box and overflow hidden
  const clipped = [...document.querySelectorAll('.t, .s, .btn, .pill, .lbl, .val, h1, h2, th, td, label, button')].filter((e) => {
    const el = e as HTMLElement, cs = getComputedStyle(el);
    return el.scrollWidth > el.clientWidth + 2 && (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.clientWidth > 0;
  });
  if (clipped.length) out.push({ kind: 'clipped', detail: clipped.slice(0, 4).map((e) => `"${(e.textContent ?? '').trim().slice(0, 40)}"`).join(' | ') });
  // contrast
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const parse = (s: string) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).map(Number); return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el: Element) => { for (let e: Element | null = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0.6) return p.rgb; } return [255, 255, 255]; };
  const low: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el), L1 = lum(fg.rgb), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < 3) low.push(`${(el.textContent ?? '').trim().slice(0, 30)} (${ratio.toFixed(1)})`);
  }
  if (low.length) out.push({ kind: 'low-contrast', detail: low.slice(0, 5).join(' | ') + (low.length > 5 ? ` +${low.length - 5}` : '') });
  // leftover English in a non-English locale
  const lang = document.documentElement.lang;
  if (lang !== 'en') {
    const words = new Set<string>();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement; if (!p || ['SCRIPT', 'STYLE', 'OPTION'].includes(p.tagName) || p.closest('canvas, [data-nolang]')) continue;
      const t = (n.textContent ?? '').trim(); if (!t) continue;
      for (const m of t.matchAll(/[A-Za-z][A-Za-z'’&-]{2,}(?:\s+[A-Za-z][A-Za-z'’&-]{2,})*/g)) words.add(m[0]);
    }
    if (words.size) out.push({ kind: 'latin-text', detail: [...words].slice(0, 25).join(' ; ') });
    for (const e of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      for (const a of ['aria-label', 'placeholder', 'title']) { const v = e.getAttribute(a); if (v && /^[A-Za-z][A-Za-z '’&-]{3,}$/.test(v)) words.add(`@${a}:${v}`); }
    }
  }
  return out;
};

test('walk', async ({ page }, info) => {
  test.setTimeout(1_500_000);
  const tag = `${WHO}-${info.project.name}-${LOC}${DARK ? '-dark' : ''}`;
  const findings: Finding[] = [];
  let where = 'setup';
  const add = (kind: string, detail: string) => findings.push({ where, kind, detail: detail.slice(0, 400) });
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!/Download the React DevTools|favicon/.test(t)) add('console-error', t); } });
  page.on('pageerror', (e) => add('pageerror', String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith('http://localhost:3100') && !r.url().includes('_next/webpack-hmr')) add('http-' + r.status(), r.url().replace('http://localhost:3100', '')); });
  page.on('requestfailed', (r) => { const u = r.url(); if (!/_next\/webpack-hmr|rsc|\.map$/.test(u) && r.failure()?.errorText !== 'net::ERR_ABORTED') add('request-failed', `${u} ${r.failure()?.errorText}`); });
  if (DARK) await page.emulateMedia({ colorScheme: 'dark' });

  const landing = await setup(page);
  const queue: string[] = [new URL(landing).pathname + new URL(landing).search];
  const seen = new Set<string>();
  let n = 0;
  if (WHO === 'platform') queue.push('/admin');
  while (queue.length && n < MAX_PAGES) {
    const path = queue.shift()!;
    const key = path.replace(/\?.*$/, '') + (path.includes('view=') || path.includes('tab=') ? path.replace(/^[^?]*/, '') : '');
    if (seen.has(key)) continue;
    seen.add(key); n++;
    where = path;
    const res = await page.goto(path, { waitUntil: 'load' }).catch((e) => { add('goto-failed', String(e)); return null; });
    if (res && res.status() >= 400) add('page-status', String(res.status()));
    await page.waitForTimeout(700);
    for (const f of await page.evaluate(checks)) add(f.kind, f.detail);
    const slug = path.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'root';
    if (process.env.WALK_SHOTS !== '0') await page.screenshot({ path: `${OUT}/${tag}__${slug}.png`, fullPage: true });
    // collect links
    const hrefs = await page.$$eval('a[href^="/"]', (as) => [...new Set(as.map((a) => a.getAttribute('href')!))]);
    for (const h of hrefs) if (!/^\/(api|_next|login|platform\/login)/.test(h) && !seen.has(h.replace(/\?.*$/, '')) ) queue.push(h);
    // forms: open each distinct action button, check the sheet, close
    if (FORMS) {
      const acts = await page.$$eval('[data-act]', (bs) => bs.map((b, i) => ({ i, act: b.getAttribute('data-act')!, text: (b.textContent ?? '').trim().slice(0, 25) })));
      const done = new Set<string>();
      for (const a of acts) {
        if (done.has(a.act) || done.size >= 14 || /^(tally|gstr|stmt|payroll|report|attToday|attCycle|attSubmit)$/.test(a.act)) continue;
        done.add(a.act);
        where = `${path} [${a.act}]`;
        const btn = page.locator('[data-act]').nth(a.i);
        try {
          await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
          await btn.click({ timeout: 3000 });
          const dlg = page.getByRole('dialog');
          await dlg.waitFor({ state: 'visible', timeout: 4000 });
          await page.waitForTimeout(300);
          const over = await page.evaluate(() => { const d = document.querySelector('[role=dialog]') as HTMLElement; return d ? { sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight, bottom: d.getBoundingClientRect().bottom, vh: window.innerHeight } : null; });
          if (over && over.sw > over.cw + 2) add('form-overflow-x', JSON.stringify(over));
          for (const f of await page.evaluate(checks)) if (f.kind !== 'overflow-x' || true) add('form-' + f.kind, f.detail);
          if (process.env.WALK_SHOTS !== '0' && done.size <= 3) await page.screenshot({ path: `${OUT}/${tag}__${slug}__form-${a.act}.png` });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(250);
        } catch (e) { add('form-open-failed', `${a.act} "${a.text}": ${String(e).slice(0, 120)}`); await page.keyboard.press('Escape').catch(() => {}); }
      }
    }
  }
  fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({ tag, pages: [...seen], findings }, null, 1));
  if (WHO === 'vendor') { const { data } = await admin.auth.admin.listUsers({ perPage: 200 }); for (const u of data?.users ?? []) if (u.phone === '919999000003') await admin.auth.admin.deleteUser(u.id); }
  console.log(`WALK ${tag}: ${seen.size} pages, ${findings.length} findings`);
});
void login;
