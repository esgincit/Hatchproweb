// Port of demo/index.html homeScreen (:303-333).
import Link from 'next/link';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi, costPerEgg, rate, tenantKpi, attGet } from '@/lib/kpi';
import { daysBetween, fmtL, fmtN } from '@/lib/format';
import { Header, Live, RagPill, sevStripe, stateLabel } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { Spark } from '@/components/charts/BarChart';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const v = await loadView(await currentMode());
  const { t, today } = v;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const me = t.users.find((u) => u.id === user?.id) ?? t.users[0];
  const first = (me?.name ?? '').split(' ')[0];
  const K = tenantKpi(t, today);
  const eggR = rate(v, 'egg'), brR = rate(v, 'broiler_farmgate'), brR7 = rate(v, 'broiler_farmgate', 7);

  if (!t.batches.length)
    return (
      <>
        <Header title={`Welcome, ${first}`} action={<Live />} />
        <div className="card" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
          <div className="t" style={{ fontWeight: 700 }}>Set up {t.name}</div>
          <div className="s" style={{ marginBottom: 8 }}>5 steps · about 10 minutes.</div>
          {[['Add your first farm', 'addFarm'], ['Add sheds & capacity', 'addShedPick'], ['Place a batch', 'addBatch'], ['Invite supervisors', 'inviteUser'], ['Add vendors & traders', 'addVendor']].map(([a, g], i) => (
            <ActBtn key={g} act={g} className="item" style={{ padding: '8px 0' }}>
              <span className="pill neutral" style={{ width: 26, justifyContent: 'center' }}>{i + 1}</span>
              <div className="t">{a}</div>
              <div className="r">›</div>
            </ActBtn>
          ))}
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Live market rates</div>
          <div className="kv"><div>NECC egg · Hyderabad</div><div>₹{eggR.toFixed(2)}</div><div>Broiler farm-gate</div><div>₹{brR}/kg</div></div>
        </div>
      </>
    );

  const layer = t.batches.find((b) => b.ft === 'layer' && b.state === 'laying');
  const isBroiler = !layer;
  const brB = t.batches.find((b) => b.ft === 'broiler' && b.state !== 'closed');
  const brK = brB ? batchKpi(brB) : null;
  const cpe = layer ? costPerEgg(layer) : null;
  const eggDelta = K.eggsToday - K.eggsYest;
  const vaccDue = t.batches.flatMap((b) => b.vacc.filter((x) => !x.done && daysBetween(today, x.due) <= 7)).length;
  const spike = K.act.find((x) => x.k.rag === 'crit');

  return (
    <>
      <Header title={`Good morning, ${first}`} action={<Live />} />
      <div className="quick">
        {[['mort', '☠️', 'Mortality'], ['saleOpen', '🧾', 'Sale'], ['payQuick', '💸', 'Payment'], ['attToday', '👷', 'Attendance']].map(([a, i, l]) => (
          <ActBtn key={a} act={a}><span>{i}</span>{l}</ActBtn>
        ))}
      </div>
      <div className="grid2">
        <div className="tile"><div className="lbl">Birds alive</div><div className="val">{fmtN(K.birds)}</div><div className="delta flat">{K.act.length} active batches</div></div>
        {isBroiler ? (
          <div className="tile">
            <div className="lbl">Avg weight · {brB?.code.slice(-5) ?? ''}</div>
            <div className="val">{brK?.last?.avg_w ? (brK.last.avg_w / 1000).toFixed(2) + ' kg' : '—'}</div>
            <div className="delta flat">FCR {brK?.fcr ? brK.fcr.toFixed(2) : '—'} · day {brB?.age ?? '—'}</div>
          </div>
        ) : (
          <div className="tile">
            <div className="lbl">Eggs today</div><div className="val">{fmtN(K.eggsToday)}</div>
            <div className={`delta ${eggDelta >= 0 ? 'up' : 'down'}`}>{eggDelta >= 0 ? '▲' : '▼'} {fmtN(Math.abs(eggDelta))} vs yesterday</div>
          </div>
        )}
        {isBroiler ? (
          <div className="tile">
            <div className="lbl">Broiler farm-gate</div>
            <div className="val">₹{brR}<span style={{ fontSize: 13, fontWeight: 600 }}>/kg</span></div>
            <div className={`delta ${brR >= brR7 ? 'up' : 'down'}`}>{brR >= brR7 ? '▲' : '▼'} ₹{Math.abs(brR - brR7)} vs last week</div>
          </div>
        ) : (
          <div className="tile">
            <div className="lbl">Margin / egg (NECC Hyd)</div>
            <div className="val">{cpe == null ? '—' : `₹${(eggR - cpe).toFixed(2)}`}</div>
            <div className="delta flat">rate ₹{eggR.toFixed(2)} − cost ₹{cpe?.toFixed(2) ?? '—'}</div>
          </div>
        )}
        <div className="tile">
          <div className="lbl">Mortality today</div><div className="val">{K.mortToday}</div>
          <div className={`delta ${spike ? 'down' : 'flat'}`}>{spike ? 'spike in ' + spike.b.shed_name : 'within baseline'}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">Needs attention</div>
          <Link className="back" href="/more/notifications">All {t.notifications.length} ›</Link>
        </div>
        <div className="list">
          {t.notifications.slice(0, 3).map((n) => (
            <div key={n.id} className={`item stripe ${sevStripe(n.severity)}`}><div><div className="t">{n.title}</div><div className="s">{n.body}</div></div></div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Today</div>
        <div className="kv">
          <div>Daily logs</div><div>{K.act.filter((x) => x.k.last?.date === today).length} of {K.act.filter((x) => x.b.ft !== 'hatchery').length} sheds done</div>
          <div>Vaccinations this week</div><div>{vaccDue}</div>
          <div>Bills due in 7 days</div><div>{fmtL(K.apDue7)}</div>
          <div>Overdue from traders</div><div className={K.arOver ? 'down' : ''}>{fmtL(K.arOver)}</div>
          <div>Workers present</div><div>{t.workers.filter((w) => attGet(t, w.id, today, today) === 'P').length} of {t.workers.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">Live market rates</div>
          <Link className="back" href="/money?view=rates">Trend ›</Link>
        </div>
        <div className="list">
          <div className="item"><div><div className="t">NECC egg · Hyderabad</div><div className="s">per egg</div></div>
            <div className="r"><Spark vals={v.rates.egg.slice(-14).map((r) => r.rate)} /><div className="t">₹{eggR.toFixed(2)}</div></div></div>
          <div className="item"><div><div className="t">Broiler farm-gate</div><div className="s">per kg live</div></div>
            <div className="r"><Spark vals={v.rates.broiler_farmgate.slice(-14).map((r) => r.rate)} color="var(--series2)" /><div className="t">₹{brR}</div></div></div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">Batches</div>
          <ActBtn act="addBatch" className="btn small">+ Place batch</ActBtn>
        </div>
        <div className="list">
          {t.batches.map((b) => {
            const k = batchKpi(b);
            return (
              <Link key={b.id} className="item" href={`/farm/batch/${b.code}`}>
                <span className="dot" style={{ background: `var(--${k.rag === 'neutral' ? 'muted' : k.rag})`, marginTop: 6 }} />
                <div>
                  <div className="t">{b.code} · {b.shed_name}</div>
                  <div className="s">{b.ft === 'hatchery' ? 'Setter' : stateLabel(b.state)} · {b.state === 'closed' ? 'closed' : 'day ' + b.age} · {fmtN(k.alive)} birds</div>
                </div>
                <div className="r"><RagPill rag={k.rag} /></div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
