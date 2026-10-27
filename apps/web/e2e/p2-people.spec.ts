import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, openAct, tamper, uniq, vkr } from './helpers';

// Test plan P2 #18: workers, the attendance cycle, month register, wage maths, advances, replacing bank details.
// Works on a new "E2E-" worker (removed afterwards) so no seed worker's attendance or pay is touched.
const INVALID = 'Please check the highlighted fields';
const MONTH = TODAY.slice(0, 7); // APP_TODAY month: 31 days in the fixture month
let I: Awaited<ReturnType<typeof vkr>>;
test.beforeAll(async () => { I = await vkr(); });
test.afterEach(async () => {
  const { data: w } = await admin.from('worker').select('id').like('name', 'E2E-%');
  const ids = (w ?? []).map((x) => x.id);
  if (!ids.length) return;
  for (const t of ['attendance', 'worker_advance', 'worker_bank']) await admin.from(t).delete().in('worker_id', ids);
  await admin.from('worker').delete().in('id', ids);
});

async function newWorker(wage = 6200) {
  const name = `E2E-Ramu-${uniq()}`;
  const { data } = await admin.from('worker').insert({ tenant_id: I.tenantId, farm_id: I.farmId, name, role: 'helper', wage_rate: wage }).select('id').single();
  return { id: data!.id, name };
}
const att = async (id: string) => (await admin.from('attendance').select('att_date,status').eq('worker_id', id).order('att_date')).data!;
const day = (n: number) => `${MONTH}-${String(n).padStart(2, '0')}`;

test('PPL-02 / PPL-03: owner adds a worker who then shows in the attendance list; bad name, wage and phone are refused', async ({ page }) => {
  const name = `E2E-Add-${uniq()}`;
  await login(page);
  await page.goto('/more/people');
  const sheet = await openAct(page, 'addWorker');
  await sheet.getByLabel('Name').fill(name);
  await sheet.getByLabel('Monthly wage (₹)').fill('450');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(`Worker added · ${name}`);
  await expect(page.locator('.item', { hasText: name })).toBeVisible();
  expect((await admin.from('worker').select('role,wage_rate').eq('name', name).single()).data).toEqual({ role: 'helper', wage_rate: 450 });

  const ok = { name: 'E2E-bad', role: 'helper', farm_id: I.farmId, wage: 450, phone: '' };
  for (const o of [{ name: '' }, { wage: 0 }, { wage: -1 }, { phone: '9'.repeat(21) }]) {
    expect(await tamper(page, 'addWorker', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('worker').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('PPL-06: tapping P, then A, then L leaves one attendance row with the last status', async ({ page }) => {
  const w = await newWorker();
  await login(page, PHONES.supervisor);
  await page.goto('/more/people');
  const row = page.locator('.item', { hasText: w.name });
  for (const [k, status] of [['P', 'present'], ['A', 'absent'], ['L', 'leave']] as const) {
    await row.getByRole('button', { name: k, exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('Attendance saved');
    await expect(row.locator(`button.on.${k}`)).toBeVisible();
    expect(await att(w.id)).toEqual([{ att_date: TODAY, status }]);
  }
});

test('PPL-07: changing a past day in the month register updates the row and the payable days', async ({ page }) => {
  test.setTimeout(90_000); // the register renders 31 days x every worker
  const w = await newWorker();
  await login(page);
  await page.goto('/more/people?tab=month');
  const payable = () => page.locator('tbody tr', { hasText: w.name }).last().locator('td').last();
  await expect(payable()).toHaveText('0');
  const cell = page.getByRole('button', { name: new RegExp(`^${w.name} ${day(6)}`) }); // label gains the status once set; // a Tuesday, long past
  await cell.click(); // blank -> P
  await expect(page.locator('.toast').last()).toContainText('Attendance saved');
  expect(await att(w.id)).toEqual([{ att_date: day(6), status: 'present' }]);
  await expect(payable()).toHaveText('1');
  await cell.click(); // P -> H
  await expect.poll(async () => (await att(w.id))[0]?.status).toBe('half');
  await expect(payable()).toHaveText('0.5');
});

test('PPL-09 / PPL-10 / PPL-11: wages follow attendance (half day = 1/2), an advance comes off the net, bad advances refused', async ({ page }) => {
  const w = await newWorker(6200); // Rs 200 a day in a 31-day month
  const rows = [...Array.from({ length: 17 }, (_, i) => ({ d: i + 1, s: 'present' })), { d: 18, s: 'half' }, { d: 19, s: 'half' }];
  expect((await admin.from('attendance').insert(rows.map((r) => ({ tenant_id: I.tenantId, worker_id: w.id, att_date: day(r.d), status: r.s })))).error).toBeNull();
  await login(page, PHONES.finance);
  await page.goto('/more/people?tab=wages');
  const line = () => page.locator('tbody tr', { hasText: w.name }).last();
  await expect(line()).toContainText('18/31'); // 17 + 2 x 0.5
  await expect(line()).toContainText('₹3,600'); // round(6200 x 18 / 31)

  const sheet = await openAct(page, 'addAdvance');
  await sheet.getByLabel('Worker').selectOption({ label: w.name });
  await sheet.getByLabel('Amount (₹)').fill('2000');
  await sheet.getByLabel('Reason (optional)').fill('festival');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Advance of ₹2,000 recorded');
  await expect(line()).toContainText('₹1,600'); // 3,600 - 2,000
  await expect(page.locator('.item', { hasText: 'festival' })).toContainText(w.name);

  const ok = { worker_id: w.id, amount: 100, date: TODAY };
  for (const o of [{ amount: 0 }, { amount: -1 }, { reason: 'r'.repeat(201) }]) {
    expect(await tamper(page, 'addAdvance', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('worker_advance').select('amount').eq('worker_id', w.id)).data).toEqual([{ amount: 2000 }]);
});

test('PPL-17: saving bank details again replaces them (one row, new account)', async ({ page }) => {
  const w = await newWorker();
  await login(page);
  await page.goto('/more/people?tab=wages');
  for (const [acc, ifsc] of [['111122223333', 'SBIN0001234'], ['999988887777', 'hdfc0000123']]) {
    const sheet = await openAct(page, 'setBank');
    await sheet.getByLabel('Worker').selectOption({ label: w.name });
    await sheet.getByLabel('Account number').fill(acc);
    await sheet.getByLabel('IFSC').fill(ifsc);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast').last()).toContainText('Bank details saved');
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  expect((await admin.from('worker_bank').select('account_no,ifsc').eq('worker_id', w.id)).data).toEqual([{ account_no: '999988887777', ifsc: 'HDFC0000123' }]);
});
