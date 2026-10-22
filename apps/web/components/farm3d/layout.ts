// Pure site layout for the 3D farm: real sheds (sizes from rows) → a believable Indian farm plan.
// x = across the sheds, z = along them; every shed's front door faces +z onto the main road; buildings sit across
// the road; a fenced compound with a gate, internal roads, silos, poles, trees and props. Deterministic per farm id.
import type { Farm3D } from '@/lib/farm3d';

export type Rect = { x: number; z: number; w: number; d: number }; // centre + size
export type Placed = { kind: string; x: number; z: number; rot: number; y?: number; scale?: number; ref?: string };
export type SiteLayout = {
  sheds: (Rect & { id: string })[];
  roads: Rect[];
  aprons: Rect[]; // concrete pads (shed spurs, wheel-dip)
  yard: Rect; // compacted ground inside the fence
  fence: Rect;
  gate: { x: number; z: number; w: number };
  buildings: Placed[]; // office, godown, generator_room, pump_house, water_tank, security_cabin, transformer (+ egg_room)
  silos: Placed[]; // ref = shed id
  trees: Placed[];
  poles: Placed[];
  wires: [number, number][]; // pole index pairs; a negative second index −1−i is a drop to shed i's front gable
  props: Placed[];
  vehicles: Placed[];
  walkways: { x: number; z: number }[][]; // paths people walk along
  fields: Rect[]; // crop fields outside the fence
  extent: number; // half-size that frames the compound
};

export const SHED_GAP = 14, ROAD_Z = 10, ROAD_W = 5;

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d + pad * 2;

// footprints (m) of the Blender models, front facing +z before rotation
export const FOOT: Record<string, [number, number]> = {
  office: [8.1, 7], godown: [15.1, 12], generator_room: [5.9, 3.3], pump_house: [3.8, 3.2], water_tank: [2.8, 2.8],
  security_cabin: [3, 3.3], transformer: [3.2, 1.6], egg_room: [8.1, 7], // office steps / godown ramp stick out at the front
};

