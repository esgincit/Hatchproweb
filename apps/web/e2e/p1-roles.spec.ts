import { test, expect, type Page } from '@playwright/test';
import { randomUUID as uuid } from 'node:crypto';
import { admin, TODAY as D, PHONES, FORBIDDEN, login, setRole, tamper, vkr } from './helpers';

// Test plan P1 #3 and #4: tab guards per role, and the server refusing every form action outside the role.
// Roles without their own test OTP (labour, auditor, vet, store keeper, manager) are the finance seed user (Rajitha)
// given another role in her JWT for the test; she is put back afterwards.
const RAJITHA = PHONES.finance;
let I: Awaited<ReturnType<typeof vkr>>;
test.beforeAll(async () => { I = await vkr(); });
test.afterAll(async () => { // belt and braces: nothing a refused call could have written may stay
  await admin.from('farm').delete().like('name', 'E2E-TAMPER%');
  await admin.from('customer').delete().like('name', 'E2E-TAMPER%');
});

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Main' }).getByRole('link').evaluateAll((a) => a.map((x) => x.getAttribute('aria-label')));

async function asRole(page: Page, role: string) {
  const restore = await setRole(RAJITHA, role);
  await login(page, RAJITHA);
  return restore;
}

// ---- tab guards -------------------------------------------------------------------------------------------------
const GUARDS: { id: string; role: string; lands: RegExp; tabs: string[]; bounced: [string, RegExp][] }[] = [
  { id: 'AUTH-27', role: 'finance', lands: /\/home$/, tabs: ['Home', 'Money', 'More'], bounced: [['/farm', /\/home$/], ['/log', /\/home$/]] },
  { id: 'AUTH-28', role: 'labour', lands: /\/log$/, tabs: ['Log', 'More'], bounced: [['/home', /\/log$/], ['/money', /\/log$/], ['/farm', /\/log$/]] },
  { id: 'AUTH-29', role: 'store_keeper', lands: /\/home$/, tabs: ['Home', 'More'], bounced: [['/farm', /\/home$/], ['/money', /\/home$/], ['/log', /\/home$/]] },
  { id: 'AUTH-30', role: 'auditor', lands: /\/home$/, tabs: ['Home', 'Farm', 'Money', 'More'], bounced: [['/log', /\/home$/]] },
  { id: 'AUTH-31', role: 'veterinarian', lands: /\/home$/, tabs: ['Home', 'Farm', 'Log', 'More'], bounced: [['/money', /\/home$/]] },
];
for (const g of GUARDS) {
  test(`${g.id}: ${g.role} sees only ${g.tabs.join('/')} and is bounced from the other tabs`, async ({ page }) => {
    const restore = await asRole(page, g.role);
    try {
      await expect(page).toHaveURL(g.lands);
      expect(await tabs(page)).toEqual(g.tabs);
      for (const [path, to] of g.bounced) {
        await page.goto(path);
        await expect(page).toHaveURL(to);
      }
    } finally { await restore(); }
  });
}

test('REP-05: labour, vet and store keeper get a 404 on the daily report; finance and supervisor do not', async ({ page }) => {
  for (const role of ['labour', 'veterinarian', 'store_keeper']) {
    const restore = await asRole(page, role);
    try {
      const r = await page.goto('/report/daily');
      expect(r!.status(), role).toBe(404);
    } finally { await restore(); }
  }
  await login(page, PHONES.supervisor);
  expect((await page.goto('/report/daily'))!.status()).toBe(200);
});

