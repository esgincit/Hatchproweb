import { describe, it, expect } from 'vitest';
import { dailyReport, mortReport, vaccReport, vaccStatus, weeklyReport } from '@/lib/reports';
import type { Batch, Tenant } from '@/lib/view/types';

const log = (day: number, mortality: number, extra: Partial<Batch['logs'][number]> = {}) => ({
  id: 'l' + day, date: `2026-10-${String(day).padStart(2, '0')}`, day, birds: 1000, mortality, culls: 0,
  feed_kg: 100, water: 0, eggs: 0, grades: null, avg_w: null, tmax: null, tmin: null, remarks: null, rh: null, by: null, ...extra,
});
const batch = (code: string, logs: Batch['logs'], extra: Partial<Batch> = {}): Batch => ({
  id: code, code, ft: 'layer', breed: 'BV-300', age: 200, doc: 1000, doc_rate: 40, state: 'laying', placed: '2026-04-01',
  shed_name: 'S', farm_name: 'F', logs, vacc: [], curve: [{ week: 28, egg: 90, weight: null }], cum: { dead: 50, feed: 0, eggs: 0, saleable: 0 }, ...extra,
});
const tenant = (batches: Batch[]) => ({ batches } as unknown as Tenant);

describe('dailyReport', () => {
  const t = tenant([batch('A', [log(18, 9), log(19, 3, { culls: 2, eggs: 900 })]), batch('B', [log(18, 1)]), batch('C', [log(19, 5)], { state: 'closed' })]);
  const r = dailyReport(t, '2026-10-19');
  it('skips closed batches and flags batches with no log that day', () => {
    expect(r.rows.map((x) => [x.b.code, x.logged])).toEqual([['A', true], ['B', false]]);
  });
  it('totals the day and computes egg %', () => {
    expect(r.total).toMatchObject({ mortality: 3, culls: 2, feed: 100, eggs: 900 });
    expect(r.rows[0].eggPct).toBe(90);
  });
});

describe('weeklyReport', () => {
  it('sums only the 7 days ending today and averages egg % over bird-days', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log(i + 10, 1, { eggs: 850 + i * 10 })); // Oct 10..19
    const r = weeklyReport(tenant([batch('A', logs)]), '2026-10-19').rows[0];
    expect(r.days).toBe(7);
    expect(r.mortality).toBe(7);
    expect(r.feed).toBe(700);
    expect(r.eggPct).toBe(91); // eggs 880..940 → 6370 / 7000
    expect(r.eggStd).toBe(90);
  });
});

describe('vaccination compliance', () => {
  const v = (due: string, done: string | null) => ({ id: due, name: 'ND', due, done });
  it('classifies each dose', () => {
    expect(vaccStatus(v('2026-10-10', '2026-10-10'), '2026-10-19')).toBe('onTime');
    expect(vaccStatus(v('2026-10-10', '2026-10-12'), '2026-10-19')).toBe('late');
    expect(vaccStatus(v('2026-10-10', null), '2026-10-19')).toBe('overdue');
    expect(vaccStatus(v('2026-10-19', null), '2026-10-19')).toBe('upcoming'); // due today is not overdue yet
  });
  it('compliance = on time ÷ due by today (future doses excluded)', () => {
    const b = batch('A', [], { vacc: [v('2026-10-01', '2026-10-01'), v('2026-10-05', '2026-10-07'), v('2026-10-09', null), v('2026-10-30', null)] });
    expect(vaccReport(tenant([b]), '2026-10-19')).toMatchObject({ due: 3, onTime: 1, overdue: 1, compliance: 33.3 });
  });
});

describe('mortReport', () => {
  it('lists only days with losses, newest first, with a running total per batch', () => {
    const r = mortReport(tenant([batch('A', [log(1, 2), log(2, 0), log(3, 4, { culls: 1 })]), batch('B', [log(3, 1)])]));
    expect(r.rows.map((x) => [x.date, x.b.code, x.run])).toEqual([['2026-10-03', 'A', 7], ['2026-10-03', 'B', 1], ['2026-10-01', 'A', 2]]);
    expect([r.mortality, r.culls]).toEqual([7, 1]);
    expect(r.rows[0].pct).toBe(0.5);
  });
});
