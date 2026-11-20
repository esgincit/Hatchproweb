import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID as uuid } from 'node:crypto';
import { admin, PHONES, FORBIDDEN, login, setRole, tamper, uniq } from './helpers';

// ERP WP 1.1 / 1.2: egg transfer (draft -> submitted -> approved -> received) -> setting sources -> hatch trace.
// KS Farms owner; supplier-sourced eggs (the seed has no breeder flock), plus a breeder flock fixture for the flock page.
// Placed 2026-10-04 in the seed, so every fixture date sits before that and no egg is older than the 7-day rule.
const SETTING = 'KS-H-2026-37';
const INVALID = 'Please check the highlighted fields';
let tenant: string, setting: string, hatchFarm: string, vendor: string;

/** Locked rows (approved / received) cannot be deleted through the API, so cleanup goes around the triggers in SQL. */
function sql(q: string) {
  execFileSync('docker', ['exec', 'supabase_db_poultryos', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `set session_replication_role = replica; ${q}`], { stdio: 'pipe' });
}
const T = () => `(select id from tenant where name = 'KS Farms')`;
function clean() {
  sql(`delete from setting_lot where tenant_id = ${T()};
       delete from hatch_record where batch_id in (select id from batch where tenant_id = ${T()} and (code like 'E2E-BR-%' or code = '${SETTING}'));
       delete from egg_transfer where tenant_id = ${T()};
       delete from tenant_rule where tenant_id = ${T()};
       delete from batch where code like 'E2E-BR-%'; delete from shed where name like 'E2E-BR-%'; delete from farm where name like 'E2E-BR-%';
       delete from vendor where name = 'E2E-Eggs'`);
}

/** An egg transfer at the given status (service role: no approver check). */
async function transfer(o: { qty?: number; rejects?: number; laid?: [string, string]; flock?: string; status?: 'submitted' | 'approved' | 'received' } = {}) {
  const [from, to] = o.laid ?? ['2026-09-30', '2026-10-02'];
  if (o.flock) { // own flock: 0039 caps qty at collected eggs, which this spec does not model, so write the row around the trigger
    const id = uuid(), ref = `E2E-${uniq()}-F`;
    sql(`insert into egg_transfer (id, tenant_id, ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status, received_qty, received_on)
         values ('${id}', '${tenant}', '${ref}', '${o.flock}', '${hatchFarm}', '${from}', '${to}', '${to}', ${o.qty ?? 1000}, 'received', ${o.qty ?? 1000}, '2026-10-03')`);
    return { id, ref };
  }
  const { data, error } = await admin.from('egg_transfer').insert({
    tenant_id: tenant, ref: `E2E-${uniq()}-${Math.floor(Math.random() * 1e4)}`, to_farm_id: hatchFarm, laid_from: from, laid_to: to, sent_on: to, qty: o.qty ?? 1000,
    source_vendor_id: vendor, status: 'submitted',
  }).select('id,ref').single();
  expect(error).toBeNull();
  const st = o.status ?? 'received';
  if (st !== 'submitted') expect((await admin.from('egg_transfer').update({ status: 'approved' }).eq('id', data!.id)).error).toBeNull();
  if (st === 'received') {
    const r = await admin.from('egg_transfer').update({ status: 'received', received_qty: o.qty ?? 1000, receipt_rejects: o.rejects ?? 0, received_on: '2026-10-03' }).eq('id', data!.id);
    expect(r.error).toBeNull();
  }
  return data!;
}

test.beforeAll(async () => {
  clean();
  tenant = (await admin.from('tenant').select('id').eq('name', 'KS Farms').single()).data!.id;
  setting = (await admin.from('batch').select('id').eq('code', SETTING).single()).data!.id;
  hatchFarm = (await admin.from('farm').select('id').eq('tenant_id', tenant).eq('farm_type', 'hatchery').limit(1).single()).data!.id;
  vendor = (await admin.from('vendor').insert({ tenant_id: tenant, name: 'E2E-Eggs', category: 'doc_hatchery' }).select('id').single()).data!.id;
});
test.afterAll(() => clean());
test.beforeEach(async () => {
  sql(`delete from setting_lot where tenant_id = ${T()}; delete from egg_transfer where tenant_id = ${T()}; delete from tenant_rule where tenant_id = ${T()};
       delete from hatch_record where batch_id = '${setting}'`);
});

