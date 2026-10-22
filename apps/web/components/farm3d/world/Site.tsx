'use client';
// Everything on the compound that isn't a shed: buildings, silos, water tank, gate with the farm's name, poles +
// sagging power lines, trees, vehicles and props. Each kind loads its Blender model (public/3d/models/<kind>.glb,
// listed in manifest.json by scripts/blender/farm_assets.py) and is instanced per placement; kinds without a model
// yet fall back to a simple stand-in so the layout always reads.
import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { Placed, SiteLayout } from '../layout';
import { byName, type Mats } from '../materials';
import { at, box, cyl, merge, signTexture } from './geo';

type V3 = [number, number, number];
export type Manifest = Record<string, { attach?: Record<string, V3 | V3[]> }>;

/** Models present in public/3d/models + their attach points (manifest.json written by the Blender build). */
export function useManifest() {
  const [m, setM] = useState<{ have: Set<string>; data: Manifest } | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/3d/models/manifest.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((j: Manifest) => live && setM({ have: new Set(Object.keys(j)), data: j }))
      .catch(() => live && setM({ have: new Set(), data: {} }));
    return () => { live = false; };
  }, []);
  return m;
}

/** Leaf cards carry outward crown normals; three.js would flip them on back faces and darken half the canopy. */
function foliage(mat: THREE.Material) {
  const f = mat.clone();
  f.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  f.customProgramCacheKey = () => 'foliage';
  return f;
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const matrixOf = (p: Placed) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y ?? 0, p.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot),
    new THREE.Vector3().setScalar(p.scale ?? 1),
  );

/** One GLB, instanced at every placement (one InstancedMesh per sub-mesh). Shared M_* materials swapped in by name. */
function ModelInstances({ kind, at: list, m, sign }: { kind: string; at: Placed[]; m: Mats; sign?: THREE.Texture }) {
  const { scene } = useGLTF(`/3d/models/${kind}.glb`);
  const parts = useMemo(() => {
    scene.updateMatrixWorld(true);
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      let mat: THREE.Material = byName(m, own.name) ?? (own.side === THREE.DoubleSide && /leaves|atlas/i.test(own.name) ? foliage(own) : own);
      if (sign && /signboard/i.test(mesh.name)) mat = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.5 });
      out.push({ geo: mesh.geometry, mat, local: mesh.matrixWorld.clone() });
    });
    return out;
  }, [scene, m, sign]);
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={i}
          args={[p.geo, p.mat, list.length]}
          castShadow
          receiveShadow
          ref={(im) => {
            if (!im) return;
            list.forEach((pl, j) => im.setMatrixAt(j, matrixOf(pl).multiply(p.local)));
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
          }}
        />
      ))}
    </>
  );
}

/* ---------- stand-ins (until the Blender model exists) ---------- */

