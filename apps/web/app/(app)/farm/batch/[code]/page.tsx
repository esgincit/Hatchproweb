// Port of demo/index.html batchScreen (:342-370).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { batchKpi, costPerEgg, hatchKpi, rate, stdEggPct, stdWeight, type BatchKpi } from '@/lib/kpi';
import { settle } from '@/lib/settlement';
import type { Batch, Invoice, Tenant } from '@/lib/view/types';
import { dateFmt, daysBetween, fmtINR, fmtL, fmtN } from '@/lib/format';
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
    mort: { batch: b.id }, addVisit: { batch: b.id }, batchState: { batch: b.id, state: b.state },
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
          {([['mort', '☠️', 'home.qMortality'], ['vaccDone', '💉', 'batch.vaccinate'], ['addVisit', '🩺', 'batch.vetVisit'], ['batchState', '🔁', 'batch.stateBtn']] as const).filter(([a]) => a !== 'vaccDone' || nextVacc) // nothing left to vaccinate: the form has nothing to open, so no dead button
            .map(([a, i, l]) => <ActBtn key={a} act={a} ctx={quickCtx[a]}><span>{i}</span>{t(l)}</ActBtn>)}
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

      {hatch && <HatchCard b={b} invoices={tn.invoices} t={t} dmy={dmy} />}
      {b.ft === 'broiler' && <ContractCard b={b} tn={tn} k={k} t={t} dmy={dmy} />}

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
            {!cases[0].vet_confirmed && <ActBtn act="confirmCase" ctx={{ case: cases[0].id }} className="btn small secondary">{t('batch.vetConfirm')}</ActBtn>}
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
          <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('batch.vaccSchedule')}</div><ActBtn act="addVacc" ctx={{ batch: b.id, ft: b.ft }} className="btn small">{t('common.add')}</ActBtn></div>
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
      {b.state !== 'closed' && <ActBtn act="closeBatch" ctx={{ batch: b.id }} className="btn secondary">{t('batch.closeBatch')}</ActBtn>}
    </>
  );
}

// Contract broiler (0029): integrator terms, a live estimate of the growing charge, then the settlement statement.
function ContractCard({ b, tn, k, t, dmy }: { b: Batch; tn: Tenant; k: BatchKpi; t: Awaited<ReturnType<typeof getTranslations>>; dmy: (s: string) => string }) {
  const c = tn.contracts.find((x) => x.id === b.contract_id);
  if (!c) return b.state !== 'closed' && tn.contracts.length
    ? <ActBtn act="linkContract" ctx={{ batch: b.id }} className="btn secondary">{t('contract.link')}</ActBtn> : null;
  const s = b.settlement;
  const kg = k.last?.avg_w ? Math.round((k.alive * k.last.avg_w) / 1000) : 0;
  const est = s ? null : settle(c, { placed: b.doc, dead: k.dead, liftedBirds: k.alive, liftedKg: kg, feedKg: k.feed });
  const row = (label: string, value: React.ReactNode) => <><div>{label}</div><div>{value}</div></>;
  return (
    <div className="card" data-testid="contract-card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">{t('contract.title', { name: c.customer })}</div>
        <span className={`pill ${s ? 'good' : 'neutral'}`}>{s ? t('contract.settled', { date: dmy(s.settled_on) }) : t('contract.estimate')}</span>
      </div>
      <div className="kv">
        {row(t('contract.terms'), t('contract.termsVal', { rate: c.base_rate.toFixed(2), fcr: c.std_fcr.toFixed(2) }))}
        {s ? <>
          {row(t('contract.lifted'), t('contract.liftedVal', { birds: fmtN(s.lifted_birds), kg: fmtN(s.lifted_kg) }))}
          {row('FCR', s.fcr.toFixed(3))}
          {row(t('contract.rate'), `₹${s.rate.toFixed(2)}/kg`)}
          {row(t('contract.mortCharge'), fmtINR(s.mort_charge))}
          {row(t('contract.net'), <b>{fmtINR(s.net)}</b>)}
          {row(t('contract.invoice'), s.invoice_no ?? '—')}
        </> : est ? <>
          {row(t('contract.lifted'), t('contract.liftedVal', { birds: fmtN(k.alive), kg: fmtN(kg) }))}
          {row('FCR', est.fcr.toFixed(3))}
          {row(t('contract.rate'), `₹${est.rate.toFixed(2)}/kg`)}
          {row(t('contract.mortCharge'), fmtINR(est.mortCharge))}
          {row(t('contract.net'), <b>{fmtINR(est.net)}</b>)}
        </> : row(t('contract.lifted'), t('contract.noWeight'))}
      </div>
      {!s && <ActBtn act="settleContract" ctx={{ batch: b.id, birds: String(k.alive), kg: kg ? String(kg) : '' }} className="btn small" style={{ marginTop: 10 }}>{t('contract.settleBtn')}</ActBtn>}
    </div>
  );
}

