import { describe, expect, it } from 'vitest';
import { SCHEMAS, proofPathOk } from '@/lib/schemas';
import { canAct } from '@/lib/auth/permissions';
import { parseRule, ruleDef } from '@/lib/rules';

const U = '3f2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f11';
const U2 = '4a2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f22';
const ok = (act: keyof typeof SCHEMAS, v: unknown) => SCHEMAS[act].safeParse(v).success;

describe('alert lifecycle schemas', () => {
  it('ids are positive integers (bigint as text or number); action needs a note, resolve does not', () => {
    expect(ok('ackAlert', { id: '12' })).toBe(true);
    expect(ok('ackAlert', { id: 0 })).toBe(false);
    expect(ok('ackAlert', { id: 'x' })).toBe(false);
    expect(ok('actAlert', { id: 5, note: '' })).toBe(false);
    expect(ok('actAlert', { id: 5, note: 'Fan fixed' })).toBe(true);
    expect(ok('resolveAlert', { id: 5, note: '' })).toBe(true);
    expect(ok('resolveAlert', { id: 5, note: 'x'.repeat(501) })).toBe(false);
  });
  it('every role can work an alert', () => {
    for (const r of ['labour', 'auditor', 'dispatch_officer', 'tenant_owner']) expect(canAct([r], 'ackAlert')).toBe(true);
    expect(canAct([], 'resolveAlert')).toBe(false);
  });
});

describe('payment proof', () => {
  const path = `${U}/payment/${U2}/${U}.pdf`;
  it('path must be <tenant>/payment/<order>/<uuid>.<ext> for that order', () => {
    expect(proofPathOk(path)).toBe(true);
    expect(proofPathOk(path, U2)).toBe(true);
    expect(proofPathOk(path, U)).toBe(false);
    expect(proofPathOk(`${U}/payment/${U2}/../x.pdf`)).toBe(false);
    expect(proofPathOk(`${U}/payment/${U2}/${U}.exe`)).toBe(false);
  });
  it('recordPayment needs a 4-60 char reference; proof optional but must be in the order folder', () => {
    expect(ok('recordPayment', { order_id: U2, payment_ref: 'UTR1' })).toBe(true);
    expect(ok('recordPayment', { order_id: U2, payment_ref: 'abc' })).toBe(false);
    expect(ok('recordPayment', { order_id: U2, payment_ref: 'x'.repeat(61) })).toBe(false);
    expect(ok('recordPayment', { order_id: U2, payment_ref: 'UTR1', proof_path: path })).toBe(true);
    expect(ok('recordPayment', { order_id: U, payment_ref: 'UTR1', proof_path: path })).toBe(false);
  });
  it('roles: owner, manager, finance, sales officer', () => {
    for (const r of ['tenant_owner', 'farm_manager', 'finance', 'sales_officer']) expect(canAct([r], 'recordPayment')).toBe(true);
    for (const r of ['labour', 'store_keeper', 'dispatch_officer']) expect(canAct([r], 'recordPayment')).toBe(false);
  });
});

describe('requisition to PO', () => {
  it('needs requisition, vendor and a positive rate; expected date optional', () => {
    expect(ok('raiseReqPO', { req_id: U, vendor_id: U2, rate: '42.5', expected: '' })).toBe(true);
    expect(ok('raiseReqPO', { req_id: U, vendor_id: U2, rate: 0 })).toBe(false);
    expect(ok('raiseReqPO', { req_id: U, vendor_id: U2, rate: 5, expected: '2027-02-30' })).toBe(false);
  });
  it('roles mirror the DB list', () => {
    for (const r of ['tenant_owner', 'farm_manager', 'store_keeper', 'procurement_officer']) expect(canAct([r], 'raiseReqPO')).toBe(true);
    for (const r of ['finance', 'sales_officer', 'shed_supervisor']) expect(canAct([r], 'raiseReqPO')).toBe(false);
  });
});

describe('new rules', () => {
  it('alert_escalation_minutes 5-1440, feed_days_alert 1-30', () => {
    expect(ruleDef('alert_escalation_minutes')?.def).toBe(60);
    expect(parseRule('alert_escalation_minutes', '1440')).toBe(1440);
    expect(parseRule('alert_escalation_minutes', '4')).toBeNull();
    expect(parseRule('alert_escalation_minutes', '1441')).toBeNull();
    expect(ruleDef('feed_days_alert')?.def).toBe(3);
    expect(parseRule('feed_days_alert', '30')).toBe(30);
    expect(parseRule('feed_days_alert', '0')).toBeNull();
    expect(parseRule('feed_days_alert', '31')).toBeNull();
  });
});
