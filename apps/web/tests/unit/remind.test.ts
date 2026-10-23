import { describe, it, expect } from 'vitest';
import { overdueByCustomer, waLink, waPhone } from '@/lib/remind';
import type { Tenant } from '@/lib/view/types';

describe('waPhone (Indian mobile → wa.me digits)', () => {
  it('accepts the formats people type', () => {
    for (const raw of ['+91 98850 30001', '98850 30001', '09885030001', '919885030001', '+91-98850-30001'])
      expect(waPhone(raw), raw).toBe('919885030001');
  });
  it('rejects landlines, short numbers and blanks', () => {
    for (const raw of ['040 2345 6789', '12345', '', null, undefined, '+1 415 555 0100']) expect(waPhone(raw), String(raw)).toBeNull();
  });
});

describe('waLink', () => {
  it('url-encodes the message (newlines, ₹, Indic script)', () => {
    const u = waLink('919885030001', 'నమస్తే\n₹2,85,864 & more');
    expect(u.startsWith('https://wa.me/919885030001?text=')).toBe(true);
    expect(decodeURIComponent(u.split('text=')[1])).toBe('నమస్తే\n₹2,85,864 & more');
  });
});

describe('overdueByCustomer', () => {
  const inv = (id: string, customer_id: string, due: string, total: number, paid = 0, status = 'unpaid') =>
    ({ id, no: 'INV' + id, customer_id, customer: 'X' + customer_id, product: 'egg', qty: 1, unit: 'tray', rate: 1, date: due, due, total, paid, status, batch: null });
  const t = {
    customers: [{ id: 'a', name: 'Alpha Traders', kind: 'trader', phone: '+91 98850 30001', credit_limit: 0, credit_days: 0 }, { id: 'b', name: 'Beta', kind: 'trader', phone: '', credit_limit: 0, credit_days: 0 }],
    invoices: [
      inv('1', 'a', '2026-10-12', 1000), inv('2', 'a', '2026-10-05', 500, 100, 'partial'), inv('3', 'a', '2026-10-25', 999), // 3 not due yet
      inv('4', 'b', '2026-10-01', 300), inv('5', 'b', '2026-10-01', 300, 300, 'paid'), inv('6', 'b', '2026-10-19', 50), // 6 due today: not overdue
    ],
  } as unknown as Pick<Tenant, 'invoices' | 'customers'>;
  it('groups past-due balances per customer, biggest first, with the oldest due date', () => {
    expect(overdueByCustomer(t, '2026-10-19')).toEqual([
      { customer_id: 'a', name: 'Alpha Traders', phone: '919885030001', amount: 1400, oldestDue: '2026-10-05', days: 14,
        invoices: [{ id: '1', no: 'INV1', due: '2026-10-12', balance: 1000 }, { id: '2', no: 'INV2', due: '2026-10-05', balance: 400 }] },
      { customer_id: 'b', name: 'Beta', phone: null, amount: 300, oldestDue: '2026-10-01', days: 18, invoices: [{ id: '4', no: 'INV4', due: '2026-10-01', balance: 300 }] },
    ]);
  });
});
