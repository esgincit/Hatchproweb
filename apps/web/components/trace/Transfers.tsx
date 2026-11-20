// Egg transfers (0036): farm/vendor -> hatchery. Server components; buttons are ActBtn (hidden by role, the server re-checks).
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';

type T = Awaited<ReturnType<typeof getTranslations>>;
/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST embeds */
const one = (x: any) => (Array.isArray(x) ? x[0] : x);
const PILL: Record<string, string> = { draft: 'neutral', submitted: 'warn', approved: 'good', rejected: 'crit', received: 'good', cancelled: 'neutral' };
const COLS = 'id,ref,status,qty,trays,laid_from,laid_to,sent_on,received_qty,receipt_rejects,received_on,reject_reason,batch(code),vendor(name),farm(name)';

function Row({ x, t, dmy }: { x: any; t: T; dmy: (s: string) => string }) {
  const src = one(x.batch)?.code ?? one(x.vendor)?.name ?? t('trace.bought');
  const ctx = { transfer: x.id, qty: String(x.qty) };
  return (
    <div className="item" data-testid="transfer-row" data-ref={x.ref}>
      <div style={{ minWidth: 0 }}>
        <div className="t">{x.ref} <span className={`pill ${PILL[x.status]}`}>{t(`trace.status.${x.status}`)}</span></div>
        <div className="s">{t('trace.line1', { src, to: one(x.farm)?.name ?? '' })}</div>
        <div className="s">{t('trace.line2', { qty: fmtN(x.qty), from: dmy(x.laid_from), until: dmy(x.laid_to), sent: dmy(x.sent_on) })}</div>
        {x.received_on && <div className="s">{t('trace.receivedLine', { n: fmtN(x.received_qty), r: fmtN(x.receipt_rejects), date: dmy(x.received_on) })}</div>}
        {x.reject_reason && <div className="s">{t('trace.reason', { r: x.reject_reason })}</div>}
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {x.status === 'draft' && <ActBtn act="submitTransfer" ctx={ctx} className="btn small">{t('trace.submit')}</ActBtn>}
          {(x.status === 'draft' || x.status === 'submitted') && <>
            <ActBtn act="approveTransfer" ctx={ctx} className="btn small">{t('trace.approve')}</ActBtn>
            <ActBtn act="rejectTransfer" ctx={ctx} className="btn small secondary">{t('trace.reject')}</ActBtn>
          </>}
          {x.status === 'approved' && <>
            <ActBtn act="receiveTransfer" ctx={ctx} className="btn small">{t('trace.receive')}</ActBtn>
            <ActBtn act="cancelTransfer" ctx={ctx} className="btn small secondary">{t('trace.cancel')}</ActBtn>
          </>}
        </div>
      </div>
    </div>
  );
}

export async function TransferList() {
  const [sb, t, locale] = [await createClient(), await getTranslations(), await getLocale()];
  const { data } = await sb.from('egg_transfer').select(COLS).order('created_at', { ascending: false }).limit(100);
  const dmy = dateFmt(locale);
  return (
    <div className="card">
      <div className="list">
        {(data ?? []).map((x) => <Row key={x.id} x={x} t={t} dmy={dmy} />)}
        {!data?.length && <div className="s">{t('trace.none')}</div>}
      </div>
    </div>
  );
}

/** Transfers sent from one breeder flock (flock page) and the hatch feedback they produced. */
export async function FlockTransfers({ flockId }: { flockId: string }) {
  const [sb, t, locale] = [await createClient(), await getTranslations(), await getLocale()];
  const [{ data }, { data: fb }] = await Promise.all([
    sb.from('egg_transfer').select(COLS).eq('flock_id', flockId).order('sent_on', { ascending: false }),
    sb.from('setting_trace').select('*').eq('flock_id', flockId).order('set_on', { ascending: false }),
  ]);
  const dmy = dateFmt(locale);
  return (
    <>
      <div className="card" data-testid="flock-transfers">
        <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('trace.flock.sent')}</div><ActBtn act="addTransfer" className="btn small">{t('trace.add')}</ActBtn></div>
        <div className="list">
          {(data ?? []).map((x) => <Row key={x.id} x={x} t={t} dmy={dmy} />)}
          {!data?.length && <div className="s">{t('trace.none')}</div>}
        </div>
      </div>
      <div className="card" data-testid="flock-feedback">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('trace.flock.feedback')}</div>
        {fb?.length ? <TraceTable rows={fb} t={t} label={(r) => r.setting_code} /> : <div className="s">{t('trace.flock.noFeedback')}</div>}
      </div>
    </>
  );
}

