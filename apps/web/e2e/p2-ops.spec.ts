import { test, expect } from '@playwright/test';
import { admin, TODAY, PHONES, login, setRole, openAct, tamper, uniq, tempBatch, cleanTemp } from './helpers';

// Test plan P2 #21 (part): labour shift form (SHIFT-03/04/05/06/09/11), compliance documents (DOC-02/03/04),
// notifications read state (NOT-05), invite validation (USR-03/05).
const INVALID = 'Please check the highlighted fields';
const plus = (days: number) => new Date(Date.parse(TODAY) + days * 864e5).toISOString().slice(0, 10);
test.afterEach(async () => {
  await cleanTemp();
  await admin.from('tenant_document').delete().like('name', 'E2E-%');
});

test('SHIFT-03 / 04 / 05 / 06 / 11: a labourer adds a night entry; limits 500 bags and 100,000 litres; minus stops at 0', async ({ page }) => {
  test.setTimeout(120_000);
  const b = await tempBatch('broiler');
  const restore = await setRole(PHONES.finance, 'labour');
  try {
    await login(page, PHONES.finance);
    await page.goto('/log');
    await expect(page).toHaveURL(/\/log$/); // labour's only tab
    await page.goto(`/log?batch=${b.code}`);
    const form = page.getByTestId('shift-form');
    await expect(form).toBeVisible(); // SHIFT-03: big-button form is the default for labour
    const toast = page.locator('.toast');
    const day = async () => (await admin.from('daily_shed_log').select('mortality,culls,feed_kg,water_litres').eq('batch_id', b.id).maybeSingle()).data;

    const dead = form.getByLabel('Dead birds', { exact: true });
    await form.getByRole('button', { name: 'Dead birds −' }).click(); // SHIFT-11
    await expect(dead).toHaveValue('0');
    await form.getByRole('button', { name: 'Dead birds +' }).click();
    await form.getByRole('button', { name: 'Dead birds +' }).click();
    await form.getByRole('button', { name: 'Dead birds −' }).click();
    await expect(dead).toHaveValue('1');

    await form.getByRole('radio', { name: 'Night' }).click(); // SHIFT-04
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect(toast.last()).toContainText('Night entry saved');
    await expect.poll(async () => (await day())?.mortality).toBe(1);
    await expect(dead).toHaveValue('0'); // the form resets once the save is finished
    await form.getByRole('button', { name: 'Dead birds +' }).click();
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect.poll(async () => (await day())?.mortality).toBe(2); // the second entry adds, it does not replace
    await expect(dead).toHaveValue('0');

    const bags = form.getByLabel('Feed bags (50 kg)', { exact: true });
    await bags.fill('501'); // SHIFT-05
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect(toast.last()).toContainText(INVALID);
    expect(Number((await day())!.feed_kg)).toBe(0);
    await bags.fill('500');
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect.poll(async () => Number((await day())!.feed_kg)).toBe(25000);
    await expect(bags).toHaveValue('0');

    await form.getByLabel('Water (litres)').fill('100001'); // SHIFT-06
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect(toast.last()).toContainText(INVALID);
    expect((await day())!.water_litres).toBeNull();
    await form.getByLabel('Water (litres)').fill('100000');
    await form.getByRole('button', { name: 'Save Night entry' }).click();
    await expect.poll(async () => Number((await day())!.water_litres)).toBe(100000);
  } finally { await restore(); }
});

test('SHIFT-09: a tampered shift name is refused', async ({ page }) => {
  const b = await tempBatch('broiler');
  await login(page, PHONES.supervisor);
  const r = await tamper(page, 'shiftLog', { op_id: crypto.randomUUID(), batch_id: b.id, date: TODAY, shift: 'afternoon', mortality: 1, culls: 0, feed_bags: 0 });
  expect(r).toMatchObject({ ok: false, error: INVALID, fields: ['shift'] });
  expect((await admin.from('daily_shed_log').select('id').eq('batch_id', b.id)).data).toEqual([]);
});

test('DOC-02 / DOC-03 / DOC-04: an expired document is flagged, one without expiry has no pill; blank name and long reference refused', async ({ page }) => {
  test.setTimeout(90_000);
  const tag = uniq();
  await login(page);
  await page.goto('/more/docs');
  const add = async (name: string, expires?: string) => {
    const sheet = await openAct(page, 'addDoc');
    await sheet.getByLabel('Document').fill(name);
    if (expires) await sheet.getByLabel('Expires on').fill(expires);
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast').last()).toContainText(`Document added · ${name}`);
    await expect(page.getByRole('dialog')).toBeHidden();
  };
  await add(`E2E-Expired-${tag}`, plus(-1)); // DOC-02
  await expect(page.locator('.item', { hasText: `E2E-Expired-${tag}` }).locator('.pill.crit')).toBeVisible();
  await add(`E2E-Forever-${tag}`); // DOC-03
  await expect(page.locator('.item', { hasText: `E2E-Forever-${tag}` })).toBeVisible();
  await expect(page.locator('.item', { hasText: `E2E-Forever-${tag}` }).locator('.pill')).toHaveCount(0);
  expect((await admin.from('tenant_document').select('expires_on').eq('name', `E2E-Forever-${tag}`).single()).data!.expires_on).toBeNull();

  expect(await tamper(page, 'addDoc', { name: '' })).toMatchObject({ ok: false, error: INVALID });
  expect(await tamper(page, 'addDoc', { name: 'E2E-bad', ref_no: 'r'.repeat(61) })).toMatchObject({ ok: false, error: INVALID });
  expect((await admin.from('tenant_document').select('id').eq('name', 'E2E-bad')).data).toEqual([]);
});

test('NOT-05: opening the notifications page marks them read and clears the unread badge', async ({ page }) => {
  await login(page);
  const { data: t } = await admin.from('tenant').select('id').eq('name', 'VKR Poultry Farms').single();
  const { data: seeded } = await admin.from('notification').select('id').eq('tenant_id', t!.id).is('read_at', null);
  const { data: mine } = await admin.from('notification').insert({ tenant_id: t!.id, kind: 'info', severity: 'info', title: 'E2E unread notice' }).select('id').single();
  try {
    await page.goto('/home');
    const badge = page.getByRole('link', { name: 'Notifications' }).locator('.badge');
    await expect(badge).toBeVisible();
    await page.goto('/more/notifications');
    await expect(page.getByText('E2E unread notice')).toBeVisible();
    await page.goto('/home');
    await expect(page.getByRole('link', { name: 'Notifications' }).locator('.badge')).toHaveCount(0);
    expect((await admin.from('notification').select('read_at').eq('id', mine!.id).single()).data!.read_at).not.toBeNull();
  } finally {
    await admin.from('notification').delete().eq('id', mine!.id);
    if (seeded?.length) await admin.from('notification').update({ read_at: null }).in('id', seeded.map((n) => n.id)); // give the seed its unread alerts back
  }
});

test('USR-03 / USR-05: inviting with a bad phone, or as tenant_owner, is refused before anything is created', async ({ page }) => {
  await login(page);
  const ok = { name: 'E2E Invitee', phone: '99990 00099', role: 'labour', language: 'en' };
  for (const o of [{ phone: '12345' }, { phone: '5999000002' }, { phone: 'abcdefghij' }, { role: 'tenant_owner' }, { role: 'platform_admin' }, { name: '' }]) {
    expect(await tamper(page, 'inviteUser', { ...ok, ...o }), JSON.stringify(o)).toMatchObject({ ok: false, error: INVALID });
  }
  expect((await admin.from('app_user').select('id').eq('full_name', 'E2E Invitee')).data).toEqual([]);
});
