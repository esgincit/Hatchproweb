// Port of demo/index.html moneyScreen (:403-420). View chosen by ?view=overview|ap|ar|pnl|rates.
import Link from 'next/link';
import { loadView } from '@/lib/view/load';
import { ageing, batchKpi, costPerEgg, rate, tenantKpi, type Ageing } from '@/lib/kpi';
import { daysBetween, dmy, fmtL, fmtN } from '@/lib/format';
import { Chips, Header, Live, RagPill, StatusPill, stateLabel } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { LineChart } from '@/components/charts/LineChart';
import type { Rate } from '@/lib/view/types';

const dOnly = (s: string) => s.slice(5).replace('-', '/');
const AGE_COL: Record<keyof Ageing, string> = { 'Not due': 'var(--good)', '1–30': 'var(--warn)', '31–60': 'var(--crit)', '60+': 'var(--ink)' };

function AgeBar({ b }: { b: Ageing }) {
  const tot = Object.values(b).reduce((a, x) => a + x, 0) || 1;
  const entries = Object.entries(b) as [keyof Ageing, number][];
  return (
    <>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
        {entries.map(([k, v]) => <i key={k} style={{ flex: v / tot, background: AGE_COL[k], display: 'block' }} title={`${k}: ${fmtL(v)}`} />)}
      </div>
      <div className="row wrap" style={{ gap: '6px 12px', marginTop: 6, fontSize: 11 }}>
        {entries.map(([k, v]) => <span key={k}><span className="dot" style={{ background: AGE_COL[k] }} /> {k} <b className="mono">{fmtL(v)}</b></span>)}
      </div>
    </>
  );
}

