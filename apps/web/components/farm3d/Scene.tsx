'use client';
// Live 3D farm (roadmap Phase 2 + 9). Real rows → layout.ts → a lit, textured compound: Ground (terrain, roads,
// fields, fence), Shed × n (structure, equipment, birds), Site (buildings, silos, gate, poles, trees, vehicles, props).
// Lighting: CC0 HDRI sky + a sun matched to it (or to live IST time at the farm's GPS, with night lights), soft
// shadows fitted around the camera target, ACES filmic tone mapping; High quality adds SSAO (N8AO) + SMAA.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import type { OrbitControls as OrbitImpl } from 'three/examples/jsm/controls/OrbitControls.js';
import { RAG_HEX, type Farm3D } from '@/lib/farm3d';
import { LabelProjector } from './Labels';
import { sunAt } from './sun';
import { layoutFarm, FOOT, type SiteLayout } from './layout';
import { useMats } from './materials';
import type { Quality, SceneProps, ViewMode } from './types';
import { Ground } from './world/Ground';
import { People } from './world/People';
import { PLINTH, Shed, ridgeY } from './world/Shed';
import { Site, useManifest } from './world/Site';

/** Sun in the day HDRI (farm_field_puresky): brightest texel at u = 0.6033, 49.5° up → three.js direction. */
const HDRI_SUN = new THREE.Vector3(0.517, 0.76, 0.392).normalize();
const HDRI_AZ = Math.atan2(HDRI_SUN.z, HDRI_SUN.x);
const HORIZON = new THREE.Color().setRGB(0.83, 0.88, 0.93, THREE.LinearSRGBColorSpace);
const NIGHT_HORIZON = new THREE.Color().setRGB(0.02, 0.025, 0.04, THREE.LinearSRGBColorSpace);

function useSky(farm: Farm3D, liveTime: boolean) {
  return useMemo(() => {
    if (!liveTime) return { night: false, dir: HDRI_SUN, intensity: 3.2, color: new THREE.Color('#fff3e2'), rot: 0 };
    const { el, dir } = sunAt(farm.lat ?? 17.4, farm.lng ?? 78.5, new Date());
    const deg = (el * 180) / Math.PI, night = deg < -4;
    const up = THREE.MathUtils.smoothstep(deg, -2, 18);
    return {
      night, dir: night ? new THREE.Vector3(-0.4, 0.8, 0.3).normalize() : dir, intensity: night ? 0.25 : 3.2 * up,
      color: night ? new THREE.Color('#9db4ff') : new THREE.Color('#ffae6b').lerp(new THREE.Color('#fff3e2'), up),
      rot: night ? 0 : HDRI_AZ - Math.atan2(dir.z, dir.x), // turn the sky so its sun sits where the real sun is
    };
    // ponytail: evaluated when the farm or the toggle changes, not every minute
  }, [farm.lat, farm.lng, liveTime]);
}

/** Directional sun whose shadow box follows the orbit target and tightens as you zoom in (crisp shadows up close). */
function Sun({ dir, intensity, color, extent, quality }: { dir: THREE.Vector3; intensity: number; color: THREE.Color; extent: number; quality: Quality }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const controls = useThree((s) => s.controls) as OrbitImpl | null;
  const camera = useThree((s) => s.camera);
  const size = useRef(0);
  const gl = useThree((s) => s.gl);
  const last = useRef({ t: new THREE.Vector3(1e9, 0, 0), frame: 0 });
  // the compound is static: re-render the shadow map ~10×/s (moving workers/trolley) or at once when the view moves
  useEffect(() => { gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; return () => { gl.shadowMap.autoUpdate = true; }; }, [gl]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const t = controls?.target ?? new THREE.Vector3();
    const moved = last.current.t.distanceToSquared(t) > 0.01;
    if (moved || ++last.current.frame % 6 === 0) gl.shadowMap.needsUpdate = true;
    last.current.t.copy(t);
    l.position.copy(t).addScaledVector(dir, 400);
    l.target.position.copy(t);
    l.target.updateMatrixWorld();
    const r = THREE.MathUtils.clamp(camera.position.distanceTo(t) * 0.9, 16, extent + 80);
    if (Math.abs(r - size.current) > size.current * 0.12) {
      const c = l.shadow.camera;
      c.left = c.bottom = -r;
      c.right = c.top = r;
      c.near = 1;
      c.far = 900;
      c.updateProjectionMatrix();
      size.current = r;
      gl.shadowMap.needsUpdate = true;
    }
  });
  return (
    <directionalLight ref={light} intensity={intensity} color={color} castShadow={intensity > 0.3}
      shadow-mapSize={quality === 'high' ? [2048, 2048] : [1024, 1024]} shadow-bias={-0.0004} shadow-normalBias={0.04} />
  );
}

type Goal = { pos: THREE.Vector3; target: THREE.Vector3; key: string };

