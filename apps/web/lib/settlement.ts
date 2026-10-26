// Contract (integrator) broiler settlement — roadmap Phase 7. The integrator supplies chicks/feed/medicine and pays the
// farmer a growing charge per kg lifted. Rate = base ± per 0.01 of FCR better/worse than the contract standard
// (never below the floor); deaths above the allowed % are charged per bird. Pure: used for the batch-page estimate
// and by the settle action, so the invoice always matches what the farmer was shown.
export type ContractTerms = {
  base_rate: number;        // ₹ per kg lifted at the standard FCR
  std_fcr: number;          // e.g. 1.70
  fcr_bonus: number;        // ₹/kg added per 0.01 FCR better than standard
  fcr_penalty: number;      // ₹/kg removed per 0.01 FCR worse than standard
  min_rate: number;         // floor ₹/kg
  allowed_mort_pct: number; // e.g. 5
  mort_penalty: number;     // ₹ per bird dead above the allowed %
};
export type Harvest = { placed: number; dead: number; liftedBirds: number; liftedKg: number; feedKg: number };

const r2 = (x: number) => Math.round(x * 100) / 100;

export function settle(c: ContractTerms, h: Harvest) {
  if (h.liftedKg <= 0) return null;
  const fcr = h.feedKg / h.liftedKg;
  const steps = Math.round(+((c.std_fcr - fcr) * 100).toFixed(6)); // + = better than standard
  const rate = r2(Math.max(c.min_rate, c.base_rate + (steps > 0 ? steps * c.fcr_bonus : steps * c.fcr_penalty)));
  const mortPct = h.placed ? (100 * h.dead) / h.placed : 0;
  const excessDead = Math.max(0, Math.round(h.dead - (c.allowed_mort_pct * h.placed) / 100));
  const mortCharge = r2(excessDead * c.mort_penalty);
  const gross = r2(rate * h.liftedKg);
  const net = r2(Math.max(0, gross - mortCharge));
  return { fcr: Math.round(fcr * 1000) / 1000, steps, rate, mortPct: Math.round(mortPct * 100) / 100, excessDead, mortCharge, gross, net, avgKg: h.liftedBirds ? r2(h.liftedKg / h.liftedBirds) : null };
}
