'use client';
// Live 3D farm (roadmap Phase 9). Sheds sized from real rows; click a shed → camera flies in, roof lifts, birds animate.
// Birds: Blender-built glTF (feather textures baked) as instanced meshes; neck/legs bend in the vertex shader.
// ponytail: per-instance walk/peck state still ticks on the CPU (fine to ~5k on screen); move to a GPU sim if needed.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import { RAG_HEX, type Farm3D, type Shed3D } from '@/lib/farm3d';

const GAP = 10, EAVE = 2.6, RIDGE = 4.2, IDLE_BIRDS = 350;

/* ---------- Blender birds (scripts/blender/birds.py → public/models/*.glb) ---------- */

// Pivots in model space (metres, Y-up, facing +Z): [neck y, neck z], hip y. Must match birds.py.
const RIG = {
  hen: { url: '/models/hen.glb', neck: [0.28, 0.1], hip: 0.085 },
  chick: { url: '/models/chick.glb', neck: [0.085, 0.02], hip: 0.025 },
} as const;
type Kind = keyof typeof RIG;
useGLTF.preload(RIG.hen.url);
useGLTF.preload(RIG.chick.url);

/**
 * Model geometry + baked material, with a vertex-shader rig: `_anim` (head, left leg, right leg weights, painted in
 * Blender) × per-instance `aAct` (peck 0..1, step phase) bends the neck and swings the legs on the GPU.
 */
