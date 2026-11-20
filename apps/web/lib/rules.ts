// tenant_rule keys the app edits (owner only). Defaults mirror the SQL defaults (0036–0044), so the card shows what the DB uses.
export type RuleKind = 'bool' | 'int' | 'num' | 'enum';
export type RuleDef = { key: string; kind: RuleKind; def: boolean | number | string; min?: number; max?: number; unit?: 'days' | 'pct' | 'c' | 'min'; opts?: string[]; lowOf?: string; highOf?: string };

export const RULES: RuleDef[] = [
  { key: 'allow_self_approval', kind: 'bool', def: true },
  { key: 'egg_max_storage_days', kind: 'int', def: 7, min: 1, max: 30, unit: 'days' },
  { key: 'breeder_mortality_alert_pct', kind: 'num', def: 0.5, min: 0.01, max: 100, unit: 'pct' },
  { key: 'floor_egg_alert_pct', kind: 'num', def: 5, min: 0, max: 100, unit: 'pct' },
  { key: 'allow_treated_dirty_eggs', kind: 'bool', def: false },
  { key: 'floor_eggs_settable', kind: 'bool', def: false },
  { key: 'expired_vaccine_policy', kind: 'enum', def: 'warn', opts: ['warn', 'block'] },
  { key: 'simple_hatch_flow', kind: 'bool', def: false },
  { key: 'machine_temp_min_c', kind: 'num', def: 37.2, min: 30, max: 45, unit: 'c', highOf: 'machine_temp_max_c' },
  { key: 'machine_temp_max_c', kind: 'num', def: 37.8, min: 30, max: 45, unit: 'c', lowOf: 'machine_temp_min_c' },
  { key: 'machine_rh_min_pct', kind: 'num', def: 45, min: 0, max: 100, unit: 'pct', highOf: 'machine_rh_max_pct' },
  { key: 'machine_rh_max_pct', kind: 'num', def: 65, min: 0, max: 100, unit: 'pct', lowOf: 'machine_rh_min_pct' },
  { key: 'house_temp_min_c', kind: 'num', def: 15, min: -10, max: 50, unit: 'c', highOf: 'house_temp_max_c' },
  { key: 'house_temp_max_c', kind: 'num', def: 32.2, min: -10, max: 50, unit: 'c', lowOf: 'house_temp_min_c' },
  { key: 'incubation_days', kind: 'int', def: 21, min: 15, max: 30, unit: 'days' },
  { key: 'alert_escalation_minutes', kind: 'int', def: 60, min: 5, max: 1440, unit: 'min' }, // 0061: unacknowledged warning/critical alerts escalate after this
  { key: 'feed_days_alert', kind: 'int', def: 3, min: 1, max: 30, unit: 'days' }, // 0061: breeder feed store below this many days left
];
export const RULE_KEYS = RULES.map((r) => r.key);
export const ruleDef = (key: string) => RULES.find((r) => r.key === key);

/** Parse the text a form sends into the JSON value stored in tenant_rule; null = not valid for this key. */
export function parseRule(key: string, raw: string): boolean | number | string | null {
  const r = ruleDef(key);
  if (!r) return null;
  if (r.kind === 'bool') return raw === 'yes' ? true : raw === 'no' ? false : null;
  if (r.kind === 'enum') return r.opts!.includes(raw) ? raw : null;
  if (!(r.kind === 'int' ? /^\d{1,4}$/ : /^-?\d{1,3}(\.\d{1,2})?$/).test(raw)) return null;
  const n = Number(raw);
  return n >= r.min! && n <= r.max! ? n : null;
}

/** A new min must stay below its max (and the reverse), or every reading would count as out of range. */
export function pairOk(key: string, value: number, current: (k: string) => number): boolean {
  const r = ruleDef(key);
  if (r?.highOf) return value < current(r.highOf);
  if (r?.lowOf) return value > current(r.lowOf);
  return true;
}

/** Form text for a stored value. */
export const ruleText = (v: unknown) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
