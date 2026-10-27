import { test, expect } from '@playwright/test';
import { admin, TODAY as D, PHONES, login, tamper, vkr } from './helpers';

// Test plan P1 #5 and #6: another tenant's ids and URLs through the UI, and a suspended tenant writing through forms.
const KS = 'b146bf5d-6213-556e-8e71-8d4c156ad36d';
let I: Awaited<ReturnType<typeof vkr>>;
test.beforeAll(async () => { I = await vkr(); });

test('AUTH-33: another tenant\'s batch URL shows nothing of theirs', async ({ page }) => {
  await login(page, PHONES.ksOwner);
  const res = await page.goto('/farm/batch/VKR-B-2026-14');
  expect(res!.status()).toBe(404);
  await expect(page.locator('.h2', { hasText: 'VKR-B-2026-14' })).toHaveCount(0);
});

test('AUTH-34: a farm owner cannot open the platform tenant page', async ({ page }) => {
  await login(page);
  await page.goto(`/admin/tenant/${KS}`);
  await expect(page).toHaveURL(/\/home$/);
});

test('LOG-17: KS owner cannot write mortality or a daily log onto a VKR batch', async ({ page }) => {
  const count = async () => (await admin.from('mortality_event').select('id', { count: 'exact', head: true }).eq('batch_id', I.batchId)).count;
  const logs = async () => (await admin.from('daily_shed_log').select('id', { count: 'exact', head: true }).eq('batch_id', I.batchId).eq('log_date', D)).count;
  const [m0, l0] = [await count(), await logs()];
  await login(page, PHONES.ksOwner);
  const mort = await tamper(page, 'mort', { batch_id: I.batchId, date: D, count: 3 });
  expect(mort.ok).toBe(false);
  const log = await tamper(page, 'logSave', { batch_id: I.batchId, date: D, mortality: 1, culls: 0, feed_bags: 1 });
  expect(log.ok).toBe(false);
  expect([await count(), await logs()]).toEqual([m0, l0]);
});

test('HLT-08 and friends: acting on another tenant\'s vaccination, case or asset says so — never a false "done"', async ({ page }) => {
  const { data: v } = await admin.from('vaccination_schedule').select('id,done_on,batch!inner(tenant_id)').eq('batch.tenant_id', I.tenantId).is('done_on', null).limit(1).single();
  const { data: c } = await admin.from('disease_case').select('id,status,vet_confirmed').eq('tenant_id', I.tenantId).single();
  const { data: a } = await admin.from('asset').select('id,next_service_on,status').eq('id', I.assetId).single();
  await login(page, PHONES.ksOwner);
  const replies = {
    vaccDone: await tamper(page, 'vaccDone', { vacc_id: v!.id, date: D }),
    confirmCase: await tamper(page, 'confirmCase', { case_id: c!.id }),
    closeCase: await tamper(page, 'closeCase', { case_id: c!.id }),
    serviceDone: await tamper(page, 'serviceDone', { asset_id: a!.id, date: D, next_service: '2027-06-01' }),
  };
  for (const [act, r] of Object.entries(replies)) expect.soft(r.ok, `${act} must not report success`).toBe(false);
  expect((await admin.from('vaccination_schedule').select('done_on').eq('id', v!.id).single()).data!.done_on).toBeNull();
  expect((await admin.from('disease_case').select('status,vet_confirmed').eq('id', c!.id).single()).data).toEqual({ status: c!.status, vet_confirmed: c!.vet_confirmed });
  expect((await admin.from('asset').select('next_service_on,status').eq('id', a!.id).single()).data).toEqual({ next_service_on: a!.next_service_on, status: a!.status });
});

test('CON-04: a contract cannot point at another tenant\'s customer', async ({ page }) => {
  const { data: other } = await admin.from('customer').select('id').eq('tenant_id', KS).limit(1).single();
  await login(page);
  try {
    const r = await tamper(page, 'addContract', { customer_id: other!.id, name: 'E2E-XT contract', base_rate: 6, std_fcr: 1.6, fcr_bonus: 0, fcr_penalty: 0, min_rate: 0, allowed_mort_pct: 0, mort_penalty: 0 });
    expect(r.ok).toBe(false);
    expect((await admin.from('contract').select('id').eq('name', 'E2E-XT contract')).data).toEqual([]);
  } finally { await admin.from('contract').delete().eq('name', 'E2E-XT contract'); }
});

test('LOG-28 (UI side of the 0033 guard): a log or mortality on a closed batch shows the error, not success', async ({ page }) => {
  const { data: b } = await admin.from('batch').select('id').eq('code', 'VKR-B-2026-13').eq('state', 'closed').single();
  await login(page);
  const log = await tamper(page, 'logSave', { batch_id: b!.id, date: D, mortality: 1, culls: 0, feed_bags: 1 });
  expect(log.ok).toBe(false);
  expect(log.error).toContain('batch is closed');
  const mort = await tamper(page, 'mort', { batch_id: b!.id, date: D, count: 1 });
  expect(mort.ok).toBe(false);
});

test('AUTH-39 / 40 / 41: a suspended tenant cannot write through tampered forms; the other tenant can; reactivating restores access', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { data: before } = await admin.from('tenant').select('plan,status').eq('id', KS).single();
  const cust = (name: string) => ({ name, kind: 'trader', phone: '', credit_limit: 0, credit_days: 0 });
  const owner = await (await browser.newContext()).newPage();
  try {
    await login(page, PHONES.ksOwner);
    expect((await tamper(page, 'addCustomer', cust('E2E-SUSP control'))).ok).toBe(true); // works while active

    await admin.from('tenant').update({ status: 'suspended' }).eq('id', KS);
    const blocked = await tamper(page, 'addCustomer', cust('E2E-SUSP blocked')); // the page is still open, as a tampered form would be
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('Your role cannot do this');
    expect((await admin.from('customer').select('id').eq('name', 'E2E-SUSP blocked')).data).toEqual([]);

    await login(owner); // AUTH-41: VKR is untouched
    expect((await tamper(owner, 'addCustomer', cust('E2E-SUSP vkr'))).ok).toBe(true);

    await admin.from('tenant').update({ status: 'active' }).eq('id', KS); // AUTH-40
    await login(page, PHONES.ksOwner);
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('alert').filter({ hasText: 'Account suspended' })).toHaveCount(0);
  } finally {
    await admin.from('tenant').update(before!).eq('id', KS);
    await admin.from('customer').delete().like('name', 'E2E-SUSP%');
    await owner.context().close();
  }
});