type MatRef = keyof Omit<Mats, 'paint'> | `paint.${keyof Mats['paint']}`;
type Stand = { geo: THREE.BufferGeometry; mat: MatRef }[];
const tree = (r: number): Stand => [
  { geo: at(cyl(0.18, 0.3, 4, 8), 0, 2, 0), mat: 'bark' },
  { geo: new THREE.IcosahedronGeometry(r, 1).scale(1, 0.7, 1).translate(0, 6, 0), mat: 'paint.green' },
];
const palm = (): Stand => [
  { geo: at(cyl(0.2, 0.28, 11, 8), 0, 5.5, 0), mat: 'bark' },
  { geo: new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.5, 1).translate(0, 11.3, 0), mat: 'paint.green' },
];
const STAND: Record<string, () => Stand> = {
  office: () => [{ geo: merge([at(box(8, 3.2, 6), 0, 1.6, 0), at(box(8.2, 0.9, 6.2), 0, 3.6, 0)]), mat: 'plaster' }],
  egg_room: () => [{ geo: at(box(8, 3.2, 6), 0, 1.6, 0), mat: 'plaster' }],
  godown: () => [{ geo: at(box(15, 4, 10), 0, 2, 0), mat: 'brick' }, { geo: at(box(15.8, 0.05, 10.8), 0, 4.6, 0), mat: 'roof' }, { geo: at(box(4, 3.2, 0.1), 0, 1.6, 5.02), mat: 'shutter' }],
  generator_room: () => [{ geo: at(box(4, 2.8, 3), -1.4, 1.4, 0), mat: 'brick' }, { geo: at(box(2.6, 1.5, 1.1), 2, 0.85, 0), mat: 'paint.yellow' }],
  pump_house: () => [{ geo: at(box(2.5, 2.4, 2.5), 0, 1.2, 0), mat: 'brick' }],
  water_tank: () => [
    { geo: merge([-1, 1].flatMap((sx) => [-1, 1].map((sz) => at(box(0.08, 4, 0.08), sx * 0.9, 2, sz * 0.9)))), mat: 'steel' },
    { geo: at(cyl(0.95, 0.95, 2.1, 24), 0, 5.05, 0), mat: 'plasticBlack' },
  ],
  security_cabin: () => [{ geo: at(box(2.4, 2.5, 2.4), 0, 1.25, 0), mat: 'plaster' }, { geo: at(box(3, 0.08, 3), 0, 2.6, 0), mat: 'roof' }],
  transformer: () => [{ geo: merge([at(box(0.25, 9, 0.25), -1.25, 4.5, 0), at(box(0.25, 9, 0.25), 1.25, 4.5, 0)]), mat: 'concrete' }, { geo: at(box(1.2, 1.4, 0.8), 0, 3.8, 0), mat: 'paint.green' }],
  feed_silo: () => [{ geo: merge([at(cyl(1.35, 1.35, 4.5, 28), 0, 4.6, 0), at(cyl(0.2, 1.35, 1.5, 28), 0, 1.6, 0), at(cyl(0.05, 1.35, 0.9, 28), 0, 7.3, 0)]), mat: 'galv' }],
  electric_pole: () => [{ geo: merge([at(cyl(0.09, 0.15, 9, 6), 0, 4.5, 0), at(box(0.08, 0.08, 1.6), 0, 8.6, 0)]), mat: 'concrete' }],
  tree_neem_1: () => tree(5), tree_neem_2: () => tree(4.2), palm_palmyra_1: palm, palm_palmyra_2: palm,
  shrub: () => [{ geo: new THREE.IcosahedronGeometry(0.8, 1).translate(0, 0.6, 0), mat: 'paint.green' }],
  feed_bag: () => [{ geo: at(box(0.5, 0.18, 0.8), 0, 0.09, 0), mat: 'pvc' }],
  crate: () => [{ geo: at(box(0.6, 0.27, 0.42), 0, 0.135, 0), mat: 'paint.blue' }],
  gas_cylinder: () => [{ geo: at(cyl(0.16, 0.16, 0.9, 14), 0, 0.45, 0), mat: 'paint.red' }],
  barrel: () => [{ geo: at(cyl(0.29, 0.29, 0.88, 16), 0, 0.44, 0), mat: 'paint.blue' }],
  chair: () => [{ geo: at(box(0.45, 0.8, 0.45), 0, 0.4, 0), mat: 'pvc' }],
  panel_box: () => [{ geo: at(box(0.6, 0.8, 0.25), 0, 1.2, 0), mat: 'galv' }],
  wheelbarrow: () => [{ geo: at(box(0.6, 0.3, 0.9), 0, 0.5, 0), mat: 'galv' }],
  truck_407: () => [{ geo: at(box(2, 2.4, 5.4), 0, 1.2, 0), mat: 'paint.blue' }],
  pickup_bolero: () => [{ geo: at(box(1.7, 1.9, 5.2), 0, 0.95, 0), mat: 'paint.white' }],
  motorbike: () => [{ geo: at(box(0.6, 1.1, 2), 0, 0.55, 0), mat: 'paint.red' }],
};
const resolve = (m: Mats, k: MatRef) => (k.startsWith('paint.') ? m.paint[k.slice(6) as keyof Mats['paint']] : m[k as keyof Omit<Mats, 'paint'>]) as THREE.Material;

function StandIns({ kind, at: list, m }: { kind: string; at: Placed[]; m: Mats }) {
  const parts = useMemo(() => (STAND[kind] ?? (() => [{ geo: box(1, 1, 1), mat: 'concrete' as MatRef }]))(), [kind]);
  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh key={i} args={[p.geo, resolve(m, p.mat), list.length]} castShadow receiveShadow
          ref={(im) => {
            if (!im) return;
            list.forEach((pl, j) => im.setMatrixAt(j, matrixOf(pl)));
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingSphere();
          }}
        />
      ))}
    </>
  );
}

