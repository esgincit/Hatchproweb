'use client';
// Selected shed: issues, expected vs actual, today's numbers, 14-day trend, last log, actions.
// Right-side panel over the stage on desktop; a sheet under the stage on phones (CSS only).
import { useId, type CSSProperties } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { dateFmt, fmtN } from '@/lib/format';
import { RagPill } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import type { Batch3D, Shed3D } from '@/lib/farm3d';
import { AlertIcon, XIcon } from './Hud';
import s from './viewer.module.css';

type Tone = 'good' | 'warn' | 'crit' | 'info';
const clamp = (v: number) => `${Math.max(0, Math.min(100, v * 100))}%`;
// ponytail: bar colours are display heuristics; the shed's status pill (kpi.ts rag) stays the source of truth
const ratioTone = (r: number): Tone => (r >= 0.97 ? 'good' : r >= 0.9 ? 'warn' : 'crit');
const mortTone = (today: number, avg: number): Tone => (today > Math.max(5, 2 * avg) ? 'crit' : today > Math.max(3, 1.3 * avg) ? 'warn' : 'good');

function Meter({ label, value, expected, fill, mark, tone }: { label: string; value: string; expected?: string; fill: number; mark?: number; tone: Tone }) {
  return (
    <div className={s.meter}>
      <div className={s.mHead}><span>{label}</span><b>{value}</b>{expected && <em>{expected}</em>}</div>
      <div className={s.track} style={{ '--tone': `var(--${tone})` } as CSSProperties}>
        <i style={{ width: clamp(fill) }} />
        {mark != null && <i className={s.mark} style={{ left: clamp(mark) }} />}
      </div>
    </div>
  );
}

/** Mortality bars + egg count (layers) or weight (broilers) line over the last logs. */
function Trend({ b }: { b: Batch3D }) {
  const t = useTranslations('farm3d');
  const dt = dateFmt(useLocale());
  const d = b.days, W = 140, H = 44, slot = W / d.length;
  const mMax = Math.max(1, ...d.map((x) => x.mort)), spike = Math.max(5, (2 * d.reduce((a, x) => a + x.mort, 0)) / d.length);
  const line = d.map((x) => (b.ft === 'broiler' ? x.w : x.eggs || null));
  const vals = line.filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pts = line.flatMap((v, i) => (v == null ? [] : [`${((i + 0.5) * slot).toFixed(1)},${(H - 5 - ((v - lo) / (hi - lo || 1)) * (H - 12)).toFixed(1)}`]));
  return (
    <section>
      <h4 className={s.h}>{t('trend', { n: d.length })}</h4>
      <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('trend', { n: d.length })}>
        {d.map((x, i) => {
          const h = Math.max(x.mort ? 1.5 : 0, (x.mort / mMax) * H * 0.6);
          return (
            <rect key={x.date} x={i * slot + slot * 0.18} y={H - h} width={slot * 0.64} height={h} data-hi={x.mort > spike || undefined}>
              <title>{`${dt(x.date)}: ${x.mort}`}</title>
            </rect>
          );
        })}
        {pts.length > 1 && <polyline points={pts.join(' ')} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className={s.dates}><span>{dt(d[0].date)}</span><span>{dt(d[d.length - 1].date)}</span></div>
      <div className={s.legend}>
        <span><i />{t('mortality')}</span>
        {pts.length > 1 && <span><i className={s.ln} />{b.ft === 'broiler' ? t('weightG') : t('eggs')}</span>}
      </div>
    </section>
  );
}

