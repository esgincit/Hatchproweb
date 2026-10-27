import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { admin, TODAY, vkr, uniq } from './helpers';

// Test plan P2b: VEN-10 Razorpay webhook signature. Needs `npx supabase@2 functions serve`; the secret is the local test value
// in supabase/functions/.env. Also checks the happy path once and the replay, so "rejected" is not just a dead endpoint.
const URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/razorpay-webhook`;
const SECRET = readFileSync('../../supabase/functions/.env', 'utf8').match(/^RAZORPAY_WEBHOOK_SECRET=(.+)$/m)![1].trim();
const head = { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('hex');
const event = (id: string, refType: string, refId: string, amount: number) => JSON.stringify({
  event: 'payment.captured', payload: { payment: { entity: { id, amount: amount * 100, method: 'upi', created_at: Math.floor(Date.now() / 1000), notes: { ref_type: refType, ref_id: refId } } } },
});
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'API only'); });

let invoiceId = '', advertiserId = '', subId = '', authId = '';
const gw = `pay_E2E${uniq()}`;
test.afterAll(async () => {
  await admin.from('payment').delete().like('gateway_ref', 'pay_E2E%');
  if (invoiceId) await admin.from('invoice').delete().eq('id', invoiceId);
  if (authId) await admin.auth.admin.deleteUser(authId); // cascades the advertiser and its subscription
});

test('VEN-10: a webhook with a wrong or missing signature is rejected and nothing changes; a right one applies once', async ({ request }) => {
  const t = await vkr();
  const { data: inv } = await admin.from('invoice').insert({
    tenant_id: t.tenantId, farm_id: t.farmId, customer_id: t.customerId, invoice_no: `E2E-${uniq()}`, invoice_date: TODAY, due_date: TODAY,
    product: 'egg', qty: 1, unit: 'tray', rate: 500, total: 500,
  }).select('id').single();
  invoiceId = inv!.id;
  const { data: au } = await admin.auth.admin.createUser({ phone: '+919999000077', phone_confirm: true });
  authId = au.user!.id;
  const { data: adv, error: e1 } = await admin.from('advertiser').insert({ user_id: authId, business_name: 'E2E Hook Vendor', phone: '+919999000077', category: 'feed' }).select('id').single();
  expect(e1).toBeNull();
  advertiserId = adv!.id;
  const { data: plan } = await admin.from('ad_plan').select('id').limit(1).single();
  const { data: sub, error: e2 } = await admin.from('ad_subscription').insert({ advertiser_id: advertiserId, plan_id: plan!.id, amount: 100 }).select('id').single();
  expect(e2).toBeNull();
  subId = sub!.id;
  const state = async () => ({
    inv: (await admin.from('invoice').select('paid,status').eq('id', invoiceId).single()).data,
    sub: (await admin.from('ad_subscription').select('status,gateway_ref').eq('id', subId).single()).data,
    pay: (await admin.from('payment').select('id', { count: 'exact', head: true }).like('gateway_ref', 'pay_E2E%')).count,
  });
  const before = await state();

  const bodies = [event(gw, 'invoice', invoiceId, 500), event(`${gw}a`, 'ad', subId, 100)];
  for (const raw of bodies) {
    for (const sig of [undefined, '', 'deadbeef', sign(raw + ' ')]) { // missing, empty, wrong, signature of another body
      const r = await request.post(URL, { headers: { ...head, ...(sig === undefined ? {} : { 'x-razorpay-signature': sig }) }, data: raw });
      expect(r.status(), `sig ${sig}`).toBe(400);
      expect(await r.text()).toBe('bad signature');
    }
  }
  expect(await state()).toEqual(before);

  const ok = await request.post(URL, { headers: { ...head, 'x-razorpay-signature': sign(bodies[0]) }, data: bodies[0] });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ result: 'applied' });
  const replay = await request.post(URL, { headers: { ...head, 'x-razorpay-signature': sign(bodies[0]) }, data: bodies[0] });
  expect(await replay.json()).toEqual({ result: 'duplicate' });
  expect(await state()).toEqual({ inv: { paid: 500, status: 'paid' }, sub: before.sub, pay: 1 });
});
