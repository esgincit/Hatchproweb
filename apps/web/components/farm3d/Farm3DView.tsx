'use client';
// Farm screen's live 3D block: farm tabs, the WebGL scene (client-only), the expected-vs-actual panel, realtime refresh.
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { dateFmt, fmtN } from '@/lib/format';
import { RagPill } from '@/components/ui/bits';
import { RAG_HEX, type Farm3D, type Shed3D } from '@/lib/farm3d';

const Scene = dynamic(() => import('./Scene'), { ssr: false, loading: () => <div className="s" style={{ padding: 16 }}>…</div> });

/** New daily logs / mortality anywhere in the tenant (RLS-filtered) → re-render with fresh numbers. */
function useLiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const sb = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel('farm3d').on('postgres_changes', { event: '*', schema: 'public', table: 'daily_shed_log' }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    });
    // the socket must carry the user's JWT before joining, or RLS filters every row out
    let live = true;
    sb.auth.getSession().then(({ data }) => { if (!live) return; sb.realtime.setAuth(data.session?.access_token ?? null); ch.subscribe(); });
    return () => { live = false; clearTimeout(timer); sb.removeChannel(ch); };
  }, [router]);
}

export default function Farm3DView({ farms }: { farms: Farm3D[] }) {
  const t = useTranslations('farm3d');
  const tr = useTranslations('rag');
  const dt = dateFmt(useLocale());
  const [fi, setFi] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  useLiveRefresh();
  const farm = farms[Math.min(fi, farms.length - 1)];
  if (!farm?.sheds.length) return null;
  const shed = farm.sheds.find((s) => s.id === sel) ?? null;
  const b = shed?.batch;
  const labelOf = (s: Shed3D) => (s.batch ? fmtN(s.batch.ft === 'hatchery' ? s.batch.placed : s.batch.alive) : t('empty'));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row between" style={{ padding: '10px 12px', gap: 8, flexWrap: 'wrap' }}>
        <div className="t" style={{ fontWeight: 700 }}>
          {t('title')} <span className="pill good" style={{ marginLeft: 6 }}>● {t('live')}</span>
        </div>
        {farms.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {farms.map((f, i) => (
              <button key={f.id} type="button" className={`btn small${i === fi ? '' : ' secondary'}`} onClick={() => { setFi(i); setSel(null); }}>{f.name}</button>
            ))}
          </div>
        )}
      </div>
      <div data-testid="farm3d" style={{ position: 'relative', height: 'min(62vh, 560px)', background: '#cfe3f2' }}>
        <Scene key={farm.id} farm={farm} selected={sel} onPick={setSel} />
        <div className="row" style={{ position: 'absolute', top: 10, right: 10, gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '70%' }}>
          {farm.sheds.map((s) => {
            const c = RAG_HEX[s.batch?.rag ?? 'neutral'];
            return (
              <button key={s.id} type="button" className="pill" aria-pressed={s.id === sel} onClick={() => setSel(s.id === sel ? null : s.id)}
                style={{ background: s.id === sel ? c : '#fff', color: s.id === sel ? '#fff' : '#222', border: `2px solid ${c}`, cursor: 'pointer', fontSize: 12 }}>
                <span style={{ color: s.id === sel ? '#fff' : c }}>●</span> {s.name} · {labelOf(s)}
              </button>
            );
          })}
        </div>
        {shed && (
          <button type="button" className="btn small secondary" style={{ position: 'absolute', top: 10, left: 10 }} onClick={() => setSel(null)}>{t('back')}</button>
        )}
        {!shed && <div className="s" style={{ position: 'absolute', bottom: 8, left: 12, right: 12, textShadow: '0 1px 2px #fff' }}>{t('hint')}</div>}
      </div>
      {shed && (
        <div style={{ padding: 12 }} data-testid="farm3d-panel">
          <div className="row between" style={{ marginBottom: 8 }}>
            <div>
              <div className="t" style={{ fontWeight: 700 }}>{shed.name}{b ? ` · ${b.code}` : ''}</div>
              <div className="s">{b ? `${b.breed} · ${t('day', { day: b.day })}` : t('empty')}</div>
            </div>
            {b && <RagPill rag={b.rag} />}
          </div>
          {b && (
            <>
              <div className="kv">
                <div>{b.ft === 'hatchery' ? t('eggsSet') : t('birds')}</div>
                <div>{b.ft === 'hatchery' ? fmtN(b.placed) : t('vs', { actual: fmtN(b.alive), expected: fmtN(b.placed) })}</div>
                {b.weight != null || b.weightStd != null ? (<><div>{t('weight')}</div><div>{t('vs', { actual: b.weight == null ? '—' : `${fmtN(b.weight)} g`, expected: b.weightStd == null ? '—' : `${fmtN(b.weightStd)} g` })}</div></>) : null}
                {b.eggPct != null ? (<><div>{t('eggs')}</div><div>{t('vs', { actual: `${b.eggPct}%`, expected: b.eggStd == null ? '—' : `${b.eggStd}%` })}</div></>) : null}
                {b.ft !== 'hatchery' && (<><div>{t('mortality')}</div><div>{t('mortVal', { today: b.mortToday, avg: b.mort7 })}</div></>)}
                {b.tmax != null && (<><div>{t('temp')}</div><div>{b.tmin ?? '—'}–{b.tmax} °C</div></>)}
                <div>{t('issue')}</div>
                <div style={{ color: b.issue || b.rag === 'crit' ? 'var(--crit)' : undefined }}>{b.issue ?? (b.rag === 'good' ? t('none') : tr(b.rag))}</div>
                <div>{t('lastUpdate')}</div>
                <div>{b.lastDate ? dt(b.lastDate) : '—'}</div>
              </div>
              {b.remarks && <div className="s" style={{ marginTop: 6 }}>“{b.remarks}”</div>}
              {b.drawn < b.alive && b.ft !== 'hatchery' && <div className="s" style={{ marginTop: 6 }}>{t('scale', { drawn: fmtN(b.drawn), alive: fmtN(b.alive) })}</div>}
              <Link className="btn small" style={{ marginTop: 10, display: 'inline-flex' }} href={`/farm/batch/${b.code}`}>{t('open')}</Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
