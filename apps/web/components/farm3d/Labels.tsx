'use client';
// Moves DOM labels (owned by the viewer UI, see types.ts LabelMap) onto their 3D anchors every frame.
// Used instead of drei <Html>, whose per-label React roots get lost under React 19 strict mode.
import type { RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LabelMap } from './types';

const v = new THREE.Vector3();

export function LabelProjector({ anchors, labels }: { anchors: Map<string, THREE.Vector3>; labels: RefObject<LabelMap> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    const map = labels.current;
    if (!map) return;
    for (const [id, el] of map) {
      const a = anchors.get(id);
      if (a) v.copy(a).project(camera);
      const off = !a || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      el.dataset.hidden = off ? '1' : '0';
      if (!off) el.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0) translate(-50%, -100%)`;
    }
  });
  return null;
}
