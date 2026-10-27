import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Shared by the p1-*.spec.ts files. Local Supabase only (the service-role key comes from .env.local).
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export const TODAY = process.env.APP_TODAY ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const FORBIDDEN = 'Your role cannot do this';

export const PHONES = {
  owner: '9849012345', supervisor: '9000033445', finance: '9849022334', ksOwner: '9440012121', platform: '9000000000',
} as const;
const profilePhone = (d: string) => `+91 ${d.slice(0, 5)} ${d.slice(5)}`;

/** OTP login on `path`. Retries once when GoTrue's 1-per-second send limit trips (back-to-back logins). */
export async function otp(page: Page, path: string, mobile: string, code = '123456') {
  await page.goto(path);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  const limited = page.locator('.pill[role=alert]', { hasText: 'only request this after' });
  await expect(page.getByLabel('6-digit code').or(limited)).toBeVisible();
  if (await limited.isVisible()) { await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Send OTP' }).click(); }
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

/** Fresh farm-app session as this seed user, English, broiler view (skips the farm-type picker). */
export async function login(page: Page, mobile: string = PHONES.owner) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await admin.from('app_user').update({ active_farm_type: 'broiler' }).eq('phone', profilePhone(mobile));
  await otp(page, '/login', mobile);
  await expect(page).not.toHaveURL(/\/(login|welcome)/, { timeout: 30_000 }); // first hit compiles the page in dev
}

/** Give a seed user another role for a test (login again afterwards: roles ride in the JWT). Returns the restore. */
export async function setRole(mobile: string, role: string) {
  const { data: u } = await admin.from('app_user').select('id').eq('phone', profilePhone(mobile)).single();
  const { data: au } = await admin.auth.admin.getUserById(u!.id);
  const before = (au.user!.app_metadata.roles as string[]) ?? [];
  const put = (roles: string[]) => admin.auth.admin.updateUserById(u!.id, { app_metadata: { ...au.user!.app_metadata, roles } });
  expect((await put([role])).error).toBeNull();
  return async () => { await put(before); };
}

async function openSheet(page: Page) {
  const sheet = page.getByRole('dialog');
  if (await sheet.isVisible()) {
    if (await sheet.getByLabel('Document').isVisible()) return sheet; // our carrier, left open by an earlier refused call
    await expect(sheet).toBeHidden({ timeout: 10_000 }); // a real form is still closing after its save: let it go first
  }
  await expect(async () => { // the form host listens only once the page has hydrated
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('hp-act', { detail: { act: 'addDoc', ctx: {} } })));
    await expect(sheet.getByLabel('Document')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await sheet.getByLabel('Document').fill('E2E tamper carrier');
  return sheet;
}

export type ActReply = { ok: boolean; msg?: string; error?: string; fields?: string[] };

/**
 * Send `runAct(act, input)` exactly as a tampered browser would: open any form, then swap the server-action
 * request body for ours. Skips the browser-side validation, so this is what the server alone enforces.
 */
export async function tamper(page: Page, act: string, input: Record<string, unknown>, tries = 3): Promise<ActReply> {
  try { return await tamperOnce(page, act, input); } catch (e) { // dev server: a late full reload can swallow the reply
    if (tries <= 1) throw e;
    await page.waitForLoadState('load');
    return tamper(page, act, input, tries - 1);
  }
}

async function tamperOnce(page: Page, act: string, input: Record<string, unknown>): Promise<ActReply> {
  const sheet = await openSheet(page);
  let reply = '';
  const handler = async (route: import('@playwright/test').Route) => {
    const r = route.request();
    if (r.method() !== 'POST' || !r.headers()['next-action']) return route.fallback();
    const res = await route.fetch({ postData: JSON.stringify([act, input]) }); // read the body here: a success refreshes the page
    reply = await res.text();
    await route.fulfill({ response: res, body: reply });
  };
  await page.route('**/*', handler);
  try {
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => reply, { timeout: 20_000 }).not.toBe('');
    const line = reply.split('\n').find((l) => /^1:\{/.test(l));
    return JSON.parse(line!.slice(2)) as ActReply;
  } finally {
    await page.unroute('**/*', handler);
  }
}

/** Same, but for the real form: open any act with ctx and return after the form is visible. */
export async function openAct(page: Page, act: string, ctx: Record<string, unknown> = {}) {
  await expect(async () => {
    await page.evaluate(([a, c]) => window.dispatchEvent(new CustomEvent('hp-act', { detail: { act: a, ctx: c } })), [act, ctx] as const);
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return page.getByRole('dialog');
}

/** A VKR id for each kind of thing a form needs. */
export async function vkr() {
  const one = async (t: string, q?: (b: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = admin.from(t).select('id').limit(1);
    return ((await (q ? q(b) : b)).data as { id: string }[])[0].id;
  };
  const batch = (await admin.from('batch').select('id,code').eq('code', 'VKR-B-2026-14').single()).data!;
  return {
    batchId: batch.id, batchCode: batch.code,
    farmId: await one('farm'), customerId: await one('customer'), vendorId: await one('vendor'),
    workerId: await one('worker'), assetId: await one('asset'), itemId: await one('item'),
    tenantId: (await admin.from('tenant').select('id').eq('name', 'VKR Poultry Farms').single()).data!.id,
  };
}

/** Unique, readable suffix for rows a test creates (the suite re-runs on the same database). */
export const uniq = () => `${Date.now() % 1e7}`;

/** Remove a test batch and everything hanging off it (service role). Safe if it is already gone. */
export async function dropBatch(code: string) {
  const { data: b } = await admin.from('batch').select('id').eq('code', code).maybeSingle();
  if (!b) return;
  const { data: inv } = await admin.from('invoice').select('id').eq('batch_id', b.id);
  if (inv?.length) await admin.from('payment').delete().in('ref_id', inv.map((i) => i.id));
  const { data: bills } = await admin.from('bill').select('id').eq('batch_id', b.id);
  if (bills?.length) await admin.from('payment').delete().in('ref_id', bills.map((i) => i.id));
  for (const t of ['vaccination_schedule', 'mortality_event', 'bill', 'invoice', 'vet_visit', 'batch_state_history']) await admin.from(t).delete().eq('batch_id', b.id);
  const { data: logs } = await admin.from('daily_shed_log').select('id').eq('batch_id', b.id);
  if (logs?.length) await admin.from('egg_production').delete().in('daily_log_id', logs.map((l) => l.id));
  await admin.from('daily_shed_log').delete().eq('batch_id', b.id);
  await admin.from('batch').delete().eq('id', b.id);
}

const tempCodes: string[] = [];
const tempSheds: string[] = [];
/** A running batch placed 30 days before APP_TODAY, in its own new shed (service role). Remove with `cleanTemp()`. */
export async function tempBatch(type: 'broiler' | 'layer') {
  const t = await vkr();
  const farm = (await admin.from('farm').select('id').eq('tenant_id', t.tenantId).eq('farm_type', type).limit(1).single()).data!.id;
  const { data: s } = await admin.from('shed').insert({ tenant_id: t.tenantId, farm_id: farm, name: `E2E-${uniq()}`, shed_type: 'cage', capacity_birds: 5000 }).select('id').single();
  tempSheds.push(s!.id);
  const code = `E2E-${type[0].toUpperCase()}-${uniq()}`;
  tempCodes.push(code);
  const placed = new Date(Date.parse(TODAY) - 30 * 864e5).toISOString().slice(0, 10);
  const { data: b } = await admin.from('batch').insert({
    tenant_id: t.tenantId, farm_id: farm, shed_id: s!.id, code, farm_type: type, placed_on: placed, doc_count: 1000, state: type === 'layer' ? 'laying' : 'growing',
  }).select('id').single();
  return { id: b!.id, code, tenantId: t.tenantId, farmId: farm };
}
export async function cleanTemp() {
  for (const c of tempCodes.splice(0)) {
    const { data: b } = await admin.from('batch').select('id').eq('code', c).maybeSingle();
    if (b) await admin.from('disease_case').delete().eq('batch_id', b.id);
    await dropBatch(c);
  }
  if (tempSheds.length) await admin.from('shed').delete().in('id', tempSheds.splice(0));
}
