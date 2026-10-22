'use client';
// Farm screen's live 3D viewer: the WebGL scene (client-only) under a HUD — farm / time / view / quality controls,
// farm KPIs, shed list, floating shed labels — plus the shed detail panel and realtime refresh. Scene contract: ./types.ts.
import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { fmtN } from '@/lib/format';
import type { Farm3D } from '@/lib/farm3d';
import type { LabelMap, Quality, ViewMode } from './types';
import { Hud, Kpis } from './ui/Hud';
import { Label3D, ShedList, alertOf, countOf } from './ui/Sheds';
import { ShedPanel } from './ui/ShedPanel';
import s from './ui/viewer.module.css';

const Scene = dynamic(() => import('./Scene'), { ssr: false });
const Progress = dynamic(() => import('./ui/Loading'), { ssr: false, loading: () => <span className={s.bar} data-busy=""><i /></span> });

/** New daily logs / mortality anywhere in the tenant (RLS-filtered) → re-render with fresh numbers. true once joined. */
function useLiveRefresh() {
  const router = useRouter();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sb = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel('farm3d').on('postgres_changes', { event: '*', schema: 'public', table: 'daily_shed_log' }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    });
    // the socket must carry the user's JWT before joining, or RLS filters every row out
    let live = true;
    sb.auth.getSession().then(({ data }) => { if (!live) return; sb.realtime.setAuth(data.session?.access_token ?? null); ch.subscribe((st) => { if (live) setOn(st === 'SUBSCRIBED'); }); });
    return () => { live = false; clearTimeout(timer); sb.removeChannel(ch); };
  }, [router]);
  return on;
}

const never = () => () => {};
/** Auto quality: phones / touch / narrow windows / ≤ 4 GB RAM → low. */
const lowEnd = () => matchMedia('(pointer: coarse)').matches || innerWidth < 768 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/** No WebGL / software-only GL (blocklisted GPU, old phone, headless CI): say so instead of freezing the Farm screen. */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); } // nothing will load: drop the loading card
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function Farm3DView({ farms: all }: { farms: Farm3D[] }) {
  const t = useTranslations('farm3d');
  const farms = all.filter((f) => f.sheds.length);
  const [fi, setFi] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('overview');
  const [q, setQ] = useState<Quality | 'auto'>('auto');
  const [liveTime, setLiveTime] = useState(false);
  const [ready, setReady] = useState(false);
  const labels = useRef<LabelMap>(new Map());
  const viewer = useRef<HTMLDivElement>(null);
  const live = useLiveRefresh();
  const low = useSyncExternalStore(never, lowEnd, () => false);
  const markReady = useCallback(() => setReady(true), []);
  const pick = useCallback((id: string | null) => {
    setSel(id);
    if (!id) setView((v) => (v === 'inside' ? 'overview' : v));
  }, []);

  useEffect(() => {
    if (!sel) return;
    // an open form sheet takes Esc first (Radix marks it handled)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) pick(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [sel, pick]);

  const idx = Math.min(fi, farms.length - 1), farm = farms[idx]; // a refresh can drop farms
  if (!farm) return null;
  const shed = farm.sheds.find((x) => x.id === sel) ?? null;
  const chooseView = (v: ViewMode) => {
    if (v === 'inside' && !shed) setSel((farm.sheds.find((x) => x.batch) ?? farm.sheds[0]).id); // inside needs a shed
    setView(v);
  };
  const chooseFarm = (i: number) => { setFi(i); setSel(null); setHov(null); setView('overview'); setReady(false); };

  return (
    <div ref={viewer} className={`${s.viewer}${shed ? ` ${s.open}` : ''}`} role="region" aria-label={t('title')}>
      <div className={s.stage} data-testid="farm3d">
        <SceneBoundary key={farm.id} fallback={<div className={s.noGl}>{t('noWebgl')}</div>} onError={markReady}>
          <Scene farm={farm} selected={sel} onPick={pick} hovered={hov} onHover={setHov} view={view}
            quality={q === 'auto' ? (low ? 'low' : 'high') : q} liveTime={liveTime} labels={labels} onReady={markReady} />
        </SceneBoundary>
        {farm.sheds.filter((x) => !(view === 'inside' && x.id === sel)).map((x) => ( // no pin over your own head inside a shed
          <Label3D key={x.id} id={x.id} labels={labels} rag={x.batch?.rag ?? 'neutral'} title={x.name} value={x.batch ? fmtN(countOf(x)) : t('empty')}
            alert={alertOf(x)} selected={x.id === sel} hovered={x.id === hov}
            onClick={() => pick(x.id === sel ? null : x.id)} onHover={(on) => setHov(on ? x.id : null)} />
        ))}
        {farm.assets.filter((a) => a.ticket).map((a) => ( // open repair tickets pinned on the equipment in 3D
          <Label3D key={a.id} id={`asset:${a.id}`} labels={labels} rag="crit" title={a.name}
            value={a.ticket!.length > 30 ? a.ticket!.slice(0, 29) + '…' : a.ticket!} alert />
        ))}
        {!ready && (
          <div className={s.loading} role="status">
            <div className={`${s.glass} ${s.loadCard}`}>{t('loading')}<Progress onDone={markReady} /></div>
          </div>
        )}
        <Hud farms={farms} farmIdx={idx} onFarm={chooseFarm} live={live} liveTime={liveTime} onLiveTime={setLiveTime}
          view={view} onView={chooseView} quality={q} onQuality={setQ} target={viewer} />
        <ShedList sheds={farm.sheds} selected={sel} hovered={hov} onPick={pick} onHover={setHov} />
        <Kpis farm={farm} />
        {!shed && <div className={`${s.glass} ${s.hint}`}>{t('hint')}</div>}
      </div>
      {shed && <ShedPanel key={shed.id} shed={shed} onClose={() => pick(null)} />}
    </div>
  );
}
