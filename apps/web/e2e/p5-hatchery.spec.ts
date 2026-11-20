import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID as uuid } from 'node:crypto';
import { admin, TODAY, PHONES, FORBIDDEN, login, openAct, setRole, tamper, uniq } from './helpers';

// ERP WP 1.3–1.10: breeder flock -> eggs -> transfer -> new setting -> setter -> D10 -> D18 -> hatcher -> hatch -> release -> quality
// -> vaccination -> KPIs, all through the real forms as the KS Farms owner; then the approval roles and tenant rules.
// Every date sits on or before APP_TODAY and after the seed, so the 7-day egg rule and "not in the future" both hold.
test.describe.configure({ mode: 'serial' });
const day = (n: number) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const KS = `(select id from tenant where name = 'KS Farms')`;
const B = `(select id from batch where tenant_id = ${KS} and code like 'E2E-H%')`;
let tenant: string, hatchFarm: string, breederShed: string, hatchShed: string, flockCode: string, settingCode: string;

/** Locked rows cannot be deleted through the API, so cleanup goes around the triggers in SQL (replica role: no FK cascade, so children go first). */
function sql(q: string) {
  execFileSync('docker', ['exec', 'supabase_db_poultryos', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `set session_replication_role = replica; ${q}`], { stdio: 'pipe' });
}
function clean() {
  const kids = ['chick_vaccination', 'chick_quality_inspection', 'machine_release', 'hatch_record', 'hatcher_transfer', 'candling', 'setting_lot', 'breeder_daily',
    'body_weight_record', 'hatching_egg_collection', 'medication_record', 'vaccination_schedule', 'batch_state_history'];
  sql(`${kids.map((t) => `delete from ${t} where batch_id in ${B};`).join(' ')}
       delete from egg_transfer where tenant_id = ${KS};
       delete from env_reading where asset_id in (select id from asset where name like 'E2E-%') or shed_id in (select id from shed where name like 'E2E-H%');
       delete from biosecurity_incident where farm_id in (select id from farm where name like 'E2E-H%');
       delete from batch where code like 'E2E-H%';
       delete from asset where name like 'E2E-%' and machine_kind is not null;
       delete from shed where name like 'E2E-H%'; delete from farm where name like 'E2E-H%';
       delete from tenant_rule where tenant_id = ${KS};
       delete from notification where tenant_id = ${KS} and (title like '%E2E-H%' or title like '%E2E-S%' or title like '%ET-%' or title like 'Expired vaccine%')`);
}

test.beforeAll(async () => {
  clean();
  tenant = (await admin.from('tenant').select('id').eq('name', 'KS Farms').single()).data!.id;
  hatchFarm = (await admin.from('farm').select('id').eq('tenant_id', tenant).eq('farm_type', 'hatchery').limit(1).single()).data!.id;
  const { data: bf } = await admin.from('farm').insert({ tenant_id: tenant, name: 'E2E-HF-farm', farm_type: 'breeder' }).select('id').single();
  breederShed = (await admin.from('shed').insert({ tenant_id: tenant, farm_id: bf!.id, name: 'E2E-HF-shed', shed_type: 'deep_litter', capacity_birds: 5000 }).select('id').single()).data!.id;
  hatchShed = (await admin.from('shed').insert({ tenant_id: tenant, farm_id: hatchFarm, name: 'E2E-HS-shed', shed_type: 'deep_litter', capacity_birds: 100000 }).select('id').single()).data!.id;
  flockCode = `E2E-HF-${uniq()}`;
  settingCode = `E2E-HS-${uniq()}`;
});
test.afterAll(() => clean());