test('TRC-01: create -> submit -> approve -> receive -> load setting -> trace, with the estimated badge once two sources mix', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/more/transfers');
  await expect(page.getByText('No egg transfers yet.')).toBeVisible();

  await page.getByRole('button', { name: '+ New transfer' }).click();
  let sheet = page.getByRole('dialog', { name: 'New egg transfer' });
  await sheet.getByLabel('Source').selectOption({ label: 'Supplier · E2E-Eggs' });
  await sheet.getByLabel('Laid from').fill('2026-09-30');
  await sheet.getByLabel('Laid to').fill('2026-10-02');
  await sheet.getByLabel('Sent on').fill('2026-10-02');
  await sheet.getByLabel('Eggs sent').fill('1000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  const saved = page.getByText(/Transfer ET-\S+ saved/);
  await expect(saved).toBeVisible({ timeout: 20_000 });
  const ref = /ET-\S+/.exec((await saved.textContent())!)![0];
  const row = page.locator(`[data-ref="${ref}"]`);
  await expect(row).toContainText('Awaiting approval', { timeout: 20_000 });

  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toContainText('Approved', { timeout: 20_000 });

  await row.getByRole('button', { name: 'Receive' }).click();
  sheet = page.getByRole('dialog', { name: 'Receive eggs' });
  await sheet.getByLabel('Eggs counted').fill('1000');
  await sheet.getByLabel('Rejected on arrival').fill('100');
  await sheet.getByLabel('Received on').fill('2026-10-03');
  await sheet.getByRole('button', { name: 'Receive' }).click();
  await expect(row).toContainText('Received 1,000 · 100 rejected', { timeout: 20_000 });

  await page.goto(`/farm/batch/${SETTING}`);
  const src = page.getByTestId('egg-sources');
  await expect(src).toContainText('No sources loaded yet.');
  await src.getByRole('button', { name: '+ Load eggs' }).click();
  sheet = page.getByRole('dialog', { name: 'Load eggs into this setting' });
  await expect(sheet.getByLabel('Eggs to load')).toHaveValue('900'); // received 1000 - 100 rejected
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('900 eggs loaded into the setting')).toBeVisible({ timeout: 20_000 });
  await expect(src).toContainText(ref, { timeout: 20_000 });
  await expect(src).toContainText('900 of 57,600 eggs sourced');
  const trace = page.getByTestId('hatch-trace');
  await expect(trace).toContainText('Bought-in eggs');
  await expect(page.getByTestId('estimated-badge')).toHaveCount(0); // one source: nothing to estimate

  const second = await transfer({ qty: 300 });
  await page.reload();
  await page.getByTestId('egg-sources').getByRole('button', { name: '+ Load eggs' }).click();
  sheet = page.getByRole('dialog', { name: 'Load eggs into this setting' });
  await expect(sheet.getByLabel('Eggs to load')).toHaveValue('300'); // the first transfer has nothing left to offer
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('egg-sources')).toContainText(second.ref, { timeout: 20_000 });
  await expect(page.getByTestId('estimated-badge')).toBeVisible();
  await expect(page.getByTestId('hatch-trace').locator('tbody tr')).toHaveCount(2);
});

