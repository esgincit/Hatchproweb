import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tamper } from './helpers';

// Test plan P1 #11 and #12: export access by role, signed-out/unknown kinds, CSV and XML injection, and the salary bank file.
const KINDS = ['tally', 'gstr1', 'statements', 'pnl', 'register', 'bankfile'] as const;
let tenantId: string, farmId: string;
test.beforeAll(async () => {
  const { data: c } = await admin.from('customer').select('tenant_id').limit(1).single();
  tenantId = c!.tenant_id;
  farmId = (await admin.from('farm').select('id').eq('tenant_id', tenantId).limit(1).single()).data!.id;
});

test('MON-43 / PPL-20: finance gets every export; the auditor gets the money ones but not the payroll files', async ({ page }) => {
  await login(page, PHONES.finance);
  for (const k of KINDS) expect((await page.request.get(`/api/export/${k}`)).status(), `finance ${k}`).toBe(200);

  const restore = await setRole(PHONES.finance, 'auditor');
  try {
    await login(page, PHONES.finance);
    for (const k of ['tally', 'gstr1', 'statements', 'pnl'] as const) expect((await page.request.get(`/api/export/${k}`)).status(), `auditor ${k}`).toBe(200);
    for (const k of ['bankfile', 'register'] as const) expect((await page.request.get(`/api/export/${k}`)).status(), `auditor ${k}`).toBe(403);
  } finally { await restore(); }
});

test('MON-45: signed out is refused; an unknown kind is a 404', async ({ page, request }) => {
  const anon = await request.get('/api/export/tally', { maxRedirects: 0 });
  expect([401, 307]).toContain(anon.status()); // 401 from the route, or the middleware's redirect to /login: never a file
  expect(await anon.text()).not.toContain('VOUCHER');
  await login(page);
  expect((await page.request.get('/api/export/xyz')).status()).toBe(404);
});

async function withCustomer<T>(name: string, run: (id: string) => Promise<T>) {
  const { data: c } = await admin.from('customer').insert({ tenant_id: tenantId, name, kind: 'trader' }).select('id').single();
  const no = `E2E-X-${Date.now() % 1e6}`;
  const { data: inv } = await admin.from('invoice').insert({ tenant_id: tenantId, farm_id: farmId, customer_id: c!.id, invoice_no: no, invoice_date: TODAY, due_date: TODAY, product: 'egg', qty: 1, unit: 'egg', rate: 100, total: 100 }).select('id').single();
  try { return await run(c!.id); } finally {
    await admin.from('invoice').delete().eq('id', inv!.id);
    await admin.from('customer').delete().eq('id', c!.id);
  }
}

test('MON-46: a customer named like a formula cannot run in Excel', async ({ page }) => {
  await login(page);
  await withCustomer('=HYPERLINK("http://x")', async () => {
    const body = await (await page.request.get('/api/export/statements')).text();
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`); // neutralised with a leading quote
    expect(body).not.toMatch(/(^|,|\n)"?=HYPERLINK/);
  });
});

test('MON-47: Tally XML escapes & < > in party names', async ({ page }) => {
  await login(page);
  await withCustomer('A & B <Traders>', async () => {
    const body = await (await page.request.get('/api/export/tally')).text();
    expect(body).toContain('<PARTYLEDGERNAME>A &amp; B &lt;Traders&gt;</PARTYLEDGERNAME>');
    expect(body).not.toContain('A & B');
    expect(body).not.toContain('<Traders>');
  });
});

// ---- bank details and the salary bank file ---------------------------------------------------------------------------
test('PPL-15 / PPL-16: bank account and IFSC formats are refused, in the form and by the server', async ({ page }) => {
  await login(page, PHONES.finance);
  await page.goto('/more/people?tab=wages');
  await page.getByRole('button', { name: /Bank details/ }).click();
  const sheet = page.getByRole('dialog');
  const { data: w } = await admin.from('worker').select('id').limit(1).single();
  const before = (await admin.from('worker_bank').select('account_no').eq('worker_id', w!.id)).data;
  const bad = [['12345678', 'SBIN0001234'], ['1'.repeat(19), 'SBIN0001234'], ['12AB5678901', 'SBIN0001234'], ['123456789012', 'SBIN1001234'], ['123456789012', 'SBI0001234'], ['123456789012', 'SBIN000123']];
  for (const [acc, ifsc] of bad) {
    await sheet.getByLabel('Account number').fill(acc);
    await sheet.getByLabel('IFSC').fill(ifsc);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert'), `${acc} / ${ifsc}`).toContainText('Please check the highlighted fields');
  }
  await page.keyboard.press('Escape'); // close this form; tamper() opens its own carrier form
  await expect(sheet).toBeHidden();
  for (const [acc, ifsc] of bad.slice(0, 3).concat(bad.slice(3, 4))) { // the same, bypassing the browser checks
    const r = await tamper(page, 'setBank', { worker_id: w!.id, account_no: acc, ifsc });
    expect(r.ok, `${acc} / ${ifsc}`).toBe(false);
  }
  expect((await admin.from('worker_bank').select('account_no').eq('worker_id', w!.id)).data).toEqual(before);
});

function net(register: string) {
  const out = new Map<string, number>();
  for (const line of register.replace(/^﻿/, '').split('\r\n').slice(1)) { const c = line.split(','); out.set(c[0], Number(c[c.length - 1])); }
  return out;
}

test('PPL-12 / PPL-21: the bank file leaves out workers with no bank details or with net pay of zero or less', async ({ page }) => {
  test.setTimeout(120_000);
  const { data: workers } = await admin.from('worker').select('id,name').eq('tenant_id', tenantId).eq('active', true);
  await login(page);
  const nets = net(await (await page.request.get('/api/export/register')).text());
  const paid = workers!.filter((w) => (nets.get(w.name) ?? 0) > 0);
  expect(paid.length, 'needs two workers with positive net pay in the seed').toBeGreaterThan(1);
  const { data: had } = await admin.from('worker_bank').select('worker_id').in('worker_id', workers!.map((w) => w.id));
  const hadIds = new Set((had ?? []).map((h) => h.worker_id));
  const noBank = paid.find((w) => !hadIds.has(w.id))!;
  const bigAdvance = paid.find((w) => w.id !== noBank.id)!;
  const added = workers!.filter((w) => !hadIds.has(w.id) && w.id !== noBank.id);
  await admin.from('worker_bank').insert(added.map((w) => ({ worker_id: w.id, tenant_id: tenantId, account_no: '123456789012', ifsc: 'SBIN0001234' })));
  try {
    const before = await (await page.request.get('/api/export/bankfile')).text();
    expect(before).toContain(`${bigAdvance.name},123456789012`);
    expect(before).not.toContain(`${noBank.name},`); // PPL-21

    await page.goto('/more/people?tab=wages');
    const sheet = await openAct(page, 'addAdvance', { worker: bigAdvance.id });
    await sheet.getByLabel('Amount (₹)').fill('100000');
    await sheet.getByLabel('Reason (optional)').fill('E2E-PPL12');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toContainText('Advance of ₹1,00,000 recorded');
    const after = await (await page.request.get('/api/export/bankfile')).text();
    expect(after).not.toContain(`${bigAdvance.name},`); // net <= 0 → not paid
    expect(after).toContain('Beneficiary Name,Account Number'); // still a valid file
  } finally {
    await admin.from('worker_advance').delete().eq('reason', 'E2E-PPL12');
    await admin.from('worker_bank').delete().in('worker_id', added.map((w) => w.id));
  }
});