/** Click until the form is open (the host listens only once the page has hydrated). */
async function open(page: Page, btn: Locator, name: string) {
  const dlg = page.getByRole('dialog', { name });
  await expect(async () => {
    if (!(await dlg.isVisible())) await btn.click();
    await expect(dlg).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  return dlg;
}
async function send(dlg: Locator, button = 'Save') {
  await dlg.getByRole('button', { name: button, exact: true }).click();
  try { await expect(dlg).toBeHidden({ timeout: 20_000 }); } catch { throw new Error('form stayed open: ' + (await dlg.innerText())); }
}
const n = (dlg: Locator, label: string | RegExp, v: string | number) => dlg.getByLabel(label, { exact: typeof label === 'string' }).fill(String(v));
const step = (page: Page, id: string) => page.getByTestId(id);
const status = (loc: Locator, text: string) => expect(loc).toContainText(text, { timeout: 20_000 });

test('HAT-01: breeder flock, eggs, transfer, then one full hatch cycle through to KPIs', async ({ page }) => {
  test.setTimeout(420_000);
  await login(page, PHONES.ksOwner);
  await page.goto('/farm');

  // ---- flock with a female / male split
  let dlg = await openAct(page, 'addBatch', { shed: breederShed });
  await expect(dlg.getByLabel('Females placed')).toBeVisible();
  await expect(dlg.getByLabel('Chicks placed')).toHaveCount(0); // a breeder flock is females + males
  await dlg.getByLabel('Batch code').fill(flockCode);
  await n(dlg, 'Placed on', day(-48));
  await n(dlg, 'Females placed', 300);
  await n(dlg, 'Males placed', 30);
  await send(dlg, 'Place batch');
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${flockCode}`), { timeout: 30_000 });
  const flock = await admin.from('batch').select('id,doc_count,females_placed,males_placed').eq('code', flockCode).single();
  expect(flock.data).toMatchObject({ doc_count: 330, females_placed: 300, males_placed: 30 });

  // ---- daily record: reject, correct, approve
  const daily = step(page, 'breeder-daily');
  const record = async (date: string, fMort: number) => {
    const d = await open(page, daily.getByRole('button', { name: '+ Daily record' }), 'Daily breeder record');
    await n(d, 'Date', date); await n(d, 'Female deaths', fMort); await n(d, 'Male deaths', 0);
    await n(d, 'Female feed (kg)', 30); await n(d, 'Male feed (kg)', 3); await n(d, 'Water (L)', 900);
    await send(d, 'Submit for approval');
  };
  await record(day(-8), 1);
  await status(daily, 'Awaiting approval');
  await daily.getByRole('button', { name: 'Reject' }).click();
  dlg = page.getByRole('dialog', { name: 'Reject record' });
  await dlg.getByLabel('Reason').fill('feed weight looks wrong');
  await send(dlg, 'Reject');
  await status(daily, 'Reason: feed weight looks wrong');
  await record(day(-8), 1); // correcting a rejected record re-submits it
  await daily.getByRole('button', { name: 'Approve' }).click();
  await status(daily, 'Approved');
  await expect(daily.locator('tbody tr')).toHaveCount(1);
  await record(day(-7), 1);
  await daily.getByRole('button', { name: 'Approve' }).click();
  await expect(daily.locator('tbody tr')).toHaveCount(2);
  await expect(daily).not.toContainText('Awaiting approval', { timeout: 20_000 });

  // ---- body weight: a tiny male sample is flagged
  const weights = step(page, 'breeder-weights');
  for (const [sex, sample, avg] of [['F', 10, 1500], ['M', 2, 2000]] as const) {
    const d = await open(page, weights.getByRole('button', { name: '+ Weight' }), 'Weekly body weight');
    await n(d, 'Weighed on', day(-7)); await d.getByLabel('Sex').selectOption(sex);
    await n(d, 'Sample size', sample); await n(d, 'Average weight (g)', avg);
    if (sex === 'M') await n(d, /^Fleshing score/, 3);
    await send(d);
  }
  await expect(weights.locator('tbody tr')).toHaveCount(2, { timeout: 20_000 });
  await expect(weights.getByTestId('sample-small')).toHaveCount(1); // 2 of 30 males is under the 10% / 3-bird minimum

  // ---- egg collection -> settable eggs, store, approval
  const eggs = step(page, 'breeder-eggs');
  let d = await open(page, eggs.getByRole('button', { name: '+ Collection' }), 'Hatching-egg collection');
  await n(d, 'Collected on', day(-7)); await n(d, /^Collection no\./, 1);
  await n(d, 'Nest eggs', 500); await n(d, 'Floor eggs', 10); await n(d, 'Broken', 20); await n(d, 'Cracked', 10);
  await send(d);
  await expect(step(page, 'egg-store')).toContainText('470 collected · 0 sent', { timeout: 20_000 }); // 500 nest - 30 rejects; floor eggs are not settable
  await expect(eggs.locator('tbody tr').last()).toContainText('Awaiting approval');
  await eggs.getByRole('button', { name: 'Approve' }).click();
  await expect(eggs.locator('tbody tr').last()).toContainText('Approved', { timeout: 20_000 });
  await expect(eggs).toContainText('92.2%'); // settable 470 of 510 collected that day
  await expect(eggs).toContainText('2.0%'); // floor 10 of 510
  await expect(step(page, 'breeder-calendar')).toContainText('Light stimulation');

  // ---- health + house
  d = await open(page, step(page, 'breeder-health').getByRole('button', { name: '+ Medication' }), 'Medication');
  await n(d, 'Medicine', 'E2E-Tylosin'); await n(d, 'Dosage', '0.5 g/L'); await n(d, 'Days of treatment', 3); await d.getByLabel('Reason').fill('respiratory signs');
  await send(d);
  d = await open(page, step(page, 'breeder-health').getByRole('button', { name: '+ Biosecurity' }), 'Biosecurity incident');
  await d.getByLabel('What happened').fill('Visitor entered without footbath');
  await send(d);
  await expect(step(page, 'breeder-health')).toContainText('E2E-Tylosin · 0.5 g/L · 3 days', { timeout: 20_000 });
  await expect(step(page, 'breeder-health')).toContainText('Visitor entered without footbath');
  d = await open(page, step(page, 'breeder-house').getByRole('button', { name: '+ Reading' }), 'House reading');
  await n(d, 'Temperature (°C)', 28.5); await n(d, 'Humidity (%)', 60); await d.getByLabel('Litter').selectOption('good');
  await send(d);
  await expect(step(page, 'breeder-house')).toContainText('28.5', { timeout: 20_000 });

  // ---- transfer own eggs -> approve -> receive
  d = await open(page, step(page, 'flock-transfers').getByRole('button', { name: '+ New transfer' }), 'New egg transfer');
  await d.getByLabel('Source').selectOption({ label: `Flock · ${flockCode}` });
  await n(d, 'Laid from', day(-9)); await n(d, 'Laid to', day(-7)); await n(d, 'Sent on', day(-6)); await n(d, 'Eggs sent', 450);
  await d.getByRole('button', { name: 'Save' }).click();
  const saved = page.getByText(/Transfer ET-\S+ saved/);
  await expect(saved).toBeVisible({ timeout: 20_000 });
  const ref = /ET-\S+/.exec((await saved.textContent())!)![0];
  const row = page.locator(`[data-ref="${ref}"]`);
  await expect(row).toContainText('Awaiting approval', { timeout: 20_000 });
  await row.getByRole('button', { name: 'Approve' }).click();
  await status(row, 'Approved');
  await row.getByRole('button', { name: 'Receive' }).click();
  dlg = page.getByRole('dialog', { name: 'Receive eggs' });
  await n(dlg, 'Eggs counted', 450); await n(dlg, 'Rejected on arrival', 0); await n(dlg, 'Received on', day(-5));
  await send(dlg, 'Receive');
  await status(row, 'Received 450');
  await page.goto(`/farm/batch/${flockCode}`);
  await expect(step(page, 'egg-store')).toContainText('470 collected · 450 sent', { timeout: 20_000 });

  // ---- machines: a setter and a hatcher, both available
  await page.goto('/more/machines');
  for (const [name, no, kind] of [['E2E-Setter', 'S-1', 'setter'], ['E2E-Hatcher', 'H-1', 'hatcher']] as const) {
    const m = await open(page, step(page, 'machines').getByRole('button', { name: '+ Machine' }), 'Add a machine');
    await n(m, 'Name', name); await n(m, 'Machine no.', no); await m.getByLabel('Type').selectOption(kind); await n(m, 'Capacity (eggs)', 1000);
    await send(m);
    await expect(page.locator(`[data-name="${name}"]`)).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.locator('[data-name="E2E-Setter"]').getByTestId('machine-state')).toHaveText('Available');

  // ---- the new setting, eggs from the transfer
  await page.goto('/farm');
  dlg = await openAct(page, 'addBatch', { shed: hatchShed });
  await dlg.getByLabel('Batch code').fill(settingCode);
  await n(dlg, 'Placed on', day(-5)); await n(dlg, 'Chicks placed', 450);
  await send(dlg, 'Place batch');
  await expect(page).toHaveURL(new RegExp(`/farm/batch/${settingCode}`), { timeout: 30_000 });
  d = await open(page, step(page, 'egg-sources').getByRole('button', { name: '+ Load eggs' }), 'Load eggs into this setting');
  await expect(d.getByLabel('Eggs to load')).toHaveValue('450');
  await send(d);
  await expect(step(page, 'egg-sources')).toContainText(ref, { timeout: 20_000 });
  // full-flow setting: the legacy single candling form is not offered
  await expect(step(page, 'hatch-card').getByRole('button', { name: /Candling/ })).toHaveCount(0);

  const flow = step(page, 'hatch-flow');
  d = await open(page, step(page, 'flow-setter').getByRole('button', { name: 'Load into setter' }), 'Load into setter');
  await send(d);
  await expect(step(page, 'flow-setter')).toContainText('E2E-Setter', { timeout: 20_000 });

  // ---- D10 candling: submit -> approve
  const d10 = step(page, 'flow-d10');
  d = await open(page, d10.getByRole('button', { name: 'Record' }), 'Candling · day 10');
  await n(d, 'Candled on', day(-4)); await n(d, 'Infertile', 45); await n(d, 'Early dead', 10); await n(d, 'Dirty / exploded', 5);
  await send(d);
  await status(d10, 'Awaiting approval');
  await d10.getByRole('button', { name: 'Approve' }).click();
  await status(d10, 'Approved');
  await expect(d10).toContainText('45 infertile · 10 early dead · 5 dirty');

  // ---- D18 candling
  const d18 = step(page, 'flow-d18');
  d = await open(page, d18.getByRole('button', { name: 'Record' }), 'Candling · day 18');
  await expect(d.getByLabel('Eggs candled')).toHaveValue('390'); // 450 - 45 - 10 - 5 live at day 10
  await n(d, 'Candled on', day(-3)); await n(d, 'Mid dead', 8); await n(d, 'Late dead', 2);
  await send(d);
  await d18.getByRole('button', { name: 'Approve' }).click();
  await status(d18, 'Approved');

  // ---- to the hatcher
  const xfer = step(page, 'flow-xfer');
  d = await open(page, xfer.getByRole('button', { name: 'Record' }), 'Move to hatcher');
  await expect(d.getByLabel('Eggs moved')).toHaveValue('380'); // 390 - 8 - 2
  await n(d, 'Moved on', day(-2));
  await send(d);
  await xfer.getByRole('button', { name: 'Approve' }).click();
  await status(xfer, 'Approved');
  await expect(xfer).toContainText('380 eggs → E2E-Hatcher');

  // ---- hatch
  const hatch = step(page, 'flow-hatch');
  d = await open(page, hatch.getByRole('button', { name: 'Record' }), 'Hatch results');
  await n(d, 'Hatched on', day(-1)); await n(d, 'Grade A chicks', 300); await n(d, 'Grade B chicks', 40); await n(d, 'Culls', 10);
  await n(d, 'Dead in hatcher', 15); await n(d, 'Unhatched eggs', 15);
  await send(d);
  await status(hatch, 'Awaiting approval');
  await hatch.getByRole('button', { name: 'Approve' }).click();
  await status(hatch, 'Approved');
  await expect(hatch).toContainText('300 grade A · 40 grade B · 10 culls');

  // machine state follows the batch: hatcher is cleaning until released, the setter is free again
  await page.goto('/more/machines');
  await expect(page.locator('[data-name="E2E-Hatcher"]').getByTestId('machine-state')).toHaveText('Cleaning', { timeout: 20_000 });
  await expect(page.locator('[data-name="E2E-Setter"]').getByTestId('machine-state')).toHaveText('Available');
  d = await open(page, page.locator('[data-name="E2E-Hatcher"]').getByRole('button', { name: '+ Reading' }), 'Reading · E2E-Hatcher');
  await n(d, 'Temperature (°C)', 37.5); await n(d, 'Humidity (%)', 55); await n(d, 'Fan (rpm)', 1500); await d.getByLabel('Alarm on').selectOption('no');
  await send(d);
  await expect(page.locator('[data-name="E2E-Hatcher"]').getByTestId('machine-compliance')).toContainText('1 of 48 readings · temperature in range 100.0% · humidity in range 100.0%', { timeout: 20_000 });
  await page.goto(`/farm/batch/${settingCode}`);

  // ---- release hatcher: every tick needed
  const rel = step(page, 'flow-release');
  d = await open(page, rel.getByRole('button', { name: 'Release' }), 'Release hatcher');
  await d.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('Please check the highlighted fields'); // nothing ticked
  for (const l of ['Chicks removed and counted', 'Waste recorded', 'Cleaned', 'Disinfected', 'Checked']) await d.getByLabel(l, { exact: true }).selectOption('yes');
  await send(d, 'Release');
  await expect(rel).toContainText('Released', { timeout: 20_000 });
  await page.goto('/more/machines');
  await expect(page.locator('[data-name="E2E-Hatcher"]').getByTestId('machine-state')).toHaveText('Available', { timeout: 20_000 });
  await page.goto(`/farm/batch/${settingCode}`);

  // ---- chick quality -> approve
  const quality = step(page, 'flow-quality');
  d = await open(page, quality.getByRole('button', { name: 'Record' }), 'Chick quality');
  await n(d, 'Inspected on', day(0)); await n(d, 'Sample size', 50); await n(d, 'Average weight (g)', 42);
  await send(d);
  await quality.getByRole('button', { name: 'Approve' }).click();
  await status(quality, 'Approved');

  // ---- vaccination: a good lot, then an expired lot is flagged (policy: warn)
  const vacc = step(page, 'flow-vacc');
  d = await open(page, vacc.getByRole('button', { name: '+ Vaccinate' }), 'Vaccinate chicks');
  await expect(d.getByLabel('Chicks vaccinated')).toHaveValue('340');
  await n(d, 'Lot no.', 'LOT-OK'); await n(d, 'Expiry date', '2027-12-31');
  await send(d);
  await expect(vacc.getByTestId('vacc-row')).toHaveCount(1, { timeout: 20_000 });
  d = await open(page, vacc.getByRole('button', { name: '+ Vaccinate' }), 'Vaccinate chicks');
  await d.getByLabel('Vaccine').selectOption({ index: 1 });
  await n(d, 'Lot no.', 'LOT-OLD'); await n(d, 'Expiry date', '2026-01-01'); await n(d, 'Chicks vaccinated', 10);
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Lot LOT-OLD is expired/)).toBeVisible({ timeout: 20_000 });
  await expect(vacc.getByText('Expired')).toBeVisible({ timeout: 20_000 });

  // ---- KPIs per the dictionary: eggs set 450, infertile 45, early/mid/late dead 10/8/2, transfer 380, A+B+culls 350, A+B 340
  const kpi = (k: string) => step(page, 'hatch-kpi').getByTestId(`kpi-${k}`);
  await expect(kpi('fertility')).toHaveText('90.00%');
  await expect(kpi('hes')).toHaveText('77.78%');
  await expect(kpi('hof')).toHaveText('86.42%');
  await expect(kpi('hot')).toHaveText('92.11%');
  await expect(kpi('early')).toHaveText('2.22%');
  await expect(kpi('embryo')).toHaveText('4.44%');
  await expect(kpi('cull')).toHaveText('2.86%');
  await expect(kpi('dih')).toHaveText('3.95%');
  await expect(kpi('e2c')).toHaveText('75.56%');
  await expect(step(page, 'stock-saleable')).toHaveText('340');
  await expect(step(page, 'chick-stock')).toContainText('Cleared'); // quality approved and eligible
  await expect(flow).toBeVisible();
});

/** A hatchery setting at a chosen point of the flow, written as the service role (no approver check). */
async function setting(upTo: 'candling1' | 'hatch') {
  const code = `E2E-HS-${uniq()}-${Math.floor(Math.random() * 1e3)}`;
  const { data: b, error } = await admin.from('batch').insert({
    tenant_id: tenant, farm_id: hatchFarm, shed_id: hatchShed, code, farm_type: 'hatchery', placed_on: day(-5), doc_count: 400, state: 'placed', full_hatch_flow: true,
  }).select('id').single();
  expect(error).toBeNull();
  const id = b!.id as string;
  const cand = (stage: number, on: string, rest: Record<string, number>) => admin.from('candling').insert({ tenant_id: tenant, batch_id: id, stage, candled_on: on, eggs_candled: 400, ...rest }).select('id').single();
  const c1 = await cand(1, day(-4), { infertile: 40, early_dead: 10, dirty: 0 });
  expect(c1.error).toBeNull();
  if (upTo === 'candling1') return { id, code, candling: c1.data!.id as string };
  expect((await admin.from('candling').update({ status: 'approved' }).eq('id', c1.data!.id)).error).toBeNull();
  const c2 = await cand(2, day(-3), { mid_dead: 5, late_dead: 5 });
  expect(c2.error).toBeNull();
  expect((await admin.from('candling').update({ status: 'approved' }).eq('id', c2.data!.id)).error).toBeNull();
  const hatcher = (await admin.from('asset').select('id').eq('name', 'E2E-Hatcher').single()).data!.id;
  const x = await admin.from('hatcher_transfer').insert({ tenant_id: tenant, batch_id: id, hatcher_id: hatcher, moved_on: day(-2), eggs: 340 }).select('id').single();
  expect(x.error).toBeNull();
  expect((await admin.from('hatcher_transfer').update({ status: 'approved' }).eq('id', x.data!.id)).error).toBeNull();
  const h = await admin.from('hatch_record').insert({ tenant_id: tenant, batch_id: id, hatched_on: day(-1), chicks_a: 300, chicks_b: 20, culls: 10, dead_in_hatcher: 5, unhatched: 5 }).select('id').single();
  expect(h.error).toBeNull();
  // free the hatcher again so the next setting can use it
  const rel = await admin.from('machine_release').insert({ tenant_id: tenant, batch_id: id, hatcher_id: hatcher, chicks_removed: true, waste_recorded: true, cleaned: true, disinfected: true, inspected: true });
  expect(rel.error).toBeNull();
  return { id, code, candling: c1.data!.id as string, hatch: h.data!.id as string };
}

test('HAT-02: each approval belongs to its role, and the DB rules show through the form', async ({ page }) => {
  test.setTimeout(300_000);
  const pending = await setting('candling1');
  const full = await setting('hatch');
  const setter = (await admin.from('asset').select('id').eq('name', 'E2E-Setter').single()).data!.id;

  // a technician records and loads, but cannot approve candling or the hatch
  let restore = await setRole(PHONES.ksOwner, 'hatchery_technician');
  try {
    await login(page, PHONES.ksOwner);
    await page.goto(`/farm/batch/${pending.code}`);
    await expect(step(page, 'flow-d10')).toContainText('Awaiting approval', { timeout: 30_000 });
    await expect(step(page, 'flow-d10').getByRole('button', { name: 'Approve' })).toHaveCount(0); // the button is hidden for this role...
    for (const [act, input] of [
      ['decideCandling', { id: pending.candling, decision: 'approve' }],
      ['decideHatch', { id: full.hatch, decision: 'approve' }],
      ['decideXfer', { id: uuid(), decision: 'approve' }],
      ['decideQuality', { id: uuid(), decision: 'approve' }],
      ['releaseHatcher', { batch_id: full.id, chicks_removed: 'yes', waste_recorded: 'yes', cleaned: 'yes', disinfected: 'yes', inspected: 'yes' }],
      ['setRule', { key: 'simple_hatch_flow', value: 'yes' }],
    ] as const) {
      const r = await tamper(page, act, input); // ...and the server refuses it too
      expect.soft(r, act).toMatchObject({ ok: false });
      expect.soft(r.error, act).toContain(FORBIDDEN);
    }
    expect(await tamper(page, 'loadSetter', { batch_id: pending.id, setter_id: setter })).toMatchObject({ ok: true });
    expect((await admin.from('candling').select('status').eq('id', pending.candling).single()).data!.status).toBe('submitted');
  } finally { await restore(); }

  // hatchery ops manager approves candling and the hatcher transfer, not the hatch
  restore = await setRole(PHONES.ksOwner, 'hatchery_ops_manager');
  try {
    await login(page, PHONES.ksOwner);
    await page.goto(`/farm/batch/${pending.code}`);
    const r = await tamper(page, 'decideCandling', { id: pending.candling, decision: 'approve' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(await tamper(page, 'decideHatch', { id: full.hatch, decision: 'approve' })).toMatchObject({ ok: false, error: expect.stringContaining(FORBIDDEN) });
    expect(await tamper(page, 'decideCandling', { id: pending.candling, decision: 'approve' })).toMatchObject({ ok: false }); // already decided
  } finally { await restore(); }

  // hatchery manager approves the hatch (and only that), through the buttons on the page
  restore = await setRole(PHONES.ksOwner, 'hatchery_manager');
  try {
    await login(page, PHONES.ksOwner);
    await page.goto(`/farm/batch/${full.code}`);
    const hatch = step(page, 'flow-hatch');
    await expect(hatch).toContainText('Awaiting approval', { timeout: 30_000 });
    await expect(step(page, 'flow-d10').getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await hatch.getByRole('button', { name: 'Approve' }).click();
    await status(hatch, 'Approved');
  } finally { await restore(); }
});

test('HAT-03: tenant rules from the owner card change what the DB allows', async ({ page }) => {
  test.setTimeout(240_000);
  const full = await setting('hatch');
  const vaccine = (await admin.from('vaccine_master').select('id').limit(1).single()).data!.id;
  const lot = { batch_id: full.id, vaccine_id: vaccine, qty: 5, expiry: '2026-01-01' };
  await login(page, PHONES.ksOwner);
  await page.goto('/more');
  const rules = step(page, 'rules-card');
  await expect(rules.locator('[data-rule]')).toHaveCount(15);
  const rule = rules.locator('[data-rule="expired_vaccine_policy"]');
  await expect(rule).toContainText('Warn only');
  await rule.getByRole('button', { name: 'Change' }).click();
  const dlg = page.getByRole('dialog', { name: 'Change rule' });
  await dlg.getByLabel('Expired vaccine').selectOption('block');
  await send(dlg);
  await expect(rule).toContainText('Block', { timeout: 20_000 });

  // block: an expired lot needs a reason from the owner / hatchery manager
  expect(await tamper(page, 'chickVaccine', { ...lot, vaccine_lot: 'OLD-1' })).toMatchObject({ ok: false, error: expect.stringContaining('not allowed') });
  expect(await tamper(page, 'chickVaccine', { ...lot, vaccine_lot: 'OLD-1', override_reason: 'only lot in stock, vet agreed' })).toMatchObject({ ok: true });
  const tech = await setRole(PHONES.ksOwner, 'hatchery_technician');
  try {
    await login(page, PHONES.ksOwner);
    expect(await tamper(page, 'chickVaccine', { ...lot, vaccine_lot: 'OLD-2', override_reason: 'try' })).toMatchObject({ ok: false, error: expect.stringContaining('only the owner or hatchery manager') });
  } finally { await tech(); }

  // thresholds: minimum must stay below maximum; unknown keys / junk values are refused
  await login(page, PHONES.ksOwner);
  expect(await tamper(page, 'setRule', { key: 'machine_temp_min_c', value: '38.5' })).toMatchObject({ ok: false });
  expect(await tamper(page, 'setRule', { key: 'machine_temp_min_c', value: '37.0' })).toMatchObject({ ok: true });
  expect(await tamper(page, 'setRule', { key: 'expired_vaccine_policy', value: 'ignore' })).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  expect(await tamper(page, 'setRule', { key: 'incubation_days', value: '3' })).toMatchObject({ ok: false, error: 'Please check the highlighted fields' });
  expect((await admin.from('tenant_rule').select('value').eq('tenant_id', tenant).eq('key', 'machine_temp_min_c').single()).data!.value).toBe(37);
});
