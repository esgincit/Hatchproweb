'use client';
// Farm workers on site today (attendance → Farm3D.staff), walking the layout's walkways between the godown and the
// shed doors, pausing at each end. Body = the Blender worker (public/3d/models/person.glb: skin / shirt / trousers,
// shirt tinted per worker) or a built-in capsule figure until that model exists. Legs and arms swing in the vertex
// shader from `_anim` = (legL, legR, armL, armR) about the hip / shoulder pivots — the same rig idea as the birds.
import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { SiteLayout } from '../layout';

const SPEED = 1.15;
const SHIRTS = ['#f2efe6', '#7aa3c9', '#b5443a', '#d9b54a', '#4f7a4f', '#9a6fb0'];
type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; tint: boolean };

function rig(base: THREE.Material, hip: number, shoulder: number) {
  const mat = base.clone();
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 _anim; attribute float aPhase;
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
float legA() { float s = sin(aPhase) * 0.5; return (_anim.x - _anim.y) * s; }
float armA() { float s = sin(aPhase) * 0.4; return (_anim.w - _anim.z) * s; }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = rotX(rotX(objectNormal, legA()), armA());`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = rotX(transformed - vec3(0.0, ${hip.toFixed(3)}, 0.0), legA()) + vec3(0.0, ${hip.toFixed(3)}, 0.0);
transformed = rotX(transformed - vec3(0.0, ${shoulder.toFixed(3)}, 0.0), armA()) + vec3(0.0, ${shoulder.toFixed(3)}, 0.0);`);
  };
  mat.customProgramCacheKey = () => `worker-${hip}-${shoulder}`;
  return mat;
}

/** Built-in stand-in: capsule limbs, trousers, white shirt, skin, hair (one vertex-coloured mesh). */
function builtIn(): Part[] {
  const parts: [THREE.BufferGeometry, string, [number, number, number, number]][] = [];
  const cap = (r: number, len: number, x: number, y: number) => new THREE.CapsuleGeometry(r, len, 4, 8).translate(x, y, 0);
  for (const sx of [-1, 1]) {
    const leg: [number, number, number, number] = sx < 0 ? [1, 0, 0, 0] : [0, 1, 0, 0], arm: [number, number, number, number] = sx < 0 ? [0, 0, 1, 0] : [0, 0, 0, 1];
    parts.push([cap(0.075, 0.68, sx * 0.1, 0.46), '#3b3f4a', leg], [new THREE.BoxGeometry(0.1, 0.06, 0.24).translate(sx * 0.1, 0.03, 0.04), '#2a2522', leg]);
    parts.push([cap(0.052, 0.5, sx * 0.25, 1.13), '#e9e4d8', arm], [new THREE.SphereGeometry(0.05, 8, 6).translate(sx * 0.25, 0.83, 0), '#8a5a3c', arm]);
  }
  parts.push([cap(0.17, 0.42, 0, 1.2), '#e9e4d8', [0, 0, 0, 0]], [new THREE.SphereGeometry(0.11, 12, 10).translate(0, 1.62, 0.01), '#8a5a3c', [0, 0, 0, 0]]);
  parts.push([new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.64, -0.005), '#1d1a18', [0, 0, 0, 0]]);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], an: number[] = [];
  for (const [g, hex, w] of parts) {
    const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex);
    pos.push(...(n.attributes.position.array as Float32Array));
    nor.push(...(n.attributes.normal.array as Float32Array));
    for (let i = 0; i < n.attributes.position.count; i++) { col.push(c.r, c.g, c.b); an.push(...w); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('_anim', new THREE.Float32BufferAttribute(an, 4));
  return [{ geo, mat: rig(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 0.86, 1.42), tint: false }];
}

function Walkers({ L, count, parts }: { L: SiteLayout; count: number; parts: Part[] }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const phase = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(THREE.DynamicDrawUsage), [count]);
  const geos = useMemo(() => parts.map((p) => p.geo.clone().setAttribute('aPhase', phase)), [parts, phase]);
  const st = useMemo(() => Array.from({ length: count }, (_, i) => ({ path: L.walkways[i % L.walkways.length], seg: 0, t: (i * 0.37) % 1, dir: 1, wait: i * 1.3, phase: i })), [L, count]);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05), ph = phase.array as Float32Array;
    st.forEach((w, i) => {
      const a = w.path[w.seg], b = w.path[w.seg + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      let moving = false;
      if (w.wait > 0) w.wait -= d;
      else {
        moving = true;
        w.t += (w.dir * SPEED * d) / len;
        if (w.t > 1 || w.t < 0) {
          w.t = THREE.MathUtils.clamp(w.t, 0, 1);
          const next = w.seg + w.dir;
          if (next < 0 || next >= w.path.length - 1) { w.dir *= -1; w.wait = 2 + (i % 3); } // turn round at either end
          else { w.seg = next; w.t = w.dir > 0 ? 0 : 1; }
        }
      }
      if (moving) w.phase += d * 7;
      o.position.set(a.x + (b.x - a.x) * w.t + (i % 2) * 0.6, 0, a.z + (b.z - a.z) * w.t);
      o.rotation.set(0, Math.atan2((b.x - a.x) * w.dir, (b.z - a.z) * w.dir), 0);
      o.updateMatrix();
      for (const m of meshes.current) m?.setMatrixAt(i, o.matrix);
      ph[i] = moving ? w.phase : 0;
    });
    for (const m of meshes.current) if (m) m.instanceMatrix.needsUpdate = true;
    phase.needsUpdate = true;
  });
  return (
    <>
      {parts.map((p, k) => (
        <instancedMesh key={k} args={[geos[k], p.mat, count]} castShadow receiveShadow frustumCulled={false}
          ref={(m) => {
            meshes.current[k] = m;
            if (!m || !p.tint) return;
            for (let i = 0; i < count; i++) m.setColorAt(i, new THREE.Color(SHIRTS[i % SHIRTS.length]));
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
          }} />
      ))}
    </>
  );
}

/** The Blender worker: one InstancedMesh per material (skin / shirt / trousers); the shirt takes a colour per worker. */
function ModelWalkers({ L, count, hip, shoulder }: { L: SiteLayout; count: number; hip: number; shoulder: number }) {
  const { scene } = useGLTF('/3d/models/person.glb');
  const parts = useMemo(() => {
    const out: Part[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = mesh.material as THREE.MeshStandardMaterial, tint = /shirt/i.test(own.name);
      const base = tint ? Object.assign(own.clone(), { color: new THREE.Color('#ffffff') }) : own;
      out.push({ geo: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mat: rig(base, hip, shoulder), tint });
    });
    return out;
  }, [scene, hip, shoulder]);
  return <Walkers L={L} count={count} parts={parts} />;
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function People({ L, count, model }: { L: SiteLayout; count: number; model?: { hip: number; shoulder: number } }) {
  const built = useMemo(builtIn, []);
  if (!count || !L.walkways.length) return null;
  const plain = <Walkers L={L} count={count} parts={built} />;
  return model ? (
    <Fallback fallback={plain}><Suspense fallback={null}><ModelWalkers L={L} count={count} {...model} /></Suspense></Fallback>
  ) : plain;
}
