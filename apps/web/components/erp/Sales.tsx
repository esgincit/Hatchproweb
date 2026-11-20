// Chick sales (0043–0049): orders with payment / status chips, order detail with the role-gated steps, the 12-week availability
// table, allocation queue per hatch week (sales proposes, hatchery manager approves), product master and customer tiers. Server components.
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtINR, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Chips, Header } from '@/components/ui/bits';
import { Card, Decide, Tbl, one, type Row, type T } from './bits';

const ORDER_PILL: Record<string, string> = { reserved: 'warn', waitlisted: 'neutral', confirmed: 'good', allocated: 'good', dispatched: 'good', delivered: 'good', completed: 'good', expired: 'crit', cancelled: 'crit' };
const PAY_PILL: Record<string, string> = { pending: 'neutral', submitted: 'warn', verified: 'good', partial: 'warn', rejected: 'crit', waived: 'neutral' };
const ALLOC_PILL: Record<string, string> = { submitted: 'warn', approved: 'good', rejected: 'crit' };
const FILTERS = ['reserved', 'waitlisted', 'confirmed', 'allocated', 'dispatched', 'delivered', 'completed', 'cancelled'] as const;
const PAYS = ['pending', 'submitted', 'verified', 'partial', 'waived', 'rejected'] as const;
export const SALES_TABS = ['orders', 'availability', 'allocation', 'products', 'customers'] as const;
export const realToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addD = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d: string) => addD(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));

export type SalesQuery = { tab?: string; order?: string; f?: string; pay?: string };

export async function SalesArea({ q }: { q: SalesQuery }) {
  const t = await getTranslations();
  const tab = (SALES_TABS as readonly string[]).includes(q.tab ?? '') ? q.tab! : 'orders';
  const chips = <Chips active={tab} items={SALES_TABS.map((k): [string, string, string] => [k === 'orders' ? '/more/sales' : `/more/sales?tab=${k}`, k, t(`sales.tab.${k}`)])} />;
  const action = tab === 'orders' ? <ActBtn act="addOrder" className="btn small">{t('sales.newOrder')}</ActBtn>
    : tab === 'products' ? <ActBtn act="addProduct" className="btn small">{t('sales.addProduct')}</ActBtn>
    : tab === 'customers' ? <ActBtn act="addCustomer" className="btn small">{t('sections.addCustomer')}</ActBtn> : undefined;
  return (
    <>
      <Header title={t('sales.title')} action={action} />
      {chips}
      {tab === 'orders' && <Orders q={q} t={t} />}
      {tab === 'availability' && <Availability t={t} />}
      {tab === 'allocation' && <Allocation t={t} />}
      {tab === 'products' && <Products t={t} />}
      {tab === 'customers' && <Customers t={t} />}
    </>
  );
}

const StatusPill = ({ s, t }: { s: string; t: T }) => <span className={`pill ${ORDER_PILL[s] ?? 'neutral'}`} data-testid="order-status">{t(`sales.status.${s}`)}</span>;
const PayPill = ({ s, t }: { s: string; t: T }) => <span className={`pill ${PAY_PILL[s] ?? 'neutral'}`} data-testid="order-pay">{t(`sales.pay.${s}`)}</span>;

