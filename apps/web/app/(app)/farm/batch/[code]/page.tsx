// Port of demo/index.html batchScreen (:342-370).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { batchKpi, costPerEgg, rate, stdEggPct, stdWeight } from '@/lib/kpi';
import { dateFmt, daysBetween, fmtL, fmtN } from '@/lib/format';
import { Back, RagPill } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { LineChart } from '@/components/charts/LineChart';
import { BarChart } from '@/components/charts/BarChart';

const dOnly = (s: string) => s.slice(5).replace('-', '/');

export default async function BatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [v, t, locale] = await Promise.all([loadView(), getTranslations(), getLocale()]);
  const dmy = dateFmt(locale);
  const { t: tn, today } = v;
  const b = tn.batches.find((x) => x.code === decodeURIComponent(code));
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
          series={[{ name: t('batch.actualHenDay'), data: actual, color: 'var(--accent)' }, { name: t('batch.breedStd'), data: std, color: 'var(--series2)', dash: true }]}
          xlabels={[[0, t('common.week', { n: wk(0) })], [mid, t('common.week', { n: wk(mid) })], [logs.length - 1, t('common.week', { n: wk(logs.length - 1) })]]}
          ylim={a.length && s.length ? [Math.min(...a) - 4, Math.max(...s) + 2] : undefined}
          vals={actual.map((x, i) => x + '% · ' + dOnly(logs[i].date))} />
        <div className="legend"><span><i />{t('batch.actualHenDay')}</span><span><i className="std" />{t('batch.breedStd')}</span></div>
      </>
    );
  } else if (b.ft === 'broiler' && logs.length) {
    const actual = logs.map((l) => l.avg_w);
    chart = (
      <>
        <LineChart fmt="kg"
          series={[{ name: t('batch.avgWeight'), data: actual, color: 'var(--accent)' }, { name: t('batch.breedStd'), data: logs.map((l) => stdWeight(b, l.day)), color: 'var(--series2)', dash: true }]}
          xlabels={[[0, t('common.day', { n: logs[0].day })], [mid, t('common.day', { n: logs[mid].day })], [logs.length - 1, t('common.day', { n: logs[logs.length - 1].day })]]}
          vals={actual.map((x, i) => x + ' g · ' + t('common.day', { n: logs[i].day }))} />
        <div className="legend"><span><i />{t('batch.avgWeight')}</span><span><i className="std" />{t('batch.breedStd')}</span></div>
      </>
    );
  }

  const mort = logs.map((l) => l.mortality);
  const cases = tn.disease_cases.filter((c) => c.batch === b.code);
  const visits = tn.vet_visits.filter((x) => x.batch === b.code);
  const spikeDay = (m: number) => m > k.mb * 1.8 && m > 5;
  const cpe = b.ft === 'layer' && k.eggs ? costPerEgg(b) : null;
  const eggR = rate(v, 'egg'), brR = rate(v, 'broiler_farmgate');
  const nextVacc = b.vacc.find((x) => !x.done);
  const quickCtx: Record<string, Record<string, string>> = {
    mort: { batch: b.id }, addVisit: { batch: b.id }, batchState: { batch: b.id },
    vaccDone: nextVacc ? { vacc: nextVacc.id, name: nextVacc.name } : { batch: b.id },
  };

  return (
    <>
      <Back href="/farm" />
      <div className="row between">
        <div><div className="eyebrow">{b.farm_name} · {b.shed_name}</div><div className="h2">{b.code}</div></div>
        <RagPill rag={k.rag} />
      </div>
      {b.state !== 'closed' && (
        <div className="quick">
          {([['mort', '☠️', 'home.qMortality'], ['vaccDone', '💉', 'batch.vaccinate'], ['addVisit', '🩺', 'batch.vetVisit'], ['batchState', '🔁', 'batch.stateBtn']] as const).map(([a, i, l]) => (
            <ActBtn key={a} act={a} ctx={quickCtx[a]}><span>{i}</span>{t(l)}</ActBtn>
          ))}
        </div>
      )}
      <div className="grid3">
        <div className="tile"><div className="lbl">{hatch ? t('batch.eggsSet') : t('batch.birds')}</div><div className="val" style={{ fontSize: 18 }}>{fmtN(k.alive)}</div><div className="delta flat">{t('batch.of', { n: fmtN(b.doc) })}</div></div>
        <div className="tile">
          <div className="lbl">{t('batch.age')}</div>
          <div className="val" style={{ fontSize: 18 }}>{b.ft === 'layer' ? t('common.week', { n: Math.floor(b.age / 7) }) : t('common.day', { n: b.age })}</div>
          <div className="delta flat">{t(`state.${b.state}`)}</div>
        </div>
        <div className="tile">
          <div className="lbl">{t('batch.mortality')}</div><div className="val" style={{ fontSize: 18 }}>{k.mortPct.toFixed(2)}%</div>
          <div className={`delta ${k.rag === 'crit' ? 'down' : 'flat'}`}>{t('batch.perDay7', { n: k.m7.toFixed(1) })}</div>
        </div>
      </div>

      {chart && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div className="eyebrow">{b.ft === 'layer' ? t('batch.prodVsStd') : t('batch.growthVsStd')}</div>
            <span className="s">{b.ft === 'layer' ? t('batch.todayStd', { pct: k.eggPct.toFixed(1), std: k.std ?? '—' }) : t('batch.fcr', { fcr: k.fcr ? k.fcr.toFixed(2) : '—' })}</span>
          </div>
          {chart}
        </div>
      )}

      {!hatch && mort.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 4 }}>
            <div className="eyebrow">{t('batch.dailyMort', { n: mort.length })}</div><span className="s">{t('batch.baseline', { n: k.mb.toFixed(1) })}</span>
          </div>
          <BarChart vals={mort} hl={mort.map(spikeDay)} xlabels={[[0, dOnly(logs[0].date)], [mort.length - 1, dOnly(logs[mort.length - 1].date)]]} />
        </div>
      )}

      {cases.length > 0 && (
        <div className="card stripe crit">
          <div className="row between">
            <div className="eyebrow">{t('batch.aiFlag')}</div>
            {!cases[0].vet_confirmed && <ActBtn act="confirmCase" className="btn small secondary">{t('batch.vetConfirm')}</ActBtn>}
          </div>
          {cases.map((c) => (
            <div key={c.id}>
              <div className="t">{c.disease} · {Math.round(c.confidence * 100)}% {c.vet_confirmed ? <span className="pill good">{t('batch.vetConfirmed')}</span> : <span className="pill warn">{t('batch.awaitingVet')}</span>}</div>
              <div className="s">{c.notes}</div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('batch.vetVisits')}</div><ActBtn act="addVisit" ctx={{ batch: b.id }} className="btn small">{t('batch.addVisit')}</ActBtn></div>
        <div className="list">
          {visits.length ? visits.map((x, i) => (
            <div className="item" key={i}><div>
              <div className="t">{x.vet} · {dmy(x.date)}</div>
              <div className="s"><b>{t('batch.findings')}</b> {x.findings}</div>
              <div className="s"><b>{t('batch.rx')}</b> {x.prescription}</div>
            </div></div>
          )) : <div className="s">{t('common.none')}</div>}
        </div>
      </div>

      {!hatch && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('batch.vaccSchedule')}</div><ActBtn act="addVacc" className="btn small">{t('common.add')}</ActBtn></div>
          <div className="list">
            {b.vacc.map((x) => {
              const od = !x.done && daysBetween(x.due, today) > 0;
              return (
                <div className="item" key={x.id}>
                  <div><div className="t">{x.name}</div><div className="s">{t('common.due', { date: dmy(x.due) })}{x.done ? t('batch.doneOn', { date: dmy(x.done) }) : ''}</div></div>
                  <div className="r">{x.done ? <span className="pill good">{t('common.done')}</span> : <ActBtn act="vaccDone" ctx={{ vacc: x.id, name: x.name }} className={`btn small ${od ? '' : 'secondary'}`}>{od ? t('common.overdueMark') : t('common.markDone')}</ActBtn>}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hatch && k.logs.length > 0 && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('batch.last7')}</div><Link className="back" href={`/log?batch=${b.code}`}>{t('batch.logToday')} ›</Link></div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>{t('batch.colDate')}</th><th className="n">{t('batch.colBirds')}</th><th className="n">{t('batch.colDead')}</th><th className="n">{t('batch.colFeed')}</th><th className="n">{b.ft === 'layer' ? t('batch.colEggs') : t('batch.colWt')}</th><th className="n">{t('batch.colTmax')}</th></tr></thead>
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
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('batch.economics')}</div>
        <div className="kv">
          <div>{t('batch.chickCost')}</div><div>{fmtL(b.doc * b.doc_rate)} {t('batch.perChick', { rate: b.doc_rate })}</div>
          <div>{t('batch.billsBooked')}</div><div>{fmtL(tn.bills.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0))}</div>
          <div>{t('batch.revenueBooked')}</div><div>{fmtL(tn.invoices.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0))}</div>
          {cpe != null && (<>
            <div>{t('batch.costPerEgg')}</div><div>₹{cpe.toFixed(2)}</div>
            <div>{t('batch.marginEgg')}</div><div className={eggR - cpe > 0 ? 'up' : 'down'}>₹{(eggR - cpe).toFixed(2)}</div>
          </>)}
          {b.ft === 'broiler' && k.last?.avg_w && (<>
            <div>{t('batch.liveWeight')}</div><div>{fmtN((k.alive * k.last.avg_w) / 1000)} kg</div>
            <div>{t('batch.valueAt', { rate: brR })}</div><div>{fmtL(((k.alive * k.last.avg_w) / 1000) * brR)}</div>
          </>)}
        </div>
      </div>
      {b.state !== 'closed' && <ActBtn act="closeBatch" className="btn secondary">{t('batch.closeBatch')}</ActBtn>}
    </>
  );
}