// ---- server refuses the action even when the form is forced open -----------------------------------------------------
type Call = [caseId: string, act: string];
const calls = (): Record<string, Record<string, unknown>> => ({
  addFarm: { name: 'E2E-TAMPER farm', farm_type: 'broiler' },
  addShed: { farm_id: I.farmId, name: 'E2E-TAMPER shed', shed_type: 'cage', capacity: 10 },
  batchState: { batch_id: I.batchId, state: 'growing', date: D },
  closeBatch: { batch_id: I.batchId, date: D },
  mort: { batch_id: I.batchId, date: D, count: 1 },
  saleOpen: { customer_id: I.customerId, product: 'egg', qty: 1, unit: 'egg', rate: 1, date: D },
  addBill: { vendor_id: I.vendorId, category: 'feed', total: 1, date: D },
  payOpen: { kind: 'bill', id: uuid(), amount: 1, mode: 'upi', date: D },
  addCustomer: { name: 'E2E-TAMPER cust', kind: 'trader', phone: '', credit_limit: 0, credit_days: 0 },
  addRate: { product: 'egg', zone: 'E2E-TAMPER', rate: 1, date: D },
  remind: { customer_id: I.customerId, invoice_ids: [uuid()], amount: 1, lang: 'en' },
  addVacc: { batch_id: I.batchId, vaccine_id: uuid(), due: D },
  vaccDone: { vacc_id: uuid(), date: D },
  addVisit: { batch_id: I.batchId, date: D, vet: 'E2E-TAMPER' },
  confirmCase: { case_id: uuid() },
  closeCase: { case_id: uuid() },
  addWorker: { name: 'E2E-TAMPER worker', role: 'helper', farm_id: I.farmId, wage: 1, phone: '' },
  attSet: { worker_id: I.workerId, date: D, status: 'present' },
  addAdvance: { worker_id: I.workerId, amount: 1, date: D },
  setBank: { worker_id: I.workerId, account_no: '123456789', ifsc: 'SBIN0001234' },
  addAsset: { farm_id: I.farmId, name: 'E2E-TAMPER asset', category: 'fan', next_service: D, date: D },
  reportIssue: { asset_id: I.assetId, issue: 'E2E-TAMPER', priority: 'low', date: D },
  closeTicket: { ticket_id: uuid(), date: D },
  serviceDone: { asset_id: I.assetId, date: D, next_service: '2027-01-01' },
  addItem: { name: 'E2E-TAMPER item', category: 'other', unit: 'kg' },
  raisePO: { vendor_id: I.vendorId, item_id: I.itemId, qty: 1, rate: 1, expected: D, date: D },
  grnOpen: { po_id: uuid(), qty: 1, bill_amount: 1, date: D },
  addVendor: { name: 'E2E-TAMPER vendor', category: 'other', terms: 0, phone: '' },
  addContract: { customer_id: I.customerId, name: 'E2E-TAMPER', base_rate: 1, std_fcr: 1.6, fcr_bonus: 0, fcr_penalty: 0, min_rate: 0, allowed_mort_pct: 0, mort_penalty: 0 },
  linkContract: { batch_id: I.batchId, contract_id: uuid() },
  settleContract: { batch_id: I.batchId, date: D, lifted_birds: 1, lifted_kg: 1 },
  hatchCandle: { batch_id: I.batchId, date: D, clears: 0, dead_germ: 0 },
  hatchResult: { batch_id: I.batchId, date: D, chicks_a: 0, chicks_b: 0, culls: 0 },
  inviteUser: { name: 'E2E-TAMPER', phone: '9876500001', role: 'labour', language: 'en' },
  addDoc: { name: 'E2E-TAMPER doc' },
  decidePay: { approval_id: uuid(), approve: 'yes' },
});

