// Port of demo/index.html batchScreen (:342-370).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadView } from '@/lib/view/load';
import { batchKpi, costPerEgg, rate, stdEggPct, stdWeight } from '@/lib/kpi';
import { daysBetween, dmy, fmtL, fmtN } from '@/lib/format';
import { Back, RagPill, stateLabel } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';

const dOnly = (s: string) => s.slice(5).replace('-', '/');

export default async function BatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const v = await loadView();
  const { t, today } = v;
  const b = t.batches.find((x) => x.code === decodeURIComponent(code));
  if (!b) notFound();
  const k = batchKpi(b);
  const logs = k.logs.slice(-28);
  const wk = (i: number) => Math.floor(logs[i].day / 7);
  const mid = Math.floor(logs.length / 2);
  const hatch = b.ft === 'hatchery';

  let chart: React.ReactNode = null;
  if (b.ft === 'layer' && k.eggs && logs.length) {
    const actual = logs.map((l) => (l.eggs ? +((100 * l.eggs) / l.birds).toFixed(1) : null));
    const std = logs.map((l) => stdEggPct(b, l.day));
    const a = actual.filter((x): x is number => x != null), s = std.filter((x): x is number => x != null);
    chart = (
      <>
        <LineChart fmt="pct"
          series={[{ name: 'Actual hen-day %', data: actual, color: 'var(--accent)' }, { name: 'Standard', data: std, color: 'var(--series2)', dash: true }]}
          xlabels={[[0, 'wk ' + wk(0)], [mid, 'wk ' + wk(mid)], [logs.length - 1, 'wk ' + wk(logs.length - 1)]]}
          ylim={a.length && s.length ? [Math.min(...a) - 4, Math.max(...s) + 2] : undefined}
          vals={actual.map((x, i) => x + '% · ' + dOnly(logs[i].date))} />
        <div className="legend"><span><i />Actual hen-day %</span><span><i className="std" />Breed standard</span></div>
      </>
    );
  } else if (b.ft === 'broiler' && logs.length) {
    const actual = logs.map((l) => l.avg_w);
    chart = (
      <>
        <LineChart fmt="kg"
          series={[{ name: 'Avg weight g', data: actual, color: 'var(--accent)' }, { name: 'Standard', data: logs.map((l) => stdWeight(b, l.day)), color: 'var(--series2)', dash: true }]}
          xlabels={[[0, 'day ' + logs[0].day], [mid, 'day ' + logs[mid].day], [logs.length - 1, 'day ' + logs[logs.length - 1].day]]}
          vals={actual.map((x, i) => x + ' g · day ' + logs[i].day)} />
        <div className="legend"><span><i />Avg weight</span><span><i className="std" />Breed standard</span></div>
      </>
    );
  }

  const mort = logs.map((l) => l.mortality);
  const cases = t.disease_cases.filter((c) => c.batch === b.code);
  const visits = t.vet_visits.filter((x) => x.batch === b.code);
  const spikeDay = (m: number) => m > k.mb * 1.8 && m > 5;
  const cpe = b.ft === 'layer' && k.eggs ? costPerEgg(b) : null;
  const eggR = rate(v, 'egg'), brR = rate(v, 'broiler_farmgate');

  return (
    <>
      <Back href="/farm" />
      <div className="row between">
        <div><div className="eyebrow">{b.farm_name} · {b.shed_name}</div><div className="h2">{b.code}</div></div>
        <RagPill rag={k.rag} />
      </div>
      {b.state !== 'closed' && (
        <div className="quick">
          {[['mort', '☠️', 'Mortality'], ['vaccDone', '💉', 'Vaccinate'], ['addVisit', '🩺', 'Vet visit'], ['batchState', '🔁', 'State']].map(([a, i, l]) => (
            <ActBtn key={a} act={a}><span>{i}</span>{l}</ActBtn>
          ))}
        </div>
      )}
      <div className="grid3">
        <div className="tile"><div className="lbl">{hatch ? 'Eggs set' : 'Birds'}</div><div className="val" style={{ fontSize: 18 }}>{fmtN(k.alive)}</div><div className="delta flat">of {fmtN(b.doc)}</div></div>
        <div className="tile">
          <div className="lbl">Age</div>
          <div className="val" style={{ fontSize: 18 }}>{hatch ? 'day ' + b.age : b.ft === 'layer' ? 'wk ' + Math.floor(b.age / 7) : 'day ' + b.age}</div>
          <div className="delta flat">{stateLabel(b.state)}</div>
        </div>
        <div className="tile">
          <div className="lbl">Mortality</div><div className="val" style={{ fontSize: 18 }}>{k.mortPct.toFixed(2)}%</div>
          <div className={`delta ${k.rag === 'crit' ? 'down' : 'flat'}`}>{k.m7.toFixed(1)}/day (7d)</div>
        </div>
      </div>

      {chart && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div className="eyebrow">{b.ft === 'layer' ? 'Production vs standard' : 'Growth vs standard'}</div>
            <span className="s">{b.ft === 'layer' ? `today ${k.eggPct.toFixed(1)}% · std ${k.std ?? '—'}%` : `FCR ${k.fcr ? k.fcr.toFixed(2) : '—'}`}</span>
          </div>
          {chart}
        </div>
      )}

      {!hatch && mort.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div className="eyebrow">Daily mortality · {mort.length} days</div><span className="s">baseline {k.mb.toFixed(1)}/day</span>
          </div>
          <BarChart vals={mort} hl={mort.map(spikeDay)} xlabels={[[0, dOnly(logs[0].date)], [mort.length - 1, dOnly(logs[mort.length - 1].date)]]} />
        </div>
      )}

      {cases.length > 0 && (
        <div className="card stripe crit">
          <div className="row between">
            <div className="eyebrow">AI disease flag</div>
            {!cases[0].vet_confirmed && <ActBtn act="confirmCase" className="btn small secondary">Vet confirm</ActBtn>}
          </div>
          {cases.map((c) => (
            <div key={c.id}>
              <div className="t">{c.disease} · {Math.round(c.confidence * 100)}% {c.vet_confirmed ? <span className="pill good">Vet confirmed</span> : <span className="pill warn">Awaiting vet</span>}</div>
              <div className="s">{c.notes}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">Vet visits</div><ActBtn act="addVisit" className="btn small">+ Visit</ActBtn></div>
        <div className="list">
          {visits.length ? visits.map((x, i) => (
            <div className="item" key={i}><div>
              <div className="t">{x.vet} · {dmy(x.date)}</div>
              <div className="s"><b>Findings:</b> {x.findings}</div>
              <div className="s"><b>Rx:</b> {x.prescription}</div>
            </div></div>
          )) : <div className="s">None yet.</div>}
        </div>
      </div>

      {!hatch && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">Vaccination schedule</div><ActBtn act="addVacc" className="btn small">+ Add</ActBtn></div>
          <div className="list">
            {b.vacc.map((x) => {
              const od = !x.done && daysBetween(x.due, today) > 0;
              return (
                <div className="item" key={x.id}>
                  <div><div className="t">{x.name}</div><div className="s">due {dmy(x.due)}{x.done ? ' · done ' + dmy(x.done) : ''}</div></div>
                  <div className="r">{x.done ? <span className="pill good">Done</span> : <ActBtn act="vaccDone" className={`btn small ${od ? '' : 'secondary'}`}>{od ? 'Overdue · mark' : 'Mark done'}</ActBtn>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hatch && k.logs.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">Last 7 logs</div><Link className="back" href={`/log?batch=${b.code}`}>+ Log today ›</Link></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Date</th><th className="n">Birds</th><th className="n">Dead</th><th className="n">Feed kg</th><th className="n">{b.ft === 'layer' ? 'Eggs' : 'Wt g'}</th><th className="n">Tmax</th></tr></thead>
              <tbody>
                {k.logs.slice(-7).reverse().map((l) => (
                  <tr key={l.id}>
                    <td>{dOnly(l.date)}</td><td className="n">{fmtN(l.birds)}</td>
                    <td className="n" style={spikeDay(l.mortality) ? { color: 'var(--crit)', fontWeight: 600 } : undefined}>{l.mortality}</td>
                    <td className="n">{fmtN(l.feed_kg)}</td><td className="n">{b.ft === 'layer' ? fmtN(l.eggs) : (l.avg_w ?? '—')}</td><td className="n">{l.tmax ?? '—'}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Batch economics</div>
        <div className="kv">
          <div>Chick cost</div><div>{fmtL(b.doc * b.doc_rate)} (₹{b.doc_rate}/chick)</div>
          <div>Bills booked</div><div>{fmtL(t.bills.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0))}</div>
          <div>Revenue booked</div><div>{fmtL(t.invoices.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0))}</div>
          {cpe != null && (<>
            <div>Cost per egg (est.)</div><div>₹{cpe.toFixed(2)}</div>
            <div>Margin / egg @ NECC</div><div className={eggR - cpe > 0 ? 'up' : 'down'}>₹{(eggR - cpe).toFixed(2)}</div>
          </>)}
          {b.ft === 'broiler' && k.last?.avg_w && (<>
            <div>Est. live weight</div><div>{fmtN((k.alive * k.last.avg_w) / 1000)} kg</div>
            <div>Value @ ₹{brR}/kg</div><div>{fmtL(((k.alive * k.last.avg_w) / 1000) * brR)}</div>
          </>)}
        </div>
      </div>
      {b.state !== 'closed' && <ActBtn act="closeBatch" className="btn secondary">Close batch (lifting / cull)</ActBtn>}
    </>
  );
}