async function Orders({ q, t }: { q: SalesQuery; t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const f = (FILTERS as readonly string[]).includes(q.f ?? '') ? q.f! : '';
  const pay = (PAYS as readonly string[]).includes(q.pay ?? '') ? q.pay! : '';
  let qb = sb.from('sales_order').select('id,order_no,product_id,qty,hatch_date,suggested_hatch_date,price,price_locked_at,deposit_due,deposit_paid,payment_status,payment_ref,status,reserve_expires_at,cancel_reason,refund_status,credit_override_reason,customer(name,tier),chick_product(name)')
    .order('created_at', { ascending: false }).limit(200);
  if (f) qb = f === 'cancelled' ? qb.in('status', ['cancelled', 'expired']) : qb.eq('status', f);
  if (pay) qb = qb.eq('payment_status', pay);
  const { data: rows } = await qb;
  const href = (nf: string, np: string, order?: string) => {
    const p = new URLSearchParams();
    if (nf) p.set('f', nf);
    if (np) p.set('pay', np);
    if (order) p.set('order', order);
    const qs = p.toString();
    return `/more/sales${qs ? `?${qs}` : ''}`;
  };
  const sel = q.order ? (rows ?? []).find((o: Row) => o.order_no === q.order) : null;
  return (
    <>
      <Chips active={f || 'all'} items={[[href('', pay), 'all', t('sales.all')], ...FILTERS.map((k): [string, string, string] => [href(k, pay), k, t(`sales.status.${k}`)])]} />
      <Chips active={pay || 'all'} items={[[href(f, ''), 'all', t('sales.allPay')], ...PAYS.map((k): [string, string, string] => [href(f, k), k, t(`sales.pay.${k}`)])]} />
      {sel && <OrderDetail o={sel} t={t} dmy={dmy} close={href(f, pay)} />}
      <Card title={t('sales.orders')} testid="orders">
        <div className="list">
          {(rows ?? []).map((o: Row) => (
            <Link key={o.id} href={href(f, pay, o.order_no)} scroll={false} className="item" data-testid="order-row" data-no={o.order_no} style={{ color: 'inherit', textDecoration: 'none' }}>
              <div style={{ minWidth: 0 }}>
                <div className="t">{o.order_no} · {one(o.customer)?.name}</div>
                <div className="s">{one(o.chick_product)?.name} · {fmtN(o.qty)} · {dmy(o.hatch_date)}</div>
              </div>
              <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}><StatusPill s={o.status} t={t} /><PayPill s={o.payment_status} t={t} /></div>
            </Link>
          ))}
          {!rows?.length && <div className="s">{t('sales.noOrders')}</div>}
        </div>
      </Card>
    </>
  );
}

