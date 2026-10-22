'use client';
// Parametric poultry shed built the way Indian sheds are: concrete plinth, brick plinth wall, steel columns every
// 3 m carrying Fink trusses + purlins, corrugated GI roof with ridge ventilator and overhangs, whitewashed gables with
// doors + vents, wire mesh + roll-up curtains (open sheds); sandwich panels + tunnel fans + cooling pads (EC);
// A-frame layer cages with egg guards + feed trolley (cage); setter/hatcher cabinets (hatchery).
// Static parts are merged per material (a handful of draw calls per shed); fans, trolley, beacon animate.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shed3D } from '@/lib/farm3d';
import type { Mats } from '../materials';
import { Parts, at, beam, box, cyl, plane, signTexture, v3 } from './geo';
import { CageBirds, LitterBirds } from './Birds';

export const PLINTH = 0.35, WALL = 0.6, EAVE = 3, BAY = 3; // metres; EAVE is above the floor
export const roofRise = (w: number) => (w / 2) * Math.tan((18 * Math.PI) / 180);
export const ridgeY = (w: number) => PLINTH + EAVE + roofRise(w);

type Key = Exclude<keyof Mats, 'paint'> | 'door';
const matOf = (m: Mats, k: Key) => (k === 'door' ? m.paint.doorBlue : m[k]);

export const shedKind = (s: Shed3D) =>
  s.batch?.ft === 'hatchery' ? 'hatchery' : s.type === 'environment_controlled' ? 'ec' : s.type === 'cage' ? 'cage' : 'open';

/** Curtain closed fraction from the latest temperatures: hot days roll them right down, cool nights pull them up. */
export const curtainFraction = (s: Shed3D) => {
  const t = s.batch?.tmax;
  return t == null ? 0.35 : t >= 33 ? 0.1 : t >= 29 ? 0.3 : t >= 25 ? 0.55 : 0.85;
};