const REFUSED: { who: string; role: string | null; list: Call[] }[] = [
  { who: 'supervisor', role: null, list: [
    ['FARM-04', 'addFarm'], ['FARM-08', 'addShed'], ['FARM-23', 'batchState'], ['FARM-29', 'closeBatch'], ['MON-06', 'saleOpen'], ['MON-10', 'addBill'],
    ['MON-25', 'payOpen'], ['MON-30', 'addCustomer'], ['MON-34', 'addRate'], ['MON-38', 'remind'], ['PPL-04', 'addWorker'], ['PPL-13', 'addAdvance'],
    ['PPL-18', 'setBank'], ['EQP-05', 'addAsset'], ['EQP-14', 'closeTicket'], ['EQP-17', 'serviceDone'], ['STK-05', 'addItem'], ['STK-10', 'raisePO'],
    ['STK-16', 'grnOpen'], ['VND-07', 'addVendor'], ['CON-03', 'addContract'], ['CON-11', 'settleContract'], ['HLT-15', 'confirmCase'],
    ['HLT-15', 'closeCase'], ['DOC-05', 'addDoc'],
  ] },
  { who: 'finance', role: 'finance', list: [
    ['FARM-04', 'addFarm'], ['FARM-08', 'addShed'], ['FARM-29', 'closeBatch'], ['LOG-27', 'mort'], ['HLT-04', 'addVacc'], ['HLT-07', 'vaccDone'],
    ['HLT-12', 'addVisit'], ['HLT-15', 'confirmCase'], ['HLT-15', 'closeCase'], ['PPL-04', 'addWorker'], ['PPL-08', 'attSet'], ['EQP-05', 'addAsset'],
    ['EQP-09', 'reportIssue'], ['EQP-14', 'closeTicket'], ['STK-05', 'addItem'], ['STK-16', 'grnOpen'], ['CON-05', 'linkContract'],
    ['HAT-08', 'hatchCandle'], ['HAT-08', 'hatchResult'], ['USR-06', 'inviteUser'], ['DOC-05', 'addDoc'], ['MON-23', 'decidePay'],
  ] },
  { who: 'labour', role: 'labour', list: [['HLT-04', 'addVacc'], ['HLT-07', 'vaccDone'], ['HLT-12', 'addVisit'], ['PPL-08', 'attSet']] },
  { who: 'store keeper', role: 'store_keeper', list: [['LOG-27', 'mort'], ['MON-06', 'saleOpen'], ['MON-10', 'addBill'], ['MON-30', 'addCustomer'], ['HLT-04', 'addVacc'], ['EQP-05', 'addAsset'], ['VND-07', 'addVendor']] },
  { who: 'vet', role: 'veterinarian', list: [['EQP-09', 'reportIssue'], ['HAT-08', 'hatchCandle'], ['HAT-08', 'hatchResult']] },
  { who: 'manager', role: 'farm_manager', list: [['USR-06', 'inviteUser'], ['MON-23', 'decidePay']] },
];

for (const r of REFUSED) {
  test(`server refuses tampered actions for the ${r.who}: ${r.list.map((c) => c[0]).filter((x, i, a) => a.indexOf(x) === i).join(' ')}`, async ({ page }) => {
    test.setTimeout(180_000);
    const restore = r.role ? await asRole(page, r.role) : (await login(page, PHONES.supervisor), async () => {});
    try {
      const input = calls();
      for (const [id, act] of r.list) {
        const reply = await tamper(page, act, input[act]);
        expect.soft(reply.ok, `${id} ${r.who} ${act}`).toBe(false);
        expect.soft(reply.error, `${id} ${r.who} ${act}`).toContain(FORBIDDEN);
      }
    } finally { await restore(); }
    for (const [t, col] of [['farm', 'name'], ['customer', 'name'], ['vendor', 'name'], ['worker', 'name'], ['asset', 'name'], ['item', 'name'], ['contract', 'name'], ['tenant_document', 'name']] as const) {
      const { count } = await admin.from(t).select('id', { count: 'exact', head: true }).like(col, 'E2E-TAMPER%');
      expect(count, `${t} rows written by a refused call`).toBe(0);
    }
  });
}

test('a manager may still do what the role allows (control: the tamper helper does not just always fail)', async ({ page }) => {
  const restore = await asRole(page, 'farm_manager');
  try {
    const reply = await tamper(page, 'addDoc', { name: 'E2E-TAMPER doc' });
    expect(reply.ok).toBe(true);
  } finally {
    await admin.from('tenant_document').delete().like('name', 'E2E-TAMPER%');
    await restore();
  }
});