const POLE_WIRES: V3[] = [[-0.65, 7.4, 0.08], [0.65, 7.4, 0.08], [0, 7.85, 0]];
const TRANSFORMER_WIRES: V3[] = [[-0.96, 7.38, 0.13], [0, 7.38, 0.13], [0.96, 7.38, 0.13]];

/** Sagging 3-phase lines between the poles' insulators, a feed from the transformer, a drop to each shed's gable. */
function Wires({ L, shedTop, data }: { L: SiteLayout; shedTop: (i: number) => THREE.Vector3; data: Manifest }) {
  const geo = useMemo(() => {
    const pole = (data.electric_pole?.attach?.wires as V3[] | undefined) ?? POLE_WIRES;
    const trans = (data.transformer?.attach?.wires as V3[] | undefined) ?? TRANSFORMER_WIRES;
    const world = (p: Placed, local: V3) => new THREE.Vector3(...local).applyMatrix4(matrixOf(p));
    const pts: number[] = [];
    const span = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      let prev = a;
      for (let k = 1; k <= 14; k++) {
        const t = k / 14, p = a.clone().lerp(b, t);
        p.y -= sag * 4 * t * (1 - t);
        pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    };
    for (const [ia, ib] of L.wires) {
      const a = L.poles[ia];
      if (ib >= 0) for (let k = 0; k < 3; k++) span(world(a, pole[k]), world(L.poles[ib], pole[k]), 0.9);
      else span(world(a, pole[2]), shedTop(-1 - ib), 0.5);
    }
    const tr = L.buildings.find((b) => b.kind === 'transformer');
    if (tr && L.poles.length) {
      const near = L.poles.reduce((b, p) => (Math.hypot(p.x - tr.x, p.z - tr.z) < Math.hypot(b.x - tr.x, b.z - tr.z) ? p : b));
      for (let k = 0; k < 3; k++) span(world(tr, trans[k]), world(near, pole[k]), 0.6);
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [L, shedTop, data]);
  return <lineSegments geometry={geo}><lineBasicMaterial color="#1c1c1c" /></lineSegments>;
}

export function Site({ L, m, farmName, shedTop }: { L: SiteLayout; m: Mats; farmName: string; shedTop: (i: number) => THREE.Vector3 }) {
  const man = useManifest();
  const have = man?.have;
  const sign = useMemo(() => signTexture(farmName, '#1f5b3a', '#ffffff', 1024, 190), [farmName]);
  const groups = useMemo(() => {
    const by = new Map<string, Placed[]>();
    for (const p of [...L.buildings, ...L.silos, ...L.trees, ...L.poles, ...L.props, ...L.vehicles]) by.set(p.kind, [...(by.get(p.kind) ?? []), p]);
    return [...by];
  }, [L]);
  if (!man || !have) return null;
  const gate: Placed = { kind: 'gate', x: L.gate.x, z: L.gate.z, rot: 0 };
  return (
    <>
      {groups.map(([kind, list]) => (
        have.has(kind) ? (
          <Fallback key={kind} fallback={<StandIns kind={kind} at={list} m={m} />}>
            <Suspense fallback={null}><ModelInstances kind={kind} at={list} m={m} /></Suspense>
          </Fallback>
        ) : <StandIns key={kind} kind={kind} at={list} m={m} />
      ))}
      {have.has('gate') ? (
        <Fallback fallback={null}><Suspense fallback={null}><ModelInstances kind="gate" at={[gate]} m={m} sign={sign} /></Suspense></Fallback>
      ) : (
        <group position={[L.gate.x, 0, L.gate.z]}>
          {[-1, 1].map((sx) => <mesh key={sx} material={m.plaster} position={[sx * 3.8, 2.3, 0]} castShadow><boxGeometry args={[0.6, 4.6, 0.6]} /></mesh>)}
          <mesh material={m.plaster} position={[0, 4.75, 0]} castShadow><boxGeometry args={[8.2, 0.5, 0.5]} /></mesh>
          <mesh position={[0, 5.55, 0.26]}><planeGeometry args={[6, 1.1]} /><meshStandardMaterial map={sign} roughness={0.5} /></mesh>
        </group>
      )}
      <Wires L={L} shedTop={shedTop} data={man.data} />
    </>
  );
}