function CameraRig({ goal }: { goal: Goal }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitImpl | null;
  const aspect = useThree((s) => s.size.width / s.size.height);
  // portrait phones: back off so the same width still fits
  const pos = useMemo(() => goal.target.clone().add(goal.pos.clone().sub(goal.target).multiplyScalar(Math.max(1, 1.3 / aspect))), [goal, aspect]);
  const flying = useRef(true);
  useEffect(() => { flying.current = true; }, [goal.key]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { flying.current = false; }; // the user grabbed the camera → stop the fly-in
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);
  useFrame((_, dt) => {
    if (!flying.current || !controls) return;
    const k = 1 - Math.exp(-dt * 2.6);
    camera.position.lerp(pos, k);
    controls.target.lerp(goal.target, k);
    controls.update();
    if (camera.position.distanceTo(pos) < 0.05) flying.current = false;
  });
  return null;
}

function goalFor(L: SiteLayout, farm: Farm3D, selected: string | null, view: ViewMode): Goal {
  const i = farm.sheds.findIndex((s) => s.id === selected);
  const s = farm.sheds[i], p = L.sheds[i];
  const c = new THREE.Vector3(L.fence.x, 0, L.fence.z * 0.6);
  if (view === 'top') {
    const t = p ? new THREE.Vector3(p.x, 0, p.z) : c;
    return { key: `top${selected}`, target: t, pos: t.clone().add(new THREE.Vector3(0, p ? Math.max(p.w, p.d) * 1.15 : L.extent * 2.6, 0.01)) };
  }
  if (view === 'inside' && s) // eye height just inside the front door, looking down the aisle
    return { key: `in${s.id}`, target: new THREE.Vector3(p.x, PLINTH + 1.3, -9), pos: new THREE.Vector3(p.x + s.w * 0.12, PLINTH + 1.75, -1.5) };
  if (!s) return { key: 'all' + farm.id, target: c, pos: c.clone().add(new THREE.Vector3(-0.62, 0.5, 0.66).multiplyScalar(L.extent * 1.75)) };
  return { key: s.id, target: new THREE.Vector3(p.x, 0.5, -s.l * 0.3), pos: new THREE.Vector3(p.x + s.w * 0.85 + 3, s.w * 0.8 + 3, s.w * 0.6 + 2) };
}

const vehicleKind = (name: string) =>
  /407|tata|truck|lorry|eicher/i.test(name) ? 'truck_407' : /bike|splendor|scooter|motor/i.test(name) ? 'motorbike' : 'pickup_bolero';