function OrderDetail({ o, t, dmy, close }: { o: Row; t: T; dmy: (s: string) => string; close: string }) {
  const ctx = { order: o.id, no: o.order_no };
  const open = ['reserved', 'waitlisted', 'confirmed', 'allocated'].includes(o.status);
  const owing = ['pending', 'submitted', 'rejected', 'partial'].includes(o.payment_status) && Number(o.deposit_due) > 0;
  const btn = (act: string, label: string, extra: Record<string, string> = {}, secondary = true) =>
    <ActBtn act={act} ctx={{ ...ctx, ...extra }} className={`btn small${secondary ? ' secondary' : ''}`}>{label}</ActBtn>;
  return (
    <Card title={`${o.order_no} · ${one(o.customer)?.name}`} testid="order-detail" action={<><StatusPill s={o.status} t={t} /><PayPill s={o.payment_status} t={t} /><Link className="btn small secondary" href={close} scroll={false}>{t('sales.close')}</Link></>}>
      <div className="kv" data-status={o.status}>
        <div>{t('sales.f.product')}</div><div>{one(o.chick_product)?.name}</div>
        <div>{t('sales.f.qty')}</div><div>{fmtN(o.qty)}</div>
        <div>{t('sales.f.hatchDate')}</div><div>{dmy(o.hatch_date)}</div>
        {o.status === 'waitlisted' && <><div>{t('sales.suggested')}</div><div data-testid="suggested">{o.suggested_hatch_date ? dmy(o.suggested_hatch_date) : '—'}</div></>}
        <div>{t('sales.f.price')}</div><div>{fmtINR(Number(o.price))}{o.price_locked_at ? ` · ${t('sales.locked')}` : ''}</div>
        <div>{t('sales.deposit')}</div><div data-testid="deposit">{t('sales.depositLine', { paid: fmtINR(Number(o.deposit_paid)), due: fmtINR(Number(o.deposit_due)) })}</div>
        <div>{t('sales.f.ref')}</div><div>{o.payment_ref ?? '—'}</div>
        {o.credit_override_reason && <><div>{t('sales.f.override')}</div><div>{o.credit_override_reason}</div></>}
        {o.status === 'reserved' && o.reserve_expires_at && <><div>{t('sales.holdUntil')}</div><div>{new Date(o.reserve_expires_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div></>}
        {o.status === 'cancelled' && <><div>{t('sales.cancelReason')}</div><div>{o.cancel_reason}{o.refund_status !== 'none' ? ` · ${t('sales.refund', { s: o.refund_status })}` : ''}</div></>}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {owing && ['reserved', 'waitlisted'].includes(o.status) && btn('verifyPayment', t('sales.verifyPay'), { due: String(o.deposit_due), ref: o.payment_ref ?? '' }, false)}
        {owing && o.status === 'reserved' && btn('waiveDeposit', t('sales.waive'))}
        {o.status === 'reserved' && btn('confirmOrder', t('sales.confirm'), {}, false)}
        {o.status === 'waitlisted' && btn('reserveOrder', t('sales.moveIn'), {}, false)}
        {['reserved', 'waitlisted', 'confirmed'].includes(o.status) && btn('moveOrder', t('sales.moveDate'), { date: o.suggested_hatch_date ?? o.hatch_date })}
        {open && btn('priceOrder', t('sales.changePrice'), { price: String(o.price) })}
        {['confirmed', 'allocated'].includes(o.status) && btn('allocate', t('sales.allocate'), { product: o.product_id ?? '' })}
        {open && btn('cancelOrder', t('sales.cancel'))}
      </div>
    </Card>
  );
}

async function Availability({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const from = mondayOf(realToday());
  const weeks = Array.from({ length: 12 }, (_, i) => addD(from, 7 * i));
  const [{ data: ps }, { data: av }] = await Promise.all([
    sb.from('chick_product').select('id,name').eq('active', true).order('name'),
    sb.from('chick_availability').select('product_id,week,expected_saleable,temp_reserved,confirmed,available').gte('week', from).lte('week', weeks[11]),
  ]);
  if (!ps?.length) return <Card title={t('sales.tab.availability')} testid="availability"><div className="s">{t('sales.noProducts')}</div></Card>;
  return (
    <>
      {ps.map((p: Row) => (
        <Card key={p.id} title={`${p.name} · ${t('sales.weeks12')}`} testid={`avail-${p.name}`}>
          <Tbl head={[`-${t('sales.week')}`, t('sales.expected'), t('sales.held'), t('sales.confirmedQty'), t('sales.available')]} empty=""
            rows={weeks.map((w) => {
              const a: Row | undefined = (av ?? []).find((x: Row) => x.product_id === p.id && x.week === w);
              const n = (k: string) => fmtN(Number(a?.[k] ?? 0));
              return { key: w, cells: [dmy(w), n('expected_saleable'), n('temp_reserved'), n('confirmed'), <b key="a" data-testid="avail-n">{n('available')}</b>] };
            })} />
        </Card>
      ))}
    </>
  );
}

async function Allocation({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const [{ data: queue }, { data: allocs }, { data: stock }] = await Promise.all([
    sb.from('allocation_queue').select('order_id,order_no,customer,tier,product_id,hatch_date,qty,allocated,open_qty,priority').order('hatch_date').order('priority'),
    sb.from('order_allocation').select('id,order_id,qty,status,reject_reason,batch(code)').in('status', ['submitted', 'approved', 'rejected']).order('created_at'),
    sb.from('chick_stock').select('batch_id,code,saleable,allocated,available,quality_ok').order('hatched_on', { ascending: false }),
  ]);
  const byWeek = new Map<string, Row[]>();
  for (const o of queue ?? []) { const w = mondayOf(o.hatch_date); byWeek.set(w, [...(byWeek.get(w) ?? []), o]); }
  return (
    <>
      <Card title={t('sales.settingsStock')} testid="alloc-stock">
        <Tbl head={[`-${t('sales.setting')}`, t('sales.saleable'), t('sales.allocated'), t('sales.available')]} empty={t('sales.noStock')}
          rows={(stock ?? []).map((s: Row) => ({ key: s.batch_id, cells: [<span key="c" data-testid="stock-code">{s.code}</span>, fmtN(s.saleable), fmtN(s.allocated), <b key="a">{fmtN(s.available)}</b>] }))} />
      </Card>
      {[...byWeek.entries()].map(([week, orders]) => (
        <Card key={week} title={t('sales.weekOf', { d: dmy(week) })} testid="alloc-week">
          <div className="list">
            {orders.map((o) => (
              <div key={o.order_id} data-testid="alloc-order" data-no={o.order_no}>
                <div className="item">
                  <div style={{ minWidth: 0 }}>
                    <div className="t">#{o.priority} · {o.order_no} · {o.customer} <span className="pill neutral">{t(`sales.tier.${o.tier}`)}</span></div>
                    <div className="s">{t('sales.allocLine', { a: fmtN(o.allocated), q: fmtN(o.qty) })} · {dmy(o.hatch_date)}</div>
                  </div>
                  <div className="r">{Number(o.open_qty) > 0 && <ActBtn act="allocate" ctx={{ order: o.order_id, no: o.order_no, product: o.product_id, open: String(o.open_qty) }} className="btn small">{t('sales.allocate')}</ActBtn>}</div>
                </div>
                {(allocs ?? []).filter((a: Row) => a.order_id === o.order_id).map((a: Row) => (
                  <div className="item" key={a.id} data-testid="alloc-row" style={{ paddingLeft: 16 }}>
                    <div className="s">{fmtN(a.qty)} ← {one(a.batch)?.code} <span className={`pill ${ALLOC_PILL[a.status]}`} data-testid="alloc-status">{t(`sales.alloc.${a.status}`)}</span>{a.status === 'rejected' && a.reject_reason ? ` · ${t('trace.reason', { r: a.reject_reason })}` : ''}</div>
                    <div className="r row" style={{ gap: 6 }}>
                      <Decide act="decideAlloc" id={a.id} status={a.status} t={t} />
                      {a.status === 'approved' && <ActBtn act="releaseAlloc" ctx={{ id: a.id }} className="btn small secondary">{t('sales.release')}</ActBtn>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      ))}
      {!byWeek.size && <div className="card"><div className="s">{t('sales.noQueue')}</div></div>}
    </>
  );
}

async function Products({ t }: { t: T }) {
  const sb = await createClient();
  const [{ data: ps }, { data: bs }] = await Promise.all([
    sb.from('chick_product').select('id,name,category,price,max_dispatch_age_hours,active').order('name'),
    sb.from('batch').select('id,code,chick_product_id').eq('farm_type', 'hatchery').is('closed_on', null).order('placed_on', { ascending: false }),
  ]);
  const name = new Map((ps ?? []).map((p: Row) => [p.id, p.name]));
  return (
    <>
      <Card title={t('sales.tab.products')} testid="products">
        <div className="list">
          {(ps ?? []).map((p: Row) => (
            <div className="item" key={p.id} data-testid="product-row" data-name={p.name}>
              <div><div className="t">{p.name}{!p.active && <> <span className="pill neutral">{t('sales.inactive')}</span></>}</div>
                <div className="s">{t(`sales.cat.${p.category}`)} · {p.price != null ? fmtINR(Number(p.price)) : '—'}{p.max_dispatch_age_hours ? ` · ${t('sales.maxAgeLine', { h: p.max_dispatch_age_hours })}` : ''}</div></div>
            </div>
          ))}
          {!ps?.length && <div className="s">{t('sales.noProducts')}</div>}
        </div>
      </Card>
      <Card title={t('sales.settingProducts')} testid="setting-products">
        <div className="list">
          {(bs ?? []).map((b: Row) => (
            <div className="item" key={b.id} data-testid="setting-row" data-code={b.code}>
              <div><div className="t">{b.code}</div><div className="s">{b.chick_product_id ? name.get(b.chick_product_id) : t('sales.noProduct')}</div></div>
              <div className="r"><ActBtn act="setBatchProduct" ctx={{ batch: b.id, code: b.code, product: b.chick_product_id ?? '' }} className="btn small secondary">{t('sales.setProduct')}</ActBtn></div>
            </div>
          ))}
          {!bs?.length && <div className="s">{t('sales.noSettings')}</div>}
        </div>
      </Card>
    </>
  );
}

async function Customers({ t }: { t: T }) {
  const sb = await createClient();
  const { data: cs } = await sb.from('customer').select('id,name,phone,tier,delivery_address,credit_limit').order('name');
  return (
    <Card title={t('sales.tab.customers')} testid="customers">
      <div className="list">
        {(cs ?? []).map((c: Row) => (
          <div className="item" key={c.id} data-testid="customer-row" data-name={c.name}>
            <div style={{ minWidth: 0 }}><div className="t">{c.name} <span className="pill neutral" data-testid="tier">{t(`sales.tier.${c.tier}`)}</span></div>
              <div className="s">{[c.phone, c.delivery_address].filter(Boolean).join(' · ')}</div></div>
            <div className="r"><ActBtn act="setTier" ctx={{ customer: c.id, name: c.name, tier: c.tier, addr: c.delivery_address ?? '' }} className="btn small secondary">{t('sales.setTier')}</ActBtn></div>
          </div>
        ))}
        {!cs?.length && <div className="s">{t('sections.noCustomers')}</div>}
      </div>
    </Card>
  );
}