function buildShed(s: Shed3D) {
  const { w, l } = s;
  const kind = shedKind(s);
  const closed = kind === 'ec' || kind === 'hatchery';
  const F = PLINTH, E = F + EAVE, rise = roofRise(w), R = E + rise, half = w / 2, a = Math.atan2(rise, half);
  const body = new Parts<Key>(), roof = new Parts<Key>(), near = new Parts<Key>();

  // plinth, side aprons, floor
  body.add('concrete', at(box(w + 0.8, F, l + 0.8), 0, F / 2, 0));
  for (const sx of [-1, 1]) body.add('concrete', at(box(1.1, 0.08, l + 0.8), sx * (half + 0.95), 0.04, 0));
  body.add(kind === 'open' || kind === 'ec' ? 'litter' : 'concrete', at(plane(w - 0.3, l - 0.3), 0, F + 0.01, 0, -Math.PI / 2));

  // long walls
  for (const sx of [-1, 1]) {
    const p = closed && sx === 1 ? near : body;
    p.add('brick', at(box(0.23, WALL, l), sx * (half - 0.115), F + WALL / 2, 0));
    if (closed) p.add(kind === 'hatchery' ? 'plaster' : 'panel', at(box(0.12, EAVE - WALL, l), sx * (half - 0.115), F + WALL + (EAVE - WALL) / 2, 0));
    else body.add('mesh', at(plane(l, EAVE - WALL - 0.05), sx * (half - 0.04), F + WALL + (EAVE - WALL) / 2, 0, 0, Math.PI / 2));
  }

  // whitewashed gables: door notch at the front (and back for open sheds), vents in the triangle
  const gable = (door: boolean) => {
    const sh = new THREE.Shape();
    sh.moveTo(-half, 0);
    if (door) { sh.lineTo(-1.2, 0); sh.lineTo(-1.2, 2.5); sh.lineTo(1.2, 2.5); sh.lineTo(1.2, 0); }
    sh.lineTo(half, 0); sh.lineTo(half, EAVE); sh.lineTo(0, EAVE + rise); sh.lineTo(-half, EAVE); sh.closePath();
    for (const vx of [-half * 0.45, half * 0.45]) {
      const h = new THREE.Path();
      h.moveTo(vx - 0.5, EAVE + 0.15); h.lineTo(vx + 0.5, EAVE + 0.15); h.lineTo(vx + 0.5, EAVE + 0.7); h.lineTo(vx - 0.5, EAVE + 0.7); h.closePath();
      sh.holes.push(h);
    }
    return new THREE.ExtrudeGeometry(sh, { depth: 0.23, bevelEnabled: false });
  };
  const backDoor = kind === 'open' || kind === 'cage';
  body.add('plaster', at(gable(true), 0, F, l / 2 - 0.23), at(gable(backDoor), 0, F, -l / 2));
  for (const z of backDoor ? [l / 2 + 0.03, -l / 2 - 0.03] : [l / 2 + 0.03])
    for (const sx of [-1, 1]) body.add('door', at(box(1.17, 2.48, 0.05), sx * 0.6, F + 1.24, z));
  for (const z of [l / 2 - 0.1, -l / 2 + 0.1]) for (const vx of [-half * 0.45, half * 0.45]) body.add('mesh', at(plane(1, 0.55), vx, F + EAVE + 0.43, z));

  // biosecurity footbath (disinfectant tray) at the front door
  body.add('concrete', at(box(2.2, 0.1, 0.9), 0, 0.05, l / 2 + 0.9));
  body.add('water', at(plane(1.9, 0.6), 0, 0.105, l / 2 + 0.9, -Math.PI / 2));

  // columns + Fink trusses every bay
  const n = Math.max(2, Math.round(l / BAY) + 1);
  const zs = Array.from({ length: n }, (_, i) => -l / 2 + 0.3 + (i * (l - 0.6)) / (n - 1));
  for (const z of zs) {
    for (const sx of [-1, 1]) body.add('steel', at(box(0.12, EAVE - WALL, 0.12), sx * (half - 0.115), F + WALL + (EAVE - WALL) / 2, z));
    const eL = v3(-half, E, z), eR = v3(half, E, z), top = v3(0, R, z);
    body.add('steel', beam(eL, top, 0.08), beam(eR, top, 0.08), beam(eL, eR, 0.07), beam(v3(0, E, z), top, 0.05));
    for (const sx of [-1, 1]) {
      const q = (sx * half) / 2;
      body.add('steel', beam(v3(q, E, z), v3(q, E + rise / 2, z), 0.05),
        beam(v3(q, E, z), v3((sx * half) / 4, E + rise * 0.75, z), 0.045),
        beam(v3(q, E, z), v3(sx * half * 0.75, E + rise * 0.25, z), 0.045));
    }
  }

  // purlins + corrugated roof sheets (with a ridge ventilator over a gap on open sheds)
  for (const sx of [-1, 1]) for (const t of [0.04, 0.27, 0.5, 0.73, 0.96]) roof.add('steel', at(box(0.06, 0.1, l + 1), sx * half * (1 - t), E + rise * t + 0.09, 0));
  const OVER = 0.9, GAP = closed ? 0 : 0.35, slope = Math.hypot(half, rise);
  for (const sx of [-1, 1]) {
    const len = slope + OVER - GAP, dc = GAP + len / 2;
    roof.add('roof', at(box(len, 0.03, l + 1.6), sx * dc * Math.cos(a), R - dc * Math.sin(a) + 0.16, 0, 0, 0, -sx * a));
  }
  if (!closed) {
    for (const sx of [-1, 1]) roof.add('roof', at(box(1.1, 0.03, l + 1.6), sx * 0.45 * Math.cos(a), R + 0.62 - 0.45 * Math.sin(a), 0, 0, 0, -sx * a));
    for (const z of zs.filter((_, i) => i % 2 === 0)) for (const sx of [-1, 1]) roof.add('steel', at(box(0.04, 0.5, 0.04), sx * 0.28, R + 0.38, z));
  }

  // lights: two rows of bulbs on a cable under the tie beams
  const bulbs: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    body.add('steel', at(box(0.012, 0.012, l - 1), (sx * half) / 2, E - 0.05, 0));
    for (const z of zs) bulbs.push([(sx * half) / 2, E - 0.25, z]);
  }

  // equipment
  const pans: [number, number, number][] = [];
  const eggs: [number, number, number][] = [];
  if (kind === 'open' || kind === 'ec') {
    // feeder lines (pans on a galvanised tube) alternating with nipple drinker lines, hung from the trusses
    const lines = Math.max(2, Math.floor(w / 3)), len = l - 4, step = w / lines;
    for (let i = 0; i < lines; i++) {
      const x = ((i + 0.5) / lines - 0.5) * w;
      body.add('galv', at(cyl(0.025, 0.025, len, 8), x, F + 0.42, 0, Math.PI / 2));
      body.add('pvc', at(cyl(0.016, 0.016, len, 6), x + step / 2, F + 0.38, 0, Math.PI / 2));
      for (const z of zs) body.add('steel', at(box(0.008, E - F - 0.45, 0.008), x, (F + 0.45 + E) / 2, z), at(box(0.008, E - F - 0.4, 0.008), x + step / 2, (F + 0.4 + E) / 2, z));
      for (let z = -len / 2 + 0.6; z < len / 2; z += 0.9) pans.push([x, F, z]);
      body.add('galv', at(box(0.6, 0.6, 0.6), x, F + 0.95, len / 2 + 0.2)); // feed hopper at the line head
    }
  }
  if (kind === 'ec') {
    // cooling pads on both long walls at the front, water pipe on top, gutter below
    for (const sx of [-1, 1]) {
      const p = sx === 1 ? near : body, z0 = l / 2 - 7.5;
      p.add('pad', at(plane(12, 1.8), sx * (half + 0.02), F + WALL + 0.95, z0, 0, (sx * Math.PI) / 2));
      p.add('pvc', at(cyl(0.05, 0.05, 12, 8), sx * (half + 0.08), F + WALL + 1.9, z0, Math.PI / 2));
      p.add('galv', at(box(0.18, 0.12, 12), sx * (half + 0.1), F + WALL - 0.02, z0));
    }
    body.add('galv', at(box(0.6, 0.8, 0.25), 1.9, F + 1.3, l / 2 + 0.15)); // controller panel by the door
  }
  if (kind === 'cage') {
    // A-frame 3-tier stepped cages: wire boxes, feed troughs, egg guards, nipple lines, legs; manure strips below
    const rows = Math.max(1, Math.floor((w - 2) / 3.2)), len = l - 4;
    for (let r = 0; r < rows; r++) {
      const xr = (r - (rows - 1) / 2) * 3.2;
      body.add('manure', at(plane(2.6, len), xr, F + 0.015, 0, -Math.PI / 2));
      for (const sx of [-1, 1])
        for (let tier = 0; tier < 3; tier++) {
          const cx = xr + sx * (0.45 + tier * 0.28), cy = F + 0.6 + tier * 0.55;
          body.add('cageWire', at(box(0.5, 0.48, len), cx, cy, 0));
          body.add('galv', at(box(0.56, 0.015, len), cx + sx * 0.03, cy - 0.25, 0, 0, 0, sx * 0.12));
          body.add('trough', at(box(0.12, 0.08, len), cx + sx * 0.32, cy - 0.12, 0));
          body.add('galv', at(box(0.08, 0.02, len), cx + sx * 0.3, cy - 0.27, 0));
          body.add('pvc', at(cyl(0.012, 0.012, len, 6), cx, cy + 0.22, 0, Math.PI / 2));
          for (let z = -len / 2 + 0.2; z < len / 2; z += 0.2) eggs.push([cx + sx * 0.3, cy - 0.24, z]);
        }
      for (let z = -len / 2; z <= len / 2; z += 2)
        for (const sx of [-1, 1]) body.add('steel', beam(v3(xr + sx * 1.3, F, z), v3(xr + sx * 0.2, F + 1.95, z), 0.04));
    }
  }
  return { body: body.build(), roof: roof.build(), near: near.build(), bulbs, pans, eggs, F, R, half, kind };
}

