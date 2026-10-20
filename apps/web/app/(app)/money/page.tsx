// Port of demo/index.html moneyScreen (:403-420). View chosen by ?view=overview|ap|ar|pnl|rates.
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { ageing, batchKpi, costPerEgg, rate, tenantKpi, type Ageing } from '@/lib/kpi';
import { dateFmt, daysBetween, fmtL, fmtN, monthFmt } from '@/lib/format';
import { Chips, Header, Live, RagPill, StatusPill } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { LineChart } from '@/components/charts/LineChart';
import type { Rate } from '@/lib/view/types';

const dOnly = (s: string) => s.slice(5).replace('-', '/');
const AGE_COL: Record<keyof Ageing, string> = { 'Not due': 'var(--good)', '1–30': 'var(--warn)', '31–60': 'var(--crit)', '60+': 'var(--ink)' };

function AgeBar({ b, notDue }: { b: Ageing; notDue: string }) {
  const tot = Object.values(b).reduce((a, x) => a + x, 0) || 1;
  const entries = Object.entries(b) as [keyof Ageing, number][];
  const label = (k: keyof Ageing) => (k === 'Not due' ? notDue : k);
  return (
    <>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
        {entries.map(([k, v]) => <i key={k} style={{ flex: v / tot, background: AGE_COL[k], display: 'block' }} title={`${label(k)}: ${fmtL(v)}`} />)}
      </div>
      <div className="row wrap" style={{ gap: '6px 12px', marginTop: 6, fontSize: 11 }}>
        {entries.map(([k, v]) => <span key={k}><span className="dot" style={{ background: AGE_COL[k] }} /> {label(k)} <b className="mono">{fmtL(v)}</b></span>)}
      </div>
    </>
  );
}

function RateCard({ s, label, fmt, dmy }: { s: Rate[]; label: string; fmt: 'inr0' | 'inr1' | 'inr2'; dmy: (d: string) => string }) {
  if (!s.length) return null;
  const f = { inr0: (x: number) => '₹' + Math.round(x), inr1: (x: number) => '₹' + x.toFixed(1), inr2: (x: number) => '₹' + x.toFixed(2) }[fmt];
  const ticks = [0, Math.floor((s.length - 1) / 2), s.length - 1];
  return (
    <div className="card">
      <div className="row between"><div className="eyebrow">{label}</div><b>{f(s[s.length - 1].rate)}</b></div>
      <LineChart fmt={fmt} series={[{ name: label, data: s.map((r) => r.rate), color: 'var(--accent)' }]}
        xlabels={ticks.map((i) => [i, dmy(s[i].date)] as [number, string])} vals={s.map((r) => f(r.rate) + ' · ' + dOnly(r.date))} />
    </div>
  );
}

