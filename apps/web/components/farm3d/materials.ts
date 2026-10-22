'use client';
// Shared PBR materials for the 3D farm. Textures are CC0 Poly Haven scans (scripts/fetch_assets.py → public/3d/tex);
// geometry carries world-scale UVs (1 UV unit = 1 m), so each texture's repeat = 1 / metres-per-tile.
// Blender models (public/3d/models) name their surfaces M_*; byName() swaps those for these shared materials.
import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

const TILE = {
  roof_gi: 1.6, panel: 1.2, brick: 1.6, concrete: 2.5, plaster: 2.5, soil: 4, grass: 4, yard: 4, gravel: 3,
  field: 5, litter: 1.4, rust: 1.5, shutter: 1.8, planks: 2, bark: 1.2,
} as const;
export type TexName = keyof typeof TILE;
const NAMES = Object.keys(TILE) as TexName[];
const URLS = Object.fromEntries(NAMES.flatMap((n) => (['diff', 'nor', 'arm'] as const).map((m) => [`${n}_${m}`, `/3d/tex/${n}_${m}.webp`])));

export type TexSet = { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture };

/** All farm textures (suspends until loaded — wrap in <Suspense>; drei useProgress reports progress). */
export function useFarmTextures(): Record<TexName, TexSet> {
  const tex = useTexture(URLS) as Record<string, THREE.Texture>;
  return useMemo(() => {
    const out = {} as Record<TexName, TexSet>;
    for (const n of NAMES) {
      const set = { map: tex[`${n}_diff`], normalMap: tex[`${n}_nor`], arm: tex[`${n}_arm`] };
      for (const [k, t] of Object.entries(set)) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1 / TILE[n], 1 / TILE[n]);
        t.anisotropy = 8;
        t.colorSpace = k === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
      }
      out[n] = set;
    }
    return out;
  }, [tex]);
}

function pbr(t: TexSet, o: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, aoMap: t.arm, roughnessMap: t.arm, metalnessMap: t.arm, metalness: 0, ...o,
  });
}

/** Repeating alpha pattern (wire mesh, cage wire, cooling pad) drawn once on a canvas. */
function patternTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, metres: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 8;
  return t;
}
const grid = (cells: number, line: number) => (g: CanvasRenderingContext2D, s: number) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#fff';
  for (let i = 0; i < cells; i++) {
    const p = (i * s) / cells;
    g.fillRect(p, 0, line, s);
    g.fillRect(0, p, s, line);
  }
};

export type Mats = ReturnType<typeof makeMats>;