function Instanced({ geo, mat, pts, castShadow }: { geo: THREE.BufferGeometry; mat: THREE.Material; pts: [number, number, number][]; castShadow?: boolean }) {
  const setRef = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    const o = new THREE.Object3D();
    pts.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  };
  return pts.length ? <instancedMesh key={pts.length} ref={setRef} args={[geo, mat, pts.length]} castShadow={castShadow} receiveShadow /> : null;
}

/** Tunnel fans on the back gable of EC sheds (housing + cone + spinning blades). */
function Fans({ s, m, F }: { s: Shed3D; m: Mats; F: number }) {
  const count = Math.min(8, Math.max(4, Math.round(s.w / 2)));
  const perRow = Math.ceil(count / 2);
  const blades = useRef<THREE.Group[]>([]);
  const bladeGeo = useMemo(() => merge5(), []);
  useFrame((_, dt) => blades.current.forEach((b, i) => b && (b.rotation.z += dt * (9 + (i % 3)))));
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const row = Math.floor(i / perRow), k = i % perRow;
        const x = ((k + 0.5) / perRow - 0.5) * (s.w - 1.5), y = F + 0.95 + row * 1.5;
        return (
          <group key={i} position={[x, y, -s.l / 2 - 0.3]}>
            <mesh material={m.galv} castShadow><boxGeometry args={[1.38, 1.38, 0.55]} /></mesh>
            <mesh material={m.galv} position={[0, 0, -0.5]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.78, 0.64, 0.5, 20, 1, true]} /></mesh>
            <mesh material={m.steel} position={[0, 0, -0.3]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.08, 0.08, 0.2, 10]} /></mesh>
            <group ref={(g) => { if (g) blades.current[i] = g; }} position={[0, 0, -0.32]}>
              <mesh geometry={bladeGeo} material={m.galv} />
            </group>
          </group>
        );
      })}
    </>
  );
}
const merge5 = () => {
  const parts = Array.from({ length: 5 }, (_, i) => at(box(0.16, 0.56, 0.02), 0, 0.3, 0, 0, 0.35, 0).rotateZ((i * Math.PI * 2) / 5));
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [];
  for (const p of parts) {
    const n = p.toNonIndexed();
    pos.push(...(n.attributes.position.array as Float32Array));
    nor.push(...(n.attributes.normal.array as Float32Array));
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
};

/** Feed trolley gantry running up and down the first cage row. */
function Trolley({ s, m, F }: { s: Shed3D; m: Mats; F: number }) {
  const ref = useRef<THREE.Group>(null);
  const rows = Math.max(1, Math.floor((s.w - 2) / 3.2)), len = s.l - 6;
  useFrame(({ clock }) => { if (ref.current) ref.current.position.z = Math.sin(clock.elapsedTime * 0.05) * (len / 2); });
  return (
    <group ref={ref} position={[(-(rows - 1) / 2) * 3.2, F, 0]}>
      {[-1, 1].map((sx) => <mesh key={sx} material={m.steel} position={[sx * 1.35, 1.05, 0]} castShadow><boxGeometry args={[0.06, 2.1, 0.06]} /></mesh>)}
      <mesh material={m.steel} position={[0, 2.12, 0]}><boxGeometry args={[2.8, 0.08, 0.08]} /></mesh>
      <mesh material={m.galv} position={[0, 1.85, 0]} castShadow><boxGeometry args={[1.1, 0.5, 0.7]} /></mesh>
      {[-1, 1].map((sx) => <mesh key={'w' + sx} material={m.rubber} position={[sx * 1.35, 0.06, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.06, 0.06, 0.05, 10]} /></mesh>)}
    </group>
  );
}

/** Hatchery: walk-in setters (left) and hatchers (right) from the farm's incubator assets, egg trolleys loaded with
 *  trays at the front, stacks of chick boxes by the hatchers. */
function Machines({ s, m, F, incubators }: { s: Shed3D; m: Mats; F: number; incubators: string[] }) {
  const named = (re: RegExp) => incubators.filter((n) => re.test(n)).length;
  const setters = Math.max(1, named(/setter/i) || Math.ceil(s.capacity / 57600));
  const hatchers = Math.max(1, named(/hatcher/i) || Math.ceil(setters / 3));
  const lamp = useMemo(() => new THREE.MeshStandardMaterial({ color: '#39d353', emissive: '#39d353', emissiveIntensity: 2 }), []);
  const screen = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0d2a1a', emissive: '#2bd46b', emissiveIntensity: 0.6 }), []);
  const kraft = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.9 }), []);
  const half = s.w / 2, front = s.l / 2;
  const machine = (key: string, side: number, z: number, w: number, h: number, d: number) => (
    <group key={key} position={[side * (half - 0.6 - w / 2), F, z]}>
      <mesh material={m.galv} position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[w, h, d]} /></mesh>
      {[-0.25, 0.25].map((f) => <mesh key={f} material={m.steel} position={[-side * (w / 2 + 0.01), h * 0.47, f * d]}><boxGeometry args={[0.03, h * 0.82, d * 0.46]} /></mesh>)}
      <mesh material={m.plasticBlack} position={[-side * (w / 2 + 0.03), h * 0.78, d * 0.52]}><boxGeometry args={[0.05, 0.5, 0.42]} /></mesh>
      <mesh material={screen} position={[-side * (w / 2 + 0.06), h * 0.8, d * 0.52]}><boxGeometry args={[0.01, 0.2, 0.3]} /></mesh>
      <mesh material={lamp} position={[-side * (w / 2 + 0.06), h * 0.95, d * 0.52]}><sphereGeometry args={[0.05, 8, 6]} /></mesh>
      <mesh material={m.galv} position={[0, h + 0.5, 0]}><cylinderGeometry args={[0.18, 0.18, 1, 12]} /></mesh>
    </group>
  );
  return (
    <>
      {Array.from({ length: setters }, (_, i) => machine('s' + i, -1, front - 5 - i * 5.2, 3, 2.6, 4.4))}
      {Array.from({ length: hatchers }, (_, i) => machine('h' + i, 1, front - 4.5 - i * 4, 2.6, 2.45, 3.2))}
      {[0, 1, 2].map((k) => (
        <group key={'t' + k} position={[-1 + k * 1.05, F, front - 2.6]}>
          {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => <mesh key={`${sx}${sz}`} material={m.galv} position={[sx * 0.42, 0.9, sz * 0.46]}><boxGeometry args={[0.03, 1.8, 0.03]} /></mesh>))}
          {Array.from({ length: 12 }, (_, j) => <mesh key={j} material={m.egg} position={[0, 0.2 + j * 0.13, 0]}><boxGeometry args={[0.8, 0.05, 0.9]} /></mesh>)}
        </group>
      ))}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={'c' + k} material={kraft} position={[half - 1.2 - (k % 2) * 0.7, F + 0.6, front - 10 - Math.floor(k / 2) * 0.55]} castShadow>
          <boxGeometry args={[0.6, 1.2, 0.45]} />
        </mesh>
      ))}
    </>
  );
}

