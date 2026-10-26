// Per-batch farm alert rules (roadmap Phase 10 table). Pure, no imports: run by daily-alerts (Deno) and
// unit-tested from apps/web (tests/unit/alerts.test.ts). Each alert carries a dedupe key, so re-running
// the job on the same day never duplicates a notification.
// ponytail: thresholds are global constants; per-tenant overrides when a farm asks (tenant_setting table).
export const LIMITS = {
  spikeX: 1.8, spikeMin: 5,   // deaths today > 1.8× mean of the previous ≤7 days and > 5 (demo rule)
  dropPct: 10,                // water / feed down > 10% vs yesterday
  thiWarn: 78, thiCrit: 84,   // heat stress (THI, °F scale) — [B] configurable
  eggPts: 3,                  // hen-day % this many points below the breed curve
  weightPct: 7,               // avg weight this % below the breed standard
};

export type AlertLog = { date: string; birds: number; mortality: number; feed_kg: number; water: number; eggs: number; avg_w: number | null; tmax: number | null; rh: number | null };
export type AlertBatch = {
  id: string; code: string; ft: string; placed: string;
  logs: AlertLog[]; // ascending by date, last ~8 days
  curve: { week: number; egg: number | null; weight: number | null }[];
};
export type Alert = { key: string; severity: 'critical' | 'warning' | 'info'; title: string; body: string; entity_type: 'batch'; entity_id: string };

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
/** Temperature-humidity index from °C and RH %: (1.8T+32) − (0.55−0.0055·RH)(1.8T−26.8). */
export const thi = (t: number, rh: number) => 1.8 * t + 32 - (0.55 - 0.0055 * rh) * (1.8 * t - 26.8);

function stdAt(curve: AlertBatch['curve'], day: number, f: 'egg' | 'weight') {
  const pts = curve.filter((r) => r[f] != null);
  if (!pts.length) return null;
  if (f === 'egg') return pts.find((r) => r.week === Math.min(72, Math.floor(day / 7)))?.egg ?? null;
  const w = day / 7, last = pts.length - 1; // weight: interpolate between weekly points (same as lib/kpi.ts stdWeight)
  const lo = pts[Math.min(last, Math.floor(w))].weight!, hi = pts[Math.min(last, Math.floor(w) + 1)].weight!;
  return Math.round(lo + (hi - lo) * (w - Math.floor(w)));
}

export function batchAlerts(b: AlertBatch, today: string): Alert[] {
  const out: Alert[] = [];
  const add = (rule: string, severity: Alert['severity'], title: string, body: string) =>
    out.push({ key: `${rule}:${b.id}:${today}`, severity, title, body, entity_type: 'batch', entity_id: b.id });
  const l = b.logs.find((x) => x.date === today);
  if (!l) {
    if (b.logs.length) add('nolog', 'warning', `No daily log today — ${b.code}`, 'Nobody has entered mortality, feed and water for today.');
    return out; // the other rules need today's numbers
  }
  const prev = b.logs.filter((x) => x.date < today).slice(-7), y = prev.at(-1);
  const day = days(b.placed, today);

  const base = prev.reduce((a, x) => a + x.mortality, 0) / Math.max(1, prev.length);
  if (prev.length >= 3 && l.mortality > LIMITS.spikeMin && l.mortality > LIMITS.spikeX * base)
    add('spike', 'critical', `Mortality ${(l.mortality / Math.max(base, 1)).toFixed(1)}× baseline — ${b.code}`,
      `${l.mortality} deaths today vs 7-day baseline ${base.toFixed(1)}/day. Upload photos for AI triage and call the vet.`);

  const drop = (now: number, was: number) => (was > 0 && now >= 0 ? (100 * (was - now)) / was : 0);
  if (y && drop(l.water, y.water) > LIMITS.dropPct)
    add('water', 'warning', `Water down ${Math.round(drop(l.water, y.water))}% — ${b.code}`, `${l.water} L today vs ${y.water} L yesterday. Check drinker lines and the tank — falling water is often the first sign of disease.`);
  if (y && drop(l.feed_kg, y.feed_kg) > LIMITS.dropPct)
    add('feed', 'warning', `Feed intake down ${Math.round(drop(l.feed_kg, y.feed_kg))}% — ${b.code}`, `${l.feed_kg} kg today vs ${y.feed_kg} kg yesterday.`);

  if (l.tmax != null && l.rh != null) {
    const h = thi(l.tmax, l.rh);
    if (h >= LIMITS.thiWarn)
      add('heat', h >= LIMITS.thiCrit ? 'critical' : 'warning', `Heat stress (THI ${Math.round(h)}) — ${b.code}`, `${l.tmax} °C at ${l.rh}% humidity. Run foggers/fans, add electrolytes, avoid feeding at peak heat.`);
  }
  if (b.ft === 'layer' && l.eggs > 0 && l.birds > 0) {
    const std = stdAt(b.curve, day, 'egg'), pct = (100 * l.eggs) / l.birds;
    if (std != null && pct < std - LIMITS.eggPts)
      add('egg', 'warning', `Egg production ${pct.toFixed(1)}% vs standard ${std}% — ${b.code}`, 'Check feed, light hours, water and signs of disease.');
  }
  if (b.ft === 'broiler' && l.avg_w) {
    const std = stdAt(b.curve, day, 'weight');
    if (std && l.avg_w < std * (1 - LIMITS.weightPct / 100))
      add('weight', 'warning', `Weight ${l.avg_w} g vs standard ${std} g — ${b.code}`, `${Math.round(100 - (100 * l.avg_w) / std)}% below the breed standard on day ${day}.`);
  }
  return out;
}
