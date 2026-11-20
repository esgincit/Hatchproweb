import { describe, expect, it } from 'vitest';
import { SCHEMAS } from '@/lib/schemas';
import { canAct } from '@/lib/auth/permissions';
import { RULES, RULE_KEYS, pairOk, parseRule, ruleText } from '@/lib/rules';

const U = '3f2b8a4e-1c6d-4e8a-9b7f-5d2c1a0e9f11';
const ok = (act: keyof typeof SCHEMAS, v: unknown) => SCHEMAS[act].safeParse(v).success;

describe('tenant rules', () => {
  it('keeps an allow-list and parses each kind', () => {
    expect(RULE_KEYS).toContain('expired_vaccine_policy');
    expect(parseRule('allow_self_approval', 'no')).toBe(false);
    expect(parseRule('expired_vaccine_policy', 'block')).toBe('block');
    expect(parseRule('expired_vaccine_policy', 'ignore')).toBeNull();
    expect(parseRule('machine_temp_max_c', '37.8')).toBe(37.8);
    expect(parseRule('machine_temp_max_c', '99')).toBeNull();
    expect(parseRule('egg_max_storage_days', '7.5')).toBeNull();
    expect(parseRule('incubation_days', '21')).toBe(21);
    expect(parseRule('nope', '1')).toBeNull();
  });
  it('a min must stay below its max', () => {
    const cur = (k: string) => ({ machine_temp_max_c: 37.8, machine_temp_min_c: 37.2 }[k] ?? 0);
    expect(pairOk('machine_temp_min_c', 37.5, cur)).toBe(true);
    expect(pairOk('machine_temp_min_c', 38, cur)).toBe(false);
    expect(pairOk('machine_temp_max_c', 37, cur)).toBe(false);
    expect(pairOk('incubation_days', 21, cur)).toBe(true);
  });
  it('every rule round-trips through the form text, and setRule validates through it', () => {
    for (const r of RULES) {
      expect(parseRule(r.key, ruleText(r.def)), r.key).toBe(r.def);
      expect(ok('setRule', { key: r.key, value: ruleText(r.def) }), r.key).toBe(true);
    }
    expect(ok('setRule', { key: 'sneaky', value: '1' })).toBe(false);
  });
});

describe('breeder + hatchery schemas', () => {
  it('a breeder flock splits into females and males that add up', () => {
    const base = { shed_id: U, code: 'B-1', placed: '2026-01-01', doc: 330, doc_rate: 0 };
    expect(ok('addBatch', base)).toBe(true);
    expect(ok('addBatch', { ...base, females_placed: 300, males_placed: 30 })).toBe(true);
    expect(ok('addBatch', { ...base, females_placed: 300, males_placed: 40 })).toBe(false);
    expect(ok('addBatch', { ...base, females_placed: 330 })).toBe(false);
  });
  it('egg collection: rejects fit inside the nest eggs, treated eggs inside the dirty ones', () => {
    const base = { batch_id: U, date: '2026-01-02', collection_no: 1, nest: 100, floor: 5 };
    expect(ok('eggCollection', { ...base, broken: 10, dirty: 5, dirty_treated: 5 })).toBe(true);
    expect(ok('eggCollection', { ...base, broken: 60, cracked: 50 })).toBe(false);
    expect(ok('eggCollection', { ...base, dirty: 2, dirty_treated: 3 })).toBe(false);
    expect(ok('eggCollection', { ...base, collection_no: 7 })).toBe(false);
  });
  it('body weight: fleshing score is for males only, 1 to 5', () => {
    const base = { batch_id: U, date: '2026-01-02', sample_size: 15, avg_g: 2000 };
    expect(ok('bodyWeight', { ...base, sex: 'M', fleshing_score: 3 })).toBe(true);
    expect(ok('bodyWeight', { ...base, sex: 'F', fleshing_score: 3 })).toBe(false);
    expect(ok('bodyWeight', { ...base, sex: 'M', fleshing_score: 6 })).toBe(false);
  });
  it('candling needs the counts of its own stage', () => {
    const base = { batch_id: U, date: '2026-01-10', eggs_candled: 500 };
    expect(ok('candling', { ...base, stage: 1, infertile: 10, early_dead: 5, dirty: 0 })).toBe(true);
    expect(ok('candling', { ...base, stage: 1, infertile: 10 })).toBe(false);
    expect(ok('candling', { ...base, stage: 2, mid_dead: 3, late_dead: 4 })).toBe(true);
    expect(ok('candling', { ...base, stage: 2, infertile: 3 })).toBe(false);
    expect(ok('candling', { ...base, stage: 3, mid_dead: 3, late_dead: 4 })).toBe(false);
  });
  it('releasing a hatcher needs every checklist item ticked', () => {
    const all = { batch_id: U, chicks_removed: 'yes', waste_recorded: 'yes', cleaned: 'yes', disinfected: 'yes', inspected: 'yes' };
    expect(ok('releaseHatcher', all)).toBe(true);
    expect(ok('releaseHatcher', { ...all, cleaned: 'no' })).toBe(false);
  });
  it('a rejection needs a reason, an approval does not', () => {
    for (const a of ['decideDaily', 'decideEggs', 'decideCandling', 'decideXfer', 'decideHatch', 'decideQuality'] as const) {
      expect(ok(a, { id: U, decision: 'approve' })).toBe(true);
      expect(ok(a, { id: U, decision: 'reject' })).toBe(false);
      expect(ok(a, { id: U, decision: 'reject', reason: 'miscount' })).toBe(true);
    }
  });
  it('quality defects cannot exceed the sample', () => {
    const base = { batch_id: U, date: '2026-01-02', sample_size: 10, navel_defects: 4, leg_defects: 4, other_defects: 3, dispatch_eligible: 'yes' };
    expect(ok('chickQuality', base)).toBe(false);
    expect(ok('chickQuality', { ...base, other_defects: 2 })).toBe(true);
  });
});

describe('role matrix mirrors the DB approvers', () => {
  it('who approves what', () => {
    expect(canAct(['hatchery_technician'], 'decideCandling')).toBe(false);
    expect(canAct(['hatchery_technician'], 'decideHatch')).toBe(false);
    expect(canAct(['hatchery_ops_manager'], 'decideCandling')).toBe(true);
    expect(canAct(['hatchery_ops_manager'], 'decideXfer')).toBe(true);
    expect(canAct(['hatchery_ops_manager'], 'decideHatch')).toBe(false);
    expect(canAct(['hatchery_manager'], 'decideHatch')).toBe(true);
    expect(canAct(['hatchery_manager'], 'decideCandling')).toBe(false);
    expect(canAct(['veterinarian'], 'decideQuality')).toBe(true);
    expect(canAct(['farm_manager'], 'decideDaily')).toBe(true);
    expect(canAct(['shed_supervisor'], 'decideDaily')).toBe(false);
    expect(canAct(['shed_supervisor'], 'breederDaily')).toBe(true);
  });
  it('who records what', () => {
    expect(canAct(['hatchery_technician'], 'loadSetter')).toBe(true);
    expect(canAct(['hatchery_technician'], 'chickVaccine')).toBe(true);
    expect(canAct(['hatchery_technician'], 'chickQuality')).toBe(false);
    expect(canAct(['hatchery_ops_manager'], 'releaseHatcher')).toBe(true);
    expect(canAct(['hatchery_technician'], 'releaseHatcher')).toBe(false);
    expect(canAct(['farm_manager'], 'addMachine')).toBe(true);
    expect(canAct(['farm_manager'], 'setRule')).toBe(false);
  });
});
