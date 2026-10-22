'use client';
// Terrain + compound: one big ground mesh whose shader blends real scans (grass, red laterite soil, packed yard,
// gravel roads, ploughed fields with crop rows) by a mask drawn from the layout, with low hills at the horizon;
// plus concrete pads, the wheel-dip at the gate and a chain-link fence on concrete posts.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Rect, SiteLayout } from '../layout';
import { useFarmTextures, type Mats } from '../materials';
import { at, box, merge, plane } from './geo';

const SIZE = 2600, SEG = 180;

/** Smooth value noise (deterministic) for the hills. */
function noise2(x: number, z: number) {
  const h = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

function terrainGeometry(flat: number) {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    const t = THREE.MathUtils.smoothstep(r, flat, flat + 420);
    const n = noise2(x / 260, z / 260) * 0.65 + noise2(x / 90, z / 90) * 0.35;
    p.setY(i, t * (25 + n * 95));
    uv.setXY(i, uv.getX(i) * SIZE, uv.getY(i) * SIZE); // metres, for the normal map
  }
  g.computeVertexNormals();
  return g;
}

/** Mask: R = packed yard, G = gravel road, B = crop field; covers `span` metres centred on the origin. */
function maskTexture(L: SiteLayout, span: number) {
  const px = 1024, c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'lighter';
  const k = px / span;
  const rect = (r: Rect, color: string, blur: number) => {
    g.filter = `blur(${blur}px)`;
    g.fillStyle = color;
    g.fillRect((r.x - r.w / 2 + span / 2) * k, (r.z - r.d / 2 + span / 2) * k, r.w * k, r.d * k);
  };
  // farmland everywhere outside the compound (B), cleared around the fence; then yard (R) and roads (G)
  g.fillStyle = '#0000ff';
  g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = 'destination-out';
  rect({ ...L.fence, w: L.fence.w + 36, d: L.fence.d + 36 }, '#000', 4);
  g.globalCompositeOperation = 'lighter';
  rect(L.yard, '#ff0000', 5);
  for (const r of L.roads) rect(r, '#00ff00', 1.2);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function useTerrainMaterial(L: SiteLayout, span: number) {
  const tex = useFarmTextures();
  return useMemo(() => {
    const mask = maskTexture(L, span);
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, normalMap: tex.yard.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) });
    mat.userData.mask = mask; // disposed with the material by <Ground>
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrass: { value: tex.grass.map }, tSoil: { value: tex.soil.map }, tYard: { value: tex.yard.map },
        tGravel: { value: tex.gravel.map }, tField: { value: tex.field.map }, tMask: { value: mask }, uSpan: { value: span },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vWXZ;
uniform sampler2D tGrass, tSoil, tYard, tGravel, tField, tMask; uniform float uSpan;`)
        .replace('#include <map_fragment>', `
vec2 w = vWXZ;
vec4 mk = texture2D(tMask, w / uSpan + 0.5);
float big = texture2D(tSoil, w / 211.0).g, mid = texture2D(tGrass, w / 47.0).g;
vec3 grass = texture2D(tGrass, w / 4.0).rgb, soil = texture2D(tSoil, w / 4.0).rgb, yard = texture2D(tYard, w / 4.0).rgb;
vec3 grav = texture2D(tGravel, w / 3.0).rgb, fld = texture2D(tField, w / 5.0).rgb;
// open land: dry grass with bare earth patches and the odd red-laterite scar
vec3 col = mix(yard * vec3(1.02, 0.98, 0.9), grass, smoothstep(0.3, 0.6, mid + (big - 0.5) * 0.5));
col = mix(col, soil, smoothstep(0.62, 0.75, big) * 0.6);
col = mix(col, yard, mk.r);
col = mix(col, grass * vec3(0.92, 1.0, 0.85), mk.r * smoothstep(0.52, 0.72, mid) * 0.55); // weedy patches in the yard
// patchwork plots (~70×60 m): fallow, young crop, lush crop, ripe paddy, scrub; rows 0.9 m apart run across or
// along each plot and fade to their average where a row is smaller than a pixel (no moiré); grassy bunds between
vec2 cell = floor((w + 4000.0) / vec2(73.0, 61.0));
float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453), h2 = fract(h * 13.7);
vec2 inCell = fract((w + 4000.0) / vec2(73.0, 61.0)) * vec2(73.0, 61.0);
float bund = 1.0 - smoothstep(0.6, 1.4, min(min(inCell.x, 73.0 - inCell.x), min(inCell.y, 61.0 - inCell.y)));
float fx = (h2 < 0.5 ? w.x : w.y) / 0.9, aa = clamp(fwidth(fx) * 1.5, 0.0, 1.0);
float row = smoothstep(0.45, 0.8, 1.0 - abs(fract(fx) - 0.5) * 2.0);
vec3 leaf = h < 0.45 ? vec3(0.12, 0.26, 0.05) : h < 0.7 ? vec3(0.2, 0.33, 0.07) : vec3(0.55, 0.47, 0.17);
leaf *= 0.8 + 0.5 * grass.g;
float cover = h < 0.18 ? 0.0 : h < 0.3 ? 0.25 : 0.55;           // fallow / sparse / full canopy
vec3 crop = mix(mix(fld, leaf, row * (cover + 0.35)), mix(fld, leaf, cover), aa);
crop = h > 0.93 ? grass * vec3(0.85, 0.95, 0.75) : crop;          // scrub plot
crop = mix(crop, grass * vec3(0.8, 0.95, 0.7), bund);
col = mix(col, crop, mk.b);
col = mix(col, grav, mk.g);
diffuseColor.rgb *= col;`);
    };
    return mat;
  }, [L, span, tex]);
}

/** Chain-link fence on concrete posts with three strands of barbed wire, open at the gate. */
function fenceGeometry(L: SiteLayout) {
  const f = L.fence, x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
  const gx0 = L.gate.x - L.gate.w / 2 - 0.4, gx1 = L.gate.x + L.gate.w / 2 + 0.4;
  const runs: [number, number, number, number][] = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x0, z0, x0, z1], [x0, z1, gx0, z1], [gx1, z1, x1, z1]];
  const posts: THREE.BufferGeometry[] = [], mesh: THREE.BufferGeometry[] = [], wire: THREE.BufferGeometry[] = [];
  for (const [ax, az, bx, bz] of runs) {
    const len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    mesh.push(at(plane(len, 1.7), mx, 0.95, mz, 0, rot));
    for (const y of [1.95, 2.1, 2.25]) wire.push(at(box(len, 0.012, 0.012), mx, y, mz, 0, rot));
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) posts.push(at(box(0.13, 2.3, 0.13), ax + ((bx - ax) * i) / n, 1.15, az + ((bz - az) * i) / n));
  }
  return { posts: merge(posts), mesh: merge(mesh), wire: merge(wire) };
}

export function Ground({ L, m }: { L: SiteLayout; m: Mats }) {
  const span = useMemo(() => Math.ceil((L.extent * 2 + 500) / 100) * 100, [L.extent]);
  const geo = useMemo(() => terrainGeometry(L.extent + 260), [L.extent]);
  const mat = useTerrainMaterial(L, span);
  const fence = useMemo(() => fenceGeometry(L), [L]);
  const pads = useMemo(() => merge(L.aprons.map((r) => at(box(r.w, 0.12, r.d), r.x, 0.06, r.z))), [L.aprons]);
  useEffect(() => () => { geo.dispose(); (mat.userData.mask as THREE.Texture).dispose(); mat.dispose(); pads.dispose(); for (const g of Object.values(fence)) g.dispose(); }, [geo, mat, pads, fence]);
  const dip = L.aprons[L.aprons.length - 1];
  return (
    <>
      <mesh geometry={geo} material={mat} receiveShadow />
      <mesh geometry={pads} material={m.concrete} receiveShadow />
      <mesh material={m.water} position={[dip.x, 0.125, dip.z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[dip.w - 0.5, dip.d - 0.5]} /></mesh>
      <mesh geometry={fence.posts} material={m.concrete} castShadow receiveShadow />
      <mesh geometry={fence.mesh} material={m.mesh} />
      <mesh geometry={fence.wire} material={m.steel} />
    </>
  );
}
