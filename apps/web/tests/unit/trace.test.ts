import { describe, expect, it } from 'vitest';
import { eggAgeDays, settleable, transferRef } from '@/lib/trace';
import { SCHEMAS } from '@/lib/schemas';
import { canAct } from '@/lib/auth/permissions';

const U = '3f2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f11';
describe('trace helpers', () => {
  it('builds a dated reference', () => {
    expect(transferRef('2026-11-20', () => 0)).toBe('ET-261120-AAAA');
    expect(transferRef('2026-11-20')).toMatch(/^ET-261120-[A-Z2-9]{4}$/);
  });
  it('computes what is left to set and egg age', () => {
    expect(settleable(1000, 40, 500)).toBe(460);
    expect(settleable(null, 0, 0)).toBe(0);
    expect(settleable(100, 0, 500)).toBe(0);
    expect(eggAgeDays('2026-11-10', '2026-11-20')).toBe(10);
  });
});
describe('transfer schemas', () => {
  const base = { to_farm_id: U, laid_from: '2026-11-10', laid_to: '2026-11-12', sent_on: '2026-11-13', qty: 100, status: 'draft' };
  it('needs exactly one source and ordered dates', () => {
    expect(SCHEMAS.addTransfer.safeParse({ ...base, flock_id: U }).success).toBe(true);
    expect(SCHEMAS.addTransfer.safeParse({ ...base }).success).toBe(false);
    expect(SCHEMAS.addTransfer.safeParse({ ...base, flock_id: U, vendor_id: U }).success).toBe(false);
    expect(SCHEMAS.addTransfer.safeParse({ ...base, flock_id: U, laid_to: '2026-11-09' }).success).toBe(false);
    expect(SCHEMAS.addTransfer.safeParse({ ...base, flock_id: U, sent_on: '2026-11-11' }).success).toBe(false);
  });
  it('a rejection needs a reason, rejects cannot exceed received', () => {
    expect(SCHEMAS.decideTransfer.safeParse({ transfer_id: U, decision: 'reject' }).success).toBe(false);
    expect(SCHEMAS.decideTransfer.safeParse({ transfer_id: U, decision: 'reject', reason: 'cracked' }).success).toBe(true);
    expect(SCHEMAS.decideTransfer.safeParse({ transfer_id: U, decision: 'approve' }).success).toBe(true);
    expect(SCHEMAS.receiveTransfer.safeParse({ transfer_id: U, received_qty: 10, rejects: 11, date: '2026-11-13' }).success).toBe(false);
  });
  it('rule values are checked per key', () => {
    expect(SCHEMAS.setRule.safeParse({ key: 'egg_max_storage_days', value: '10' }).success).toBe(true);
    expect(SCHEMAS.setRule.safeParse({ key: 'egg_max_storage_days', value: 'yes' }).success).toBe(false);
    expect(SCHEMAS.setRule.safeParse({ key: 'allow_self_approval', value: 'no' }).success).toBe(true);
    expect(SCHEMAS.setRule.safeParse({ key: 'other', value: 'no' }).success).toBe(false);
  });
  it('role matrix mirrors the DB', () => {
    expect(canAct(['hatchery_technician'], 'decideTransfer')).toBe(false);
    expect(canAct(['hatchery_technician'], 'receiveTransfer')).toBe(true);
    expect(canAct(['farm_manager'], 'decideTransfer')).toBe(true);
    expect(canAct(['farm_manager'], 'setRule')).toBe(false);
    expect(canAct(['shed_supervisor'], 'cancelTransfer')).toBe(false);
    expect(canAct(['farm_manager'], 'cancelTransfer')).toBe(true);
  });
});
