'use client';
// Labour mode: one shift's numbers with big +/- buttons. Each save ADDS to the day (add_shift_log, 0028) and carries
// an op id, so it can wait offline (lib/outbox.ts) and replay safely.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { runAct } from '@/app/actions/forms';
import { queue } from '@/lib/outbox';
import { fmtN } from '@/lib/format';
import { toast } from '@/components/ui/Toast';

const SHIFTS = ['morning', 'evening', 'night'] as const;
type Shift = (typeof SHIFTS)[number];
const nowShift = (): Shift => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'evening' : 'night'; };

export function ShiftForm({ batchId, today, sofar }: { batchId: string; today: string; sofar: { dead: number; culls: number; bags: number } }) {
  const t = useTranslations('shift');
  const router = useRouter();
  const [shift, setShift] = useState<Shift>(nowShift);
  const [v, setV] = useState({ mortality: 0, culls: 0, feed_bags: 0 });
  const [water, setWater] = useState('');
  const [busy, setBusy] = useState(false);

  const step = (k: keyof typeof v, label: string, by = 1) => (
    <div className="card" style={{ padding: 12 }}>
      <div className="eyebrow">{label}</div>
      <div className="row between" style={{ marginTop: 6 }}>
        <button type="button" className="btn secondary" style={{ width: 64, fontSize: 28 }} aria-label={`${label} −`}
          onClick={() => setV({ ...v, [k]: Math.max(0, v[k] - by) })}>−</button>
        <input aria-label={label} inputMode="numeric" type="number" min={0} value={v[k]}
          onChange={(e) => setV({ ...v, [k]: Math.max(0, +e.target.value || 0) })}
          style={{ width: 96, fontSize: 32, textAlign: 'center', fontWeight: 700 }} />
        <button type="button" className="btn" style={{ width: 64, fontSize: 28 }} aria-label={`${label} +`}
          onClick={() => setV({ ...v, [k]: v[k] + by })}>+</button>
      </div>
    </div>
  );

  async function save() {
    const input = { op_id: crypto.randomUUID(), batch_id: batchId, date: today, shift, ...v, ...(water ? { water: +water } : {}) };
    setBusy(true);
    let r: Awaited<ReturnType<typeof runAct>> | null = null;
    try { if (navigator.onLine) r = await runAct('shiftLog', input); } catch { /* network dropped */ }
    if (!r) {
      const user = (await createClient().auth.getSession()).data.session?.user.id;
      try { if (!user) throw new Error(); await queue(user, 'shiftLog', input); toast(t('queued')); } catch { toast(t('offlineFailed')); setBusy(false); return; }
    } else if (!r.ok) { setBusy(false); return toast(r.error); }
    else { toast(t('ok', { shift: t(shift) })); router.refresh(); }
    setV({ mortality: 0, culls: 0, feed_bags: 0 }); setWater(''); setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="shift-form">
      <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label={t('title')}>
        {SHIFTS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={shift === s} className={`btn ${shift === s ? '' : 'secondary'}`} onClick={() => setShift(s)}>{t(s)}</button>
        ))}
      </div>
      {step('mortality', t('dead'))}
      {step('culls', t('culls'))}
      {step('feed_bags', t('bags'))}
      <div className="card" style={{ padding: 12 }}>
        <label className="eyebrow" htmlFor="shift-water">{t('water')}</label>
        <input id="shift-water" inputMode="numeric" type="number" min={0} value={water} onChange={(e) => setWater(e.target.value)}
          style={{ width: '100%', fontSize: 28, fontWeight: 700, marginTop: 6 }} />
      </div>
      <div className="s">{t('sofar', { dead: fmtN(sofar.dead), culls: fmtN(sofar.culls), bags: fmtN(sofar.bags) })}</div>
      <button className="btn" type="button" disabled={busy} onClick={save} style={{ fontSize: 18, padding: 16 }}>{t('save', { shift: t(shift) })}</button>
    </div>
  );
}
