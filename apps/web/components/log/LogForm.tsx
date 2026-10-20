'use client';
// Port of demo/index.html logScreen form (:381-392) incl. the live egg total (:400).
// Saving (local-first outbox → sync-apply) lands in Phase 5; for now submit shows a toast.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { fmtN } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { Log } from '@/lib/view/types';

const GRADES = ['jumbo', 'large', 'medium', 'small', 'cracked', 'dirty'] as const;

export function LogForm({ isLayer, alive, std, last }: { isLayer: boolean; alive: number; std: number | null; last: Log | null }) {
  const t = useTranslations('log');
  const g = last?.grades ?? {};
  const [trays, setTrays] = useState<Record<string, number>>(Object.fromEntries(GRADES.map((gr) => [gr, Math.round((g[gr] ?? 0) / 30)])));
  const eggs = GRADES.reduce((a, gr) => a + (trays[gr] || 0) * 30, 0);
  const num = (id: string, label: string, value: number | string | null | undefined, mode: 'numeric' | 'decimal' = 'numeric') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode={mode} defaultValue={value ?? ''} />
    </div>
  );
  return (
    <form className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      onSubmit={(e) => { e.preventDefault(); toast(t('save')); }}>
      <div className="eyebrow">{t('birdsSection')}</div>
      <div className="grid2">
        {num('f_mort', t('mortality'), last?.mortality ?? 0)}
        {num('f_cull', t('culls'), last ? Math.round(last.mortality * 0.2) : 0)}
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
            {num('f_wt', t('avgWt'), last?.avg_w)}
            {num('f_cv', t('cv'), 9.5, 'decimal')}
          </div>
        </>
      )}
      <div className="eyebrow">{t('feedWater')}</div>
      <div className="grid2">
        {num('f_feed', t('feedBags'), Math.round((last?.feed_kg ?? 0) / 50))}
        {num('f_water', t('water'), Math.round(last?.water ?? 0))}
      </div>
      <div className="eyebrow">{t('climate')}</div>
      <div className="grid3">
        {num('f_tmin', t('tmin'), last?.tmin, 'decimal')}
        {num('f_tmax', t('tmax'), last?.tmax, 'decimal')}
        {num('f_rh', t('rh'), 64)}
      </div>
      <div className="eyebrow">{t('photos')}</div>
      <div className="grid2">
        <div className="photo" tabIndex={0} role="button">📷 {t('photoDead')}<br /><span style={{ fontSize: 10 }}>{t('gps')}</span></div>
        <div className="photo" tabIndex={0} role="button">📷 {t('photoFeed')}</div>
      </div>
      <div className="field">
        <label htmlFor="f_rem">{t('remarks')}</label>
        <input id="f_rem" type="text" defaultValue={last?.remarks ?? ''} placeholder={t('remarksHint')} />
      </div>
      <button className="btn" type="submit">{t('save')}</button>
    </form>
  );
}
