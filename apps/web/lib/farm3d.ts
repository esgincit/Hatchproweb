// View-model for the live 3D farm (roadmap Phase 9): real farm/shed/batch/asset/worker rows → what the scene draws
// and what the viewer panels show.
import { batchKpi, stdWeight, type Rag } from './kpi';
import type { FarmType } from './farm-types';
import type { Tenant } from './view/types';

export const RAG_HEX = { good: '#3fa564', warn: '#e8a93c', crit: '#d9483b', neutral: '#8c8c8c' } as const;
export const MAX_BIRDS = 2500; // ponytail: render cap per shed (1 bird drawn = N real); raise with GPU-skinned VAT birds

export type Day3D = { date: string; mort: number; eggs: number; w: number | null; feed: number };
export type Batch3D = {
  id: string; code: string; ft: FarmType; breed: string; state: string; day: number; rag: Rag;
  placed: number; alive: number; drawn: number;
  weight: number | null; weightStd: number | null; eggPct: number | null; eggStd: number | null; fcr: number | null;
  mortToday: number; mort7: number; feedToday: number | null; waterToday: number | null; eggsToday: number | null;
  tmax: number | null; tmin: number | null; rh: number | null;
  lastDate: string | null; lastBy: string | null; remarks: string | null; issue: string | null;
  days: Day3D[]; // last 14 logs, oldest first
};
export type Shed3D = {
  id: string; name: string; type: string; capacity: number;
  w: number; l: number; // metres
  batch: Batch3D | null;
  tickets: string[]; // open maintenance tickets on equipment in this shed
};
export type Asset3D = { id: string; name: string; category: string; status: string; shedId: string | null; ticket: string | null };
export type Farm3D = {
  id: string; name: string; ft: FarmType; district: string; village: string; lat: number | null; lng: number | null;
  sheds: Shed3D[]; assets: Asset3D[];
  feedKg: number | null; feedPerDay: number; // complete feed in store (null = not tracked) vs yesterday's use
  staff: { total: number; present: number | null }; // present = attendance marked P/H today (null = not marked yet)
  kpi: { birds: number; mortToday: number; feedToday: number; eggsToday: number };
};

/** Shed footprint: area_sqft if known, else ~0.75 sqft/bird; Indian sheds are ~12 m wide (EC ~15 m). */
export function shedSize(type: string, capacity: number, areaSqft: number | null) {
  const m2 = (areaSqft || capacity * 0.75) * 0.0929;
  const w = type === 'environment_controlled' ? 15 : 12;
  return { w, l: Math.round(Math.min(150, Math.max(20, m2 / w))) };
}

export function farmScene(t: Tenant, today: string): Farm3D[] {
  const userName = new Map(t.users.map((u) => [u.id, u.name]));
  const openTickets = t.tickets.filter((k) => k.status !== 'closed');
  const ticketOf = (assetId: string) => openTickets.find((k) => k.asset_id === assetId)?.issue ?? null;

  return t.farms.map((f) => {
    const assets: Asset3D[] = t.assets
      .filter((a) => a.farm_id === f.id)
      .map((a) => ({ id: a.id, name: a.name, category: a.category, status: a.status, shedId: a.shed_id, ticket: ticketOf(a.id) }));
    const sheds: Shed3D[] = f.sheds.map((s) => {
      const b = t.batches.find((x) => x.shed_name === s.name && x.farm_name === f.name && x.state !== 'closed');
      const k = b && batchKpi(b);
      const last = k?.last;
      const sick = b && t.disease_cases.find((c) => c.batch === b.code && c.status !== 'resolved');
      const alive = Math.max(0, k?.alive ?? 0);
      const size = shedSize(s.type, s.capacity, s.area);
      if (b?.ft === 'hatchery') size.l = Math.min(size.l, 40); // a hatchery is a compact building, whatever the plot area
      return {
        id: s.id, name: s.name, type: s.type, capacity: s.capacity, ...size,
        tickets: assets.filter((a) => a.shedId === s.id && a.ticket).map((a) => `${a.name}: ${a.ticket}`),
        batch: b && k ? {
          id: b.id, code: b.code, ft: b.ft, breed: b.breed, state: b.state, day: b.age, rag: k.rag,
          placed: b.doc, alive, drawn: Math.min(alive, MAX_BIRDS),
          weight: last?.avg_w ?? null, weightStd: b.ft === 'broiler' ? stdWeight(b, b.age) : null,
          eggPct: b.ft === 'layer' && last ? Math.round(k.eggPct * 10) / 10 : null, eggStd: k.std,
          fcr: k.fcr == null ? null : Math.round(k.fcr * 100) / 100,
          mortToday: last?.mortality ?? 0, mort7: Math.round(k.m7 * 10) / 10,
          feedToday: last ? last.feed_kg : null, waterToday: last ? last.water : null, eggsToday: last && b.ft === 'layer' ? last.eggs : null,
          tmax: last?.tmax ?? null, tmin: last?.tmin ?? null, rh: last?.rh ?? null,
          lastDate: last?.date ?? null, lastBy: last?.by ? (userName.get(last.by) ?? null) : null, remarks: last?.remarks ?? null,
          issue: sick ? `${sick.disease} (${Math.round(sick.confidence * 100)}%)` : null,
          days: k.logs.slice(-14).map((l) => ({ date: l.date, mort: l.mortality, eggs: l.eggs, w: l.avg_w, feed: l.feed_kg })),
        } : null,
      };
    });
    const live = sheds.map((s) => s.batch).filter((b): b is Batch3D => !!b);
    const sum = (fn: (b: Batch3D) => number) => live.reduce((a, b) => a + fn(b), 0);
    const staff = t.workers.filter((w) => w.farm_id === f.id);
    const marked = staff.filter((w) => t.attendance[w.id]?.[today]);
    return {
      id: f.id, name: f.name, ft: f.farm_type, district: f.district, village: f.village, lat: f.lat, lng: f.lng,
      sheds, assets,
      feedKg: f.feed_kg, feedPerDay: Math.round(sum((b) => b.feedToday ?? 0)),
      staff: { total: staff.length, present: marked.length ? marked.filter((w) => ['P', 'H'].includes(t.attendance[w.id][today])).length : null },
      kpi: { birds: sum((b) => b.alive), mortToday: sum((b) => b.mortToday), feedToday: Math.round(sum((b) => b.feedToday ?? 0)), eggsToday: sum((b) => b.eggsToday ?? 0) },
    };
  });
}
