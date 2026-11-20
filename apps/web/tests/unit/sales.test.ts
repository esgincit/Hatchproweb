import { describe, expect, it } from 'vitest';
import { SCHEMAS } from '@/lib/schemas';
import { canAct, canSee } from '@/lib/auth/permissions';
import { landingFor, redirectFor } from '@/lib/auth/route-guard';

const U = '3f2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f11';
const ok = (act: keyof typeof SCHEMAS, v: unknown) => SCHEMAS[act].safeParse(v).success;

describe('sales schemas', () => {
  it('an order needs a customer, product, quantity and a real date; price and notes are optional', () => {
    const o = { customer_id: U, product_id: U, qty: 600, hatch_date: '2027-01-05' };
    expect(ok('addOrder', o)).toBe(true);
    expect(ok('addOrder', { ...o, price: '' })).toBe(true);
    expect(ok('addOrder', { ...o, qty: 0 })).toBe(false);
    expect(ok('addOrder', { ...o, hatch_date: '2027-02-30' })).toBe(false);
  });
  it('a payment verdict other than "not received" must carry an amount', () => {
    const v = { order_id: U, result: 'verified', deposit_paid: 0 };
    expect(ok('verifyPayment', v)).toBe(false);
    expect(ok('verifyPayment', { ...v, deposit_paid: 12000 })).toBe(true);
    expect(ok('verifyPayment', { ...v, result: 'rejected' })).toBe(true);
    expect(ok('verifyPayment', { ...v, result: 'waived', deposit_paid: 5 })).toBe(false);
  });
  it('cancelling and price changes need a reason', () => {
    expect(ok('cancelOrder', { order_id: U, reason: '' })).toBe(false);
    expect(ok('cancelOrder', { order_id: U, reason: 'customer postponed' })).toBe(true);
    expect(ok('priceOrder', { order_id: U, price: 35 })).toBe(false);
    expect(ok('priceOrder', { order_id: U, price: 35, reason: 'volume discount' })).toBe(true);
  });
  it('rejecting an allocation or trip needs a reason, approving does not', () => {
    for (const a of ['decideAlloc', 'decideTrip'] as const) {
      expect(ok(a, { id: U, decision: 'approve' })).toBe(true);
      expect(ok(a, { id: U, decision: 'reject' })).toBe(false);
      expect(ok(a, { id: U, decision: 'reject', reason: 'not ready' })).toBe(true);
    }
  });
  it('a DOA claim is approved with a resolution and rejected with a reason', () => {
    expect(ok('decideDoa', { id: U, decision: 'approve' })).toBe(false);
    expect(ok('decideDoa', { id: U, decision: 'approve', resolution: 'replace' })).toBe(true);
    expect(ok('decideDoa', { id: U, decision: 'reject' })).toBe(false);
    expect(ok('decideDoa', { id: U, decision: 'reject', reason: 'outside window' })).toBe(true);
    expect(ok('decideDoa', { id: U, decision: 'approve', resolution: 'refund' })).toBe(false);
  });
  it('delivery lines: dead on arrival cannot exceed delivered; at least one line', () => {
    const d = { dispatch_id: U, receiver_name: 'Ramesh', lines: [{ id: U, delivered: 595, short: 5, doa: 5 }] };
    expect(ok('deliverTrip', d)).toBe(true);
    expect(ok('deliverTrip', { ...d, lines: [{ id: U, delivered: 3, short: 0, doa: 5 }] })).toBe(false);
    expect(ok('deliverTrip', { ...d, lines: [] })).toBe(false);
    expect(ok('deliverTrip', { ...d, receiver_name: '' })).toBe(false);
  });
  it('vehicle plates are normalised and checked', () => {
    const p = SCHEMAS.addVehicle.safeParse({ reg_no: ' ap21 tb 0001 ', ownership: 'own' });
    expect(p.success && p.data.reg_no).toBe('AP21 TB 0001');
    expect(ok('addVehicle', { reg_no: 'AB', ownership: 'own' })).toBe(false);
  });
  it('customers carry a tier', () => {
    expect(ok('setTier', { customer_id: U, tier: 'platinum' })).toBe(true);
    expect(ok('setTier', { customer_id: U, tier: 'diamond' })).toBe(false);
    expect(ok('addCustomer', { name: 'A', kind: 'trader', phone: '', credit_limit: 0, credit_days: 7, tier: 'gold' })).toBe(true);
  });
});

describe('sales + dispatch role matrix mirrors the DB', () => {
  it('sales proposes, finance verifies, the hatchery manager approves', () => {
    expect(canAct(['sales_officer'], 'addOrder')).toBe(true);
    expect(canAct(['sales_officer'], 'verifyPayment')).toBe(false);
    expect(canAct(['finance'], 'verifyPayment')).toBe(true);
    expect(canAct(['finance'], 'confirmOrder')).toBe(false);
    expect(canAct(['sales_officer'], 'allocate')).toBe(true);
    expect(canAct(['sales_officer'], 'decideAlloc')).toBe(false);
    expect(canAct(['hatchery_manager'], 'decideAlloc')).toBe(true);
    expect(canAct(['hatchery_manager'], 'releaseAlloc')).toBe(true);
    expect(canAct(['sales_officer'], 'priceOrder')).toBe(false);
    expect(canAct(['sales_officer'], 'waiveDeposit')).toBe(false);
    expect(canAct(['tenant_owner'], 'waiveDeposit')).toBe(true);
  });
  it('dispatch prepares, the ops manager confirms', () => {
    expect(canAct(['dispatch_officer'], 'addLoad')).toBe(true);
    expect(canAct(['dispatch_officer'], 'submitTrip')).toBe(true);
    expect(canAct(['dispatch_officer'], 'decideTrip')).toBe(false);
    expect(canAct(['hatchery_ops_manager'], 'decideTrip')).toBe(true);
    expect(canAct(['dispatch_officer'], 'decideDoa')).toBe(false);
    expect(canAct(['dispatch_officer'], 'doaClaim')).toBe(true);
    expect(canAct(['farm_manager'], 'setBatchProduct')).toBe(true);
    expect(canAct(['hatchery_manager'], 'setBatchProduct')).toBe(false); // the batch policy is owner / manager
  });
  it('who sees the screens', () => {
    expect(canSee(['sales_officer'], 'sales')).toBe(true);
    expect(canSee(['sales_officer'], 'dispatch')).toBe(true);
    expect(canSee(['dispatch_officer'], 'sales')).toBe(false);
    expect(canSee(['shed_supervisor'], 'sales')).toBe(false);
    expect(canSee(['finance'], 'sales')).toBe(true);
  });
});

describe('customer portal routing', () => {
  const portal = { tenantId: null, roles: [], platform: false };
  const owner = { tenantId: 't1', roles: ['tenant_owner'], platform: false };
  it('a login with no tenant lands on /portal and stays there', () => {
    expect(landingFor(portal)).toBe('/portal');
    expect(redirectFor('/portal', portal)).toBeNull();
    expect(redirectFor('/home', portal)).toBe('/portal');
    expect(redirectFor('/login', portal)).toBe('/portal');
  });
  it('farm users are kept out of /portal, anonymous visitors go to login', () => {
    expect(redirectFor('/portal', owner)).toBe('/home');
    expect(redirectFor('/portal', null)).toBe('/login');
  });
});
