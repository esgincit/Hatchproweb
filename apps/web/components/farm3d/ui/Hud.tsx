'use client';
// Viewer HUD: farm switcher, live badge + IST clock, day/night, view modes, quality, fullscreen; farm KPI strip; icons.
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { fmtN } from '@/lib/format';
import { TAB_ICONS } from '@/components/shell/icons';
import type { Farm3D } from '@/lib/farm3d';
import type { Quality, ViewMode } from '../types';
import s from './viewer.module.css';

const P = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const AlertIcon = () => <svg {...P}><path d="M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.5h.01" /></svg>;
export const XIcon = () => <svg {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>;
const Sun = () => <svg {...P}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></svg>;
const Moon = () => <svg {...P}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>;
const Expand = () => <svg {...P}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>;
const Shrink = () => <svg {...P}><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" /></svg>;
const Sliders = () => <svg {...P}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>;

const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const everyMin = (cb: () => void) => { const id = setInterval(cb, 15_000); return () => clearInterval(id); };
const onFsChange = (cb: () => void) => { document.addEventListener('fullscreenchange', cb); return () => document.removeEventListener('fullscreenchange', cb); };
const never = () => () => {};

export function Hud({ farms, farmIdx, onFarm, live, liveTime, onLiveTime, view, onView, quality, onQuality, target }: {
  farms: Farm3D[]; farmIdx: number; onFarm: (i: number) => void; live: boolean;
  liveTime: boolean; onLiveTime: (on: boolean) => void; view: ViewMode; onView: (v: ViewMode) => void;
  quality: Quality | 'auto'; onQuality: (q: Quality | 'auto') => void; target: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('farm3d');
  const now = useSyncExternalStore(everyMin, () => IST.format(new Date()), () => '');
  const fsOk = useSyncExternalStore(never, () => !!document.fullscreenEnabled, () => false);
  const fs = useSyncExternalStore(onFsChange, () => !!document.fullscreenElement, () => false);
  // form sheets open outside the viewer, so leave fullscreen when an action button fires
  useEffect(() => {
    const exit = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
    window.addEventListener('hp-act', exit);
    return () => window.removeEventListener('hp-act', exit);
  }, []);
  const h = +now.slice(0, 2);
  const night = liveTime && now !== '' && (h < 6 || h >= 18);

  return (
    <div className={s.hud}>
      {farms.length > 1 && (
        <label className={`${s.glass} ${s.sel} ${s.farm}`}>
          <span className={s.ico}>{TAB_ICONS.farm}</span>
          <select aria-label={t('farm')} value={farmIdx} onChange={(e) => onFarm(+e.target.value)}>
            {farms.map((f, i) => <option key={f.id} value={i}>{f.name}</option>)}
          </select>
        </label>
      )}
      <div className={`${s.glass} ${s.chip} ${s.live}`} data-off={live ? undefined : ''} title={t('clock')}>
        <i className={s.liveDot} /><span className={s.liveTxt}>{t('live')}</span>
        <span className={s.clock}>{now || '--:--'}</span><span className={s.ist}>IST</span>
      </div>
      <button type="button" className={`${s.glass} ${s.chip} ${s.day}`} aria-pressed={liveTime} aria-label={t('liveTime')} title={t('liveTimeTip')}
        onClick={() => onLiveTime(!liveTime)}>
        {night ? <Moon /> : <Sun />}<span className={s.dayTxt}>{t('liveTime')}</span>
      </button>
      <span className={s.grow} />
      <span className={s.br} />
      <div className={`${s.glass} ${s.seg}`} role="group" aria-label={t('view')}>
        {(['overview', 'inside', 'top'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => onView(v)}>{t(v)}</button>
        ))}
      </div>
      <label className={`${s.glass} ${s.sel} ${s.qual}`}>
        <Sliders />
        <select aria-label={t('quality')} value={quality} onChange={(e) => onQuality(e.target.value as Quality | 'auto')}>
          <option value="auto">{t('qAuto')}</option>
          <option value="high">{t('qHigh')}</option>
          <option value="low">{t('qLow')}</option>
        </select>
      </label>
      {fsOk && (
        <button type="button" className={`${s.glass} ${s.chip} ${s.fs}`} aria-pressed={fs} aria-label={t('fullscreen')} title={t('fullscreen')}
          onClick={() => (fs ? document.exitFullscreen() : target.current?.requestFullscreen())?.catch(() => {})}>
          {fs ? <Shrink /> : <Expand />}
        </button>
      )}
    </div>
  );
}

export function Kpis({ farm }: { farm: Farm3D }) {
  const t = useTranslations('farm3d');
  const { kpi, staff, ft } = farm, hatch = ft === 'hatchery';
  const stock = farm.feedKg != null && farm.feedPerDay > 0 ? Math.floor(farm.feedKg / farm.feedPerDay) : null;
  const items: [label: string, value: string, tone?: 'warn' | 'crit'][] = [[hatch ? t('eggsSet') : t('birdsAlive'), fmtN(kpi.birds)]];
  if (!hatch) items.push([t('mortalityToday'), fmtN(kpi.mortToday)], [t('feedToday'), t('kg', { n: fmtN(kpi.feedToday) })]);
  if (ft === 'layer') items.push([t('eggsToday'), fmtN(kpi.eggsToday)]);
  items.push([t('staff'), staff.total ? t('staffOf', { present: staff.present ?? '—', total: staff.total }) : '—']);
  if (!hatch) items.push([t('stock'), stock == null ? '—' : t('days', { n: stock }), stock == null || stock >= 7 ? undefined : stock < 3 ? 'crit' : 'warn']);
  return (
    <dl className={`${s.glass} ${s.kpis}`}>
      {items.map(([l, v, tone]) => <div key={l} className={s.kpi}><dt>{l}</dt><dd data-tone={tone}>{v}</dd></div>)}
    </dl>
  );
}
