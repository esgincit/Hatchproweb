// Geometry helpers for procedural farm structures: primitives with UVs in metres (so tiled PBR textures land at
// true scale), beams between two points, and per-material merging (one draw call per material per structure).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const scaleUV = (g: THREE.BufferGeometry, faces: [number, number][], perFace: number) => {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < faces.length; f++)
    for (let i = 0; i < perFace; i++) {
      const k = f * perFace + i;
      uv.setXY(k, uv.getX(k) * faces[f][0], uv.getY(k) * faces[f][1]);
    }
  return g;
};

/** Box with metre UVs on every face (BoxGeometry face order: +x −x +y −y +z −z). */
export const box = (w: number, h: number, d: number) =>
  scaleUV(new THREE.BoxGeometry(w, h, d), [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]], 4);

export const plane = (w: number, h: number, sx = 1, sy = 1) => scaleUV(new THREE.PlaneGeometry(w, h, sx, sy), [[w, h]], (sx + 1) * (sy + 1));

export function cyl(rTop: number, rBot: number, h: number, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const c = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * c, uv.getY(i) * h);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Rectangular member from a to b (steel angles, rafters, purlins). */
export function beam(a: THREE.Vector3, b: THREE.Vector3, t: number, t2 = t) {
  const g = box(t, a.distanceTo(b), t2);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}
export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Move/rotate a geometry in place (Euler XYZ, radians). */
export function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  return g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z));
}

/** Merge into one geometry (normalises indexed / non-indexed and drops extra attributes). */
export function merge(list: THREE.BufferGeometry[]) {
  const flat = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  const out = mergeGeometries(flat, false)!;
  out.computeBoundingSphere();
  return out;
}

/** Collects geometries per material key, then merges each bucket. */
export class Parts<K extends string> {
  private b = new Map<K, THREE.BufferGeometry[]>();
  add(k: K, ...g: THREE.BufferGeometry[]) {
    const list = this.b.get(k) ?? [];
    list.push(...g);
    this.b.set(k, list);
    return this;
  }
  build() {
    return [...this.b].map(([k, list]) => ({ k, geo: merge(list) }));
  }
}

/** Flat sign texture (shed boards, gate arch): text on a coloured panel with a border. */
export function signTexture(text: string, bg: string, fg: string, w = 1024, h = 192) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = h * 0.05;
  g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = h * 0.52;
  const font = () => `800 ${size}px Manrope, "Noto Sans Telugu", system-ui, sans-serif`;
  g.font = font();
  while (g.measureText(text).width > w * 0.9 && size > 10) { size -= 2; g.font = font(); }
  g.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
