// Contract between the 3D scene (Scene.tsx + world/*) and the viewer UI (Farm3DView.tsx + ui/*).
import type { RefObject } from 'react';
import type { Farm3D } from '@/lib/farm3d';

export type ViewMode = 'overview' | 'inside' | 'top';
export type Quality = 'high' | 'low';

/**
 * DOM label elements keyed by anchor id; the scene positions them every frame by setting
 * `style.transform` (screen px, anchored bottom-centre) and `dataset.hidden` ('1' when off-screen / behind the camera).
 * Anchor ids: a shed id, `asset:<asset id>`, or `site:<office|godown|generator|tank|silo|gate>`.
 */
export type LabelMap = Map<string, HTMLElement>;

export type SceneProps = {
  farm: Farm3D;
  selected: string | null; // shed id
  onPick: (id: string | null) => void;
  hovered?: string | null;
  onHover?: (id: string | null) => void;
  view: ViewMode;
  quality: Quality;
  liveTime: boolean; // false = bright daytime; true = live IST time (sun position, shed lights at night)
  labels: RefObject<LabelMap>;
  onReady?: () => void; // first frame drawn with assets loaded
};