export function ShedPanel({ shed, onClose }: { shed: Shed3D; onClose: () => void }) {
  const t = useTranslations('farm3d');
  const tf = useTranslations('farm');
  const dt = dateFmt(useLocale());
  const id = useId();
  const b = shed.batch, hatch = b?.ft === 'hatchery';
  const issues = [
    ...(b?.issue ? [t('issueDisease', { name: b.issue })] : []),
    ...shed.tickets.map((x) => t('issueTicket', { name: x })),
    ...(b?.rag === 'crit' ? [t('ragCrit')] : b?.rag === 'warn' ? [t('ragWarn')] : []),
  ];
  const stats: [label: string, value: string, wide?: boolean][] = [];
  if (b) {
    if (b.ft === 'broiler') stats.push([t('fcr'), b.fcr?.toFixed(2) ?? '—']);
    if (b.eggsToday != null) stats.push([t('eggsToday'), fmtN(b.eggsToday)]);
    if (!hatch) stats.push([t('feedToday'), b.feedToday == null ? '—' : t('kg', { n: fmtN(b.feedToday) })], [t('water'), b.waterToday == null ? '—' : t('litres', { n: fmtN(b.waterToday) })]);
    stats.push([t('temp'), b.tmin == null && b.tmax == null ? '—' : `${b.tmin ?? '—'}–${b.tmax ?? '—'} °C`, true], [t('rh'), b.rh == null ? '—' : `${b.rh}%`]);
  }
  const wMax = b ? Math.max(b.weight ?? 0, b.weightStd ?? 0) * 1.15 || 1 : 1;
  const mMax = b ? Math.max(b.mortToday, b.mort7 * 2, 1) : 1;

  return (
    <section className={s.panel} data-testid="farm3d-panel" aria-labelledby={id}>
      <header className={s.pHead}>
        <div style={{ minWidth: 0 }}>
          <h3 id={id} className={s.pTitle}>{shed.name}</h3>
          <div className={s.pSub}>{b ? [b.code, b.breed, t('day', { day: b.day })].filter(Boolean).join(' · ') : t('empty')}</div>
        </div>
        {b && <RagPill rag={b.rag} />}
        <button type="button" className={s.x} aria-label={t('close')} onClick={onClose}><XIcon /></button>
      </header>
      <div className={s.pBody}>
        {issues.length > 0 && (
          <div className={s.banner} data-tone={b?.issue || b?.rag === 'crit' ? 'crit' : 'warn'}>
            <AlertIcon />
            <ul>{issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {b ? (
          <>
            <section>
              <h4 className={s.h}>{t('expectedVsActual')}</h4>
              {hatch ? (
                <Meter label={t('eggsSet')} value={fmtN(b.placed)} expected={t('ofCapacity', { n: fmtN(shed.capacity) })} fill={b.placed / Math.max(1, shed.capacity)} tone="info" />
              ) : (
                <Meter label={t('birdsAlive')} value={fmtN(b.alive)} expected={t('ofPlaced', { n: fmtN(b.placed) })} fill={b.alive / Math.max(1, b.placed)} tone="info" />
              )}
              {(b.weight != null || b.weightStd != null) && (
                <Meter label={t('weight')} value={b.weight == null ? '—' : `${fmtN(b.weight)} g`} expected={b.weightStd == null ? undefined : t('std', { v: `${fmtN(b.weightStd)} g` })}
                  fill={(b.weight ?? 0) / wMax} mark={b.weightStd == null ? undefined : b.weightStd / wMax}
                  tone={b.weight != null && b.weightStd ? ratioTone(b.weight / b.weightStd) : 'info'} />
              )}
              {b.eggPct != null && (
                <Meter label={t('eggPct')} value={`${b.eggPct}%`} expected={b.eggStd == null ? undefined : t('std', { v: `${b.eggStd}%` })}
                  fill={b.eggPct / 100} mark={b.eggStd == null ? undefined : b.eggStd / 100}
                  tone={b.eggStd == null ? 'info' : b.eggPct >= b.eggStd - 3 ? 'good' : b.eggPct >= b.eggStd - 10 ? 'warn' : 'crit'} />
              )}
              {!hatch && (
                <Meter label={t('mortality')} value={t('todayN', { n: fmtN(b.mortToday) })} expected={t('mortAvg', { avg: b.mort7 })}
                  fill={b.mortToday / mMax} mark={b.mort7 / mMax} tone={mortTone(b.mortToday, b.mort7)} />
              )}
            </section>
            <div className={s.stats}>{stats.map(([l, v, wide]) => <div key={l} className={s.stat} data-wide={wide || undefined}><span>{l}</span><b>{v}</b></div>)}</div>
            {!hatch && b.days.length > 1 && <Trend b={b} />}
            <section>
              <h4 className={s.h}>{t('lastUpdate')}</h4>
              <div className={s.upd}>
                {b.lastDate ? [dt(b.lastDate), b.lastBy && t('updatedBy', { name: b.lastBy })].filter(Boolean).join(' · ') : t('noLog')}
                {b.remarks && <q>{b.remarks}</q>}
              </div>
            </section>
            {!hatch && b.drawn < b.alive && <p className={s.foot}>{t('scale', { drawn: fmtN(b.drawn), alive: fmtN(b.alive) })}</p>}
          </>
        ) : (
          <div className={s.emptyBox}><b>{t('emptyShed')}</b>{tf('capacity', { n: fmtN(shed.capacity) })}</div>
        )}
      </div>
      <div className={s.pFoot}>
        {b ? (
          <>
            {!hatch && <ActBtn act="mort" ctx={{ batch: b.id }} className={`btn ${s.act}`}>{t('recordMort')}</ActBtn>}
            {!hatch && <ActBtn act="addVisit" ctx={{ batch: b.id }} className={`btn secondary ${s.act}`}>{t('vetVisit')}</ActBtn>}
            {!hatch && <Link className={`btn secondary ${s.act}`} href={`/log?batch=${b.code}`}>{t('dailyLog')}</Link>}
            <Link className={`btn secondary ${s.act}`} href={`/farm/batch/${b.code}`}>{t('open')} →</Link>
          </>
        ) : (
          <ActBtn act="addBatch" ctx={{ shed: shed.id }} className={`btn ${s.act}`}>{t('placeBatch')}</ActBtn>
        )}
      </div>
    </section>
  );
}
