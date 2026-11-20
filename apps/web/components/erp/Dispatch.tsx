// Dispatch (0045): vehicles, trips (draft -> submitted -> confirmed by the ops manager -> delivered with receiver + POD -> completed),
// loads from approved allocations, DOA claims and the one-click delivery trace. Server components.
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtINR, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Chips, Header } from '@/components/ui/bits';
import { Card, Decide, Tbl, one, type Row, type T } from './bits';

const TRIP_PILL: Record<string, string> = { draft: 'neutral', submitted: 'warn', approved: 'good', rejected: 'crit', delivered: 'good', completed: 'good' };
const CLAIM_PILL: Record<string, string> = { submitted: 'warn', approved: 'good', rejected: 'crit' };
export type DispatchQuery = { tab?: string; trip?: string; trace?: string };

export async function DispatchArea({ q }: { q: DispatchQuery }) {
  const t = await getTranslations();
  const tab = q.tab === 'vehicles' ? 'vehicles' : 'trips';
  return (
    <>
      <Header title={t('sales.dispatchTitle')} action={tab === 'vehicles' ? <ActBtn act="addVehicle" className="btn small">{t('sales.addVehicle')}</ActBtn> : <ActBtn act="addTrip" className="btn small">{t('sales.newTrip')}</ActBtn>} />
      <Chips active={tab} items={[['/more/dispatch', 'trips', t('sales.tab.trips')], ['/more/dispatch?tab=vehicles', 'vehicles', t('sales.tab.vehicles')]]} />
      {tab === 'vehicles' ? <Vehicles t={t} /> : <Trips q={q} t={t} />}
    </>
  );
}

