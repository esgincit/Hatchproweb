import { describe, it, expect } from 'vitest';
import { SCHEMAS } from '@/lib/schemas';

const U = '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c';
describe('form schemas', () => {
  it('coerces form strings and drops blank optionals', () => {
    const r = SCHEMAS.addBatch.parse({ shed_id: U, code: ' B-1 ', breed_id: '', placed: '2026-10-19', doc: '10000', doc_rate: '40', vendor_id: '' });
    expect(r).toEqual({ shed_id: U, code: 'B-1', placed: '2026-10-19', doc: 10000, doc_rate: 40 });
  });
  it('rejects zero chicks and bad dates', () => {
    expect(SCHEMAS.addBatch.safeParse({ shed_id: U, code: 'x', placed: '19/10/2026', doc: 0, doc_rate: 1 }).success).toBe(false);
  });
  it('dates must be real calendar days (no 30 Feb, no month 13), leap days ok', () => {
    const ok = (d: string) => SCHEMAS.mort.safeParse({ batch_id: U, date: d, count: 1 }).success;
    expect([ok('2026-02-30'), ok('2026-13-01'), ok('2026-04-31'), ok('2024-02-29'), ok('2026-02-28')]).toEqual([false, false, false, true, true]);
  });
  it('no future placement; PO expected on/after the PO date', () => {
    const b = (placed: string) => SCHEMAS.addBatch.safeParse({ shed_id: U, code: 'x', placed, doc: 1, doc_rate: 1 }).success;
    expect([b('2026-10-19'), b('2999-01-01')]).toEqual([true, false]);
    const po = (expected: string) => SCHEMAS.raisePO.safeParse({ vendor_id: U, item_id: U, qty: 1, rate: 1, expected, date: '2026-10-19' }).success;
    expect([po('2026-10-19'), po('2026-10-25'), po('2026-10-18')]).toEqual([true, true, false]);
  });
  it('phone: digits (mobile or landline), blank allowed, letters rejected', () => {
    const ok = (phone: string) => SCHEMAS.addCustomer.safeParse({ name: 'A', kind: 'trader', phone, credit_limit: 0, credit_days: 0 }).success;
    expect([ok('abcd'), ok('12345'), ok('98490 12345'), ok('+91-9849012345'), ok('040-23456789'), ok('')]).toEqual([false, false, true, true, true, true]);
  });
  it('GSTIN is 15 chars, upper-cased', () => {
    expect(SCHEMAS.addVendor.parse({ name: 'A', category: 'feed', gstin: '36abcde1234f1z5', terms: '15' }).gstin).toBe('36ABCDE1234F1Z5');
    expect(SCHEMAS.addVendor.safeParse({ name: 'A', category: 'feed', gstin: '123', terms: 15 }).success).toBe(false);
  });
  it('payments must be positive', () => {
    expect(SCHEMAS.payOpen.safeParse({ kind: 'bill', id: U, amount: '-5', mode: 'upi', date: '2026-10-19' }).success).toBe(false);
  });
  it('daily log eggs by grade', () => {
    const r = SCHEMAS.logSave.parse({ batch_id: U, date: '2026-10-19', mortality: '3', culls: '0', feed_bags: '12', eggs: { large: '9000', cracked: '30' } });
    expect(r.eggs).toEqual({ large: 9000, cracked: 30 });
  });
});
