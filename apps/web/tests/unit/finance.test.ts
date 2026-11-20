import { describe, expect, it } from 'vitest';
import { SCHEMAS } from '@/lib/schemas';
import { canAct, canSee, ACT_ROLES, DELEGATORS } from '@/lib/auth/permissions';

const U = '3f2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f11';
const ok = (act: keyof typeof SCHEMAS, v: unknown) => SCHEMAS[act].safeParse(v).success;

describe('finance / procurement / settings schemas', () => {
  it('a credit note needs a customer, a positive amount and a reason', () => {
    const n = { customer_id: U, amount: 500, reason: 'DOA credit', issued_on: '2026-10-19' };
    expect(ok('addCreditNote', n)).toBe(true);
    expect(ok('addCreditNote', { ...n, invoice_id: '' })).toBe(true);
    expect(ok('addCreditNote', { ...n, amount: 0 })).toBe(false);
    expect(ok('addCreditNote', { ...n, reason: 'x' })).toBe(false);
  });
  it('every approval flow rejects only with a reason', () => {
    for (const a of ['decideCreditNote', 'decideRefund', 'decideReq', 'decideCount', 'decideStockXfer'] as const) {
      expect(ok(a, { id: U, decision: 'approve' })).toBe(true);
      expect(ok(a, { id: U, decision: 'reject' })).toBe(false);
      expect(ok(a, { id: U, decision: 'reject', reason: 'not needed' })).toBe(true);
    }
  });
  it('the books lock takes a real date or nothing; limits only the three known keys', () => {
    expect(ok('setLock', { date: '2026-03-31' })).toBe(true);
    expect(ok('setLock', { date: '' })).toBe(true);
    expect(ok('setLock', { date: '2026-02-30' })).toBe(false);
    expect(ok('setLimit', { key: 'po_approval_above', value: '100000' })).toBe(true);
    expect(ok('setLimit', { key: 'po_approval_above', value: '' })).toBe(true);
    expect(ok('setLimit', { key: 'allow_self_approval', value: '1' })).toBe(false);
    expect(ok('setLimit', { key: 'finance_owner_above', value: '-5' })).toBe(false);
  });
  it('a count sheet needs at least one line; a transfer needs two different stores', () => {
    const c = { store_id: U, counted_on: '2026-10-19', lines: [{ item_id: U, counted_qty: '12.5' }] };
    expect(ok('addCount', c)).toBe(true);
    expect(ok('addCount', { ...c, lines: [] })).toBe(false);
    expect(ok('addCount', { ...c, lines: [{ item_id: U, counted_qty: -1 }] })).toBe(false);
    const x = { from_store: U, to_store: '5a2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f22', item_id: U, qty: 10 };
    expect(ok('addStockXfer', x)).toBe(true);
    expect(ok('addStockXfer', { ...x, to_store: U })).toBe(false);
  });
  it('a maintenance schedule needs days or batches', () => {
    const p = { asset_id: U, task: 'Calibrate sensors' };
    expect(ok('addPm', p)).toBe(false);
    expect(ok('addPm', { ...p, every_days: 30 })).toBe(true);
    expect(ok('addPm', { ...p, every_batches: 4 })).toBe(true);
  });
  it('a support grant is at most 6 days, a delegation at most 59 days', () => {
    expect(ok('grantSupport', { hours: 24, reason: 'billing question' })).toBe(true);
    expect(ok('grantSupport', { hours: 200, reason: 'billing question' })).toBe(false);
    expect(ok('addDelegation', { to_user: U, roles: ['finance'], days: 7, reason: 'on leave' })).toBe(true);
    expect(ok('addDelegation', { to_user: U, roles: [], days: 7, reason: 'on leave' })).toBe(false);
    expect(ok('addDelegation', { to_user: U, roles: ['finance'], days: 90, reason: 'on leave' })).toBe(false);
  });
  it('the portal link needs a valid email', () => {
    expect(ok('linkPortal', { customer_id: U, email: 'a@b.co' })).toBe(true);
    expect(ok('linkPortal', { customer_id: U, email: 'nope' })).toBe(false);
  });
});

describe('finance / procurement / settings permissions', () => {
  it('every new act has a role list, and the owner alone controls the lock, limits, keys, support and portal', () => {
    for (const a of ['addCreditNote', 'addRefund', 'setLock', 'addReq', 'approvePO', 'addCount', 'addStockXfer', 'addBranch', 'addPm', 'addDelegation', 'grantSupport', 'linkPortal', 'createApiKey', 'createWebhook']) {
      expect(ACT_ROLES[a]?.length, a).toBeGreaterThan(0);
    }
    for (const a of ['setLock', 'setLimit', 'createApiKey', 'createWebhook', 'grantSupport', 'revokeSupport', 'linkPortal', 'unlinkPortal', 'addBranch']) {
      expect(ACT_ROLES[a], a).toEqual(['tenant_owner']);
    }
  });
  it('the procurement officer approves POs (0057), a farm manager does not', () => {
    expect(canAct(['procurement_officer'], 'approvePO')).toBe(true);
    expect(canAct(['farm_manager'], 'approvePO')).toBe(false);
  });
  it('finance approves credit notes, a sales officer only raises them', () => {
    expect(canAct(['finance'], 'decideCreditNote')).toBe(true);
    expect(canAct(['sales_officer'], 'addCreditNote')).toBe(true);
    expect(canAct(['sales_officer'], 'decideCreditNote')).toBe(false);
  });
  it('the owner cannot delegate (ownership is not delegable); managers can', () => {
    expect(DELEGATORS).not.toContain('tenant_owner');
    expect(canAct(['tenant_owner'], 'addDelegation')).toBe(false);
    expect(canAct(['farm_manager'], 'addDelegation')).toBe(true);
    expect(canAct(['finance'], 'addDelegation')).toBe(true);
  });
  it('areas: dashboards are not for supervisors, settings are not for labour', () => {
    expect(canSee(['shed_supervisor'], 'dashboards')).toBe(false);
    expect(canSee(['hatchery_manager'], 'dashboards')).toBe(true);
    expect(canSee(['labour'], 'settings')).toBe(false);
    expect(canSee(['tenant_owner'], 'settings')).toBe(true);
    expect(canSee(['store_keeper'], 'procurement')).toBe(true);
  });
});
