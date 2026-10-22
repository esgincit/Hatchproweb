// View-model for the live 3D farm (roadmap Phase 9): real farm/shed rows → sized sheds + per-shed expected vs actual.
import { batchKpi, stdWeight, type Rag } from './kpi';
import type { FarmType } from './farm-types';
import type { Tenant } from './view/types';

export const RAG_HEX = { good: '#3fa564', warn: '#e8a93c', crit: '#d9483b', neutral: '#8c8c8c' } as const;
export const MAX_BIRDS = 2500; // ponytail: render cap per shed (1 bird drawn = N real); raise with GPU-skinned VAT birds

export type Shed3D = {
  id: string; name: string; type: string; capacity: number;
  w: number; l: number; // metres
  batch: null | {
    code: string; ft: FarmType; breed: string; state: string; day: number; rag: Rag;
    placed: number; alive: number; drawn: number;
    weight: number | null; weightStd: number | null; eggPct: number | null; eggStd: number | null;
    mortToday: number; mort7: number; tmax: number | null; tmin: number | null;
    lastDate: string | null; remarks: string | null; issue: string | null;
  };
};
export type Farm3D = { id: string; name: string; ft: FarmType; sheds: Shed3D[] };

/** Shed footprint: area_sqft if known, else ~0.75 sqft/bird; Indian sheds are ~12 m wide (EC ~15 m). */
export function shedSize(type: string, capacity: number, areaSqft: number | null) {
  const m2 = (areaSqft || capacity * 0.75) * 0.0929;
  const w = type === 'environment_controlled' ? 15 : 12;
  return { w, l: Math.round(Math.min(150, Math.max(20, m2 / w))) };
}

export function farmScene(t: Tenant): Farm3D[] {
  return t.farms.map((f) => ({
    id: f.id, name: f.name, ft: f.farm_type,
    sheds: f.sheds.map((s) => {
      const b = t.batches.find((x) => x.shed_name === s.name && x.farm_name === f.name && x.state !== 'closed');
      const k = b && batchKpi(b);
      const last = k?.last;
      const sick = b && t.disease_cases.find((c) => c.batch === b.code && c.status !== 'resolved');
      const alive = Math.max(0, k?.alive ?? 0);
      return {
        id: s.id, name: s.name, type: s.type, capacity: s.capacity, ...shedSize(s.type, s.capacity, s.area),
        batch: b && k ? {
          code: b.code, ft: b.ft, breed: b.breed, state: b.state, day: b.age, rag: k.rag,
          placed: b.doc, alive, drawn: Math.min(alive, MAX_BIRDS),
          weight: last?.avg_w ?? null, weightStd: b.ft === 'broiler' ? stdWeight(b, b.age) : null,
          eggPct: b.ft === 'layer' && last ? Math.round(k.eggPct * 10) / 10 : null, eggStd: k.std,
          mortToday: last?.mortality ?? 0, mort7: Math.round(k.m7 * 10) / 10,
          tmax: last?.tmax ?? null, tmin: last?.tmin ?? null, lastDate: last?.date ?? null, remarks: last?.remarks ?? null,
          issue: sick ? `${sick.disease} (${Math.round(sick.confidence * 100)}%)` : null,
        } : null,
      };
    }),
  }));
}
