// Finance (0050/0051): credit notes and refunds with approvals, receivables ageing, customer balances, accounting period lock.
// The database applies the owner threshold (finance_owner_above), the invoice totals and the lock; its messages reach the user as they are.
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtINR } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Chips, Header } from '@/components/ui/bits';
import { AStatus, Card, Decide, Tbl, one, type Row, type T } from './bits';

export const FIN_TABS = ['credit', 'refunds', 'ageing', 'balances', 'lock'] as const;
const inr = (v: unknown) => fmtINR(Number(v ?? 0));

export async function FinanceArea({ tab: q }: { tab?: string }) {
  const t = await getTranslations();
  const tab = (FIN_TABS as readonly string[]).includes(q ?? '') ? q! : 'credit';
  const chips = <Chips active={tab} items={FIN_TABS.map((k): [string, string, string] => [k === 'credit' ? '/more/finance' : `/more/finance?tab=${k}`, k, t(`fin.tab.${k}`)])} />;
  const action = tab === 'credit' ? <ActBtn act="addCreditNote" className="btn small">{t('fin.newNote')}</ActBtn>
    : tab === 'refunds' ? <ActBtn act="addRefund" className="btn small">{t('fin.newRefund')}</ActBtn> : undefined;
  return (
    <>
      <Header title={t('fin.title')} action={action} />
      {chips}
      {tab === 'credit' && <Notes t={t} />}
      {tab === 'refunds' && <Refunds t={t} />}
      {tab === 'ageing' && <Ageing t={t} />}
      {tab === 'balances' && <Balances t={t} />}
      {tab === 'lock' && <Lock t={t} />}
    </>
  );
}

async function Notes({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data } = await sb.from('credit_note').select('id,note_no,amount,reason,issued_on,status,reject_reason,customer(name),invoice(invoice_no)').order('created_at', { ascending: false }).limit(200);
  return (
    <Card title={t('fin.tab.credit')} testid="credit-notes">
      <div className="list">
        {(data ?? []).map((n: Row) => (
          <div className="item" key={n.id} data-testid="note-row" data-no={n.note_no}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{n.note_no} · {one(n.customer)?.name}</div>
              <div className="s">{[inr(n.amount), dmy(n.issued_on), one(n.invoice)?.invoice_no, n.reason].filter(Boolean).join(' · ')}</div>
              {n.status === 'rejected' && n.reject_reason && <div className="s">{t('trace.reason', { r: n.reject_reason })}</div>}
            </div>
            <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}><AStatus status={n.status} t={t} /><Decide act="decideCreditNote" id={n.id} status={n.status} t={t} /></div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('fin.noNotes')}</div>}
      </div>
    </Card>
  );
}

async function Refunds({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data } = await sb.from('refund').select('id,amount,mode,utr,paid_on,status,reject_reason,customer(name),sales_order(order_no),credit_note(note_no)').order('created_at', { ascending: false }).limit(200);
  return (
    <Card title={t('fin.tab.refunds')} testid="refunds">
      <div className="list">
        {(data ?? []).map((r: Row) => (
          <div className="item" key={r.id} data-testid="refund-row">
            <div style={{ minWidth: 0 }}>
              <div className="t">{one(r.customer)?.name} · {inr(r.amount)}</div>
              <div className="s">{[r.mode.toUpperCase(), r.utr, r.paid_on ? dmy(r.paid_on) : null, one(r.sales_order)?.order_no, one(r.credit_note)?.note_no].filter(Boolean).join(' · ')}</div>
              {r.status === 'rejected' && r.reject_reason && <div className="s">{t('trace.reason', { r: r.reject_reason })}</div>}
            </div>
            <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}><AStatus status={r.status} t={t} /><Decide act="decideRefund" id={r.id} status={r.status} t={t} /></div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('fin.noRefunds')}</div>}
      </div>
    </Card>
  );
}

async function Ageing({ t }: { t: T }) {
  const sb = await createClient();
  const { data } = await sb.from('receivables_ageing').select('customer_id,name,not_due,d1_30,d31_60,d61_90,d90_plus,total_open').order('total_open', { ascending: false });
  const sum = (k: string) => (data ?? []).reduce((a: number, r: Row) => a + Number(r[k] ?? 0), 0);
  return (
    <Card title={t('fin.tab.ageing')} testid="ageing">
      <Tbl head={[`-${t('fin.customer')}`, t('fin.notDue'), '1–30', '31–60', '61–90', '90+', t('fin.total')]} empty={t('fin.noAgeing')}
        rows={[...(data ?? []).map((r: Row) => ({ key: r.customer_id, cells: [r.name, inr(r.not_due), inr(r.d1_30), inr(r.d31_60), inr(r.d61_90), inr(r.d90_plus), <b key="t">{inr(r.total_open)}</b>] })),
          ...(data?.length ? [{ key: 'sum', cells: [<b key="l">{t('fin.total')}</b>, inr(sum('not_due')), inr(sum('d1_30')), inr(sum('d31_60')), inr(sum('d61_90')), inr(sum('d90_plus')), <b key="t" data-testid="ageing-total">{inr(sum('total_open'))}</b>] }] : [])]} />
    </Card>
  );
}

async function Balances({ t }: { t: T }) {
  const sb = await createClient();
  const { data } = await sb.from('customer_balance').select('customer_id,name,credit_limit,invoices_open,credits,balance').order('balance', { ascending: false });
  return (
    <Card title={t('fin.tab.balances')} testid="balances">
      <Tbl head={[`-${t('fin.customer')}`, t('fin.open'), t('fin.credits'), t('fin.balance'), t('fin.creditLimit')]} empty={t('fin.noBalances')}
        rows={(data ?? []).map((r: Row) => ({
          key: r.customer_id,
          cells: [<span key="n" data-testid="balance-name">{r.name}</span>, inr(r.invoices_open), inr(r.credits),
            <b key="b" className={Number(r.balance) > Number(r.credit_limit) ? 'down' : ''} data-testid="balance-amt">{inr(r.balance)}</b>, inr(r.credit_limit)],
        }))} />
    </Card>
  );
}

async function Lock({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const { data } = await sb.from('tenant_rule').select('value').eq('key', 'books_locked_until').maybeSingle();
  const lock = typeof data?.value === 'string' ? data.value : null;
  return (
    <Card title={t('fin.tab.lock')} testid="lock" action={<ActBtn act="setLock" ctx={{ date: lock ?? '' }} className="btn small secondary">{t('fin.changeLock')}</ActBtn>}>
      <div className="s">{t('fin.lockHint')}</div>
      <div className="t" data-testid="lock-state" style={{ marginTop: 8 }}>{lock ? t('fin.lockedUntil', { date: dateFmt(locale)(lock) }) : t('fin.booksOpen')}</div>
    </Card>
  );
}