function useBird(kind: Kind, tint: string, count: number) {
  const { scene } = useGLTF(RIG[kind].url);
  return useMemo(() => {
    const src = scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    const geo = src.geometry.clone();
    geo.setAttribute('aAct', new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const mat = (src.material as THREE.MeshStandardMaterial).clone();
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
    return { geo, mat, act: geo.getAttribute('aAct') as THREE.InstancedBufferAttribute };
  }, [scene, kind, tint, count]);
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

/** Free-range birds on litter: wander (legs step), peck (neck bends), idle. */
function LitterBirds({ shed, count }: { shed: Shed3D; count: number }) {
  const look = birdLook(shed.batch!);
  const { geo, mat, act } = useBird(look.kind, look.tint, count);
  const ref = useRef<THREE.InstancedMesh>(null);
  const st = useMemo(() => {
    const r = rand(shed.id.charCodeAt(0) * 9973 + count);
    const s = { x: new Float32Array(count), z: new Float32Array(count), h: new Float32Array(count), mode: new Uint8Array(count), t: new Float32Array(count), sc: new Float32Array(count) };
    for (let i = 0; i < count; i++) {
      s.x[i] = (r() - 0.5) * (shed.w - 1.5); s.z[i] = (r() - 0.5) * (shed.l - 1.5);
      s.h[i] = r() * Math.PI * 2; s.mode[i] = Math.floor(r() * 3); s.t[i] = r() * 4; s.sc[i] = look.scale * (0.9 + r() * 0.2);
    }
    return s;
  }, [shed.id, shed.w, shed.l, count, look.scale]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const hx = (shed.w - 1.2) / 2, hz = (shed.l - 1.2) / 2;

  useFrame(({ clock }, dt) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime, d = Math.min(dt, 0.05), a = act.array as Float32Array;
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
      a[i * 2] = peck; a[i * 2 + 1] = step;
      o.position.set(st.x[i], bob, st.z[i]);
      o.rotation.set(peck * 0.15, st.h[i], 0);
      o.scale.setScalar(st.sc[i]);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    act.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} />;
}

/** Layer cages: A-frame rows, 3 tiers each side; hens fixed, necks dip to the feed trough. */
function CageBirds({ shed, count }: { shed: Shed3D; count: number }) {
  const rows = Math.max(1, Math.floor((shed.w - 2) / 3.2)), len = shed.l - 4;
  const slots = useMemo(() => {
    const out: [number, number, number, number][] = [];
    const perLine = Math.max(1, Math.ceil(count / (rows * 2 * 3)));
    for (let r = 0; r < rows && out.length < count; r++)
      for (const side of [-1, 1])
        for (let tier = 0; tier < 3; tier++)
          for (let k = 0; k < perLine && out.length < count; k++) {
            const x = (r - (rows - 1) / 2) * 3.2 + side * (0.45 + tier * 0.28);
            out.push([x, 0.35 + tier * 0.55, -len / 2 + ((k + 0.5) / perLine) * len, side > 0 ? Math.PI / 2 : -Math.PI / 2]);
          }
    return out;
  }, [count, rows, len]);
  const { geo, mat, act } = useBird('hen', '#ffffff', slots.length);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    slots.forEach(([x, y, z, h], i) => {
      o.position.set(x, y, z);
      o.rotation.set(0, h, 0);
      o.scale.setScalar(0.8);
      o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [slots]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime, a = act.array as Float32Array;
    for (let i = 0; i < slots.length; i++) a[i * 2] = Math.max(0, Math.sin(t * 5 + i * 2.1)) ** 2;
    act.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={ref} args={[geo, mat, slots.length]} frustumCulled={false} />
      {Array.from({ length: rows }, (_, r) => (
        <group key={r} position={[(r - (rows - 1) / 2) * 3.2, 0, 0]}>
          {[-1, 1].map((side) => [0, 1, 2].map((tier) => (
            <mesh key={`${side}${tier}`} position={[side * (0.45 + tier * 0.28), 0.6 + tier * 0.55, 0]}>
              <boxGeometry args={[0.5, 0.5, len, 1, 1, Math.ceil(len / 0.6)]} />
              <meshStandardMaterial color="#aeb3b8" metalness={0.6} roughness={0.4} wireframe />
            </mesh>
          )))}
          {[-1, 1].map((side) => [0, 1, 2].map((tier) => (
            <mesh key={`t${side}${tier}`} position={[side * (0.75 + tier * 0.28), 0.42 + tier * 0.55, 0]}>
              <boxGeometry args={[0.12, 0.06, len]} />
              <meshStandardMaterial color="#c9a227" roughness={0.6} />
            </mesh>
          )))}
        </group>
      ))}
    </>
  );
}

/** Feeder (pans) and drinker (nipple) lines along the shed, as in Indian deep-litter broiler houses. */
function Lines({ shed }: { shed: Shed3D }) {
  const n = Math.max(2, Math.floor(shed.w / 3)), len = shed.l - 3;
  const pans = Math.floor(len / 1.2);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    let i = 0;
    for (let line = 0; line < n; line++)
      for (let p = 0; p < pans; p++) {
        o.position.set(((line + 0.5) / n - 0.5) * shed.w, 0.06, -len / 2 + p * 1.2);
        o.updateMatrix();
        ref.current!.setMatrixAt(i++, o.matrix);
      }
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [n, pans, len, shed.w]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, n * pans]}>
        <cylinderGeometry args={[0.18, 0.12, 0.08, 12]} />
        <meshStandardMaterial color="#d84a2a" roughness={0.5} />
      </instancedMesh>
      {Array.from({ length: n }, (_, line) => {
        const x = ((line + 0.5) / n - 0.5) * shed.w;
        return (
          <group key={line}>
            <mesh position={[x, 0.45, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.025, 0.025, len, 6]} /><meshStandardMaterial color="#9aa0a6" metalness={0.5} /></mesh>
            <mesh position={[x + 1.4, 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.015, 0.015, len, 6]} /><meshStandardMaterial color="#2f6fb0" /></mesh>
          </group>
        );
      })}
    </>
  );
}

/** Hatchery: setter cabinets in two rows with a status lamp. */
function Setters({ shed }: { shed: Shed3D }) {
  const count = Math.min(24, Math.max(2, Math.ceil(shed.capacity / 10000)));
  const perRow = Math.ceil(count / 2);
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const row = i < perRow ? -1 : 1, k = i % perRow;
        const z = (k - (perRow - 1) / 2) * 3.6;
        return (
          <group key={i} position={[row * (shed.w / 4), 0, z]}>
            <mesh position={[0, 1.1, 0]} castShadow><boxGeometry args={[2.2, 2.2, 3]} /><meshStandardMaterial color="#d7dbdf" metalness={0.7} roughness={0.25} /></mesh>
            <mesh position={[-row * 1.11, 1.3, 0]}><boxGeometry args={[0.02, 1.2, 1.4]} /><meshStandardMaterial color="#1d2a33" metalness={0.3} roughness={0.2} /></mesh>
            <mesh position={[-row * 1.12, 2.0, 0.9]}><sphereGeometry args={[0.06, 8, 6]} /><meshStandardMaterial color="#39d353" emissive="#39d353" emissiveIntensity={2} /></mesh>
          </group>
        );
      })}
    </>
  );
}

