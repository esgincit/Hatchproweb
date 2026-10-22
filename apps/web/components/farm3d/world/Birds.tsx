'use client';
// Blender-built birds (scripts/blender/birds.py → public/models/*.glb) as instanced meshes; neck and legs bend in the
// vertex shader from per-instance peck/step values. Two LODs: birds within ~22 m of the camera use the full model,
// the rest a meshoptimizer-simplified copy (~28 % of the vertices) — 2,000 birds stay smooth on a laptop iGPU.
// ponytail: walk/peck state ticks on the CPU (fine to ~5k on screen); move to a GPU sim if needed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import type { Shed3D } from '@/lib/farm3d';

// Pivots in model space (metres, Y-up, facing +Z): [neck y, neck z], hip y. Must match birds.py.
const RIG = {
  hen: { url: '/models/hen.glb', neck: [0.28, 0.1], hip: 0.085 },
  chick: { url: '/models/chick.glb', neck: [0.085, 0.02], hip: 0.025 },
} as const;
type Kind = keyof typeof RIG;
useGLTF.preload(RIG.hen.url);
useGLTF.preload(RIG.chick.url);

const NEAR_R2 = 22 * 22, NEAR_MAX = 450;
const lowCache = new Map<Kind, Promise<THREE.BufferGeometry>>();

/** Baked bird material + vertex-shader rig: `_anim` (head, left leg, right leg weights) × per-instance `aAct`. */
function birdMaterial(src: THREE.Material, tint: string, kind: Kind) {
  const mat = (src as THREE.MeshStandardMaterial).clone();
  mat.color.set(tint);
  const { neck, hip } = RIG[kind];
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNeck = { value: new THREE.Vector2(neck[0], neck[1]) };
    sh.uniforms.uHip = { value: hip };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 _anim; attribute vec2 aAct; uniform vec2 uNeck; uniform float uHip;
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
float headA() { return _anim.x * aAct.x * 1.1; }
float legA() { float sw = sin(aAct.y) * 0.45; return (_anim.y - _anim.z) * sw; }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = rotX(rotX(objectNormal, headA()), legA());`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = rotX(transformed - vec3(0.0, uNeck), headA()) + vec3(0.0, uNeck);
transformed = rotX(transformed - vec3(0.0, uHip, 0.0), legA()) + vec3(0.0, uHip, 0.0);`);
  };
  return mat;
}

const withAct = (g: THREE.BufferGeometry, n: number) => {
  g.setAttribute('aAct', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
  return { geo: g, act: g.getAttribute('aAct') as THREE.InstancedBufferAttribute };
};

/** Near (full) + far (simplified, once ready) geometries sharing one material. */
function useFlock(kind: Kind, tint: string, count: number) {
  const { scene } = useGLTF(RIG[kind].url);
  const src = useMemo(() => scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh, [scene]);
  const mat = useMemo(() => birdMaterial(src.material as THREE.Material, tint, kind), [src, tint, kind]);
  const [low, setLow] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    let live = true;
    let p = lowCache.get(kind);
    if (!p) {
      const g = src.geometry;
      p = new SimplifyModifier().modify(g.clone(), Math.floor(g.attributes.position.count * 0.72));
      lowCache.set(kind, p);
    }
    p.then((g) => live && setLow(g)).catch(() => {});
    return () => { live = false; };
  }, [src, kind]);
  const near = useMemo(() => withAct(src.geometry.clone(), count), [src, count]);
  const far = useMemo(() => (low ? withAct(low.clone(), count) : null), [low, count]);
  return { mat, near, far };
}