test('TRC-02: roles and the DB rules hold when the form is bypassed', async ({ page }) => {
  test.setTimeout(240_000);
  const waiting = await transfer({ status: 'submitted' });
  const approved = await transfer({ status: 'approved' });
  const received = await transfer({ qty: 500, rejects: 0 });
  const old = await transfer({ qty: 500, laid: ['2026-09-20', '2026-09-22'] }); // 14 days old on the 4th: over the 7-day limit

  const restore = await setRole(PHONES.ksOwner, 'hatchery_technician');
  try {
    await login(page, PHONES.ksOwner);
    for (const [act, input] of [
      ['decideTransfer', { transfer_id: waiting.id, decision: 'approve' }],
      ['cancelTransfer', { transfer_id: approved.id }],
      ['addTransfer', { vendor_id: vendor, to_farm_id: hatchFarm, laid_from: '2026-09-30', laid_to: '2026-10-02', sent_on: '2026-10-02', qty: 10, status: 'draft' }],
      ['setRule', { key: 'egg_max_storage_days', value: '20' }],
    ] as const) {
      const r = await tamper(page, act, input);
      expect.soft(r, act).toMatchObject({ ok: false });
      expect.soft(r.error, act).toContain(FORBIDDEN);
    }
    // a technician may receive, and may not set over-age eggs
    const rcv = await tamper(page, 'receiveTransfer', { transfer_id: approved.id, received_qty: 50, rejects: 0, date: '2026-10-03', note: 'short count' });
    expect(rcv, JSON.stringify(rcv)).toMatchObject({ ok: true });
    expect(await tamper(page, 'loadSetting', { batch_id: setting, transfer_id: old.id, qty: 100 })).toMatchObject({ ok: false, error: expect.stringContaining('override reason') });
    expect(await tamper(page, 'loadSetting', { batch_id: setting, transfer_id: old.id, qty: 100, age_override_reason: 'strong breeder flock' }))
      .toMatchObject({ ok: false, error: expect.stringContaining('only the owner or hatchery operations manager') });
  } finally { await restore(); }
  expect((await admin.from('egg_transfer').select('status').eq('id', waiting.id).single()).data!.status).toBe('submitted');

  // hatchery ops manager: over-age with a reason is allowed
  const ops = await setRole(PHONES.ksOwner, 'hatchery_ops_manager');
  try {
    await login(page, PHONES.ksOwner);
    expect(await tamper(page, 'loadSetting', { batch_id: setting, transfer_id: old.id, qty: 100, age_override_reason: 'strong breeder flock' })).toMatchObject({ ok: true });
  } finally { await ops(); }

  // the owner: still bound by what is left, by the reject reason, and by the dates
  await login(page, PHONES.ksOwner);
  expect(await tamper(page, 'loadSetting', { batch_id: setting, transfer_id: received.id, qty: 501 })).toMatchObject({ ok: false, error: expect.stringContaining('only 500 settable eggs left') });
  expect(await tamper(page, 'loadSetting', { batch_id: setting, transfer_id: waiting.id, qty: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('must be received') });
  expect(await tamper(page, 'decideTransfer', { transfer_id: waiting.id, decision: 'reject' })).toMatchObject({ ok: false, error: INVALID });
  expect(await tamper(page, 'decideTransfer', { transfer_id: uuid(), decision: 'approve' })).toMatchObject({ ok: false, error: 'Not found' });
  expect(await tamper(page, 'receiveTransfer', { transfer_id: approved.id, received_qty: 5, rejects: 0, date: '2026-10-03' })).toMatchObject({ ok: false }); // already received above
  expect(await tamper(page, 'receiveTransfer', { transfer_id: waiting.id, received_qty: 10, rejects: 0, date: '2026-10-03' })).toMatchObject({ ok: false }); // not approved yet
  expect(await tamper(page, 'receiveTransfer', { transfer_id: received.id, received_qty: 10, rejects: 11, date: '2026-10-03' })).toMatchObject({ ok: false, error: INVALID });
  expect(await tamper(page, 'cancelTransfer', { transfer_id: received.id })).toMatchObject({ ok: false }); // received transfers cannot be cancelled
  expect(await tamper(page, 'setRule', { key: 'egg_max_storage_days', value: 'abc' })).toMatchObject({ ok: false, error: INVALID });
  expect(await tamper(page, 'setRule', { key: 'sneaky', value: '1' })).toMatchObject({ ok: false, error: INVALID });

  // rules: the owner turns self-approval off, so the submitter can no longer approve
  expect(await tamper(page, 'setRule', { key: 'allow_self_approval', value: 'no' })).toMatchObject({ ok: true });
  // submitted_by is stamped from the login (0037), so submit through the app as the owner
  expect(await tamper(page, 'addTransfer', { vendor_id: vendor, to_farm_id: hatchFarm, laid_from: '2026-09-30', laid_to: '2026-10-02', sent_on: '2026-10-02', qty: 10, status: 'submitted' })).toMatchObject({ ok: true });
  const mine = (await admin.from('egg_transfer').select('id').eq('tenant_id', tenant).eq('qty', 10).single()).data!.id;
  expect(await tamper(page, 'decideTransfer', { transfer_id: mine, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining('cannot approve') });
  expect(await tamper(page, 'decideTransfer', { transfer_id: mine, decision: 'reject', reason: 'cracked in transit' })).toMatchObject({ ok: true });
  expect((await admin.from('tenant_rule').select('value').eq('tenant_id', tenant).eq('key', 'allow_self_approval').single()).data!.value).toBe(false);
});

test('TRC-03: the owner sees and edits the rules; the breeder flock page shows its transfers and hatch feedback', async ({ page }) => {
  test.setTimeout(180_000);
  const { data: farm } = await admin.from('farm').insert({ tenant_id: tenant, name: 'E2E-BR-farm', farm_type: 'breeder' }).select('id').single();
  const { data: shed } = await admin.from('shed').insert({ tenant_id: tenant, farm_id: farm!.id, name: 'E2E-BR-shed', shed_type: 'deep_litter', capacity_birds: 5000 }).select('id').single();
  const code = `E2E-BR-${uniq()}`;
  const { data: flock, error } = await admin.from('batch').insert({
    tenant_id: tenant, farm_id: farm!.id, shed_id: shed!.id, code, farm_type: 'breeder', placed_on: '2026-03-01', doc_count: 3000, state: 'laying',
  }).select('id').single();
  expect(error).toBeNull();
  const t = await transfer({ qty: 1000, flock: flock!.id });
  expect((await admin.from('setting_lot').insert({ tenant_id: tenant, batch_id: setting, transfer_id: t.id, qty: 1000 })).error).toBeNull();
  expect((await admin.from('hatch_record').insert({ tenant_id: tenant, batch_id: setting, candled_on: '2026-10-22', clears: 4600, dead_germ: 900 })).error).toBeNull();
  expect((await admin.from('hatch_record').update({ hatched_on: '2026-10-25', chicks_a: 48000, chicks_b: 1500, culls: 600 }).eq('batch_id', setting)).error).toBeNull();

  await login(page, PHONES.ksOwner);
  await page.goto('/more');
  await expect(page.getByTestId('rules-card')).toContainText('Max egg storage');
  await expect(page.getByTestId('rules-card')).toContainText('7 days');
  await page.getByTestId('rules-card').getByRole('button', { name: 'Change' }).nth(1).click();
  const sheet = page.getByRole('dialog', { name: 'Change rule' });
  await sheet.getByLabel('Days (1–30)').fill('10');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('rules-card')).toContainText('10 days', { timeout: 20_000 });

  await page.goto(`/farm/batch/${code}`);
  await expect(page.getByTestId('flock-transfers')).toContainText(t.ref);
  const fb = page.getByTestId('flock-feedback');
  await expect(fb).toContainText(SETTING);
  // one source: the whole setting is this flock's, so the numbers are measured rather than estimated
  await expect(fb.getByTestId('estimated-badge')).toHaveCount(0);
  await expect(fb.locator('tbody tr')).toHaveCount(1);
});

test('TRC-04: a manager gets the approve button but not the owner-only rules card', async ({ page }) => {
  await transfer({ status: 'submitted' });
  const restore = await setRole(PHONES.ksOwner, 'farm_manager');
  try {
    await login(page, PHONES.ksOwner);
    await page.goto('/more');
    await expect(page.getByTestId('rules-card')).toHaveCount(0); // owner only
    await page.goto('/more/transfers');
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible(); // a manager is the approver
  } finally { await restore(); }
});
