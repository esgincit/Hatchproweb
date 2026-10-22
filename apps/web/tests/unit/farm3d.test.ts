import { describe, it, expect } from 'vitest';
import { farmScene, shedSize, MAX_BIRDS } from '@/lib/farm3d';
import type { Batch, Tenant } from '@/lib/view/types';

const log = { id: 'l', date: '2026-10-19', day: 20, birds: 9000, mortality: 7, culls: 3, feed_kg: 900, water: 1800, eggs: 0, grades: null, avg_w: 820, tmax: 33, tmin: 25, remarks: 'ok' };
const batch: Batch = {
  id: 'b', code: 'B1', ft: 'broiler', breed: 'Cobb', age: 21, doc: 10000, doc_rate: 40, state: 'growing', placed: '2026-09-28',
  shed_name: 'Shed A', farm_name: 'F', logs: [log], vacc: [], curve: [{ week: 3, egg: null, weight: 900 }], cum: { dead: 400, feed: 9000, eggs: 0, saleable: 0 },
};
const t = {
  farms: [{ id: 'f', name: 'F', farm_type: 'broiler', district: '', capacity: 0, sheds: [
    { id: 's1', name: 'Shed A', type: 'deep_litter', capacity: 10000, area: 7500 },
    { id: 's2', name: 'Shed B', type: 'deep_litter', capacity: 10000, area: null },
  ] }],
  batches: [batch],
  disease_cases: [{ id: 'c', batch: 'B1', opened: '', disease: 'Heat stress', confidence: 0.88, vet_confirmed: false, status: 'open', notes: '' }],
} as unknown as Tenant;

describe('farmScene', () => {
  it('sizes sheds from area (12 m wide open shed) and falls back to capacity', () => {
    expect(shedSize('deep_litter', 10000, 7500)).toEqual({ w: 12, l: 58 });
    expect(shedSize('environment_controlled', 25000, 18750)).toEqual({ w: 15, l: 116 });
    expect(shedSize('cage', 100, null).l).toBe(20);
  });
  it('maps live batch to expected vs actual, caps drawn birds, surfaces open disease case', () => {
    const [a, b] = farmScene(t)[0].sheds;
    expect(a.batch).toMatchObject({ alive: 8990, drawn: MAX_BIRDS, weight: 820, weightStd: 900, mortToday: 7, issue: 'Heat stress (88%)' });
    expect(b.batch).toBeNull();
  });
});
