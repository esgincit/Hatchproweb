import { test, expect, type Page } from '@playwright/test';
import { admin } from './helpers';

// Test plan P1 #10: the public application's anti-abuse rules (mobile proof, code attempts, send limit, uploads, tampered
// paths, 3 applications a day). Needs `npx supabase@2 functions serve` and the local apply test OTP (123456) for +919999000001.
const PHONE = '+919999000001';
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'form behaviour, not layout: one project is enough'); });

async function cleanup() {
  const { data: apps } = await admin.from('onboarding_application').select('id,documents').eq('phone', PHONE);
  for (const a of apps ?? []) await admin.from('onboarding_application').delete().eq('id', a.id);
  const { data: checks } = await admin.from('apply_phone_check').select('id').eq('phone', PHONE);
  for (const c of checks ?? []) {
    const { data: files } = await admin.storage.from('documents').list(`applications/${c.id}`);
    if (files?.length) await admin.storage.from('documents').remove(files.map((f) => `applications/${c.id}/${f.name}`));
  }
  await admin.from('onboarding_application').update({ phone_check_id: null }).eq('phone', PHONE);
  await admin.from('apply_phone_check').delete().eq('phone', PHONE);
}
test.beforeEach(cleanup);
test.afterAll(cleanup);

async function start(page: Page) {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: 'http://localhost:3100' }]);
  await page.goto('/apply');
  await page.getByLabel('Mobile (your login) *').fill('99990 00001');
  await page.waitForFunction(() => !!(window as unknown as { turnstile?: { getResponse: () => string } }).turnstile?.getResponse(), undefined, { timeout: 30_000 });
  return page.getByTestId('phone-verify');
}
async function fillRest(page: Page) {
  await page.getByLabel('Farm / business name *').fill('E2E Abuse Test Farm');
  await page.getByLabel('PAN *').fill('abcde1234f');
  await page.getByLabel('Owner name *').fill('Ravi Teja');
  await page.getByLabel('Site name *').fill('Abuse Unit');
  await page.getByLabel('District *').fill('Medak');
  await page.getByLabel('PIN code *').fill('502110');
  await page.getByLabel('Shed name').first().fill('North Shed');
  await page.getByLabel('Max birds *').first().fill('8000');
  await page.getByRole('checkbox').check();
}
const captchaReady = (page: Page) => page.waitForFunction(() => !!(window as unknown as { turnstile?: { getResponse: () => string } }).turnstile?.getResponse(), undefined, { timeout: 30_000 });
async function sendCode(page: Page, box: ReturnType<Page['getByTestId']>) {
  await captchaReady(page);
  await box.getByRole('button', { name: /Send (code by SMS|a new code)/ }).click();
}
async function verified(page: Page) {
  const box = await start(page);
  await sendCode(page, box);
  await box.getByLabel('6-digit code').fill('123456');
  await box.getByRole('button', { name: 'Verify' }).click();
  await expect(box).toContainText('Mobile verified');
  return box;
}
const pdf = (name: string, size = 20) => ({ name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size)]) });

test('APP-16: submitting without verifying the mobile is refused and nothing is stored', async ({ page }) => {
  await start(page);
  await fillRest(page);
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: /Verify your mobile/i }).first()).toBeVisible();
  expect((await admin.from('onboarding_application').select('id').eq('phone', PHONE)).data).toEqual([]);
});

test('APP-19: a wrong code is rejected', async ({ page }) => {
  const box = await start(page);
  await sendCode(page, box);
  await box.getByLabel('6-digit code').fill('000000');
  await box.getByRole('button', { name: 'Verify' }).click();
  await expect(box).toContainText('Wrong code. Try again.');
  await expect(box).not.toContainText('Mobile verified');
});

