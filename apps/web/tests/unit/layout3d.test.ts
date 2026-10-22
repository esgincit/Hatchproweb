import { describe, it, expect } from 'vitest';
import { layoutFarm, overlaps, FOOT, type Rect } from '@/components/farm3d/layout';
import type { Farm3D } from '@/lib/farm3d';

const farm = (ft: string, sheds: [number, number, string][]) => ({
  id: 'farm-' + ft, ft, feedKg: 1200,
  sheds: sheds.map(([w, l, type], i) => ({ id: 's' + i, name: 'S' + i, type, capacity: 10000, w, l, tickets: [], batch: { ft, day: 9 } })),
}) as unknown as Farm3D;
const inside = (r: Rect, f: Rect) => Math.abs(r.x - f.x) + r.w / 2 <= f.w / 2 && Math.abs(r.z - f.z) + r.d / 2 <= f.d / 2;

describe('layoutFarm', () => {
  for (const f of [farm('broiler', [[12, 58, 'deep_litter'], [12, 58, 'deep_litter']]), farm('layer', [[12, 58, 'cage'], [12, 58, 'cage'], [12, 44, 'cage']]), farm('broiler', [[15, 116, 'environment_controlled'], [15, 116, 'environment_controlled'], [12, 70, 'deep_litter']])]) {
    const L = layoutFarm(f, ['truck_407']);
    const blds = L.buildings.map((b) => ({ x: b.x, z: b.z, w: FOOT[b.kind][0], d: FOOT[b.kind][1] }));
    it(`${f.ft} ×${f.sheds.length}: sheds, buildings, silos sit inside the fence without overlapping`, () => {
      const solids = [...L.sheds, ...blds, ...L.silos.map((s) => ({ x: s.x, z: s.z, w: 2.8, d: 2.8 }))];
      for (const s of solids) expect(inside(s, L.fence)).toBe(true);
      for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) expect(overlaps(solids[i], solids[j]), `${i}×${j}`).toBe(false);
    });
    it(`${f.ft}: buildings stay off the roads; every shed has a silo + power drop; deterministic`, () => {
      for (const b of blds) for (const r of L.roads) expect(overlaps(b, r)).toBe(false);
      expect(new Set(L.silos.map((s) => s.ref)).size).toBe(f.sheds.length);
      expect(L.wires.filter(([, b]) => b < 0)).toHaveLength(f.sheds.length);
      expect(layoutFarm(f, ['truck_407'])).toEqual(L);
    });
  }
  it('godown feed-bag stack follows feed in store', () => {
    const bags = (kg: number) => layoutFarm({ ...farm('broiler', [[12, 58, 'deep_litter']]), feedKg: kg }).props.filter((p) => p.kind === 'feed_bag').length;
    expect(bags(0)).toBe(6);       // only the 6 at the shed door
    expect(bags(500)).toBe(6 + 10);
    expect(bags(99999)).toBe(6 + 48); // capped
  });
});