function World({ farm, selected, onPick, hovered, onHover, view, quality, liveTime, labels, onReady, fx }: SceneProps & { fx: boolean }) {
  const m = useMats();
  const L = useMemo(() => layoutFarm(farm, farm.assets.filter((a) => a.category === 'vehicle').map((a) => vehicleKind(a.name))), [farm]);
  const sky = useSky(farm, liveTime);
  const incubators = useMemo(() => farm.assets.filter((a) => a.category === 'incubator').map((a) => a.name), [farm.assets]);
  const man = useManifest();
  const person = useMemo(() => {
    const at = man?.data.person?.attach as Record<string, [number, number, number]> | undefined;
    return at ? { hip: at.hip_L?.[1] ?? 0.88, shoulder: at.shoulder_L?.[1] ?? 1.4 } : undefined;
  }, [man]);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.fog = new THREE.Fog(sky.night ? NIGHT_HORIZON : HORIZON, L.extent * 3 + 150, L.extent * 3 + 2600);
    m.bulb.emissiveIntensity = sky.night ? 5 : 0;
    // ponytail: bulbs don't cast real light (one light per bulb is too costly) — a warm glow on the litter fakes it
    m.litter.emissive.set('#ffc98a');
    m.litter.emissiveIntensity = sky.night ? 0.22 : 0;
  }, [scene, sky.night, L.extent, m]);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
    return () => cancelAnimationFrame(id);
  }, [onReady]);

  const goal = useMemo(() => goalFor(L, farm, selected, view), [L, farm, selected, view]);
  const shedTop = useMemo(() => (i: number) => new THREE.Vector3(L.sheds[i].x, ridgeY(L.sheds[i].w) - 0.4, 0.1), [L]);
  const anchors = useMemo(() => {
    const a = new Map<string, THREE.Vector3>(L.sheds.map((p) => [p.id, new THREE.Vector3(p.x, ridgeY(p.w) + 1.4, p.z)]));
    for (const b of L.buildings) a.set(`site:${b.kind === 'generator_room' ? 'generator' : b.kind === 'water_tank' ? 'tank' : b.kind}`, new THREE.Vector3(b.x, b.kind === 'water_tank' ? 7 : 5, b.z));
    if (L.silos[0]) a.set('site:silo', new THREE.Vector3(L.silos[0].x, 9, L.silos[0].z));
    a.set('site:gate', new THREE.Vector3(L.gate.x, 6.6, L.gate.z));
    const gen = L.buildings.find((b) => b.kind === 'generator_room');
    for (const as of farm.assets) {
      const si = L.sheds.findIndex((p) => p.id === as.shedId);
      if (si >= 0) a.set(`asset:${as.id}`, new THREE.Vector3(L.sheds[si].x, 3.4, 0.5));
      else if (as.category === 'generator' && gen) a.set(`asset:${as.id}`, new THREE.Vector3(gen.x + FOOT.generator_room[0] / 4, 3, gen.z));
      else if (['fan', 'feeder', 'drinker', 'incubator'].includes(as.category) && L.sheds[0]) // in-shed kit without a shed link → first shed
        a.set(`asset:${as.id}`, new THREE.Vector3(L.sheds[0].x - 2.5, 3.6, 0.6));
      else if (as.category === 'vehicle') {
        const v = L.vehicles.find((x) => x.kind === vehicleKind(as.name));
        if (v) a.set(`asset:${as.id}`, new THREE.Vector3(v.x, 3, v.z));
      }
    }
    return a;
  }, [L, farm.assets]);

  return (
    <>
      <Environment files={sky.night ? '/3d/hdri/night.hdr' : '/3d/hdri/day.hdr'} background
        environmentIntensity={sky.night ? 0.25 : 0.85} backgroundIntensity={sky.night ? 0.7 : 1}
        environmentRotation={[0, sky.rot, 0]} backgroundRotation={[0, sky.rot, 0]} />
      <Sun dir={sky.dir} intensity={sky.intensity} color={sky.color} extent={L.extent} quality={quality} />
      <Ground L={L} m={m} />
      {farm.sheds.map((s, i) => (
        <Shed key={s.id} s={s} m={m} x={L.sheds[i].x} z={L.sheds[i].z} quality={quality} incubators={incubators}
          cutaway={s.id === selected && view === 'overview'}
          highlight={(s.id === hovered || s.id === selected) && view !== 'inside' ? RAG_HEX[s.batch?.rag ?? 'neutral'] : null}
          onPick={() => onPick(s.id)} onHover={(on) => onHover?.(on ? s.id : null)} />
      ))}
      <Site L={L} m={m} farmName={farm.name} shedTop={shedTop} />
      <People L={L} count={Math.min(8, farm.staff.present ?? farm.staff.total)} model={person} />
      <CameraRig goal={goal} />
      <LabelProjector anchors={anchors} labels={labels} />
      {quality === 'high' && fx && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={1.4} intensity={2.4} distanceFalloff={0.6} quality="performance" halfRes />
          <Bloom intensity={sky.night ? 1.1 : 0} luminanceThreshold={0.9} mipmapBlur />
          <SMAA />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}

/** true while the element is on screen and no form sheet (Radix dialog) covers the page. */
function useWorthDrawing(el: React.RefObject<HTMLDivElement | null>) {
  const [onScreen, setOnScreen] = useState(true);
  const [dialog, setDialog] = useState(false);
  useEffect(() => {
    if (!el.current) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el.current);
    const mo = new MutationObserver(() => setDialog(!!document.querySelector('[role="dialog"]')));
    mo.observe(document.body, { childList: true, subtree: false });
    return () => { io.disconnect(); mo.disconnect(); };
  }, [el]);
  return onScreen && !dialog;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|software|basic render/i;

/** No WebGL, or a CPU rasteriser (no GPU / blocklisted driver): the realistic scene would freeze the whole page. */
function softwareGL() {
  try {
    const c = document.createElement('canvas');
    const g = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!g) return true;
    const info = g.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(g.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    g.getExtension('WEBGL_lose_context')?.loseContext();
    return SOFTWARE_GL.test(renderer);
  } catch {
    return true;
  }
}

export default function Scene(props: SceneProps) {
  const [soft] = useState(softwareGL);
  if (soft) throw new Error('3D needs hardware graphics'); // Farm3DView's boundary shows "not available on this device"
  return <Viewer {...props} />;
}

function Viewer(props: SceneProps) {
  const { onPick, view, quality } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const draw = useWorthDrawing(wrap);
  const top = quality === 'high' ? Math.min(1.5, window.devicePixelRatio) : 1;
  const [dpr, setDpr] = useState(top);
  const [fx, setFx] = useState(true); // SSAO + SMAA (+ night bloom); the first thing dropped after resolution
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        key={quality}
        frameloop={draw ? 'always' : 'never'}
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={dpr}
        gl={{ antialias: quality === 'low', powerPreference: 'high-performance' }}
        camera={{ fov: 42, near: 0.3, far: 6000, position: [-300, 260, 320] }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 0.95; }}
        onPointerMissed={() => onPick(null)}
      >
        {/* frame rate sagging: first 1× pixels, then no post effects; restored in reverse when there's headroom */}
        <PerformanceMonitor flipflops={4}
          onDecline={() => (dpr > 1 ? setDpr(1) : setFx(false))}
          onIncline={() => (!fx ? setFx(true) : setDpr(top))} />
        <Suspense fallback={null}>
          <World {...props} fx={fx} />
        </Suspense>
        {/* inside a shed you may look up at the trusses; outside the camera stays above the ground */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={view === 'inside' ? Math.PI * 0.62 : Math.PI / 2.06} minDistance={1.2} maxDistance={1400} />
      </Canvas>
    </div>
  );
}
