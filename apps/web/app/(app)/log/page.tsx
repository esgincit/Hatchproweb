// Port of demo/index.html logScreen (:373-392). Batch chosen by ?batch=<code>.
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi } from '@/lib/kpi';
import { dmy, fmtN } from '@/lib/format';
import { Chips, Header, Live } from '@/components/ui/bits';
import { LogForm } from '@/components/log/LogForm';

export default async function LogPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { batch } = await searchParams;
  const { t, today } = await loadView(await currentMode());
  const active = t.batches.filter((b) => b.state !== 'closed' && b.ft !== 'hatchery');
  if (!active.length)
    return (
      <>
        <Header title="Daily log" />
        <div className="card"><div className="t">No active batch.</div><div className="s">Place a batch under Farm first.</div></div>
      </>
    );
  const b = active.find((x) => x.code === batch) ?? active[0];
  const k = batchKpi(b);
  const sup = t.users.find((u) => u.role === 'shed_supervisor')?.name ?? 'supervisor';
  return (
    <>
      <Header title={`Daily log · ${dmy(today)}`} action={<Live label="offline OK" />} />
      <Chips active={b.code} items={active.map((x) => [`/log?batch=${x.code}`, x.code, x.shed_name])} />
      <div className="card">
        <div className="t" style={{ fontWeight: 700 }}>{b.code}</div>
        <div className="s">{b.ft === 'layer' ? 'wk ' + Math.floor(b.age / 7) : 'day ' + b.age} · opening birds <b className="mono">{fmtN(k.alive)}</b> · {sup}</div>
      </div>
      <LogForm key={b.code} isLayer={b.ft === 'layer'} alive={k.alive} std={k.std} last={k.last ?? null} />
    </>
  );
}
