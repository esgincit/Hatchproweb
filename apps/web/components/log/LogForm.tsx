'use client';
// Port of demo/index.html logScreen form (:381-392) incl. the live egg total (:400).
// Saves online through save_daily_log (one transaction). Offline outbox → sync-apply comes with the PWA phase.
import { useState } from 'react';
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
    const r = await runAct('logSave', input);
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
        <div className="photo" tabIndex={0} role="button">📷 {t('photoDead')}<br /><span style={{ fontSize: 10 }}>{t('gps')}</span></div>
        <div className="photo" tabIndex={0} role="button">📷 {t('photoFeed')}</div>
      </div>
      <div className="field">
        <label htmlFor="f_rem">{t('remarks')}</label>
        <input id="f_rem" name="remarks" type="text" defaultValue={isToday ? (last?.remarks ?? '') : ''} placeholder={t('remarksHint')} />
      </div>
      <button className="btn" type="submit" disabled={busy}>{t('save')}</button>
    </form>
  );
}
