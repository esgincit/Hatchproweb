'use client';
// Platform console: review queue for "apply for access" submissions.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { approveApplication, rejectApplication } from '@/app/actions/platform';
import { toast } from '@/components/ui/Toast';

export type AppRow = {
  id: string; business_name: string; owner_name: string; phone: string; email: string | null; state: string; district: string | null;
  farm_types: string[]; pan: string | null; gstin: string | null; pcb_ref: string | null; created_at: string;
  sites: { name: string; village?: string; pin?: string; lat?: number; lng?: number; land_acres?: number; sheds: { name: string; capacity: number }[] }[];
  operations: { current_birds?: number; breed?: string; model?: string; monthly_volume?: number };
  labour: Record<string, number | undefined>;
  phone_verified?: boolean; documents?: { path: string; name: string; url: string | null }[]; // 0030
};

export function Applications({ rows }: { rows: AppRow[] }) {
  const t = useTranslations('admin');
  const tf = useTranslations('farmType');
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (p: Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const r = await p;
      toast(r.ok ? msg : (r.error ?? 'error'));
      if (r.ok) router.refresh();
    });
  if (!rows.length)
    return <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('apps')}</div><div className="s">{t('noApps')}</div></div>;
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{t('apps')} · {rows.length}</div>
      <div className="list">
        {rows.map((a) => {
          const site = a.sites[0];
          const cap = (site?.sheds ?? []).reduce((s, x) => s + Number(x.capacity || 0), 0);
          const labour = Object.values(a.labour ?? {}).reduce<number>((s, x) => s + Number(x || 0), 0);
          return (
            <div key={a.id} className="item" style={{ flexDirection: 'column', gap: 8 }}>
              <button type="button" className="row between" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}
                style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit' }}>
                <div>
                  <div className="t">{a.business_name}</div>
                  <div className="s">{a.owner_name} · {a.phone} · {a.farm_types.map((x) => tf(x)).join(' + ')} · {a.district ?? ''} {a.state}</div>
                </div>
                <span className="pill warn">{t('pending')}</span>
              </button>
              {open === a.id && (
                <div style={{ width: '100%' }}>
                  <div className="kv">
                    <div>PAN / GSTIN</div><div>{a.pan ?? '—'} / {a.gstin ?? '—'}</div>
                    <div>PCB</div><div>{a.pcb_ref ?? '—'}</div>
                    <div>{t('appSheds')}</div><div>{site?.sheds.length ?? 0} · {cap.toLocaleString('en-IN')}</div>
                    <div>{t('appBirds')}</div><div>{(a.operations.current_birds ?? 0).toLocaleString('en-IN')}{a.operations.breed ? ' · ' + a.operations.breed : ''}</div>
                    <div>{t('appLabour')}</div><div>{labour}</div>
                    <div>GPS</div><div>{site?.lat ? <a href={`https://maps.google.com/?q=${site.lat},${site.lng}`} target="_blank" rel="noreferrer">{site.lat}, {site.lng}</a> : '—'}</div>
                    <div>Email</div><div>{a.email ?? '—'}</div>
                    <div>{t('appMobile')}</div><div>{a.phone_verified ? <span className="pill good">{t('appVerified')}</span> : <span className="pill warn">{t('appUnverified')}</span>}</div>
                    <div>{t('appDocs')}</div><div>{a.documents?.length ? a.documents.map((d) => (
                      <div key={d.path}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">📎 {d.name}</a> : `📎 ${d.name}`}</div>
                    )) : '—'}</div>
                  </div>
                  <form className="row wrap" style={{ gap: 8, marginTop: 10 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      run(approveApplication(a.id, String(fd.get('plan')), Number(fd.get('trial'))), t('approved', { name: a.business_name }));
                    }}>
                    <select name="plan" defaultValue="growth" aria-label={t('plan')}>
                      {['starter', 'growth', 'pro', 'enterprise'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select name="trial" defaultValue="30" aria-label={t('trial')}>
                      {[0, 14, 30, 60].map((d) => <option key={d} value={d}>{t('trialDays', { n: d })}</option>)}
                    </select>
                    <button className="btn small" disabled={pending}>{t('approve')}</button>
                    <button type="button" className="btn small danger" disabled={pending} onClick={() => run(rejectApplication(a.id, ''), t('rejected'))}>{t('reject')}</button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