function RateCard({ s, label, fmt }: { s: Rate[]; label: string; fmt: 'inr0' | 'inr1' | 'inr2' }) {
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
  const v = await loadView();
  const { t, today } = v;
  const K = tenantKpi(t, today);
  const chips = (
    <Chips active={view} items={[['/money', 'overview', 'Overview'], ['/money?view=ap', 'ap', 'Payables'], ['/money?view=ar', 'ar', 'Receivables'], ['/money?view=pnl', 'pnl', 'Batch P&L'], ['/money?view=rates', 'rates', 'Rates']]} />
  );
  const open = <T extends { status: string; due: string }>(xs: T[]) => xs.filter((x) => x.status !== 'paid').sort((a, b) => a.due.localeCompare(b.due));

  if (view === 'ap')
    return (
      <>
        <Header title="Payables" action={<ActBtn act="addBill" className="btn small">+ Bill / expense</ActBtn>} />
        {chips}
        <div className="card"><AgeBar b={ageing(t.bills, today)} /></div>
        <div className="card"><div className="list">
          {open(t.bills).map((b) => (
            <div className="item" key={b.id}>
              <div><div className="t">{b.vendor}</div><div className="s">{b.no} · {b.category} · due {dmy(b.due)}{b.batch ? ' · ' + b.batch : ''}</div></div>
              <div className="r"><div className="t">{fmtL(b.total - b.paid)}</div><StatusPill s={b.status} /><div><ActBtn act="payOpen" className="btn small secondary" style={{ marginTop: 4 }}>Pay</ActBtn></div></div>
            </div>
          ))}
          {!open(t.bills).length && <div className="s">Nothing outstanding.</div>}
        </div></div>
      </>
    );

  if (view === 'ar')
    return (
      <>
        <Header title="Receivables" action={<ActBtn act="saleOpen" className="btn small">+ New sale</ActBtn>} />
        {chips}
        <div className="card"><AgeBar b={ageing(t.invoices, today)} /></div>
        <div className="card"><div className="list">
          {open(t.invoices).map((b) => (
            <div className="item" key={b.id}>
              <div><div className="t">{b.customer}</div><div className="s">{b.no} · {fmtN(b.qty)} {b.unit} @ ₹{b.rate} · due {dmy(b.due)}</div></div>
              <div className="r"><div className="t">{fmtL(b.total - b.paid)}</div><StatusPill s={b.status} /><div><ActBtn act="payOpen" className="btn small secondary" style={{ marginTop: 4 }}>Receive</ActBtn></div></div>
            </div>
          ))}
          {!open(t.invoices).length && <div className="s">Nothing outstanding.</div>}
        </div></div>
        <ActBtn act="remind" className="btn secondary">WhatsApp reminders for {fmtL(K.arOver)} overdue</ActBtn>
      </>
    );

  if (view === 'rates')
    return (
      <>
        <Header title="Market rates · 60 days" action={<ActBtn act="addRate" className="btn small">+ Local rate</ActBtn>} />
        {chips}
        <RateCard s={v.rates.egg} label="NECC egg · Hyderabad" fmt="inr2" />
        <RateCard s={v.rates.broiler_farmgate} label="Broiler farm-gate · Telangana" fmt="inr0" />
        <RateCard s={v.rates.maize} label="Maize · yellow" fmt="inr1" />
        <RateCard s={v.rates.soya} label="Soya DOC 46%" fmt="inr1" />
      </>
    );

  if (view === 'pnl')
    return (
      <>
        <Header title="Batch P&L" />
        {chips}
        {t.batches.length ? t.batches.map((b) => {
          const k = batchKpi(b);
          const bills = t.bills.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
          const rev = t.invoices.filter((x) => x.batch === b.code).reduce((a, x) => a + x.total, 0);
          const chick = b.doc * b.doc_rate;
          const liveVal = b.ft === 'broiler' && k.last?.avg_w && b.state !== 'closed' ? ((k.alive * k.last.avg_w) / 1000) * rate(v, 'broiler_farmgate') : 0;
          const margin = rev + liveVal - chick - bills;
          const cpe = b.ft === 'layer' && k.eggs ? costPerEgg(b) : null;
          return (
            <div className="card" key={b.id}>
              <div className="row between">
                <div><div className="t" style={{ fontWeight: 700 }}>{b.code}</div><div className="s">{b.shed_name} · {stateLabel(b.state)}</div></div>
                <RagPill rag={k.rag} />
              </div>
              <div className="kv" style={{ marginTop: 8 }}>
                <div>Chick + bills</div><div>{fmtL(chick + bills)}</div>
                <div>Revenue</div><div>{fmtL(rev)}</div>
                {liveVal > 0 && (<><div>Live inventory @ market</div><div>{fmtL(liveVal)}</div></>)}
                <div><b>{b.state === 'closed' ? 'Result' : 'Running margin'}</b></div><div className={margin >= 0 ? 'up' : 'down'}><b>{fmtL(margin)}</b></div>
                {cpe != null && (<><div>Cost / egg</div><div>₹{cpe.toFixed(2)}</div></>)}
                {k.fcr != null && (<><div>FCR</div><div>{k.fcr.toFixed(2)}</div></>)}
              </div>
            </div>
          );
        }) : <div className="card s">No batches yet.</div>}
      </>
    );

  const recent30 = <T extends { date: string }>(xs: T[]) => xs.filter((i) => daysBetween(i.date, today) <= 30);
  const spend: Record<string, number> = {};
  t.bills.forEach((b) => (spend[b.category] = (spend[b.category] ?? 0) + b.total));
  const spendTot = Object.values(spend).reduce((a, b) => a + b, 0) || 1;
  const recent = [...t.invoices.map((i) => ({ ...i, kind: 'inv' as const, party: i.customer })), ...t.bills.map((b) => ({ ...b, kind: 'bill' as const, party: b.vendor }))]
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  return (
    <>
      <Header title="Money" action={<Live />} />
      {chips}
      <div className="grid2">
        <Link className="tile" href="/money?view=ap"><div className="lbl">Payables (AP)</div><div className="val">{fmtL(K.ap)}</div><div className={`delta ${K.apDue7 ? 'down' : 'flat'}`}>{fmtL(K.apDue7)} due in 7 days</div></Link>
        <Link className="tile" href="/money?view=ar"><div className="lbl">Receivables (AR)</div><div className="val">{fmtL(K.ar)}</div><div className={`delta ${K.arOver ? 'down' : 'flat'}`}>{fmtL(K.arOver)} overdue</div></Link>
        <div className="tile"><div className="lbl">Collected · 30 d</div><div className="val">{fmtL(recent30(t.invoices).reduce((a, i) => a + i.paid, 0))}</div><div className="delta flat">{recent30(t.invoices).length} invoices</div></div>
        <div className="tile"><div className="lbl">Paid out · 30 d</div><div className="val">{fmtL(recent30(t.bills).reduce((a, i) => a + i.paid, 0))}</div><div className="delta flat">{recent30(t.bills).length} bills</div></div>
      </div>
      <div className="quick">
        {[['saleOpen', '🧾', 'New sale'], ['addBill', '🧮', 'New bill'], ['payQuick', '💸', 'Payment'], ['addCustomer', '🤝', 'Customer']].map(([a, i, l]) => (
          <ActBtn key={a} act={a}><span>{i}</span>{l}</ActBtn>
        ))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Spend by category</div>
        {Object.entries(spend).sort((a, b) => b[1] - a[1]).map(([k, x]) => (
          <div className="row" key={k} style={{ fontSize: 12.5, padding: '3px 0' }}>
            <span style={{ width: 84, textTransform: 'capitalize' }}>{k}</span>
            <div className="bar" style={{ flex: 1, height: 8 }}><i style={{ width: `${(100 * x) / spendTot}%`, background: 'var(--series2)' }} /></div>
            <b className="mono" style={{ width: 70, textAlign: 'right' }}>{fmtL(x)}</b>
          </div>
        ))}
        {!t.bills.length && <div className="s">No bills yet.</div>}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Recent</div>
        <div className="list">
          {recent.map((b) => (
            <div className="item" key={b.kind + b.id}>
              <div><div className="t">{b.kind === 'inv' ? '↙ ' : '↗ '}{b.party}</div><div className="s">{b.no} · {dmy(b.date)}</div></div>
              <div className="r"><div className="t">{fmtL(b.total)}</div><StatusPill s={b.status} /></div>
            </div>
          ))}
          {!recent.length && <div className="s">No transactions yet.</div>}
        </div>
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Exports &amp; GST</div>
        <div className="row wrap">
          <ActBtn act="tally" className="btn small secondary">Tally XML · {dmy(today).split(' ')[1]}</ActBtn>
          <ActBtn act="gstr" className="btn small secondary">GSTR-1 JSON</ActBtn>
          <ActBtn act="stmt" className="btn small secondary">Statements</ActBtn>
        </div>
      </div>
    </>
  );
}
