// Port of demo/index.html homeScreen (:303-333).
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi, costPerEgg, rate, tenantKpi, attGet } from '@/lib/kpi';
import { daysBetween, fmtL, fmtN } from '@/lib/format';
import { Header, Live, RagPill, sevStripe } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import { Spark } from '@/components/charts/BarChart';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const [v, t] = await Promise.all([currentMode().then(loadView), getTranslations()]);
  const { t: tn, today } = v;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const me = tn.users.find((u) => u.id === user?.id) ?? tn.users[0];
  const first = (me?.name ?? '').split(' ')[0];
  const K = tenantKpi(tn, today);
  const eggR = rate(v, 'egg'), brR = rate(v, 'broiler_farmgate'), brR7 = rate(v, 'broiler_farmgate', 7);

  if (!tn.batches.length)
    return (
      <>
        <Header title={t('auth.welcomeName', { name: first })} action={<Live />} />
        <div className="card" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
          <div className="t" style={{ fontWeight: 700 }}>{t('home.setUp', { name: tn.name })}</div>
          <div className="s" style={{ marginBottom: 8 }}>{t('home.setupSteps')}</div>
          {(['stepFarm:addFarm', 'stepSheds:addShedPick', 'stepBatch:addBatch', 'stepInvite:inviteUser', 'stepVendors:addVendor'] as const).map((x, i) => {
            const [label, act] = x.split(':');
            return (
              <ActBtn key={act} act={act} className="item" style={{ padding: '8px 0' }}>
                <span className="pill neutral" style={{ width: 26, justifyContent: 'center' }}>{i + 1}</span>
                <div className="t">{t(`home.${label}`)}</div>
                <div className="r">›</div>
              </ActBtn>
            );
          })}
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t('home.liveRates')}</div>
          <div className="kv"><div>{t('home.neccEgg')}</div><div>₹{eggR.toFixed(2)}</div><div>{t('home.broilerFarmgate')}</div><div>₹{brR}/kg</div></div>
        </div>
      </>
    );

  const layer = tn.batches.find((b) => b.ft === 'layer' && b.state === 'laying');
  const isBroiler = !layer;
  const brB = tn.batches.find((b) => b.ft === 'broiler' && b.state !== 'closed');
  const brK = brB ? batchKpi(brB) : null;
  const cpe = layer ? costPerEgg(layer) : null;
  const eggDelta = K.eggsToday - K.eggsYest;
  const vaccDue = tn.batches.flatMap((b) => b.vacc.filter((x) => !x.done && daysBetween(today, x.due) <= 7)).length;
  const spike = K.act.find((x) => x.k.rag === 'crit');

  return (
    <>
      <Header title={t('home.goodMorning', { name: first })} action={<Live />} />
      <div className="quick">
        {([['mort', '☠️', 'qMortality'], ['saleOpen', '🧾', 'qSale'], ['payQuick', '💸', 'qPayment'], ['attToday', '👷', 'qAttendance']] as const).map(([a, i, l]) => (
          <ActBtn key={a} act={a}><span>{i}</span>{t(`home.${l}`)}</ActBtn>
        ))}
      </div>
      <div className="grid2">
        <div className="tile"><div className="lbl">{t('home.birdsAlive')}</div><div className="val">{fmtN(K.birds)}</div><div className="delta flat">{t('home.activeBatches', { n: K.act.length })}</div></div>
        {isBroiler ? (
          <div className="tile">
            <div className="lbl">{t('home.avgWeight', { code: brB?.code.slice(-5) ?? '' })}</div>
            <div className="val">{brK?.last?.avg_w ? (brK.last.avg_w / 1000).toFixed(2) + ' kg' : '—'}</div>
            <div className="delta flat">{t('home.fcrDay', { fcr: brK?.fcr ? brK.fcr.toFixed(2) : '—', day: brB?.age ?? '—' })}</div>
          </div>
        ) : (
          <div className="tile">
            <div className="lbl">{t('home.eggsToday')}</div><div className="val">{fmtN(K.eggsToday)}</div>
            <div className={`delta ${eggDelta >= 0 ? 'up' : 'down'}`}>{eggDelta >= 0 ? '▲' : '▼'} {t('home.vsYesterday', { n: fmtN(Math.abs(eggDelta)) })}</div>
          </div>
        )}
        {isBroiler ? (
          <div className="tile">
            <div className="lbl">{t('home.farmgate')}</div>
            <div className="val">₹{brR}<span style={{ fontSize: 13, fontWeight: 600 }}>/kg</span></div>
            <div className={`delta ${brR >= brR7 ? 'up' : 'down'}`}>{brR >= brR7 ? '▲' : '▼'} {t('home.vsLastWeek', { n: Math.abs(brR - brR7) })}</div>
          </div>
        ) : (
          <div className="tile">
            <div className="lbl">{t('home.marginEgg')}</div>
            <div className="val">{cpe == null ? '—' : `₹${(eggR - cpe).toFixed(2)}`}</div>
            <div className="delta flat">{t('home.rateMinusCost', { rate: eggR.toFixed(2), cost: cpe?.toFixed(2) ?? '—' })}</div>
          </div>
        )}
        <div className="tile">
          <div className="lbl">{t('home.mortToday')}</div><div className="val">{K.mortToday}</div>
          <div className={`delta ${spike ? 'down' : 'flat'}`}>{spike ? t('home.spikeIn', { shed: spike.b.shed_name }) : t('home.withinBaseline')}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">{t('home.needsAttention')}</div>
          <Link className="back" href="/more/notifications">{t('home.all', { n: tn.notifications.length })} ›</Link>
        </div>
        <div className="list">
          {tn.notifications.slice(0, 3).map((n) => (
            <div key={n.id} className={`item stripe ${sevStripe(n.severity)}`}><div><div className="t">{n.title}</div><div className="s">{n.body}</div></div></div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('home.today')}</div>
        <div className="kv">
          <div>{t('home.dailyLogs')}</div><div>{t('home.shedsDone', { done: K.act.filter((x) => x.k.last?.date === today).length, total: K.act.filter((x) => x.b.ft !== 'hatchery').length })}</div>
          <div>{t('home.vaccWeek')}</div><div>{vaccDue}</div>
          <div>{t('home.billsDue7')}</div><div>{fmtL(K.apDue7)}</div>
          <div>{t('home.overdueTraders')}</div><div className={K.arOver ? 'down' : ''}>{fmtL(K.arOver)}</div>
          <div>{t('home.workersPresent')}</div><div>{t('home.nOfM', { n: tn.workers.filter((w) => attGet(tn, w.id, today, today) === 'P').length, m: tn.workers.length })}</div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">{t('home.liveRates')}</div>
          <Link className="back" href="/money?view=rates">{t('home.trend')} ›</Link>
        </div>
        <div className="list">
          <div className="item"><div><div className="t">{t('home.neccEgg')}</div><div className="s">{t('home.perEgg')}</div></div>
            <div className="r"><Spark vals={v.rates.egg.slice(-14).map((r) => r.rate)} /><div className="t">₹{eggR.toFixed(2)}</div></div></div>
          <div className="item"><div><div className="t">{t('home.broilerFarmgate')}</div><div className="s">{t('home.perKgLive')}</div></div>
            <div className="r"><Spark vals={v.rates.broiler_farmgate.slice(-14).map((r) => r.rate)} color="var(--series2)" /><div className="t">₹{brR}</div></div></div>
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">{t('home.batches')}</div>
          <ActBtn act="addBatch" className="btn small">{t('home.placeBatch')}</ActBtn>
        </div>
        <div className="list">
          {tn.batches.map((b) => {
            const k = batchKpi(b);
            return (
              <Link key={b.id} className="item" href={`/farm/batch/${b.code}`}>
                <span className="dot" style={{ background: `var(--${k.rag === 'neutral' ? 'muted' : k.rag})`, marginTop: 6 }} />
                <div>
                  <div className="t">{b.code} · {b.shed_name}</div>
                  <div className="s">{b.ft === 'hatchery' ? t('home.setter') : t(`state.${b.state}`)} · {b.state === 'closed' ? t('home.closed') : t('common.day', { n: b.age })} · {t('common.birds', { n: fmtN(k.alive) })}</div>
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