function makeMats(t: Record<TexName, TexSet>) {
  const paint = (color: string, physical = false) =>
    physical
      ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.25 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 });
  const mesh = patternTexture(256, grid(8, 3), 0.2); // 25 mm welded mesh; mip-maps fade it to a haze at distance, like the real thing
  const cage = patternTexture(256, grid(5, 4), 0.25);
  const pad = patternTexture(256, (g, s) => {
    g.fillStyle = '#9a6331';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#c98d4f';
    g.lineWidth = 3;
    for (let i = -s; i < s * 2; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke(); g.beginPath(); g.moveTo(i, s); g.lineTo(i + s, 0); g.stroke(); }
  }, 0.6);
  pad.colorSpace = THREE.SRGBColorSpace;
  // procedural sheds: box UV u runs down the slope, so turn the scan 90° (its ridges run along v); Blender models
  // already lay v up the slope, so they get an unturned copy. Both brightened from weathered to new GI.
  const flat = { map: t.roof_gi.map.clone(), normalMap: t.roof_gi.normalMap.clone(), arm: t.roof_gi.arm.clone() };
  for (const tx of Object.values(t.roof_gi)) { tx.rotation = Math.PI / 2; tx.needsUpdate = true; }
  const gi = { metalness: 0.6, color: new THREE.Color().setRGB(1.9, 1.95, 2.0, THREE.LinearSRGBColorSpace), envMapIntensity: 1.3 };
  return {
    roof: pbr(t.roof_gi, gi),
    roofModel: pbr(flat, gi),
    // the scan is red colour-coated sheet; EC sheds here are white, so keep only its ribs + roughness
    panel: new THREE.MeshStandardMaterial({ color: '#eceeed', normalMap: t.panel.normalMap, aoMap: t.panel.arm, roughnessMap: t.panel.arm, metalness: 0.25 }),
    brick: pbr(t.brick),
    concrete: pbr(t.concrete),
    plaster: pbr(t.plaster, { color: '#f4f0e6' }),
    soil: pbr(t.soil),
    litter: pbr(t.litter, { color: '#e3c38e' }),
    manure: pbr(t.soil, { color: '#5b4632' }),
    rust: pbr(t.rust, { metalness: 0.6 }),
    shutter: pbr(t.shutter, { metalness: 0.5 }),
    planks: pbr(t.planks),
    bark: pbr(t.bark),
    steel: new THREE.MeshStandardMaterial({ color: '#4e555c', metalness: 0.7, roughness: 0.45 }),
    galv: new THREE.MeshStandardMaterial({ color: '#c3c9ce', metalness: 0.9, roughness: 0.32 }),
    tarp: new THREE.MeshStandardMaterial({ color: '#2b62b0', roughness: 0.85, side: THREE.DoubleSide }),
    mesh: new THREE.MeshStandardMaterial({ color: '#9aa1a7', metalness: 0.6, roughness: 0.5, alphaMap: mesh, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    // cut-out + unlit: you look through dozens of overlapping cage faces, so each must be cheap (thin wire needs no PBR)
    cageWire: new THREE.MeshBasicMaterial({ color: '#8f969c', alphaMap: cage, alphaTest: 0.4, side: THREE.DoubleSide }),
    pad: new THREE.MeshStandardMaterial({ map: pad, roughness: 0.95 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1d2a33', roughness: 0.05, metalness: 0.1, reflectivity: 0.6, clearcoat: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e6e8ea', metalness: 1, roughness: 0.12 }),
    plasticBlack: new THREE.MeshStandardMaterial({ color: '#1a1c1e', roughness: 0.5 }),
    pvc: new THREE.MeshStandardMaterial({ color: '#e9e6dd', roughness: 0.4 }),
    feeder: new THREE.MeshStandardMaterial({ color: '#d6402a', roughness: 0.45 }),
    trough: new THREE.MeshStandardMaterial({ color: '#d9b329', roughness: 0.45 }),
    water: new THREE.MeshStandardMaterial({ color: '#3d6f73', roughness: 0.05, metalness: 0.2 }),
    bulb: new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#ffd890', emissiveIntensity: 0 }),
    egg: new THREE.MeshStandardMaterial({ color: '#f3ead9', roughness: 0.45 }),
    paint: {
      white: paint('#eeeeea', true), yellow: paint('#e2b312', true), blue: paint('#1f4f9c', true), red: paint('#b3261e', true),
      green: paint('#3e6b3a', true), orange: paint('#d9661f', true), grey: paint('#7c8288', true), doorBlue: paint('#2f5d8c'),
    },
  };
}

export function useMats(): Mats {
  const t = useFarmTextures();
  return useMemo(() => makeMats(t), [t]);
}

/** Material for a Blender model surface named M_* (see scripts/blender/farm_assets.py), or null to keep the model's own. */
export function byName(m: Mats, name: string): THREE.Material | null {
  const k = name.replace(/\.\d+$/, '');
  const direct: Record<string, THREE.Material> = {
    M_brick: m.brick, M_plaster: m.plaster, M_concrete: m.concrete, M_corrugated: m.roofModel, M_galv: m.galv, M_steel_dark: m.steel,
    M_rust: m.rust, M_wood: m.planks, M_bark: m.bark, M_rubber: m.rubber, M_glass: m.glass, M_chrome: m.chrome,
    M_plastic_black: m.plasticBlack, M_tarp_blue: m.tarp, M_emissive_light: m.bulb,
  };
  if (direct[k]) return direct[k];
  const p = /^M_paint_(\w+)$/.exec(k)?.[1] as keyof Mats['paint'] | undefined;
  return p && m.paint[p] ? m.paint[p] : null;
}
