import { describe, it, expect } from 'vitest';
import { batchAlerts, thi, type AlertBatch, type AlertLog } from '../../../../supabase/functions/_shared/alerts';

const TODAY = '2026-10-19';
const log = (d: number, x: Partial<AlertLog> = {}): AlertLog => ({
  date: `2026-10-${String(d).padStart(2, '0')}`, birds: 10000, mortality: 4, feed_kg: 1000, water: 2000, eggs: 0, avg_w: null, tmax: 25, rh: 50, ...x,
});
const batch = (logs: AlertLog[], x: Partial<AlertBatch> = {}): AlertBatch => ({
  id: 'b1', code: 'B1', ft: 'broiler', placed: '2026-09-21', logs, // day 28 today
  curve: [{ week: 3, egg: null, weight: 1000 }, { week: 4, egg: null, weight: 1700 }, { week: 30, egg: 92, weight: null }], ...x,
});
const week = (today: Partial<AlertLog> = {}) => [12, 13, 14, 15, 16, 17, 18].map((d) => log(d)).concat(log(19, today));
const rules = (b: AlertBatch) => batchAlerts(b, TODAY).map((a) => `${a.key.split(':')[0]}/${a.severity}`);

describe('THI', () => {
  it('matches the formula at three points', () => {
    expect(thi(35, 60)).toBeCloseTo(87.04, 2);
    expect(thi(30, 50)).toBeCloseTo(78.52, 2);
    expect(thi(25, 50)).toBeCloseTo(72.0, 2);
  });
});

describe('batchAlerts', () => {
  it('a normal day raises nothing', () => expect(rules(batch(week()))).toEqual([]));
  it('missing log for today is the only alert', () => expect(rules(batch(week().slice(0, -1)))).toEqual(['nolog/warning']));
  it('mortality spike is critical (> 1.8× baseline and > 5)', () => expect(rules(batch(week({ mortality: 8 })))).toEqual(['spike/critical']));
  it('a small absolute rise is not a spike', () => expect(rules(batch(week({ mortality: 5 })))).toEqual([]));
  it('water and feed drops > 10% vs yesterday', () => expect(rules(batch(week({ water: 1700, feed_kg: 850 })))).toEqual(['water/warning', 'feed/warning']));
  it('heat stress: warning then critical', () => {
    expect(rules(batch(week({ tmax: 30, rh: 50 })))).toEqual(['heat/warning']);
    expect(rules(batch(week({ tmax: 35, rh: 60 })))).toEqual(['heat/critical']);
  });
  it('broiler weight > 7% below standard (day 28 → 1700 g)', () => {
    expect(rules(batch(week({ avg_w: 1550 })))).toEqual(['weight/warning']);
    expect(rules(batch(week({ avg_w: 1650 })))).toEqual([]);
  });
  it('layer egg % > 3 points below the curve (day 210 → week 30 → 92%)', () => {
    const layer = { ft: 'layer', placed: '2026-03-23' };
    expect(rules(batch(week({ eggs: 8500 }), layer))).toEqual(['egg/warning']);
    expect(rules(batch(week({ eggs: 9000 }), layer))).toEqual([]);
  });
  it('keys are stable per rule, batch and day (dedupe)', () => {
    expect(batchAlerts(batch(week({ mortality: 8 })), TODAY)[0].key).toBe('spike:b1:2026-10-19');
  });
});
