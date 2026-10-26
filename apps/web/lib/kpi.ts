// KPI functions ported from demo/index.html:237-260 and :403 (batchKpi, tenantKpi, costPerEgg, attGet, attMonth, ageing).
// Differences from the demo, on purpose: cumulative dead/feed/eggs come from v_batch_kpi (all-time, not just loaded logs),
// birds alive subtracts culls, and standard curves are the batch's own breed (not always BV-300).
import { daysBetween } from './format';
import type { Batch, Bill, Invoice, Tenant, View } from './view/types';

export type Rag = 'good' | 'warn' | 'crit' | 'neutral';

export const stdEggPct = (b: Batch, day: number) => b.curve.find((r) => r.week === Math.min(72, Math.floor(day / 7)))?.egg ?? null;

/** Breed weight standard interpolated between weekly points (demo: std_curve_broiler). */
export function stdWeight(b: Batch, day: number) {
  const pts = b.curve.filter((r) => r.weight != null);
  if (!pts.length) return null;
  const w = day / 7, last = pts.length - 1;
  const lo = pts[Math.min(last, Math.floor(w))].weight!, hi = pts[Math.min(last, Math.floor(w) + 1)].weight!;
  return Math.round(lo + (hi - lo) * (w - Math.floor(w)));
}

export function batchKpi(b: Batch) {
  const logs = b.logs, last = logs.at(-1);
  const avg = (xs: typeof logs) => xs.reduce((a, l) => a + l.mortality, 0) / Math.max(1, xs.length);
  const m7 = avg(logs.slice(-7)), mb = avg(logs.slice(-14, -7));
  const eggPct = last && last.eggs ? (100 * last.eggs) / last.birds : 0;
  const std = b.ft === 'layer' ? stdEggPct(b, b.age) : null;
  const alive = last ? last.birds - last.mortality - last.culls : b.doc - b.cum.dead;
  const fcr = b.ft === 'broiler' && last?.avg_w ? b.cum.feed / ((alive * last.avg_w) / 1000) : null;
  const rag: Rag = b.state === 'closed' ? 'neutral' : m7 > 1.8 * mb && m7 > 5 ? 'crit' : std && eggPct < std - 3 ? 'warn' : 'good';
  return { logs, last, dead: b.cum.dead, eggs: b.cum.eggs, feed: b.cum.feed, m7, mb, eggPct, std, fcr, alive, rag, mortPct: (100 * b.cum.dead) / b.doc };
}
export type BatchKpi = ReturnType<typeof batchKpi>;

const outstanding = (xs: (Bill | Invoice)[]) => xs.filter((x) => x.status !== 'paid').reduce((a, x) => a + x.total - x.paid, 0);

export function tenantKpi(t: Tenant, today: string) {
  const act = t.batches.filter((b) => b.state !== 'closed').map((b) => ({ b, k: batchKpi(b) }));
  const sum = (f: (x: (typeof act)[number]) => number) => act.reduce((a, x) => a + f(x), 0);
  return {
    act,
    birds: sum((x) => x.k.alive),
    eggsToday: sum((x) => x.k.last?.eggs ?? 0),
    eggsYest: sum((x) => x.k.logs.at(-2)?.eggs ?? 0),
    mortToday: sum((x) => x.k.last?.mortality ?? 0),
    ap: outstanding(t.bills),
    ar: outstanding(t.invoices),
    apDue7: outstanding(t.bills.filter((b) => daysBetween(today, b.due) <= 7)),
    arOver: outstanding(t.invoices.filter((b) => daysBetween(b.due, today) > 0)),
  };
}

export const rate = (v: View, p: keyof View['rates'], back = 0) => {
  const s = v.rates[p];
  return s[s.length - 1 - back]?.rate ?? 0;
};

/** ₹/egg: feed at ₹27/kg + chick cost amortised over 500 eggs + ₹0.62 overheads (demo assumptions). */
export function costPerEgg(b: Batch) {
  if (!b.cum.saleable) return null;
  return (b.cum.feed * 27) / b.cum.saleable + b.doc_rate / 500 + 0.62;
}

export type AttCode = 'P' | 'H' | 'A' | 'L' | 'S' | '-';
export const ATT_CODES: Record<string, string> = { P: 'Present', H: 'Half day', A: 'Absent', L: 'Leave' };

export function attGet(t: Tenant, workerId: string, date: string, today: string): AttCode {
  const o = t.attendance[workerId]?.[date];
  if (o) return o;
  if (date > today) return '-';
  return new Date(date + 'T12:00:00Z').getUTCDay() === 0 ? 'S' : '-';
}

export function attMonth(t: Tenant, workerId: string, today: string) {
  const [y, m] = today.split('-');
  const days = new Date(+y, +m, 0).getDate();
  const out = { P: 0, H: 0, A: 0, L: 0 };
  for (let d = 1; d <= days; d++) {
    const c = attGet(t, workerId, `${y}-${m}-${String(d).padStart(2, '0')}`, today);
    if (c in out) out[c as keyof typeof out]++;
  }
  return { ...out, payable: out.P + out.H * 0.5 + out.L, days };
}

/** Month-to-date pay: monthly wage pro-rated by payable days, minus this month's advances (wages tab, register, bank file). */
export function payslip(t: Tenant, w: Tenant['workers'][number], today: string) {
  const a = attMonth(t, w.id, today);
  const gross = Math.round((w.wage * a.payable) / a.days);
  const adv = t.advances.filter((x) => x.worker_id === w.id).reduce((s, x) => s + x.amount, 0);
  return { a, gross, adv, net: gross - adv };
}

export type Ageing = Record<'Not due' | '1–30' | '31–60' | '60+', number>;
export function ageing(list: (Bill | Invoice)[], today: string): Ageing {
  const b: Ageing = { 'Not due': 0, '1–30': 0, '31–60': 0, '60+': 0 };
  for (const x of list.filter((x) => x.status !== 'paid')) {
    const d = daysBetween(x.due, today);
    b[d <= 0 ? 'Not due' : d <= 30 ? '1–30' : d <= 60 ? '31–60' : '60+'] += x.total - x.paid;
  }
  return b;
}