/** Warning lamp on the front gable of a shed whose batch is below curve / spiking. */
function Beacon({ rag, y, z }: { rag: string; y: number; z: number }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: rag === 'crit' ? '#ff3b2f' : '#ffb020', emissive: rag === 'crit' ? '#ff2a1a' : '#ff9d00', emissiveIntensity: 2 }), [rag]);
  useFrame(({ clock }) => { mat.emissiveIntensity = 1 + 3 * Math.max(0, Math.sin(clock.elapsedTime * (rag === 'crit' ? 6 : 3))); });
  return <mesh material={mat} position={[0, y, z]}><sphereGeometry args={[0.16, 12, 8]} /></mesh>;
}

const PAN = new THREE.CylinderGeometry(0.19, 0.13, 0.07, 14).translate(0, 0.035, 0);
const GRILL = new THREE.ConeGeometry(0.12, 0.22, 10).translate(0, 0.17, 0);
const BULB = new THREE.SphereGeometry(0.06, 8, 6);
const EGG = new THREE.SphereGeometry(1, 6, 4).scale(0.022, 0.028, 0.022);

/** Glowing footprint outline (hovered / selected shed), in the batch's status colour. */
function Outline({ w, l, color }: { w: number; l: number; color: string }) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }), [color]);
  const W = w + 3, D = l + 3, t = 0.28;
  return (
    <group position={[0, 0.07, 0]}>
      {[[0, D / 2, W, t], [0, -D / 2, W, t], [W / 2, 0, t, D], [-W / 2, 0, t, D]].map(([px, pz, sx, sz], i) => (
        <mesh key={i} material={mat} position={[px, 0, pz]}><boxGeometry args={[sx, 0.04, sz]} /></mesh>
      ))}
    </group>
  );
}

