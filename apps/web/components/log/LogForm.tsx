'use client';
// Port of demo/index.html logScreen form (:381-392) incl. the live egg total (:400).
// Saves online through save_daily_log (one transaction); offline it queues on the phone (lib/outbox.ts) and
// components/shell/OutboxSync.tsx replays it through the same action when the network is back.
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { queue } from '@/lib/outbox';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fmtN } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { runAct } from '@/app/actions/forms';
import { GRADES, SCHEMAS } from '@/lib/schemas';
import type { Log } from '@/lib/view/types';

export function LogForm({ batchId, today, isLayer, alive, std, last }: {
  batchId: string; today: string; isLayer: boolean; alive: number; std: number | null; last: Log | null;
}) {
  const t = useTranslations('log');
  const tf = useTranslations('forms');
  const router = useRouter();
  const g = last?.grades ?? {};
  const [trays, setTrays] = useState<Record<string, number>>(Object.fromEntries(GRADES.map((gr) => [gr, Math.round((g[gr] ?? 0) / 30)])));
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string[]>([]);
  const eggs = GRADES.reduce((a, gr) => a + (trays[gr] || 0) * 30, 0);
  // today's log (if already saved) pre-fills; otherwise yesterday's values are a starting point
  const isToday = last?.date === today;
  const num = (id: string, name: string, label: string, value: number | string | null | undefined, mode: 'numeric' | 'decimal' = 'numeric') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type="number" inputMode={mode} step="any" defaultValue={value ?? ''}
        aria-invalid={bad.includes(name) || undefined} style={bad.includes(name) ? { borderColor: 'var(--crit)' } : undefined} />
    </div>
  );

  // Evidence photo → private bucket evidence/<tenant>/<batch>/<date>/… (0027) + media row; dead-bird photos also go
  // to AI triage (advisory; vet confirms). Needs network — photos are too big to queue on the phone for now.
  async function photo(kind: 'dead' | 'feed', f: File) {
    if (!navigator.onLine) return toast(t('photoOffline'));
    setBusy(true);
    try {
      const sb = createClient();
      const s = (await sb.auth.getSession()).data.session;
      const tenant = (s?.user.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
      const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${tenant}/${batchId}/${today}/${crypto.randomUUID()}.${ext}`;
      const gps = await new Promise<GeolocationCoordinates | null>((res) =>
        navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { timeout: 4000 }) : res(null));
      const up = await sb.storage.from('evidence').upload(path, f, { contentType: f.type || 'image/jpeg' });
      if (up.error) return toast(t('photoFailed'));
      const { data: m, error } = await sb.from('media').insert({
        storage_path: path, entity_type: 'batch', entity_id: batchId, taken_at: new Date().toISOString(), device_id: 'web',
        lat: gps ? +gps.latitude.toFixed(6) : null, lng: gps ? +gps.longitude.toFixed(6) : null,
      }).select('id').single();
      if (error || !m) return toast(t('photoFailed'));
      if (kind === 'feed') return toast(t('photoSaved'));
      toast(t('aiChecking'));
      const r = await sb.functions.invoke('ai-triage', { body: { batch_id: batchId, media_ids: [m.id] } });
      const status = (r.error as { context?: Response } | null)?.context?.status;
      if (r.error) return toast(status === 503 ? t('aiOff') : t('aiFailed'));
      const top = r.data?.case;
      toast(t('aiResult', { name: top?.ai_top_condition ?? '—', pct: Math.round((r.data?.ranked?.[0]?.confidence ?? 0) * 100) }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));
    const input = {
      ...fd, batch_id: batchId, date: today,
      ...(isLayer ? { eggs: Object.fromEntries(GRADES.map((gr) => [gr, (trays[gr] || 0) * 30])) } : {}),
    };
    const local = SCHEMAS.logSave.safeParse(input);
    if (!local.success) { setBad(local.error.issues.map((i) => String(i.path[0]))); return toast(tf('invalid')); }
    setBusy(true);
    let r: Awaited<ReturnType<typeof runAct>> | null = null;
    try { if (navigator.onLine) r = await runAct('logSave', input); } catch { /* network dropped mid-save */ }
    if (!r) { // offline: keep it on the phone, OutboxSync sends it when the network is back (upsert, safe to replay)
      const user = (await createClient().auth.getSession()).data.session?.user.id;
      setBusy(false);
      if (!user) return toast(t('offlineFailed'));
      try { await queue(user, 'logSave', input); } catch { return toast(t('offlineFailed')); }
      return toast(t('queued'));
    }
    setBusy(false);
    if (!r.ok) { setBad(r.fields ?? []); return toast(r.error); }
    toast(r.msg);
    if (r.href) router.push(r.href);
    router.refresh();
  }

  return (
    <form className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={save} noValidate>
      <div className="eyebrow">{t('birdsSection')}</div>
      <div className="grid2">
        {num('f_mort', 'mortality', t('mortality'), isToday ? last?.mortality : 0)}
        {num('f_cull', 'culls', t('culls'), isToday ? last?.culls : 0)}
      </div>
      {isLayer ? (
        <>
          <div className="eyebrow">{t('eggsByGrade')}</div>
          <div className="grid3">
            {GRADES.map((gr) => (
              <div className="field" key={gr}>
                <label htmlFor={'f_' + gr}>{t(gr)}</label>
                <input id={'f_' + gr} type="number" inputMode="numeric" value={trays[gr] ?? 0}
                  onChange={(e) => setTrays({ ...trays, [gr]: +e.target.value })} />
              </div>
            ))}
          </div>
          <div className="s">= <b className="mono">{fmtN(eggs)}</b> {t('eggTotal')} · <span>{alive ? ((100 * eggs) / alive).toFixed(1) : '0.0'}%</span> {t('henDay', { std: std ?? '—' })}</div>
        </>
      ) : (
        <>
          <div className="eyebrow">{t('growth')}</div>
          <div className="grid2">
            {num('f_wt', 'avg_w', t('avgWt'), last?.avg_w)}
            {num('f_cv', 'cv', t('cv'), 9.5, 'decimal')}
          </div>
        </>
      )}
      <div className="eyebrow">{t('feedWater')}</div>
      <div className="grid2">
        {num('f_feed', 'feed_bags', t('feedBags'), Math.round((last?.feed_kg ?? 0) / 50))}
        {num('f_water', 'water', t('water'), Math.round(last?.water ?? 0))}
      </div>
      <div className="eyebrow">{t('climate')}</div>
      <div className="grid3">
        {num('f_tmin', 'tmin', t('tmin'), last?.tmin, 'decimal')}
        {num('f_tmax', 'tmax', t('tmax'), last?.tmax, 'decimal')}
        {num('f_rh', 'rh', t('rh'), 64)}
      </div>
      <div className="eyebrow">{t('photos')}</div>
      <div className="grid2">
        {(['dead', 'feed'] as const).map((k) => (
          <label className="photo" key={k} data-testid={`photo-${k}`}>
            📷 {t(k === 'dead' ? 'photoDead' : 'photoFeed')}{k === 'dead' && <><br /><span style={{ fontSize: 10 }}>{t('gps')}</span></>}
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) photo(k, f); }} />
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="f_rem">{t('remarks')}</label>
        <input id="f_rem" name="remarks" type="text" defaultValue={isToday ? (last?.remarks ?? '') : ''} placeholder={t('remarksHint')}
          aria-invalid={bad.includes('remarks') || undefined} style={bad.includes('remarks') ? { borderColor: 'var(--crit)' } : undefined} />
      </div>
      <button className="btn" type="submit" disabled={busy}>{t('save')}</button>
    </form>
  );
}
