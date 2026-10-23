// WhatsApp payment reminders (click-to-chat): who owes what, and the wa.me link that opens a ready message.
// ponytail: wa.me links need no Meta approval; switch to the Business API (supabase/functions) when the team has a token.
import { daysBetween } from './format';
import type { Tenant } from './view/types';

/** Indian mobile in any format → wa.me digits (91 + 10 digits), or null when it can't be one. */
export function waPhone(raw: string | null | undefined) {
  const d = (raw ?? '').replace(/\D/g, '');
  const ten = d.length === 10 ? d : d.length === 11 && d.startsWith('0') ? d.slice(1) : d.length === 12 && d.startsWith('91') ? d.slice(2) : '';
  return /^[6-9]\d{9}$/.test(ten) ? '91' + ten : null;
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export type Due = {
  customer_id: string; name: string; phone: string | null; amount: number; oldestDue: string; days: number;
  invoices: { id: string; no: string; due: string; balance: number }[];
};

/** Invoices past their due date with money still owed, grouped per customer, biggest amount first. */
export function overdueByCustomer(t: Pick<Tenant, 'invoices' | 'customers'>, today: string): Due[] {
  const by = new Map<string, Due>();
  for (const i of t.invoices) {
    const balance = i.total - i.paid;
    if (i.status === 'paid' || balance <= 0 || i.due >= today) continue;
    const c = t.customers.find((x) => x.id === i.customer_id);
    const g = by.get(i.customer_id) ?? { customer_id: i.customer_id, name: c?.name ?? i.customer, phone: waPhone(c?.phone), amount: 0, oldestDue: i.due, days: 0, invoices: [] };
    g.amount += balance;
    g.invoices.push({ id: i.id, no: i.no, due: i.due, balance });
    if (i.due < g.oldestDue) g.oldestDue = i.due;
    by.set(i.customer_id, g);
  }
  return [...by.values()].map((g) => ({ ...g, days: daysBetween(g.oldestDue, today) })).sort((a, b) => b.amount - a.amount);
}