/* ---------- shed building ---------- */

function Shed({ shed, x, selected, onPick }: { shed: Shed3D; x: number; selected: boolean; onPick: () => void }) {
  const { w, l } = shed;
  const ec = shed.type === 'environment_controlled', cage = shed.type === 'cage';
  const b = shed.batch;
  const hatchery = b?.ft === 'hatchery';
  const rag = RAG_HEX[b?.rag ?? 'neutral'];
  const half = w / 2 + 0.8, slope = Math.hypot(half, RIDGE - EAVE), tilt = Math.atan2(RIDGE - EAVE, half);
  const posts = Math.floor(l / 4) + 1, fans = Math.max(2, Math.floor(w / 3));
  const birds = b && !hatchery && b.drawn > 0 ? (selected ? b.drawn : Math.min(b.drawn, IDLE_BIRDS)) : 0;

  return (
    <group position={[x, 0, 0]} onClick={(e) => { e.stopPropagation(); onPick(); }}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[w, l]} />
        <meshStandardMaterial color={cage || ec ? '#a8a49c' : '#c9ad7f'} roughness={1} />
      </mesh>
      {/* brick plinth walls */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2), 0.3, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.23, 0.6, l]} />
          <meshStandardMaterial color="#b0563a" roughness={0.95} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={'e' + s} position={[0, ec ? EAVE / 2 : 0.3, s * (l / 2)]} castShadow>
          <boxGeometry args={[w, ec ? EAVE : 0.6, 0.23]} />
          <meshStandardMaterial color={ec ? '#e9e7e1' : '#b0563a'} roughness={0.9} />
        </mesh>
      ))}
      {/* posts + side curtains (open-sided) or insulated panels (EC; near wall hidden when opened) */}
      {Array.from({ length: posts }, (_, i) => [-1, 1].map((s) => (
        <mesh key={`${i}${s}`} position={[s * (w / 2), EAVE / 2, -l / 2 + (i * l) / (posts - 1)]} castShadow>
          <boxGeometry args={[0.15, EAVE, 0.15]} />
          <meshStandardMaterial color="#7d8288" metalness={0.4} />
        </mesh>
      )))}
      {[-1, 1].map((s) => (
        <mesh key={'c' + s} position={[s * (w / 2 + 0.05), ec ? EAVE / 2 : 0.95, 0]} visible={!(selected && ec && s === 1)}>
          <boxGeometry args={[0.04, ec ? EAVE : 0.7, l]} />
          <meshStandardMaterial color={ec ? '#e9e7e1' : '#e8b628'} roughness={0.8} transparent={!ec} opacity={ec ? 1 : 0.85} />
        </mesh>
      ))}
      {ec && Array.from({ length: fans }, (_, i) => (
        <mesh key={'f' + i} position={[((i + 0.5) / fans - 0.5) * w, 1.3, l / 2 + 0.13]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 0.1, 18]} />
          <meshStandardMaterial color="#2c3136" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      {ec && (
        <mesh position={[0, 1.2, -l / 2 - 0.13]}>
          <boxGeometry args={[w * 0.9, 1.6, 0.1]} />
          <meshStandardMaterial color="#9c7b4f" roughness={1} />
        </mesh>
      )}
      {/* gable roof (galvanised sheets) with a status-coloured ridge; lifted away when the shed is opened */}
      <group visible={!selected}>
        {[-1, 1].map((s) => (
          <mesh key={'r' + s} position={[(s * half) / 2, (EAVE + RIDGE) / 2, 0]} rotation={[0, 0, s * -tilt]} castShadow receiveShadow>
            <boxGeometry args={[slope, 0.05, l + 1.6]} />
            <meshStandardMaterial color="#c9ced3" metalness={0.25} roughness={0.45} />
          </mesh>
        ))}
        <mesh position={[0, RIDGE + 0.05, 0]}>
          <boxGeometry args={[0.6, 0.08, l + 1.6]} />
          <meshStandardMaterial color={rag} emissive={rag} emissiveIntensity={0.6} />
        </mesh>
      </group>
      {hatchery ? <Setters shed={shed} /> : null}
      {b && !hatchery && !cage ? <Lines shed={shed} /> : null}
      {birds > 0 ? <Suspense fallback={null}>{cage ? <CageBirds shed={shed} count={birds} /> : <LitterBirds shed={shed} count={birds} />}</Suspense> : null}
    </group>
  );
}

