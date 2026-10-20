// Port of demo/index.html logScreen (:373-392). Batch chosen by ?batch=<code>.
import { getLocale, getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi } from '@/lib/kpi';
import { dateFmt, fmtN } from '@/lib/format';
import { Chips, Header, Live } from '@/components/ui/bits';
import { LogForm } from '@/components/log/LogForm';

export default async function LogPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { batch } = await searchParams;
  const [{ t: tn, today }, t, locale] = await Promise.all([currentMode().then(loadView), getTranslations(), getLocale()]);
  const active = tn.batches.filter((b) => b.state !== 'closed' && b.ft !== 'hatchery');
  if (!active.length)
    return (
      <>
        <Header title={t('log.title')} />
        <div className="card"><div className="t">{t('log.noActive')}</div><div className="s">{t('log.noActiveHint')}</div></div>
      </>
    );
  const b = active.find((x) => x.code === batch) ?? active[0];
  const k = batchKpi(b);
  const sup = tn.users.find((u) => u.role === 'shed_supervisor')?.name ?? t('roles.shed_supervisor');
  return (
    <>
      <Header title={t('log.titleDate', { date: dateFmt(locale)(today) })} action={<Live label={t('common.offlineOk')} />} />
      <Chips active={b.code} items={active.map((x) => [`/log?batch=${x.code}`, x.code, x.shed_name])} />
      <div className="card">
        <div className="t" style={{ fontWeight: 700 }}>{b.code}</div>
        <div className="s">{b.ft === 'layer' ? t('common.week', { n: Math.floor(b.age / 7) }) : t('common.day', { n: b.age })} · {t('log.opening')} <b className="mono">{fmtN(k.alive)}</b> · {sup}</div>
      </div>
      <LogForm key={b.code} batchId={b.id} today={today} isLayer={b.ft === 'layer'} alive={k.alive} std={k.std} last={k.last ?? null} />
    </>
  );
}