const num = (v: unknown) => (v == null ? '—' : fmtN(Math.round(Number(v))));
export function TraceTable({ rows, t, label }: { rows: any[]; t: T; label: (r: any) => string }) {
  const est = rows.some((r) => r.estimated);
  return (
    <>
      {est && <div className="s" style={{ marginBottom: 6 }}><span className="pill warn" data-testid="estimated-badge">{t('trace.trace.estimated')}</span> {t('trace.trace.note')}</div>}
      <div className="tablewrap">
        <table data-testid="trace-table">
          <thead><tr>
            <th>{t('trace.trace.source')}</th><th className="n">{t('trace.trace.set')}</th><th className="n">{t('trace.trace.share')}</th>
            <th className="n">{t('trace.trace.infertile')}</th><th className="n">{t('trace.trace.deadGerm')}</th><th className="n">{t('trace.trace.chicks')}</th><th className="n">{t('trace.trace.culls')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.batch_id}-${r.transfer_id}`}>
                <td>{label(r)}</td><td className="n">{fmtN(r.eggs_set)}</td><td className="n">{Math.round(Number(r.share) * 100)}%</td>
                <td className="n">{num(r.infertile)}</td><td className="n">{num(r.dead_germ)}</td><td className="n">{num(r.chicks)}</td><td className="n">{num(r.culls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Hatchery setting page: which transfers fed this setting, and the per-source hatch result. */
export async function SettingSources({ batchId, eggsSet, locked }: { batchId: string; eggsSet: number; locked: boolean }) {
  const [sb, t] = [await createClient(), await getTranslations()];
  const [{ data: lots }, { data: tr }] = await Promise.all([
    sb.from('setting_lot').select('id,qty,age_override_reason,egg_transfer(ref,laid_from,batch(code),vendor(name))').eq('batch_id', batchId).order('created_at'),
    sb.from('setting_trace').select('*').eq('batch_id', batchId),
  ]);
  const used = (lots ?? []).reduce((a, l) => a + l.qty, 0);
  const name = (x: any) => one(x?.batch)?.code ?? one(x?.vendor)?.name ?? t('trace.bought');
  return (
    <>
      <div className="card" data-testid="egg-sources">
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="eyebrow">{t('trace.sources.title')}</div>
          {!locked && <ActBtn act="loadSetting" ctx={{ batch: batchId }} className="btn small">{t('trace.sources.load')}</ActBtn>}
        </div>
        <div className="list">
          {(lots ?? []).map((l) => {
            const x = one(l.egg_transfer);
            return (
              <div className="item" key={l.id}><div>
                <div className="t">{x?.ref} · {name(x)}</div>
                {l.age_override_reason && <div className="s">{t('trace.sources.overAge', { r: l.age_override_reason })}</div>}
              </div><div className="r">{fmtN(l.qty)}</div></div>
            );
          })}
          {!lots?.length && <div className="s">{t('trace.sources.none')}</div>}
        </div>
        <div className="s" style={{ marginTop: 6 }}>{t('trace.sources.total', { used: fmtN(used), set: fmtN(eggsSet) })}{locked ? ` · ${t('trace.sources.locked')}` : ''}</div>
      </div>
      {!!tr?.length && (
        <div className="card" data-testid="hatch-trace">
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t('trace.trace.title')}</div>
          <TraceTable rows={tr} t={t} label={(r) => r.flock_code ?? t('trace.bought')} />
        </div>
      )}
    </>
  );
}

/** Owner-only tenant rules (tenant_rule): the two thresholds the transfer workflow reads. */
export async function RulesCard() {
  const [sb, t] = [await createClient(), await getTranslations()];
  const { data } = await sb.from('tenant_rule').select('key,value');
  const v = (k: string) => data?.find((r) => r.key === k)?.value;
  const self = v('allow_self_approval') !== false, days = Number(v('egg_max_storage_days') ?? 7);
  return (
    <div className="card" data-testid="rules-card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>{t('trace.rules.title')}</div>
      <div className="list">
        <div className="item"><div className="t">{t('trace.rules.selfApproval')}</div>
          <div className="r"><span className="pill neutral">{self ? t('trace.rules.allowed') : t('trace.rules.blocked')}</span>{' '}
            <ActBtn act="setRule" ctx={{ key: 'allow_self_approval', value: self ? 'yes' : 'no' }} className="btn small secondary">{t('trace.rules.change')}</ActBtn></div></div>
        <div className="item"><div className="t">{t('trace.rules.maxDays')}</div>
          <div className="r"><span className="pill neutral">{t('trace.rules.days', { n: days })}</span>{' '}
            <ActBtn act="setRule" ctx={{ key: 'egg_max_storage_days', value: String(days) }} className="btn small secondary">{t('trace.rules.change')}</ActBtn></div></div>
      </div>
    </div>
  );
}
