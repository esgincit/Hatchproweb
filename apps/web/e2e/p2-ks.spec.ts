import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, tamper } from './helpers';

// Test plan P2 #21 (part): contract broiler (CON-02/06/07/08/10/13) and hatchery (HAT-03/04/05/06/09) refusals, as the
// KS Farms owner. The seed rows these touch are put back exactly as they were.
const INVALID = 'Please check the highlighted fields';
const KS_BROILER = 'KS-B-2026-22', KS_HATCH = 'KS-H-2026-37';
let broiler: string, hatch: string, tenant: string, integrator: string, buyer: string;
const batchId = async (code: string) => (await admin.from('batch').select('id').eq('code', code).single()).data!.id as string;

test.beforeAll(async () => {
  [broiler, hatch] = [await batchId(KS_BROILER), await batchId(KS_HATCH)];
  const { data: t } = await admin.from('tenant').select('id').eq('name', 'KS Farms').single();
  tenant = t!.id;
  integrator = (await admin.from('customer').select('id').eq('tenant_id', tenant).eq('kind', 'integrator').limit(1).single()).data!.id;
  buyer = (await admin.from('customer').select('id').eq('tenant_id', tenant).neq('kind', 'integrator').limit(1).single()).data!.id;
});
test.afterEach(async () => {
  await admin.from('batch').update({ contract_id: null }).eq('id', broiler);
  await admin.from('contract').delete().like('name', 'E2E-%');
  await admin.from('hatch_record').delete().eq('batch_id', hatch);
  await admin.from('invoice').delete().eq('batch_id', hatch).eq('product', 'doc');
});

const terms = (o: Record<string, unknown> = {}) => ({
  customer_id: integrator, name: 'E2E-terms', base_rate: 6.5, std_fcr: 1.7, fcr_bonus: 0.1, fcr_penalty: 0.1, min_rate: 0, allowed_mort_pct: 5, mort_penalty: 20, ...o,
});
async function contract(o: Record<string, unknown> = {}) {
  const { data } = await admin.from('contract').insert({ tenant_id: tenant, ...terms(o) }).select('id').single();
  return data!.id as string;
}

test('CON-02 / CON-10 / CON-13: contract terms, settlement numbers and a bad contract id are validated', async ({ page }) => {
  await login(page, PHONES.ksOwner);
  for (const o of [{ std_fcr: 0.9 }, { std_fcr: 4.1 }, { base_rate: 0 }, { fcr_bonus: 101 }, { allowed_mort_pct: 101 }, { mort_penalty: 10001 }, { name: '' }]) {
    expect(await tamper(page, 'addContract', terms(o)), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('contract').select('id').eq('name', 'E2E-terms')).data).toEqual([]);

  const c = await contract();
  await admin.from('batch').update({ contract_id: c }).eq('id', broiler);
  for (const o of [{ lifted_birds: 0 }, { lifted_kg: 0 }, { lifted_kg: -1 }]) {
    expect(await tamper(page, 'settleContract', { batch_id: broiler, date: TODAY, lifted_birds: 100, lifted_kg: 200, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect(await tamper(page, 'linkContract', { batch_id: broiler, contract_id: 'abc' })).toMatchObject({ ok: false, error: INVALID });
  expect((await admin.from('invoice').select('id').eq('batch_id', broiler).eq('product', 'gc')).data).toEqual([]);
});

test('CON-06 / CON-07 / CON-08: linking to a hatchery batch is an error, settling without a contract is an error, a tiny lift has nothing to invoice', async ({ page }) => {
  await login(page, PHONES.ksOwner);
  const c = await contract({ allowed_mort_pct: 0, mort_penalty: 10000 }); // every extra dead bird costs more than a tiny lift earns
  const link = await tamper(page, 'linkContract', { batch_id: hatch, contract_id: c });
  expect(link).toMatchObject({ ok: false, error: 'Only broiler batches can be linked to a contract.' });
  expect((await admin.from('batch').select('contract_id').eq('id', hatch).single()).data!.contract_id).toBeNull();

  expect(await tamper(page, 'settleContract', { batch_id: broiler, date: TODAY, lifted_birds: 100, lifted_kg: 200 })).toMatchObject({ ok: false, error: 'This batch has no contract' });

  expect(await tamper(page, 'linkContract', { batch_id: broiler, contract_id: c })).toMatchObject({ ok: true });
  expect(await tamper(page, 'settleContract', { batch_id: broiler, date: TODAY, lifted_birds: 10, lifted_kg: 15 })).toMatchObject({ ok: false, error: 'Nothing to invoice for these numbers' });
  expect((await admin.from('invoice').select('id').eq('batch_id', broiler).eq('product', 'gc')).data).toEqual([]);
});

test('HAT-03 / HAT-04 / HAT-05 / HAT-06: candling refused for too many clears, a date before setting, a non-hatchery batch, negative or decimal counts', async ({ page }) => {
  await login(page, PHONES.ksOwner);
  const ok = { batch_id: hatch, date: TODAY, clears: 4600, dead_germ: 900 };
  expect(await tamper(page, 'hatchCandle', { ...ok, clears: 57000, dead_germ: 1000 })).toMatchObject({ ok: false, error: expect.stringContaining('exceed eggs set') });
  expect(await tamper(page, 'hatchCandle', { ...ok, date: '2026-10-01' })).toMatchObject({ ok: false, error: 'date is before the eggs were set' });
  expect(await tamper(page, 'hatchCandle', { ...ok, batch_id: broiler })).toMatchObject({ ok: false, error: 'not a hatchery setting' });
  expect(await tamper(page, 'hatchCandle', { ...ok, clears: -1 })).toMatchObject({ ok: false, error: INVALID });
  expect(await tamper(page, 'hatchResult', { batch_id: hatch, date: TODAY, chicks_a: 1.5, chicks_b: 0, culls: 0 })).toMatchObject({ ok: false, error: INVALID });
  expect((await admin.from('hatch_record').select('batch_id').eq('batch_id', hatch)).data).toEqual([]);
});

test('HAT-09: dispatching chicks needs hatch results first, and never more than are in stock', async ({ page }) => {
  await login(page, PHONES.ksOwner);
  const sale = (qty: number) => ({ customer_id: buyer, product: 'doc', qty, unit: 'chick', rate: 32, date: TODAY, batch_id: hatch });
  expect(await tamper(page, 'saleOpen', sale(100))).toMatchObject({ ok: false, error: 'record the hatch results before dispatching chicks' });
  expect(await tamper(page, 'hatchCandle', { batch_id: hatch, date: TODAY, clears: 4600, dead_germ: 900 })).toMatchObject({ ok: true });
  expect(await tamper(page, 'hatchResult', { batch_id: hatch, date: TODAY, chicks_a: 48000, chicks_b: 1500, culls: 600 })).toMatchObject({ ok: true });
  expect(await tamper(page, 'saleOpen', sale(60000))).toMatchObject({ ok: false, error: 'only 49500 chicks left in stock for this setting' });
  expect(await tamper(page, 'saleOpen', sale(49500))).toMatchObject({ ok: true }); // exactly the stock
  expect(await tamper(page, 'saleOpen', sale(1))).toMatchObject({ ok: false, error: 'only 0 chicks left in stock for this setting' });
  expect((await admin.from('invoice').select('qty').eq('batch_id', hatch).eq('product', 'doc')).data!.map((i) => Number(i.qty))).toEqual([49500]);
});