async function Vehicles({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data: vs } = await sb.from('vehicle').select('id,reg_no,ownership,capacity_boxes,temp_controlled,fitness_expiry,insurance_expiry,permit_expiry,active').order('reg_no');
  const exp = (k: string, d?: string | null) => (d ? `${t(`sales.${k}`)} ${dmy(d)}` : null);
  return (
    <Card title={t('sales.tab.vehicles')} testid="vehicles">
      <div className="list">
        {(vs ?? []).map((v: Row) => (
          <div className="item" key={v.id} data-testid="vehicle-row" data-reg={v.reg_no}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{v.reg_no} · {t(`sales.own.${v.ownership}`)}{v.temp_controlled && <> <span className="pill good">{t('sales.cold')}</span></>}</div>
              <div className="s">{[v.capacity_boxes ? t('sales.boxesLine', { n: v.capacity_boxes }) : null, exp('fitness', v.fitness_expiry), exp('insurance', v.insurance_expiry), exp('permit', v.permit_expiry)].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        ))}
        {!vs?.length && <div className="s">{t('sales.noVehicles')}</div>}
      </div>
    </Card>
  );
}

async function Trips({ q, t }: { q: DispatchQuery; t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data: rows } = await sb.from('dispatch')
    .select('id,dispatch_no,planned_on,status,driver_name,route,delivered_at,receiver_name,pod_path,delivery_note,reject_reason,vehicle(reg_no),dispatch_line(id)')
    .order('created_at', { ascending: false }).limit(100);
  const sel = q.trip ? (rows ?? []).find((r: Row) => r.dispatch_no === q.trip) : null;
  return (
    <>
      {sel && <TripDetail d={sel} trace={q.trace === '1'} t={t} dmy={dmy} />}
      <Card title={t('sales.tab.trips')} testid="trips">
        <div className="list">
          {(rows ?? []).map((d: Row) => (
            <Link key={d.id} href={`/more/dispatch?trip=${d.dispatch_no}`} scroll={false} className="item" data-testid="trip-row" data-no={d.dispatch_no} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div style={{ minWidth: 0 }}>
                <div className="t">{d.dispatch_no} · {one(d.vehicle)?.reg_no}</div>
                <div className="s">{[d.driver_name, d.route, dmy(d.planned_on), t('sales.loadsLine', { n: d.dispatch_line.length })].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="r"><span className={`pill ${TRIP_PILL[d.status]}`} data-testid="trip-status">{t(`sales.trip.${d.status}`)}</span></div>
            </Link>
          ))}
          {!rows?.length && <div className="s">{t('sales.noTrips')}</div>}
        </div>
      </Card>
    </>
  );
}

async function TripDetail({ d, trace, t, dmy }: { d: Row; trace: boolean; t: T; dmy: (s: string) => string }) {
  const sb = await createClient();
  const { data: lines } = await sb.from('dispatch_line')
    .select('id,qty_loaded,boxes,qty_delivered,qty_short,qty_doa,age_override_reason,order_allocation(batch_id,batch(code),sales_order(order_no,customer_id,customer(name)))')
    .eq('dispatch_id', d.id).order('created_at');
  const ids = (lines ?? []).map((l: Row) => l.id);
  const [{ data: claims }, { data: invs }, { data: tr }, pod] = await Promise.all([
    ids.length ? sb.from('doa_claim').select('id,dispatch_line_id,qty,status,resolution,reject_reason,reported_on,customer_note').in('dispatch_line_id', ids).order('created_at') : { data: [] as Row[] },
    ids.length ? sb.from('invoice').select('invoice_no,total,dispatch_line_id').in('dispatch_line_id', ids) : { data: [] as Row[] },
    trace ? sb.from('delivery_trace').select('*').eq('dispatch_id', d.id) : { data: [] as Row[] },
    d.pod_path ? sb.storage.from('evidence').createSignedUrl(d.pod_path, 300) : { data: null },
  ]);
  const ctx = { trip: d.id, no: d.dispatch_no };
  const open = d.status === 'draft' || d.status === 'rejected';
  const done = d.status === 'delivered' || d.status === 'completed';
  const first = (lines ?? [])[0];
  const custs = [...new Map((lines ?? []).map((l: Row) => { const o = one(one(l.order_allocation)?.sales_order); return [o?.customer_id, one(o?.customer)?.name]; })).entries()] as [string, string][];
  const sets = [...new Map((lines ?? []).map((l: Row) => [one(l.order_allocation)?.batch_id, one(one(l.order_allocation)?.batch)?.code])).entries()] as [string, string][];
  const lineLabel = (l: Row) => { const o = one(l.order_allocation); return `${one(o?.sales_order)?.order_no} · ${one(one(o?.sales_order)?.customer)?.name}`; };
  const claimed = (id: string) => (claims ?? []).filter((c: Row) => c.dispatch_line_id === id && c.status !== 'rejected').reduce((n: number, c: Row) => n + c.qty, 0);
  const podUrl = (pod as { data: { signedUrl: string } | null }).data?.signedUrl;
  return (
    <Card title={`${d.dispatch_no} · ${one(d.vehicle)?.reg_no}`} testid="trip-detail"
      action={<Link className="btn small secondary" href="/more/dispatch" scroll={false}>{t('sales.close')}</Link>}>
      <div className="kv" data-status={d.status}>
        <div>{t('sales.f.driver')}</div><div>{d.driver_name}</div>
        <div>{t('sales.f.planned')}</div><div>{dmy(d.planned_on)}</div>
        {d.route && <><div>{t('sales.f.route')}</div><div>{d.route}</div></>}
        {d.status === 'rejected' && d.reject_reason && <><div>{t('sales.f.reason')}</div><div>{d.reject_reason}</div></>}
        {done && <><div>{t('sales.f.receiver')}</div><div data-testid="receiver">{d.receiver_name}</div></>}
        {d.pod_path && <><div>{t('sales.f.pod')}</div><div data-testid="pod">{podUrl ? <a href={podUrl} target="_blank" rel="noreferrer">{t('sales.viewPod')}</a> : t('sales.podSaved')}</div></>}
      </div>
      <Tbl head={[`-${t('sales.order')}`, `-${t('sales.setting')}`, t('sales.loaded'), t('sales.f.delivered'), t('sales.f.short'), t('sales.f.doa'), '-']} empty={t('sales.noLoads')}
        rows={(lines ?? []).map((l: Row) => {
          const o = one(l.order_allocation);
          const left = (l.qty_delivered ?? 0) - claimed(l.id);
          return {
            key: l.id,
            cells: [<span key="o" data-testid="line-order">{lineLabel(l)}</span>, one(o?.batch)?.code, fmtN(l.qty_loaded), l.qty_delivered ?? '—', l.qty_short ?? '—', l.qty_doa ?? '—',
              done && left > 0 ? <ActBtn key="c" act="doaClaim" ctx={{ line: l.id, label: lineLabel(l), max: String(left) }} className="btn small secondary">{t('sales.claim')}</ActBtn> : null],
          };
        })} />
      {!!invs?.length && <div className="s" data-testid="trip-invoices">{t('sales.invoices')}: {invs.map((i: Row) => `${i.invoice_no} ${fmtINR(Number(i.total))}`).join(', ')}</div>}
      {!!claims?.length && (
        <div className="list" data-testid="claims" style={{ marginTop: 8 }}>
          {claims.map((c: Row) => (
            <div className="item" key={c.id} data-testid="claim-row">
              <div className="s">{t('sales.claimLine', { n: c.qty, d: dmy(c.reported_on) })}{c.resolution ? ` · ${t(`sales.res.${c.resolution}`)}` : ''}{c.status === 'rejected' && c.reject_reason ? ` · ${t('trace.reason', { r: c.reject_reason })}` : ''}
                {' '}<span className={`pill ${CLAIM_PILL[c.status]}`} data-testid="claim-status">{t(`sales.claimStatus.${c.status}`)}</span></div>
              <div className="r"><Decide act="decideDoa" id={c.id} status={c.status} t={t} /></div>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {open && <ActBtn act="addLoad" ctx={ctx} className="btn small secondary">{t('sales.addLoad')}</ActBtn>}
        {open && !!lines?.length && <ActBtn act="submitTrip" ctx={ctx} className="btn small">{t('sales.submitTrip')}</ActBtn>}
        {d.status === 'submitted' && <Decide act="decideTrip" id={d.id} status="submitted" t={t} />}
        {d.status === 'approved' && first && (
          <ActBtn act="deliverTrip" className="btn small" ctx={{ ...ctx, batch: one(first.order_allocation)?.batch_id ?? '',
            lines: JSON.stringify((lines ?? []).map((l: Row) => ({ id: l.id, label: lineLabel(l), loaded: l.qty_loaded }))) }}>{t('sales.deliver')}</ActBtn>
        )}
        {d.status === 'delivered' && <ActBtn act="completeTrip" ctx={ctx} className="btn small">{t('sales.complete')}</ActBtn>}
        {['approved', 'delivered', 'completed'].includes(d.status) && (
          <Link className="btn small secondary" data-testid="trace-btn" href={`/more/dispatch?trip=${d.dispatch_no}&trace=1`} scroll={false}>{t('sales.trace')}</Link>
        )}
      </div>
      {!!lines?.length && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} data-testid="print-links">
          {['approved', 'delivered', 'completed'].includes(d.status) && custs.map(([cid, name]) => (
            <Link key={cid} className="btn small secondary" data-testid="note-link" href={`/print/delivery-note?trip=${d.dispatch_no}&customer=${cid}`}>{t('gap.doc.noteFor', { name })}</Link>
          ))}
          {sets.map(([bid, code]) => (
            <span key={bid} className="row" style={{ gap: 6 }}>
              <Link className="btn small secondary" data-testid="list-link" href={`/print/dispatch-list?batch=${bid}`}>{t('gap.doc.listFor', { code })}</Link>
              <Link className="btn small secondary" data-testid="alloc-link" href={`/print/allocation-list?batch=${bid}`}>{t('gap.doc.allocFor', { code })}</Link>
            </span>
          ))}
        </div>
      )}
      {trace && <Trace rows={tr ?? []} t={t} dmy={dmy} />}
    </Card>
  );
}

function Trace({ rows, t, dmy }: { rows: Row[]; t: T; dmy: (s: string) => string }) {
  return (
    <div data-testid="trace" style={{ marginTop: 10 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{t('sales.traceTitle')}</div>
      {rows.map((r, i) => (
        <div className="kv" key={i} style={{ marginBottom: 8 }}>
          <div>{t('sales.order')}</div><div>{r.order_no} · {r.customer}</div>
          <div>{t('sales.vehicle')}</div><div>{r.vehicle} · {r.driver}</div>
          <div>{t('sales.setting')}</div><div data-testid="trace-setting">{r.setting_code}{r.hatched_on ? ` · ${dmy(r.hatched_on)}` : ''}</div>
          <div>{t('sales.hatchKpi')}</div><div>{r.hes_pct != null ? `${Number(r.hes_pct).toFixed(1)}% / ${r.hatch_of_transfer_pct != null ? Number(r.hatch_of_transfer_pct).toFixed(1) : '—'}%` : '—'}</div>
          <div>{t('sales.vaccines')}</div><div data-testid="trace-vaccines">{r.vaccines ?? '—'}</div>
          <div>{t('sales.source')}</div><div>{r.flock_code ? `${r.flock_code} · ${r.transfer_ref ?? ''}${r.laid_from ? ` · ${dmy(r.laid_from)}${r.laid_to ? `–${dmy(r.laid_to)}` : ''}` : ''}${r.chicks_from_source != null ? ` · ${fmtN(r.chicks_from_source)}` : ''}` : t('sales.noSource')}</div>
        </div>
      ))}
      {!rows.length && <div className="s">{t('sales.noTrace')}</div>}
    </div>
  );
}
