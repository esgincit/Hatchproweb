import { describe, it, expect } from 'vitest';
import { settle, type ContractTerms } from '@/lib/settlement';

const T: ContractTerms = { base_rate: 6.5, std_fcr: 1.7, fcr_bonus: 0.1, fcr_penalty: 0.1, min_rate: 4, allowed_mort_pct: 5, mort_penalty: 20 };

describe('contract settlement', () => {
  it('better FCR earns a bonus; deaths above 5% are charged (hand calculation)', () => {
    // FCR 35,700 / 21,620 = 1.6512 → 5 steps of 0.01 better → ₹6.50 + 0.50 = ₹7.00/kg
    // gross 21,620 × 7 = 1,51,340; allowed dead 500 → 100 extra × ₹20 = 2,000; net 1,49,340
    expect(settle(T, { placed: 10000, dead: 600, liftedBirds: 9400, liftedKg: 21620, feedKg: 35700 })).toMatchObject({
      fcr: 1.651, steps: 5, rate: 7, excessDead: 100, mortCharge: 2000, gross: 151340, net: 149340, avgKg: 2.3, mortPct: 6,
    });
  });
  it('worse FCR is penalised but never below the floor', () => {
    expect(settle(T, { placed: 10000, dead: 300, liftedBirds: 9700, liftedKg: 20000, feedKg: 36000 })!.rate).toBe(5.5); // 1.80 → −10 steps
    expect(settle(T, { placed: 10000, dead: 300, liftedBirds: 9700, liftedKg: 20000, feedKg: 60000 })!.rate).toBe(4); // floor
  });
  it('exactly the standard FCR pays the base rate; nothing lifted → no settlement', () => {
    expect(settle(T, { placed: 1000, dead: 0, liftedBirds: 1000, liftedKg: 1000, feedKg: 1700 })).toMatchObject({ steps: 0, rate: 6.5, mortCharge: 0, net: 6500 });
    expect(settle(T, { placed: 1000, dead: 0, liftedBirds: 0, liftedKg: 0, feedKg: 10 })).toBeNull();
  });
});