/** Writes one bird into the near or far mesh by its distance to the camera (shed-local). */
function makeWriter() {
  const inv = new THREE.Matrix4(), cam = new THREE.Vector3();
  let ni = 0, fi = 0;
  return {
    begin(near: THREE.InstancedMesh, camera: THREE.Camera) {
      cam.copy(camera.position).applyMatrix4(inv.copy(near.parent!.matrixWorld).invert());
      ni = fi = 0;
    },
    put(near: THREE.InstancedMesh, far: THREE.InstancedMesh | null, na: Float32Array, fa: Float32Array | null, m: THREE.Matrix4, x: number, z: number, peck: number, step: number) {
      const dx = x - cam.x, dz = z - cam.z;
      if (!far || !fa || (dx * dx + dz * dz < NEAR_R2 && ni < NEAR_MAX)) {
        near.setMatrixAt(ni, m); na[ni * 2] = peck; na[ni * 2 + 1] = step; ni++;
      } else {
        far.setMatrixAt(fi, m); fa[fi * 2] = peck; fa[fi * 2 + 1] = step; fi++;
      }
    },
    end(near: THREE.InstancedMesh, far: THREE.InstancedMesh | null, nact: THREE.InstancedBufferAttribute, fact: THREE.InstancedBufferAttribute | null) {
      near.count = ni;
      near.instanceMatrix.needsUpdate = true;
      nact.needsUpdate = true;
      if (far && fact) { far.count = fi; far.instanceMatrix.needsUpdate = true; fact.needsUpdate = true; }
    },
  };
}

/** Model + tint + body scale from batch type and age (chicks yellow → broilers white by ~day 26; scale ∝ ∛weight). */
function birdLook(b: NonNullable<Shed3D['batch']>): { kind: Kind; tint: string; scale: number } {
  if (b.ft === 'layer' || b.ft === 'breeder') return { kind: 'hen', tint: '#ffffff', scale: 0.85 };
  if (b.day < 12) return { kind: 'chick', tint: '#ffdc6e', scale: 1 + b.day * 0.07 };
  const w = b.weight ?? b.weightStd ?? 56 * b.day;
  const mix = Math.min(1, (b.day - 12) / 14);
  const tint = '#' + new THREE.Color('#f7d97a').lerp(new THREE.Color('#ffffff'), mix).getHexString();
  return { kind: 'hen', tint, scale: Math.min(1.1, Math.max(0.45, Math.cbrt(w / 2500))) };
}

const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function FlockMeshes({ f, count, nearRef, farRef }: {
  f: ReturnType<typeof useFlock>; count: number;
  nearRef: React.RefObject<THREE.InstancedMesh | null>; farRef: React.RefObject<THREE.InstancedMesh | null>;
}) {
  return (
    <>
      <instancedMesh ref={nearRef} args={[f.near.geo, f.mat, count]} frustumCulled={false} receiveShadow />
      {f.far && <instancedMesh key="far" ref={farRef} args={[f.far.geo, f.mat, count]} frustumCulled={false} receiveShadow />}
    </>
  );
}