export function Shed({ s, m, x, z, cutaway, quality, incubators = [], highlight = null, onPick, onHover }: {
  s: Shed3D; m: Mats; x: number; z: number; cutaway: boolean; quality: 'high' | 'low'; incubators?: string[]; highlight?: string | null;
  onPick: () => void; onHover: (on: boolean) => void;
}) {
  const g = useMemo(() => buildShed(s), [s]);
  const board = useMemo(() => signTexture(s.name.toUpperCase(), '#1f5b3a', '#ffffff', 768, 160), [s.name]);
  // merged geometries + the name board are this shed's own GPU memory (materials are shared — never disposed here)
  useEffect(() => () => { for (const p of [...g.body, ...g.roof, ...g.near]) p.geo.dispose(); }, [g]);
  useEffect(() => () => board.dispose(), [board]);
  const b = s.batch;
  const eggPts = useMemo(() => {
    if (!b || b.ft !== 'layer' || !cutaway) return []; // eggs only matter (and cost) once you look inside
    const keep = Math.min(1, (b.eggPct ?? 80) / 100) * (quality === 'high' ? 1 : 0.4);
    return g.eggs.filter((_, i) => ((i * 2654435761) % 1000) / 1000 < keep);
  }, [g.eggs, b, quality, cutaway]);
  // caged layers sit in tiers and read as full with fewer drawn; litter birds need more to look stocked
  const cap = g.kind === 'cage' ? [1400, 700, 400, 200] : [2000, 900, 600, 250];
  const birds = b && b.ft !== 'hatchery' ? Math.min(b.drawn, cap[(cutaway ? 0 : 2) + (quality === 'high' ? 0 : 1)]) : 0;
  const ch = (EAVE - WALL) * curtainFraction(s);

  return (
    <group
      position={[x, 0, z]}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
      onPointerOut={() => onHover(false)}
    >
      {g.body.map(({ k, geo }) => <mesh key={k} geometry={geo} material={matOf(m, k)} castShadow={k !== 'mesh' && k !== 'litter' && k !== 'cageWire'} receiveShadow />)}
      {!cutaway && g.roof.map(({ k, geo }) => <mesh key={'r' + k} geometry={geo} material={matOf(m, k)} castShadow receiveShadow />)}
      {!cutaway && g.near.map(({ k, geo }) => <mesh key={'n' + k} geometry={geo} material={matOf(m, k)} castShadow receiveShadow />)}
      {(g.kind === 'open' || g.kind === 'cage') && [-1, 1].map((sx) => (
        <group key={sx}>
          {ch > 0.05 && <mesh material={m.tarp} position={[sx * (g.half + 0.07), g.F + WALL + ch / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow><planeGeometry args={[s.l - 0.4, ch]} /></mesh>}
          <mesh material={m.tarp} position={[sx * (g.half + 0.1), g.F + WALL + ch, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.07, 0.07, s.l - 0.4, 10]} /></mesh>
        </group>
      ))}
      <mesh position={[0, g.F + 2.78, s.l / 2 + 0.012]}><planeGeometry args={[2.4, 0.5]} /><meshStandardMaterial map={board} roughness={0.6} /></mesh>
      <Instanced geo={BULB} mat={m.bulb} pts={g.bulbs} />
      <Instanced geo={PAN} mat={m.feeder} pts={g.pans} />
      <Instanced geo={GRILL} mat={m.galv} pts={g.pans} />
      <Instanced geo={EGG} mat={m.egg} pts={eggPts} />
      {g.kind === 'ec' && <Fans s={s} m={m} F={g.F} />}
      {g.kind === 'cage' && <Trolley s={s} m={m} F={g.F} />}
      {g.kind === 'hatchery' && <Machines s={s} m={m} F={g.F} incubators={incubators} />}
      {b && (b.rag === 'crit' || b.rag === 'warn') && <Beacon rag={b.rag} y={g.R + 0.35} z={s.l / 2 + 0.2} />}
      {highlight && <Outline w={s.w} l={s.l} color={highlight} />}
      {birds > 0 && (
        <group position={[0, g.F, 0]}>
          {g.kind === 'cage' ? <CageBirds shed={s} count={birds} /> : <LitterBirds shed={s} count={birds} />}
        </group>
      )}
    </group>
  );
}
