import { describe, it, expect } from 'vitest';
import { sunAt } from '@/components/farm3d/sun';

const deg = (r: number) => (r * 180) / Math.PI;
describe('sunAt (Siddipet 18.1°N 78.85°E)', () => {
  it('is high in the southern sky around local noon', () => {
    const { el, dir } = sunAt(18.1, 78.85, new Date('2026-10-22T12:10:00+05:30'));
    expect(deg(el)).toBeGreaterThan(55);
    expect(deg(el)).toBeLessThan(65); // ~ 90 − 18.1 − 11 (Oct declination)
    expect(dir.z).toBeGreaterThan(0); // south = +z in the scene
  });
  it('rises in the east and is below the horizon at night', () => {
    const morning = sunAt(18.1, 78.85, new Date('2026-10-22T07:30:00+05:30'));
    expect(deg(morning.el)).toBeGreaterThan(5);
    expect(morning.dir.x).toBeGreaterThan(0); // east = +x
    expect(deg(sunAt(18.1, 78.85, new Date('2026-10-22T23:00:00+05:30')).el)).toBeLessThan(-30);
  });
});
