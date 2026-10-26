import { describe, it, expect } from 'vitest';
import { batchKpi, attMonth, ageing, hatchKpi, payslip, stdWeight } from '@/lib/kpi';
import type { Batch, Tenant } from '@/lib/view/types';

const log = (day: number, mortality: number, extra: Partial<Batch['logs'][number]> = {}) => ({
  id: 'l' + day, date: `2026-10-${String(day).padStart(2, '0')}`, day, birds: 10000 - day * 10, mortality, culls: 1,
  feed_kg: 1000, water: 2000, eggs: 0, grades: null, avg_w: null, tmax: 32, tmin: 24, remarks: null, rh: null, by: null, ...extra,
});
const batch = (mort: number[], extra: Partial<Batch> = {}): Batch => ({
  id: 'b', code: 'B1', ft: 'broiler', breed: 'Cobb', age: mort.length, doc: 10000, doc_rate: 40, state: 'growing', placed: '2026-10-01',
  shed_name: 'Shed A', farm_name: 'F', logs: mort.map((m, i) => log(i + 1, m)), vacc: [],
  curve: [0, 1, 2].map((w) => ({ week: w, egg: null, weight: [42, 185, 465][w] })), cum: { dead: 300, feed: 14000, eggs: 0, saleable: 0 }, ...extra,
});

describe('batchKpi (demo rule: crit when 7-day avg mortality > 1.8× prior week and > 5/day)', () => {
  it('flags a spike', () => expect(batchKpi(batch([...Array(7).fill(4), ...Array(7).fill(12)])).rag).toBe('crit'));
  it('stays good when flat', () => expect(batchKpi(batch(Array(14).fill(6))).rag).toBe('good'));
  it('closed batches are neutral', () => expect(batchKpi(batch(Array(14).fill(30), { state: 'closed' })).rag).toBe('neutral'));
  it('alive = last opening − deaths − culls; mortality % from cumulative', () => {
    const k = batchKpi(batch(Array(3).fill(5)));
    expect(k.alive).toBe(10000 - 30 - 5 - 1);
    expect(k.mortPct).toBe(3);
  });
  it('interpolates breed weight standard', () => expect(stdWeight(batch([1]), 7 + 3.5)).toBe(325));
});

describe('attMonth + ageing', () => {
  const t = { attendance: { w1: { '2026-10-01': 'P', '2026-10-02': 'H', '2026-10-03': 'L', '2026-10-05': 'A' } } } as unknown as Tenant;
  it('payable = P + 0.5·H + L', () => {
    const a = attMonth(t, 'w1', '2026-10-19');
    expect([a.P, a.H, a.L, a.A, a.payable, a.days]).toEqual([1, 1, 1, 1, 2.5, 31]);
  });
  it('hatchKpi matches the hand calculation (57,600 set; 4,600 clears; 48,000 A + 1,500 B)', () => {
    const b = { code: 'H1', doc: 57600, hatch: { candled_on: '2026-10-11', clears: 4600, dead_germ: 900, hatched_on: '2026-10-25', chicks_a: 48000, chicks_b: 1500, culls: 600 } } as unknown as Batch;
    const inv = [{ batch: 'H1', product: 'doc', qty: 10000 }, { batch: 'H1', product: 'egg', qty: 5 }, { batch: 'X', product: 'doc', qty: 7 }] as unknown as Parameters<typeof hatchKpi>[1];
    expect(hatchKpi(b, inv)).toMatchObject({ stage: 'hatched', fertile: 53000, chicks: 49500, fertility: 92, hatchability: 85.9, hof: 93.4, gradeA: 97, dispatched: 10000, inStock: 39500 });
    expect(hatchKpi({ ...b, hatch: null } as Batch, []).stage).toBe('set');
  });
  it('payslip = wage × payable/days − advances (bank file amount)', () => {
    const tp = { ...t, advances: [{ worker_id: 'w1', amount: 300 }, { worker_id: 'w2', amount: 999 }] } as unknown as Tenant;
    expect(payslip(tp, { id: 'w1', name: '', role: '', wage: 12400, farm_id: null }, '2026-10-19')).toMatchObject({ gross: 1000, adv: 300, net: 700 });
  });
  it('buckets outstanding by days past due', () => {
    const inv = (due: string, total: number, paid = 0) => ({ id: due, no: '', customer_id: 'c', customer: '', product: '', qty: 0, unit: '', rate: 0, date: due, due, total, paid, status: 'unpaid', batch: null });
    expect(ageing([inv('2026-10-25', 100), inv('2026-10-01', 200, 50), inv('2026-08-01', 300), inv('2026-07-01', 1, 1)], '2026-10-19'))
      .toEqual({ 'Not due': 100, '1–30': 150, '31–60': 0, '60+': 300 });
  });
});
