import { randomUUID as uuid } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tamper, tempBatch, cleanTemp } from './helpers';

// Test plan P2 #17: vaccinations, vet visits and disease cases through the forms (role refusals are in p1-roles,
// other-tenant ids in p1-tenancy). Each test works on its own throw-away batch.
const INVALID = 'Please check the highlighted fields';
const plus = (days: number) => new Date(Date.parse(TODAY) + days * 864e5).toISOString().slice(0, 10);
test.afterEach(cleanTemp);

const vaccine = async () => (await admin.from('vaccine_master').select('id,name').eq('farm_type', 'broiler').limit(1).single()).data!;
const schedule = async (batchId: string) => (await admin.from('vaccination_schedule').select('id,vaccine_id,due_date,done_on').eq('batch_id', batchId).order('due_date')).data!;

/** The batch comes without a schedule (made by the service role), so the page lists only what the test adds. */
async function withVacc(batchId: string, due: string) {
  const v = await vaccine();
  const { data } = await admin.from('vaccination_schedule').insert({ tenant_id: (await admin.from('batch').select('tenant_id').eq('id', batchId).single()).data!.tenant_id, batch_id: batchId, vaccine_id: v.id, due_date: due }).select('id').single();
  return { id: data!.id, name: v.name };
}

test('HLT-02 / HLT-03: owner adds a vaccination to the schedule; blank date and a bad vaccine id are refused', async ({ page }) => {
  const b = await tempBatch('broiler');
  const v = await vaccine();
  await login(page);
  await page.goto(`/farm/batch/${b.code}`);
  const sheet = await openAct(page, 'addVacc', { batch: b.id, ft: 'broiler' });
  await sheet.getByLabel('Vaccine').selectOption(v.id);
  await sheet.getByLabel('Due on').fill('');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('alert')).toContainText(INVALID); // HLT-03: due blank
  expect(await schedule(b.id)).toEqual([]);

  await sheet.getByLabel('Due on').fill(plus(3));
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText('Vaccination added to schedule');
  expect(await schedule(b.id)).toMatchObject([{ vaccine_id: v.id, due_date: plus(3), done_on: null }]);
  await expect(page.locator('.item', { hasText: v.name })).toContainText('Mark done'); // appears in the schedule, not done

  expect(await tamper(page, 'addVacc', { batch_id: b.id, vaccine_id: 'abc', due: plus(3) })).toMatchObject({ ok: false, error: INVALID });
  expect(await schedule(b.id)).toHaveLength(1);
});

test('HLT-05 / HLT-06: a supervisor marks a vaccination done; a blank date is refused; it is then marked Done', async ({ page }) => {
  const b = await tempBatch('broiler');
  const vac = await withVacc(b.id, plus(-2));
  await login(page, PHONES.supervisor);
  await page.goto(`/farm/batch/${b.code}`);
  const row = page.locator('.item', { hasText: vac.name });
  await expect(row).toContainText('Overdue · mark'); // HLT-16 shows here too: due two days ago, not done
  await row.getByRole('button').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Date').fill('');
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(sheet.getByRole('alert')).toContainText(INVALID);
  expect((await schedule(b.id))[0].done_on).toBeNull();

  await sheet.getByLabel('Date').fill(TODAY);
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('.toast')).toContainText('Vaccination marked done');
  expect((await schedule(b.id))[0].done_on).toBe(TODAY);
  await expect(page.locator('.item', { hasText: vac.name }).locator('.pill.good')).toBeVisible();
});

test('HLT-16: a vaccination due yesterday is flagged overdue, one due tomorrow is not', async ({ page }) => {
  const b = await tempBatch('broiler');
  await withVacc(b.id, plus(-1));
  await withVacc(b.id, plus(1));
  await login(page);
  await page.goto(`/farm/batch/${b.code}`);
  expect(await schedule(b.id)).toHaveLength(2);
  await expect(page.locator('.item button', { hasText: 'Overdue · mark' })).toHaveCount(1);
  await expect(page.locator('.item button', { hasText: 'Mark done' })).toHaveCount(1);
});

test('HLT-09 / HLT-10 / HLT-11: a vet logs a visit; blank vet, 1001-character findings and an unknown batch are refused', async ({ page }) => {
  const b = await tempBatch('broiler');
  const restore = await setRole(PHONES.finance, 'veterinarian');
  try {
    await login(page, PHONES.finance);
    await page.goto(`/farm/batch/${b.code}`);
    const sheet = await openAct(page, 'addVisit', { batch: b.id });
    await sheet.getByLabel('Vet name').fill('Dr E2E');
    await sheet.getByLabel('Findings').fill('Mild respiratory signs');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast')).toContainText('Vet visit saved');
    const { data: v } = await admin.from('vet_visit').select('vet_name,findings,visit_date').eq('batch_id', b.id);
    expect(v).toEqual([{ vet_name: 'Dr E2E', findings: 'Mild respiratory signs', visit_date: TODAY }]);
    await expect(page.locator('.s', { hasText: 'Mild respiratory signs' })).toBeVisible();

    const ok = { batch_id: b.id, date: TODAY, vet: 'Dr X' };
    expect(await tamper(page, 'addVisit', { ...ok, vet: '' })).toMatchObject({ ok: false, error: INVALID });
    expect(await tamper(page, 'addVisit', { ...ok, findings: 'f'.repeat(1001) })).toMatchObject({ ok: false, error: INVALID });
    expect(await tamper(page, 'addVisit', { ...ok, batch_id: uuid() })).toMatchObject({ ok: false, error: 'Not found' });
    expect((await admin.from('vet_visit').select('id').eq('batch_id', b.id)).data).toHaveLength(1);
  } finally { await restore(); }
});

test('HLT-13 / HLT-14: a vet confirms an AI case; the owner resolves it', async ({ page }) => {
  const b = await tempBatch('broiler');
  const { data: d } = await admin.from('disease_master').select('code').limit(1).single();
  const { data: c } = await admin.from('disease_case').insert({
    tenant_id: b.tenantId, batch_id: b.id, opened_on: TODAY, disease_code: d!.code, ai_confidence: 0.8, vet_confirmed: false, status: 'open',
  }).select('id').single();
  const state = async () => (await admin.from('disease_case').select('vet_confirmed,status').eq('id', c!.id).single()).data;

  const restore = await setRole(PHONES.finance, 'veterinarian');
  try {
    await login(page, PHONES.finance);
    await page.goto(`/farm/batch/${b.code}`);
    await expect(page.locator('.pill', { hasText: 'Awaiting vet' })).toBeVisible();
    await page.getByRole('button', { name: 'Vet confirm' }).click();
    await expect(page.locator('.toast')).toContainText('Case confirmed by vet');
    expect(await state()).toEqual({ vet_confirmed: true, status: 'open' });
    await expect(page.locator('.pill', { hasText: 'Vet confirmed' })).toBeVisible();
  } finally { await restore(); }

  await login(page);
  await page.goto('/more/health');
  await page.locator('.item', { hasText: b.code }).getByRole('button', { name: 'Resolve' }).click();
  await expect(page.locator('.toast')).toContainText('Case resolved');
  expect(await state()).toEqual({ vet_confirmed: true, status: 'resolved' });
  await expect(page.locator('.item', { hasText: b.code }).getByRole('button', { name: 'Resolve' })).toHaveCount(0);
});