/* ---------- camera + world ---------- */

function CameraRig({ goal }: { goal: { pos: THREE.Vector3; target: THREE.Vector3; key: string } }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitImpl | null;
  const aspect = useThree((s) => s.size.width / s.size.height);
  // portrait phones: back the camera off so the same width still fits
  const pos = useMemo(() => goal.target.clone().add(goal.pos.clone().sub(goal.target).multiplyScalar(Math.max(1, 1.3 / aspect))), [goal, aspect]);
  const flying = useRef(true);
  useEffect(() => { flying.current = true; }, [goal.key]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { flying.current = false; }; // user grabbed the camera → stop the fly-in
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);
  useFrame((_, dt) => {
    if (!flying.current || !controls) return;
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(pos, k);
    controls.target.lerp(goal.target, k);
    controls.update();
    if (camera.position.distanceTo(pos) < 0.2) flying.current = false;
  });
  return null;
}

function Trees({ extentX, extentZ }: { extentX: number; extentZ: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  const n = 40;
  useEffect(() => {
    const r = rand(42), o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.1;
      const x = Math.cos(a) * (extentX / 2 + 18 + r() * 25), z = Math.sin(a) * (extentZ / 2 + 18 + r() * 25), s = 0.8 + r() * 0.7;
      o.position.set(x, 3.5 * s, z); o.scale.set(s, s, s); o.updateMatrix(); ref.current!.setMatrixAt(i, o.matrix);
      o.position.set(x, 1.2 * s, z); o.updateMatrix(); trunks.current!.setMatrixAt(i, o.matrix);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
    trunks.current!.instanceMatrix.needsUpdate = true;
  }, [extentX, extentZ]);
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, n]} castShadow>
        <icosahedronGeometry args={[2.6, 1]} />
        <meshStandardMaterial color="#4f7a3a" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.18, 0.25, 2.4, 6]} />
        <meshStandardMaterial color="#6b4a2f" />
      </instancedMesh>
    </>
  );
}

export default function Scene({ farm, selected, onPick }: { farm: Farm3D; selected: string | null; onPick: (id: string | null) => void }) {
  const xs = useMemo(() => {
    let acc = 0;
    const raw = farm.sheds.map((s) => { const x = acc + s.w / 2; acc += s.w + GAP; return x; });
    const mid = (acc - GAP) / 2;
    return raw.map((x) => x - mid);
  }, [farm.sheds]);
  const extentX = farm.sheds.reduce((a, s) => a + s.w + GAP, 0), extentZ = Math.max(30, ...farm.sheds.map((s) => s.l));
  const span = Math.max(extentX, extentZ);

  const goal = useMemo(() => {
    const i = farm.sheds.findIndex((s) => s.id === selected);
    if (i < 0) return { key: 'all' + farm.id, target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(span * 0.55, span * 0.45, span * 0.75) };
    const s = farm.sheds[i];
    return { key: s.id, target: new THREE.Vector3(xs[i], 0.3, s.l * 0.25), pos: new THREE.Vector3(xs[i] + s.w * 0.75, s.w * 0.75, s.l / 2 + s.w * 0.5) };
  }, [selected, farm, xs, span]);

  return (
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: [span, span, span], fov: 45, near: 0.1, far: 3000 }} onPointerMissed={() => onPick(null)}>
      <color attach="background" args={['#cfe3f2']} />
      <fog attach="fog" args={['#cfe3f2', span * 1.5, span * 4]} />
      <hemisphereLight args={['#eaf4ff', '#6b5a3c', 0.7]} />
      <directionalLight
        position={[span * 0.5, span * 0.6, span * 0.3]} intensity={2.2} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span}
        shadow-camera-far={span * 3} shadow-bias={-0.0005}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span * 8, span * 8]} />
        <meshStandardMaterial color="#8d9a5c" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[extentX + 8, extentZ + 12]} />
        <meshStandardMaterial color="#b9a88a" roughness={1} />
      </mesh>
      <Trees extentX={extentX} extentZ={extentZ} />
      {farm.sheds.map((s, i) => (
        <Shed key={s.id} shed={s} x={xs[i]} selected={s.id === selected} onPick={() => onPick(s.id)} />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.1} minDistance={2} maxDistance={span * 3} />
      <CameraRig goal={goal} />
    </Canvas>
  );
}
