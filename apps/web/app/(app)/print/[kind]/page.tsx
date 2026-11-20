// Printable dispatch documents (WP 1.14 / C2): delivery note per customer for a trip, dispatch list per hatch batch, customer allocation list per
// hatch batch. Same print pattern as /report/[kind] (PrintButton + @media print in globals.css). Roles: whoever sees Dispatch, plan module "dispatch".
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { canSee } from '@/lib/auth/permissions';
import { hasModule } from '@/lib/modules';
import { dateFmt, fmtN } from '@/lib/format';
import { Back } from '@/components/ui/bits';
import { PrintButton } from '@/components/ui/PrintButton';
import { one, type Row } from '@/components/erp/bits';

const KINDS = ['delivery-note', 'dispatch-list', 'allocation-list'] as const;
const UUID = /^[0-9a-f-]{36}$/;
const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '–');

export default async function PrintDoc({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ trip?: string; customer?: string; batch?: string }> }) {
  const [{ kind }, q] = [await params, await searchParams];
  if (!(KINDS as readonly string[]).includes(kind)) notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !canSee(claimsFromUser(user).roles, 'dispatch') || !(await hasModule(sb, 'dispatch'))) notFound();
  const [t, locale] = [await getTranslations('gap.doc'), await getLocale()];
  const dmy = dateFmt(locale);
  const { data: tenant } = await sb.from('tenant').select('name').maybeSingle();
  const empty = (cols: number) => <tr><td colSpan={cols} className="s">{t('noRows')}</td></tr>;
  const th = (keys: string[], text = 1) => <thead><tr>{keys.map((k, i) => <th key={k} className={i >= text ? 'n' : undefined}>{t(k)}</th>)}</tr></thead>;

  let title: string, sub: string, body: React.ReactNode, back = '/more/dispatch';
  if (kind === 'delivery-note') {
    if (!q.trip || !q.customer || !UUID.test(q.customer)) notFound();
    const { data: d } = await sb.from('dispatch').select('id,dispatch_no,driver_name,dispatched_at,planned_on,status,vehicle(reg_no)').eq('dispatch_no', q.trip).maybeSingle();
    if (!d) notFound();
    const { data: all } = await sb.from('dispatch_line')
      .select('id,qty_loaded,boxes,order_allocation(batch(code,farm(name)),sales_order(order_no,customer_id,customer(name,delivery_address),chick_product(name)))')
      .eq('dispatch_id', d.id).order('created_at');
    const lines = (all ?? []).filter((l: Row) => one(one(l.order_allocation)?.sales_order)?.customer_id === q.customer);
    if (!lines.length) notFound();
    const cust = one(one(one(lines[0].order_allocation)?.sales_order)?.customer);
    const farm = one(one(one(lines[0].order_allocation)?.batch)?.farm)?.name ?? tenant?.name;
    const total = lines.reduce((n: number, l: Row) => n + l.qty_loaded, 0);
    back = `/more/dispatch?trip=${d.dispatch_no}`;
    title = t('noteTitle'); sub = `${farm} · ${d.dispatch_no}`;
    body = (
      <>
        <div className="kv" data-testid="doc-head">
          <div>{t('farm')}</div><div>{farm}</div>
          <div>{t('trip')}</div><div>{d.dispatch_no}</div>
          <div>{t('vehicle')}</div><div>{one(d.vehicle)?.reg_no}</div>
          <div>{t('driver')}</div><div>{d.driver_name ?? '–'}</div>
          <div>{t('dispatchedAt')}</div><div>{stamp(d.dispatched_at)}</div>
          <div>{t('customer')}</div><div>{cust?.name}</div>
          <div>{t('address')}</div><div>{cust?.delivery_address ?? '–'}</div>
        </div>
        <table>{th(['order', 'product', 'batch', 'qty'], 3)}<tbody>
          {lines.map((l: Row) => {
            const o = one(l.order_allocation);
            return <tr key={l.id} data-testid="doc-row"><td>{one(o?.sales_order)?.order_no}</td><td>{one(one(o?.sales_order)?.chick_product)?.name}</td><td>{one(o?.batch)?.code}</td><td className="n">{fmtN(l.qty_loaded)}</td></tr>;
          })}
          <tr><th colSpan={3}>{t('total')}</th><th className="n" data-testid="doc-total">{fmtN(total)}</th></tr>
        </tbody></table>
        <div className="row" style={{ gap: 40, marginTop: 40 }}>
          <div style={{ flex: 1, borderTop: '1px solid var(--ink)', paddingTop: 4 }}>{t('receiverName')}</div>
          <div style={{ flex: 1, borderTop: '1px solid var(--ink)', paddingTop: 4 }}>{t('signature')}</div>
        </div>
      </>
    );
  } else {
    if (!q.batch || !UUID.test(q.batch)) notFound();
    const { data: b } = await sb.from('batch').select('id,code').eq('id', q.batch).maybeSingle();
    if (!b) notFound();
    back = '/more/dispatch';
    if (kind === 'dispatch-list') {
      const { data: rows } = await sb.from('dispatch_line')
        .select('id,qty_loaded,dispatch(dispatch_no,dispatched_at,status,vehicle(reg_no)),order_allocation!inner(batch_id,sales_order(order_no,customer(name)))')
        .eq('order_allocation.batch_id', b.id).order('created_at');
      const total = (rows ?? []).reduce((n: number, l: Row) => n + l.qty_loaded, 0);
      title = t('listTitle'); sub = `${tenant?.name} · ${b.code}`;
      body = (
        <table>{th(['trip', 'customer', 'order', 'time', 'status', 'qty'], 5)}<tbody>
          {(rows ?? []).map((l: Row) => {
            const d = one(l.dispatch), o = one(one(l.order_allocation)?.sales_order);
            return <tr key={l.id} data-testid="doc-row"><td>{d?.dispatch_no} · {one(d?.vehicle)?.reg_no}</td><td>{one(o?.customer)?.name}</td><td>{o?.order_no}</td><td>{stamp(d?.dispatched_at)}</td><td>{t(`tripSt.${d?.status}`)}</td><td className="n">{fmtN(l.qty_loaded)}</td></tr>;
          })}
          {rows?.length ? <tr><th colSpan={5}>{t('total')}</th><th className="n" data-testid="doc-total">{fmtN(total)}</th></tr> : empty(6)}
        </tbody></table>
      );
    } else {
      const { data: rows } = await sb.from('order_allocation').select('id,qty,status,sales_order(order_no,customer(name,tier))').eq('batch_id', b.id).order('created_at');
      const live = (rows ?? []).filter((a: Row) => ['submitted', 'approved'].includes(a.status)).reduce((n: number, a: Row) => n + a.qty, 0);
      title = t('allocTitle'); sub = `${tenant?.name} · ${b.code}`;
      body = (
        <table>{th(['customer', 'order', 'tierCol', 'qty', 'status'], 3)}<tbody>
          {(rows ?? []).map((a: Row) => {
            const o = one(a.sales_order), c = one(o?.customer);
            return <tr key={a.id} data-testid="doc-row"><td>{c?.name}</td><td>{o?.order_no}</td><td>{c?.tier ? t(`tier.${c.tier}`) : '–'}</td><td className="n">{fmtN(a.qty)}</td><td>{t(`alloc.${a.status}`)}</td></tr>;
          })}
          {rows?.length ? <tr><th colSpan={3}>{t('totalLive')}</th><th className="n" data-testid="doc-total">{fmtN(live)}</th><th /></tr> : empty(5)}
        </tbody></table>
      );
    }
  }

  return (
    <>
      <Back href={back} />
      <div className="card report" data-testid={`doc-${kind}`}>
        <div className="row between">
          <div><h2>{title}</h2><div className="s">{sub}</div></div>
          <PrintButton label={t('print')} />
        </div>
        <div className="tablewrap">{body}</div>
        <div className="s">{t('generated', { date: dmy(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })) })} · HatchPro</div>
      </div>
    </>
  );
}