/** Free-range birds on litter: wander (legs step), peck (neck bends), idle. */
export function LitterBirds({ shed, count }: { shed: Shed3D; count: number }) {
  const look = birdLook(shed.batch!);
  const f = useFlock(look.kind, look.tint, count);
  const nearRef = useRef<THREE.InstancedMesh>(null), farRef = useRef<THREE.InstancedMesh>(null);
  const st = useMemo(() => {
    const r = rand(shed.id.charCodeAt(0) * 9973 + count);
    const s = { x: new Float32Array(count), z: new Float32Array(count), h: new Float32Array(count), mode: new Uint8Array(count), t: new Float32Array(count), sc: new Float32Array(count) };
    for (let i = 0; i < count; i++) {
      // drawn birds bunch toward the front door (where the camera looks in) so a capped flock still reads as stocked
      s.x[i] = (r() - 0.5) * (shed.w - 1.5); s.z[i] = (shed.l - 1.5) * (0.5 - r() ** 1.6);
      s.h[i] = r() * Math.PI * 2; s.mode[i] = Math.floor(r() * 3); s.t[i] = r() * 4; s.sc[i] = look.scale * (0.9 + r() * 0.2);
    }
    return s;
  }, [shed.id, shed.w, shed.l, count, look.scale]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const w = useMemo(makeWriter, []);
  const hx = (shed.w - 1.2) / 2, hz = (shed.l - 1.2) / 2;

  useFrame(({ clock, camera }, dt) => {
    const nm = nearRef.current, fm = f.far ? farRef.current : null;
    if (!nm) return;
    const t = clock.elapsedTime, d = Math.min(dt, 0.05);
    const na = f.near.act.array as Float32Array, fa = f.far ? (f.far.act.array as Float32Array) : null;
    w.begin(nm, camera);
    for (let i = 0; i < count; i++) {
      if ((st.t[i] -= d) < 0) { st.mode[i] = (st.mode[i] + 1 + (i % 2)) % 3; st.t[i] = 1.5 + ((i * 7919) % 40) / 10; }
      let peck = 0, step = 0, bob = 0;
      if (st.mode[i] === 0) { // walk
        st.h[i] += Math.sin(t * 0.7 + i) * d * 0.8;
        st.x[i] += Math.sin(st.h[i]) * d * 0.25 * st.sc[i];
        st.z[i] += Math.cos(st.h[i]) * d * 0.25 * st.sc[i];
        if (Math.abs(st.x[i]) > hx || Math.abs(st.z[i]) > hz) { st.h[i] += Math.PI; st.x[i] = Math.max(-hx, Math.min(hx, st.x[i])); st.z[i] = Math.max(-hz, Math.min(hz, st.z[i])); }
        step = t * 9 + i;
        bob = Math.abs(Math.sin(step)) * 0.008 * st.sc[i];
      } else if (st.mode[i] === 1) { // peck
        peck = Math.max(0, Math.sin(t * 7 + i * 1.3)) ** 2;
      }
      o.position.set(st.x[i], bob, st.z[i]);
      o.rotation.set(peck * 0.15, st.h[i], 0);
      o.scale.setScalar(st.sc[i]);
      o.updateMatrix();
      w.put(nm, fm, na, fa, o.matrix, st.x[i], st.z[i], peck, step);
    }
    w.end(nm, fm, f.near.act, f.far?.act ?? null);
  });
  return <FlockMeshes f={f} count={count} nearRef={nearRef} farRef={farRef} />;
}

/** Layer cages: A-frame rows, 3 tiers each side (cages drawn by Shed.tsx); hens fixed, necks dip to the trough. */
export function CageBirds({ shed, count }: { shed: Shed3D; count: number }) {
  const rows = Math.max(1, Math.floor((shed.w - 2) / 3.2)), len = shed.l - 4;
  const slots = useMemo(() => {
    const o = new THREE.Object3D();
    const out: { m: THREE.Matrix4; x: number; z: number }[] = [];
    const perLine = Math.max(1, Math.ceil(count / (rows * 2 * 3)));
    for (let r = 0; r < rows && out.length < count; r++)
      for (const side of [-1, 1])
        for (let tier = 0; tier < 3; tier++)
          for (let k = 0; k < perLine && out.length < count; k++) {
            // denser toward the front door (camera end): z = len/2 − len·u^1.8
            const x = (r - (rows - 1) / 2) * 3.2 + side * (0.45 + tier * 0.28), z = len / 2 - len * ((k + 0.5) / perLine) ** 1.8;
            o.position.set(x, 0.35 + tier * 0.55, z);
            o.rotation.set(0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
            o.scale.setScalar(0.8);
            o.updateMatrix();
            out.push({ m: o.matrix.clone(), x, z });
          }
    return out;
  }, [count, rows, len]);
  const f = useFlock('hen', '#ffffff', slots.length);
  const nearRef = useRef<THREE.InstancedMesh>(null), farRef = useRef<THREE.InstancedMesh>(null);
  const w = useMemo(makeWriter, []);
  useFrame(({ clock, camera }) => {
    const nm = nearRef.current, fm = f.far ? farRef.current : null;
    if (!nm) return;
    const t = clock.elapsedTime;
    const na = f.near.act.array as Float32Array, fa = f.far ? (f.far.act.array as Float32Array) : null;
    w.begin(nm, camera);
    slots.forEach((s, i) => w.put(nm, fm, na, fa, s.m, s.x, s.z, Math.max(0, Math.sin(t * 5 + i * 2.1)) ** 2, 0));
    w.end(nm, fm, f.near.act, f.far?.act ?? null);
  });
  return <FlockMeshes f={f} count={slots.length} nearRef={nearRef} farRef={farRef} />;
}
