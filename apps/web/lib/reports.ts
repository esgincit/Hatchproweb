// Printable reports (More → Reports). Pure: built from the loaded view, rendered by app/(app)/report/[kind],
// saved as PDF with the browser's print dialog (no PDF library — Indic scripts render like the rest of the app).
import { addDays } from './format';
import { batchKpi, stdEggPct, stdWeight } from './kpi';
import type { Batch, Tenant } from './view/types';

export const REPORTS = ['daily', 'weekly', 'vaccination', 'mortality'] as const;
export type ReportKind = (typeof REPORTS)[number];
export const isReport = (k: string): k is ReportKind => (REPORTS as readonly string[]).includes(k);

const active = (t: Tenant) => t.batches.filter((b) => b.state !== 'closed');
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);

/** One row per active batch for `date`; `logged` false = nobody entered the day's log. */
export function dailyReport(t: Tenant, date: string) {
  const rows = active(t).map((b) => {
    const l = b.logs.find((x) => x.date === date);
    return {
      b, logged: !!l, alive: batchKpi(b).alive, mortality: l?.mortality ?? 0, culls: l?.culls ?? 0, feed: l?.feed_kg ?? 0,
      eggs: l?.eggs ?? 0, eggPct: l && l.eggs ? pct(l.eggs, l.birds) : null, avgW: l?.avg_w ?? null, tmax: l?.tmax ?? null, tmin: l?.tmin ?? null,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const vacc = active(t).flatMap((b) => b.vacc.filter((v) => !v.done && v.due <= date).map((v) => ({ b, ...v })));
  return { rows, vacc, total: { alive: sum((r) => r.alive), mortality: sum((r) => r.mortality), culls: sum((r) => r.culls), feed: sum((r) => r.feed), eggs: sum((r) => r.eggs) } };
}

/** Last 7 days ending `today`, per active batch, with breed standards. */
export function weeklyReport(t: Tenant, today: string) {
  const from = addDays(today, -6);
  const rows = active(t).map((b) => {
    const k = batchKpi(b);
    const wk = b.logs.filter((l) => l.date >= from && l.date <= today);
    const s = (f: (l: (typeof wk)[number]) => number) => wk.reduce((a, l) => a + f(l), 0);
    const eggs = s((l) => l.eggs), birdDays = s((l) => l.birds);
    const lastW = [...wk].reverse().find((l) => l.avg_w != null);
    return {
      b, days: wk.length, alive: k.alive, mortality: s((l) => l.mortality + l.culls), mortPct: pct(k.dead, b.doc), feed: s((l) => l.feed_kg),
      eggs, eggPct: b.ft === 'layer' ? pct(eggs, birdDays) : null, eggStd: b.ft === 'layer' ? stdEggPct(b, b.age) : null,
      avgW: lastW?.avg_w ?? null, wStd: lastW && b.ft === 'broiler' ? stdWeight(b, lastW.day) : null, fcr: k.fcr,
    };
  });
  return { from, to: today, rows };
}

export type VaccStatus = 'onTime' | 'late' | 'overdue' | 'upcoming';
export const vaccStatus = (v: Batch['vacc'][number], today: string): VaccStatus =>
  v.done ? (v.done <= v.due ? 'onTime' : 'late') : v.due < today ? 'overdue' : 'upcoming';

/** Every scheduled vaccination; compliance = done on/before due ÷ all due by today. */
export function vaccReport(t: Tenant, today: string) {
  const rows = t.batches.flatMap((b) => b.vacc.map((v) => ({ b, ...v, status: vaccStatus(v, today) })));
  const due = rows.filter((r) => r.due <= today);
  const onTime = due.filter((r) => r.status === 'onTime').length;
  return { rows, due: due.length, onTime, overdue: rows.filter((r) => r.status === 'overdue').length, compliance: pct(onTime, due.length) };
}

/** Insurance register: every logged day with deaths or culls (loaded window), running total per batch, newest first. */
export function mortReport(t: Tenant) {
  const rows = t.batches.flatMap((b) => {
    let run = 0;
    return b.logs.map((l) => ({ l, run: (run += l.mortality + l.culls) })).filter((r) => r.l.mortality || r.l.culls)
      .map(({ l, run }) => ({ b, date: l.date, day: l.day, birds: l.birds, mortality: l.mortality, culls: l.culls, run, pct: pct(l.mortality + l.culls, l.birds) }));
  });
  rows.sort((a, c) => (a.date === c.date ? a.b.code.localeCompare(c.b.code) : a.date < c.date ? 1 : -1));
  return { rows, mortality: rows.reduce((a, r) => a + r.mortality, 0), culls: rows.reduce((a, r) => a + r.culls, 0) };
}