export default async function Money({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const view = (await searchParams).view ?? 'overview';
  const [v, t, locale] = await Promise.all([loadView(), getTranslations(), getLocale()]);
  const dmy = dateFmt(locale);
  const { t: tn, today } = v;
  const K = tenantKpi(tn, today);
  const chips = (
    <Chips active={view} items={[
      ['/money', 'overview', t('money.overview')], ['/money?view=ap', 'ap', t('money.payables')], ['/money?view=ar', 'ar', t('money.receivables')],
      ['/money?view=pnl', 'pnl', t('money.pnl')], ['/money?view=rates', 'rates', t('money.rates')],
    ]} />
  );
  const open = <T extends { status: string; due: string }>(xs: T[]) => xs.filter((x) => x.status !== 'paid').sort((a, b) => a.due.localeCompare(b.due));

  if (view === 'ap')
    return (
      <>
        <Header title={t('money.payables')} action={<ActBtn act="addBill" className="btn small">{t('money.addBill')}</ActBtn>} />
        {chips}
        <div className="card"><AgeBar b={ageing(tn.bills, today)} notDue={t('money.notDue')} /></div>
        <div className="card"><div className="list">
          {open(tn.bills).map((b) => (
            <div className="item" key={b.id}>
              <div><div className="t">{b.vendor}</div><div className="s">{b.no} · {b.category} · {t('common.due', { date: dmy(b.due) })}{b.batch ? ' · ' + b.batch : ''}</div></div>
              <div className="r"><div className="t">{fmtL(b.total - b.paid)}</div><StatusPill s={b.status} /><div><ActBtn act="payOpen" ctx={{ kind: 'bill', id: b.id }} className="btn small secondary" style={{ marginTop: 4 }}>{t('money.pay')}</ActBtn></div></div>
            </div>
          ))}
          {!open(tn.bills).length && <div className="s">{t('money.nothingOutstanding')}</div>}
        </div></div>
      </>
    );

  if (view === 'ar')
    return (
      <>
        <Header title={t('money.receivables')} action={<ActBtn act="saleOpen" className="btn small">{t('money.addSale')}</ActBtn>} />
        {chips}
        <div className="card"><AgeBar b={ageing(tn.invoices, today)} notDue={t('money.notDue')} /></div>
        <div className="card"><div className="list">
          {open(tn.invoices).map((b) => (
            <div className="item" key={b.id}>
              <div><div className="t">{b.customer}</div><div className="s">{b.no} · {fmtN(b.qty)} {b.unit} @ ₹{b.rate} · {t('common.due', { date: dmy(b.due) })}</div></div>
              <div className="r"><div className="t">{fmtL(b.total - b.paid)}</div><StatusPill s={b.status} /><div><ActBtn act="payOpen" ctx={{ kind: 'invoice', id: b.id }} className="btn small secondary" style={{ marginTop: 4 }}>{t('money.receive')}</ActBtn></div></div>
            </div>
          ))}
          {!open(tn.invoices).length && <div className="s">{t('money.nothingOutstanding')}</div>}
        </div></div>
        <ActBtn act="remind" className="btn secondary">{t('money.remind', { amt: fmtL(K.arOver) })}</ActBtn>
      </>
    );

  if (view === 'rates')
    return (
      <>
        <Header title={t('money.ratesTitle')} action={<ActBtn act="addRate" className="btn small">{t('money.addRate')}</ActBtn>} />
        {chips}
        <RateCard s={v.rates.egg} label={t('money.rEgg')} fmt="inr2" dmy={dmy} />
        <RateCard s={v.rates.broiler_farmgate} label={t('money.rBroiler')} fmt="inr0" dmy={dmy} />
        <RateCard s={v.rates.maize} label={t('money.rMaize')} fmt="inr1" dmy={dmy} />
        <RateCard s={v.rates.soya} label={t('money.rSoya')} fmt="inr1" dmy={dmy} />
      </>
    );

  if (view === 'pnl')
    return (
      <>
        <Header title={t('money.pnl')} />
        {chips}
        {tn.batches.length ? tn.batches.map((b) => {
          const k = batchKpi(b);
          const bills = tn.bills.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
          const rev = tn.invoices.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
          const chick = b.doc * b.doc_rate;
          const liveVal = b.ft === 'broiler' && k.last?.avg_w && b.state !== 'closed' ? ((k.alive * k.last.avg_w) / 1000) * rate(v, 'broiler_farmgate') : 0;
          const margin = rev + liveVal - chick - bills;
          const cpe = b.ft === 'layer' && k.eggs ? costPerEgg(b) : null;
          return (
            <div className="card" key={b.id}>
              <div className="row between">
                <div><div className="t" style={{ fontWeight: 700 }}>{b.code}</div><div className="s">{b.shed_name} · {t(`state.${b.state}`)}</div></div>
                <RagPill rag={k.rag} />
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <div>{t('money.chickBills')}</div><div>{fmtL(chick + bills)}</div>
                <div>{t('money.revenue')}</div><div>{fmtL(rev)}</div>
                {liveVal > 0 && (<><div>{t('money.liveInv')}</div><div>{fmtL(liveVal)}</div></>)}
                <div><b>{b.state === 'closed' ? t('money.result') : t('money.running')}</b></div><div className={margin >= 0 ? 'up' : 'down'}><b>{fmtL(margin)}</b></div>
                {cpe != null && (<><div>{t('money.costEgg')}</div><div>₹{cpe.toFixed(2)}</div></>)}
                {k.fcr != null && (<><div>{t('money.fcr')}</div><div>{k.fcr.toFixed(2)}</div></>)}
              </div>
            </div>
          );
        }) : <div className="card s">{t('money.noBatches')}</div>}
      </>
    );

  const recent30 = <T extends { date: string }>(xs: T[]) => xs.filter((i) => daysBetween(i.date, today) <= 30);
  const spend: Record<string, number> = {};
  tn.bills.forEach((b) => (spend[b.category] = (spend[b.category] ?? 0) + b.total));
  const spendTot = Object.values(spend).reduce((a, b) => a + b, 0) || 1;
  const recent = [...tn.invoices.map((i) => ({ ...i, kind: 'inv' as const, party: i.customer })), ...tn.bills.map((b) => ({ ...b, kind: 'bill' as const, party: b.vendor }))]
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <>
      <Header title={t('money.title')} action={<Live />} />
      {chips}
      <div className="grid2">
        <Link className="tile" href="/money?view=ap"><div className="lbl">{t('money.ap')}</div><div className="val">{fmtL(K.ap)}</div><div className={`delta ${K.apDue7 ? 'down' : 'flat'}`}>{t('money.dueIn7', { amt: fmtL(K.apDue7) })}</div></Link>
        <Link className="tile" href="/money?view=ar"><div className="lbl">{t('money.ar')}</div><div className="val">{fmtL(K.ar)}</div><div className={`delta ${K.arOver ? 'down' : 'flat'}`}>{t('money.overdue', { amt: fmtL(K.arOver) })}</div></Link>
        <div className="tile"><div className="lbl">{t('money.collected30')}</div><div className="val">{fmtL(recent30(tn.invoices).reduce((a, i) => a + i.paid, 0))}</div><div className="delta flat">{t('money.nInvoices', { n: recent30(tn.invoices).length })}</div></div>
        <div className="tile"><div className="lbl">{t('money.paid30')}</div><div className="val">{fmtL(recent30(tn.bills).reduce((a, i) => a + i.paid, 0))}</div><div className="delta flat">{t('money.nBills', { n: recent30(tn.bills).length })}</div></div>
      </div>
      <div className="quick">
        {([['saleOpen', '🧾', 'newSale'], ['addBill', '🧮', 'newBill'], ['payQuick', '💸', 'payment'], ['addCustomer', '🤝', 'customer']] as const).map(([a, i, l]) => (
          <ActBtn key={a} act={a}><span>{i}</span>{t(`money.${l}`)}</ActBtn>
        ))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('money.spendByCat')}</div>
        {Object.entries(spend).sort((a, b) => b[1] - a[1]).map(([k, x]) => (
          <div className="row" key={k} style={{ fontSize: 12.5, padding: '3px 0' }}>
            <span style={{ width: 84 }}>{t.has(`billCat.${k}`) ? t(`billCat.${k}`) : k}</span>
            <div className="bar" style={{ flex: 1, height: 8 }}><i style={{ width: `${(100 * x) / spendTot}%`, background: 'var(--series2)' }} /></div>
            <b className="mono" style={{ width: 70, textAlign: 'right' }}>{fmtL(x)}</b>
          </div>
        ))}
        {!tn.bills.length && <div className="s">{t('money.noBills')}</div>}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('money.recent')}</div>
        <div className="list">
          {recent.map((b) => (
            <div className="item" key={b.kind + b.id}>
              <div><div className="t">{b.kind === 'inv' ? '↙ ' : '↗ '}{b.party}</div><div className="s">{b.no} · {dmy(b.date)}</div></div>
              <div className="r"><div className="t">{fmtL(b.total)}</div><StatusPill s={b.status} /></div>
            </div>
          ))}
          {!recent.length && <div className="s">{t('money.noTx')}</div>}
        </div>
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('money.exports')}</div>
        <div className="row wrap">
          <ActBtn act="tally" className="btn small secondary">{t('money.tally', { month: monthFmt(locale)(today) })}</ActBtn>
          <ActBtn act="gstr" className="btn small secondary">{t('money.gstr')}</ActBtn>
          <ActBtn act="stmt" className="btn small secondary">{t('money.statements')}</ActBtn>
        </div>
      </div>
    </>
  );
}
