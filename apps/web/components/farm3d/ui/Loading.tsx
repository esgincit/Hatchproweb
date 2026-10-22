'use client';
// Asset-loading progress for the viewer's loading card. Loaded with next/dynamic so drei/three stay out of the page bundle.
import { useEffect } from 'react';
import { useProgress } from '@react-three/drei';
import s from './viewer.module.css';

export default function Progress({ onDone }: { onDone: () => void }) {
  const { active, progress } = useProgress();
  // ponytail: backstop for a scene that never calls onReady — loaders idle at 100% for 1.5 s counts as ready
  useEffect(() => {
    if (active || progress < 100) return;
    const id = setTimeout(onDone, 1500);
    return () => clearTimeout(id);
  }, [active, progress, onDone]);
  return (
    <>
      <span className={s.bar} data-busy={progress ? undefined : ''}><i style={progress ? { width: `${progress}%` } : undefined} /></span>
      {progress > 0 && <span className={s.pct}>{Math.round(progress)}%</span>}
    </>
  );
}