// Hatchery setting: set → candle → hatch → dispatch (hatch_record, 0025; dispatch = 'doc' sale of this batch).
function HatchCard({ b, invoices, t, dmy }: { b: Batch; invoices: Invoice[]; t: Awaited<ReturnType<typeof getTranslations>>; dmy: (s: string) => string }) {
  const h = hatchKpi(b, invoices), r = b.hatch;
  const pct = (x: number | null) => (x == null ? '—' : `${x}%`);
  const candled: Record<string, string> = r?.candled_on ? { candled: r.candled_on, clears: String(r.clears), dead: String(r.dead_germ) } : {};
  const hatched: Record<string, string> = r?.hatched_on ? { hatched: r.hatched_on, a: String(r.chicks_a), b: String(r.chicks_b), culls: String(r.culls) } : {};
  return (
    <div className="card" data-testid="hatch-card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">{t('hatch.title')}</div><span className={`pill ${h.stage === 'hatched' ? 'good' : 'neutral'}`}>{t(`hatch.stage.${h.stage}`)}</span>
      </div>
      <div className="kv">
        <div>{t('hatch.set')}</div><div>{fmtN(h.set)} · {dmy(b.placed)}</div>
        {r?.candled_on && <><div>{t('hatch.candled')}</div><div>{dmy(r.candled_on)} · {t('hatch.clearsDead', { c: fmtN(r.clears ?? 0), d: fmtN(r.dead_germ ?? 0) })}</div></>}
        <div>{t('hatch.fertility')}</div><div>{pct(h.fertility)}</div>
        {r?.hatched_on && <><div>{t('hatch.hatched')}</div><div>{dmy(r.hatched_on)} · {fmtN(h.chicks ?? 0)}</div></>}
        <div>{t('hatch.hatchability')}</div><div>{pct(h.hatchability)}</div>
        <div>{t('hatch.hof')}</div><div>{pct(h.hof)}</div>
        <div>{t('hatch.gradeA')}</div><div>{pct(h.gradeA)}</div>
        {h.chicks != null && <><div>{t('hatch.dispatched')}</div><div>{fmtN(h.dispatched)} / {fmtN(h.chicks)}</div></>}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <ActBtn act="hatchCandle" ctx={{ batch: b.id, set: fmtN(h.set), ...candled }} className="btn small secondary">{t('hatch.candleBtn')}</ActBtn>
        <ActBtn act="hatchResult" ctx={{ batch: b.id, ...hatched }} className="btn small secondary">{t('hatch.resultBtn')}</ActBtn>
        {!!h.inStock && h.inStock > 0 && <ActBtn act="saleOpen" ctx={{ batch: b.id, product: 'doc', unit: 'chick', qty: String(h.inStock) }} className="btn small">{t('hatch.dispatchBtn')}</ActBtn>}
      </div>
    </div>
  );
}
