'use client';
// Port of demo/index.html logScreen form (:381-392) incl. the live egg total (:400).
// Saving (local-first outbox → sync-apply) lands in Phase 5; for now submit shows a toast.
import { useState } from 'react';
import { fmtN } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import type { Log } from '@/lib/view/types';

const GRADES = ['jumbo', 'large', 'medium', 'small', 'cracked', 'dirty'] as const;

export function LogForm({ isLayer, alive, std, last }: { isLayer: boolean; alive: number; std: number | null; last: Log | null }) {
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
      onSubmit={(e) => { e.preventDefault(); toast('Saving logs arrives in the next update (works offline)'); }}>
      <div className="eyebrow">Birds</div>
      <div className="grid2">
        {num('f_mort', 'Mortality', last?.mortality ?? 0)}
        {num('f_cull', 'Culls', last ? Math.round(last.mortality * 0.2) : 0)}
      </div>
      {isLayer ? (
        <>
          <div className="eyebrow">Eggs by grade (trays of 30)</div>
          <div className="grid3">
            {GRADES.map((gr) => (
              <div className="field" key={gr}>
                <label htmlFor={'f_' + gr}>{gr[0].toUpperCase() + gr.slice(1)}</label>
                <input id={'f_' + gr} type="number" inputMode="numeric" value={trays[gr] ?? 0}
                  onChange={(e) => setTrays({ ...trays, [gr]: +e.target.value })} />
              </div>
            ))}
          </div>
          <div className="s">= <b className="mono">{fmtN(eggs)}</b> eggs · <span>{alive ? ((100 * eggs) / alive).toFixed(1) : '0.0'}%</span> hen-day (standard {std ?? '—'}%)</div>
        </>
      ) : (
        <>
          <div className="eyebrow">Growth sample</div>
          <div className="grid2">
            {num('f_wt', 'Avg weight (g) · 50 birds', last?.avg_w)}
            {num('f_cv', 'Uniformity CV %', 9.5, 'decimal')}
          </div>
        </>
      )}
      <div className="eyebrow">Feed &amp; water</div>
      <div className="grid2">
        {num('f_feed', 'Feed (bags of 50 kg)', Math.round((last?.feed_kg ?? 0) / 50))}
        {num('f_water', 'Water (litres)', Math.round(last?.water ?? 0))}
      </div>
      <div className="eyebrow">Shed climate</div>
      <div className="grid3">
        {num('f_tmin', 'Min °C', last?.tmin, 'decimal')}
        {num('f_tmax', 'Max °C', last?.tmax, 'decimal')}
        {num('f_rh', 'RH %', 64)}
      </div>
      <div className="eyebrow">Evidence photos</div>
      <div className="grid2">
        <div className="photo" tabIndex={0} role="button">📷 Droppings / dead birds<br /><span style={{ fontSize: 10 }}>GPS + time stamped</span></div>
        <div className="photo" tabIndex={0} role="button">📷 Feed bags issued</div>
      </div>
      <div className="field">
        <label htmlFor="f_rem">Remarks (voice-to-text)</label>
        <input id="f_rem" type="text" defaultValue={last?.remarks ?? ''} placeholder="e.g. birds active, litter dry" />
      </div>
      <button className="btn" type="submit">Save log · syncs when online</button>
    </form>
  );
}