export function layoutFarm(f: Farm3D, vehicleKinds: string[] = []): SiteLayout {
  const r = rng(f.id);
  // sheds in a row, fronts aligned on z = 0
  let acc = 0;
  const raw = f.sheds.map((s) => { const x = acc + s.w / 2; acc += s.w + SHED_GAP; return { id: s.id, x, z: -s.l / 2, w: s.w, d: s.l }; });
  const mid = (acc - SHED_GAP) / 2;
  const sheds = raw.map((s) => ({ ...s, x: s.x - mid }));
  const minX = Math.min(-20, ...sheds.map((s) => s.x - s.w / 2)), maxX = Math.max(20, ...sheds.map((s) => s.x + s.w / 2));
  const maxL = Math.max(30, ...f.sheds.map((s) => s.l));

  // buildings across the road, facing it (rot π turns the model's +z front toward the road)
  const strip = ROAD_Z + ROAD_W / 2 + 4;
  const kinds = ['office', 'godown', 'generator_room', 'pump_house', 'water_tank'];
  if (f.ft === 'layer') kinds.splice(2, 0, 'egg_room');
  const buildings: Placed[] = [];
  let bx = minX + 2;
  for (const k of kinds) {
    const [w, d] = FOOT[k];
    buildings.push({ kind: k, x: bx + w / 2, z: strip + d / 2, rot: Math.PI });
    bx += w + 7;
  }
  const front = Math.max(...buildings.map((b) => b.z + FOOT[b.kind][1] / 2)) + 16;
  const fenceMinX = Math.min(minX, bx - 7) - 22, fenceMaxX = Math.max(maxX, bx) + 22, back = -maxL - 22;
  const fence: Rect = { x: (fenceMinX + fenceMaxX) / 2, z: (front + back) / 2, w: fenceMaxX - fenceMinX, d: front - back };

  // gate in the front fence between office and godown, with an access road to the main road
  const office = buildings[0], godown = buildings[1];
  const gateX = (office.x + FOOT.office[0] / 2 + godown.x - FOOT.godown[0] / 2) / 2;
  const gate = { x: gateX, z: front, w: 7 };
  buildings.push({ kind: 'security_cabin', x: gateX + 6, z: front - 4, rot: -Math.PI / 2 });
  const gen = buildings.find((b) => b.kind === 'generator_room')!;
  buildings.push({ kind: 'transformer', x: gen.x, z: gen.z + FOOT.generator_room[1] / 2 + 4, rot: 0 });

  const roads: Rect[] = [
    { x: fence.x, z: ROAD_Z, w: fenceMaxX - fenceMinX - 16, d: ROAD_W },
    { x: gateX, z: (ROAD_Z + front) / 2, w: 6, d: front - ROAD_Z },
  ];
  const aprons: Rect[] = [
    ...sheds.map((s) => ({ x: s.x, z: (ROAD_Z - ROAD_W / 2) / 2, w: 4, d: ROAD_Z - ROAD_W / 2 })),
    { x: gateX, z: front - 7, w: 6, d: 4 }, // wheel-dip
  ];

  // silos at each shed's front-left corner (two for EC sheds, none for hatcheries) — clear of the cut-away camera
  const silos: Placed[] = sheds.flatMap((s, i) => {
    const n = f.sheds[i].batch?.ft === 'hatchery' ? 0 : f.sheds[i].type === 'environment_controlled' ? 2 : 1;
    return Array.from({ length: n }, (_, k) => ({ kind: 'feed_silo', x: s.x - s.w / 2 - 2.6, z: -3 - k * 4, rot: Math.PI / 2, ref: s.id })); // auger (+z) → into the shed
  });

  // poles along the far side of the main road; a service drop to every shed's front gable
  const poles: Placed[] = [];
  for (let x = fenceMinX + 14; x <= fenceMaxX - 14; x += 32) poles.push({ kind: 'electric_pole', x, z: ROAD_Z + ROAD_W / 2 + 1.5, rot: Math.PI / 2 }); // cross-arm across the line
  const wires: [number, number][] = poles.slice(1).map((_, i) => [i, i + 1]);
  sheds.forEach((s, i) => {
    const near = poles.reduce((b, p, j) => (Math.abs(p.x - s.x) < Math.abs(poles[b].x - s.x) ? j : b), 0);
    wires.push([near, -1 - i]);
  });

  // trees: rows inside the fence (neem + palmyra), scattered ones outside among the fields
  const solid: Rect[] = [
    ...sheds.map((s) => ({ ...s, w: s.w + 6, d: s.d + 6 })),
    ...buildings.map((b) => ({ x: b.x, z: b.z, w: FOOT[b.kind][0] + 5, d: FOOT[b.kind][1] + 5 })),
    ...roads.map((x) => ({ ...x, w: x.w + 4, d: x.d + 4 })),
    ...silos.map((s) => ({ x: s.x, z: s.z, w: 5, d: 5 })),
    { x: gateX, z: front, w: 18, d: 10 },
  ];
  const trees: Placed[] = [];
  const tryTree = (x: number, z: number, outside = false) => {
    const t = { x, z, w: 6, d: 6 };
    if (!outside && solid.some((s) => overlaps(s, t))) return;
    if (trees.some((o) => Math.hypot(o.x - x, o.z - z) < 7)) return;
    const k = r();
    trees.push({ kind: k < 0.45 ? 'tree_neem_1' : k < 0.7 ? 'tree_neem_2' : k < 0.85 ? 'palm_palmyra_1' : 'palm_palmyra_2', x, z, rot: r() * Math.PI * 2, scale: 0.85 + r() * 0.35 });
  };
  const inset = 4;
  for (let x = fenceMinX + inset; x <= fenceMaxX - inset; x += 11 + r() * 6) { tryTree(x, back + inset + r() * 2); tryTree(x, front - inset - r() * 2); }
  for (let z = back + inset; z <= front - inset; z += 11 + r() * 6) { tryTree(fenceMinX + inset + r() * 2, z); tryTree(fenceMaxX - inset - r() * 2, z); }
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.max(fence.w, fence.d) / 2 + 20 + r() * 110;
    tryTree(fence.x + Math.cos(a) * d, fence.z + Math.sin(a) * d, true);
  }

  // props: feed bags + crates at shed doors, gas cylinders (brooders) for young batches, office chairs, pump barrels
  const props: Placed[] = Array.from({ length: 16 }, () => {
    const b = buildings[Math.floor(r() * 5)];
    return { kind: 'shrub', x: b.x + (r() - 0.5) * (FOOT[b.kind][0] + 4), z: b.z + FOOT[b.kind][1] / 2 + 1.5 + r() * 2, rot: r() * 6.28, scale: 0.7 + r() * 0.6 };
  });
  sheds.forEach((s, i) => {
    const b = f.sheds[i].batch;
    if (!b || b.ft === 'hatchery') return;
    for (let k = 0; k < 6; k++) props.push({ kind: 'feed_bag', x: s.x - s.w / 2 + 1.2 + (k % 3) * 0.55, z: 1.6, y: Math.floor(k / 3) * 0.18, rot: 0 });
    if (b.ft === 'broiler') for (let k = 0; k < 8; k++) props.push({ kind: 'crate', x: s.x + 2.6 + (k % 2) * 0.62, z: 1.7, y: Math.floor(k / 2) * 0.27, rot: 0 });
    if (b.day < 14) for (let k = 0; k < 3; k++) props.push({ kind: 'gas_cylinder', x: s.x - 1.6 - k * 0.45, z: 1, rot: 0 });
  });
  const pump = buildings.find((b) => b.kind === 'pump_house')!;
  props.push({ kind: 'barrel', x: pump.x + 2.2, z: pump.z, rot: 0 }, { kind: 'barrel', x: pump.x + 2.9, z: pump.z + 0.4, rot: 1 });
  for (let k = 0; k < 3; k++) props.push({ kind: 'chair', x: office.x - 2 + k * 0.9, z: office.z - FOOT.office[1] / 2 - 1.8, rot: Math.PI + (r() - 0.5) * 0.6 });
  props.push({ kind: 'panel_box', x: gen.x - FOOT.generator_room[0] / 2 - 0.4, z: gen.z, rot: Math.PI / 2 });
  props.push({ kind: 'wheelbarrow', x: (sheds[0]?.x ?? 0) + 4.5, z: 4, rot: 0.6 });
  // feed-bag stack left of the godown ramp, sized by feed in store (50 kg bags, capped)
  const bags = Math.min(48, Math.ceil((f.feedKg ?? 0) / 50));
  for (let k = 0; k < bags; k++)
    props.push({ kind: 'feed_bag', x: godown.x - 6.8 + (k % 6) * 0.55, z: godown.z - FOOT.godown[1] / 2 - 0.4 - Math.floor(k / 24) * 0.9, y: Math.floor((k % 24) / 6) * 0.18, rot: 0 });

  // vehicles parked side-on along the godown front (clear of the bag stack); a staff motorbike at the office
  const vehicles: Placed[] = vehicleKinds.map((k, i) => ({ kind: k, x: godown.x + 4.8 + i * 6.2, z: godown.z - FOOT.godown[1] / 2 - 0.8, rot: Math.PI / 2 }));
  if (!vehicleKinds.includes('motorbike')) vehicles.push({ kind: 'motorbike', x: office.x + FOOT.office[0] / 2 + 1.5, z: office.z - FOOT.office[1] / 2 - 1, rot: 0.4 });

  // people walk godown → a shed door → back along the road
  const walkways = sheds.map((s) => [{ x: godown.x, z: ROAD_Z + 1 }, { x: s.x, z: ROAD_Z }, { x: s.x, z: 1.5 }, { x: s.x + 1, z: ROAD_Z - 1 }]);

  // crop fields on each side of the compound
  const fields: Rect[] = [0, 1, 2, 3].map((side) => {
    const w = 60 + r() * 50, d = 50 + r() * 40, ring = 18;
    const x = side === 0 ? fence.x - fence.w / 2 - ring - w / 2 : side === 1 ? fence.x + fence.w / 2 + ring + w / 2 : fence.x + (r() - 0.5) * fence.w * 0.6;
    const z = side === 2 ? fence.z - fence.d / 2 - ring - d / 2 : side === 3 ? fence.z + fence.d / 2 + ring + d / 2 : fence.z + (r() - 0.5) * fence.d * 0.5;
    return { x, z, w, d };
  });

  return {
    sheds, roads, aprons, fence, gate, buildings, silos, trees, poles, wires, props, vehicles, walkways, fields,
    yard: { x: fence.x, z: fence.z, w: fence.w - 2, d: fence.d - 2 },
    extent: Math.max(fence.w, fence.d) / 2,
  };
}
