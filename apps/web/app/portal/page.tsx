// Customer portal (0050): a customer's own orders, invoices, chick availability and payment reference. The user is not a tenant member
// (no tenant claim), so every read goes through the portal_* functions; portal_me() says whether this login is linked to a customer.
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/ui/bits';
import { Toaster } from '@/components/ui/Toast';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { PortalPay } from '@/components/erp/PortalPay';
import { Card, Tbl, type Row } from '@/components/erp/bits';
import { dateFmt, fmtINR, fmtN } from '@/lib/format';

const ORDER_PILL: Record<string, string> = { reserved: 'warn', waitlisted: 'neutral', confirmed: 'good', allocated: 'good', dispatched: 'good', delivered: 'good', completed: 'good', expired: 'crit', cancelled: 'crit' };

export default async function Portal() {
  const [t, ts, locale, sb] = await Promise.all([getTranslations('portal'), getTranslations(), getLocale(), createClient()]);
  const dmy = dateFmt(locale);
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: me } = await sb.rpc('portal_me');
  const shell = (body: React.ReactNode) => (
    <div className="app"><div className="col">
      <header className="topbar"><div className="tenant"><span className="avatar">🐥</span><span><div className="name">HatchPro</div><div className="sub">{t('title')}</div></span></div><LanguagePicker compact /></header>
      <main className="screen"><div className="wrap">{body}<SignOutButton /></div></main>
      <Toaster />
    </div></div>
  );
  if (!Array.isArray(me) || !me.length) return shell(<div className="card" data-testid="not-customer">{t('notCustomer')}</div>);

  const [{ data: orders }, { data: invoices }, { data: avail }] = await Promise.all([sb.rpc('portal_orders'), sb.rpc('portal_invoices'), sb.rpc('portal_availability')]);
  const owing = (o: Row) => ['pending', 'rejected', 'partial'].includes(o.payment_status) && Number(o.deposit_due) > Number(o.deposit_paid) && ['reserved', 'waitlisted', 'confirmed'].includes(o.status);
  return shell(
    <>
      <Header title={t('title')} />
      <Card title={t('orders')} testid="portal-orders">
        <div className="list">
          {((orders ?? []) as Row[]).map((o) => (
            <div key={o.order_no} data-testid="portal-order" data-no={o.order_no}>
              <div className="item">
                <div style={{ minWidth: 0 }}>
                  <div className="t">{o.order_no} · {o.product}</div>
                  <div className="s">{fmtN(o.qty)} · {dmy(o.hatch_date)} · {fmtINR(Number(o.price))}{o.status === 'waitlisted' && o.suggested_hatch_date ? ` · ${ts('sales.suggested')}: ${dmy(o.suggested_hatch_date)}` : ''}</div>
                  <div className="s">{ts('sales.depositLine', { paid: fmtINR(Number(o.deposit_paid)), due: fmtINR(Number(o.deposit_due)) })}</div>
                </div>
                <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span className={`pill ${ORDER_PILL[o.status] ?? 'neutral'}`}>{ts(`sales.status.${o.status}`)}</span>
                  <span className="pill neutral" data-testid="portal-pay">{ts(`sales.pay.${o.payment_status}`)}</span>
                </div>
              </div>
              {owing(o) && <PortalPay orderNo={o.order_no} />}
            </div>
          ))}
          {!orders?.length && <div className="s">{t('noOrders')}</div>}
        </div>
      </Card>
      <Card title={t('invoices')} testid="portal-invoices">
        <Tbl head={[`-${t('invoiceNo')}`, `-${t('date')}`, t('total'), t('paid')]} empty={t('noInvoices')}
          rows={((invoices ?? []) as Row[]).map((i) => ({ key: i.invoice_no, cells: [i.invoice_no, dmy(i.invoice_date), fmtINR(Number(i.total)), fmtINR(Number(i.paid))] }))} />
      </Card>
      <Card title={t('availability')} testid="portal-availability">
        <Tbl head={[`-${t('product')}`, `-${t('week')}`, t('available')]} empty={t('noAvailability')}
          rows={((avail ?? []) as Row[]).map((a) => ({ key: a.product + a.week, cells: [a.product, dmy(a.week), fmtN(a.available)] }))} />
      </Card>
    </>,
  );
}
