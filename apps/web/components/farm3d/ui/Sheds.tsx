'use client';
// Shed list (left column on desktop, bottom scroller on phones) and floating 3D labels, both synced with the scene.
import type { CSSProperties, RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { fmtN } from '@/lib/format';
import { RAG_HEX, type Shed3D } from '@/lib/farm3d';
import type { Rag } from '@/lib/kpi';
import type { LabelMap } from '../types';
import { AlertIcon } from './Hud';
import s from './viewer.module.css';

/** Disease case, open equipment ticket or a mortality spike. */
export const alertOf = (x: Shed3D) => !!x.batch?.issue || x.tickets.length > 0 || x.batch?.rag === 'crit';
/** Birds alive; eggs set for a hatchery. */
export const countOf = (x: Shed3D) => (x.batch ? (x.batch.ft === 'hatchery' ? x.batch.placed : x.batch.alive) : 0);
const ragVar = (rag: Rag) => ({ '--rag': RAG_HEX[rag] }) as CSSProperties;

export function ShedList({ sheds, selected, hovered, onPick, onHover }: {
  sheds: Shed3D[]; selected: string | null; hovered: string | null; onPick: (id: string | null) => void; onHover: (id: string | null) => void;
}) {
  const t = useTranslations('farm3d');
  return (
    <div className={s.side}>
      <div className={s.list} role="group" aria-label={t('sheds')}>
        {sheds.map((x) => {
          const b = x.batch, n = countOf(x);
          return (
            <button key={x.id} type="button" className={`${s.glass} ${s.shed}`} style={ragVar(b?.rag ?? 'neutral')}
              aria-pressed={x.id === selected} data-hover={x.id === hovered || undefined}
              onClick={() => onPick(x.id === selected ? null : x.id)}
              onPointerEnter={() => onHover(x.id)} onPointerLeave={() => onHover(null)} onFocus={() => onHover(x.id)} onBlur={() => onHover(null)}>
              <span className={s.shedTop}>
                {x.name}
                {alertOf(x) && <><AlertIcon /><span className={s.sr}>{t('attention')}</span></>}
              </span>
              <span className={s.shedSub}>{b ? <><span>{b.code}</span><span>· {t('day', { day: b.day })}</span></> : t('empty')}</span>
              <span className={s.occ}>
                <span><i style={{ width: `${Math.min(100, (100 * n) / Math.max(1, x.capacity))}%` }} /></span>
                {fmtN(n)} / {fmtN(x.capacity)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Pill pinned to a 3D anchor (shed id, `asset:<id>` or `site:<kind>`): registers itself in the labels map and the
 * scene moves it every frame. Hidden from assistive tech — the shed list is the accessible control for the same thing.
 */
export function Label3D({ id, labels, rag, title, value, alert, selected, hovered, onClick, onHover }: {
  id: string; labels: RefObject<LabelMap>; rag: Rag; title: string; value?: string; alert?: boolean;
  selected?: boolean; hovered?: boolean; onClick?: () => void; onHover?: (on: boolean) => void;
}) {
  return (
    <button type="button" tabIndex={-1} aria-hidden className={s.label} style={ragVar(rag)} data-hidden="1"
      data-on={selected || undefined} data-hover={hovered || undefined}
      ref={(el) => { if (!el) return; labels.current.set(id, el); return () => { labels.current.delete(id); }; }}
      onClick={onClick} onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
      <span className={s.lblPill}>
        <i className={s.lblDot} />
        {title}
        {value && <span className={s.lblVal}>{value}</span>}
        {alert && <span className={s.lblAlert}>!</span>}
      </span>
    </button>
  );
}
