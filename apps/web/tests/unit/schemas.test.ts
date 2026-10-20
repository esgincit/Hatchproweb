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