test('APP-20: after 5 wrong guesses even the right code is refused', async ({ page }) => {
  const box = await start(page);
  await sendCode(page, box);
  for (let i = 0; i < 5; i++) {
    await box.getByLabel('6-digit code').fill('000000');
    await box.getByRole('button', { name: 'Verify' }).click();
    await expect(box).toContainText('Wrong code. Try again.');
    await page.waitForTimeout(150);
  }
  await box.getByLabel('6-digit code').fill('123456');
  await box.getByRole('button', { name: 'Verify' }).click();
  await expect(box).toContainText('That code expired. Send a new one.');
  await expect(box).not.toContainText('Mobile verified');
});

test('APP-22: the 4th code within 10 minutes is refused', async ({ page }) => {
  const box = await start(page);
  for (let i = 0; i < 3; i++) {
    await sendCode(page, box);
    await expect(box).toContainText('Code sent');
    await expect(box.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  }
  await sendCode(page, box);
  await expect(box).toContainText('Too many codes for this number. Wait 10 minutes.');
});

test('APP-26 / APP-27: only JPG, PNG or PDF up to 10 MB, and not empty', async ({ page }) => {
  const box = await verified(page);
  const input = box.locator('input[type=file]');
  const bad = 'Only JPG, PNG or PDF up to 10 MB.';
  for (const f of [
    { name: 'notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('x') },
    { name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
    { name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(Math.round(10.1 * 1024 * 1024)) },
    { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
  ]) {
    await input.setInputFiles(f);
    await expect(box.getByRole('status'), f.name).toContainText(bad);
    await page.waitForTimeout(800); // the same message repeats, so give a wrongly accepted file time to show up in the list
    await expect(box, f.name).not.toContainText(f.name);
  }
});

test('APP-28: the 6th document is refused', async ({ page }) => {
  const box = await verified(page);
  await box.locator('input[type=file]').setInputFiles(['a', 'b', 'c', 'd', 'e'].map((n) => pdf(`${n}.pdf`)));
  for (const n of ['a', 'e']) await expect(box).toContainText(`${n}.pdf`);
  await expect(box.locator('input[type=file]')).toHaveCount(0); // the attach button is gone at 5
  const { data: c } = await admin.from('apply_phone_check').select('id').eq('phone', PHONE).single();
  const r = await page.request.post('http://127.0.0.1:54321/functions/v1/apply-otp', {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
    data: { action: 'upload-url', check_id: c!.id, name: 'f.pdf', type: 'application/pdf', size: 20 },
  });
  expect(r.status()).toBe(400);
  expect(await r.json()).toEqual({ error: 'too_many_files' });
});

test('APP-30: a document path pointing outside this application is refused', async ({ page }) => {
  const box = await verified(page);
  await box.locator('input[type=file]').setInputFiles(pdf('pan.pdf'));
  await expect(box).toContainText('pan.pdf');
  await fillRest(page);
  await page.route('**/*', async (route) => {
    const r = route.request();
    if (r.method() === 'POST' && r.headers()['next-action']) {
      const [input] = JSON.parse(r.postData()!);
      input.documents[0].path = 'applications/00000000-0000-0000-0000-000000000000/stolen.pdf';
      return route.continue({ postData: JSON.stringify([input]) });
    }
    return route.fallback();
  });
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('A document was not uploaded through this form')).toBeVisible();
  expect((await admin.from('onboarding_application').select('id').eq('phone', PHONE)).data).toEqual([]);
});

test('APP-32: the 4th application from one number in a day is refused', async ({ page }) => {
  const row = { business_name: 'E2E earlier', owner_name: 'x', phone: PHONE, farm_types: ['broiler'], state: 'Telangana', consent: true, sites: [{ name: 's', sheds: [{ name: 'a', capacity: 1 }] }] };
  expect((await admin.from('onboarding_application').insert([row, row, row])).error).toBeNull();
  const box = await verified(page);
  await fillRest(page);
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByText('already under review')).toBeVisible();
  expect((await admin.from('onboarding_application').select('id', { count: 'exact', head: true }).eq('phone', PHONE)).count).toBe(3);
  void box;
});
