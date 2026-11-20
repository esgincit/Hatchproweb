// Procurement (0051/0053): purchase requisitions, PO approval above the owner's limit, stock counts with approved adjustments,
// store-to-store transfers, supplier KPIs. Goods receipt stays on More > Stock (the PO list there links here for approval).
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtINR, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Chips, Header } from '@/components/ui/bits';
import { AStatus, Card, Decide, Tbl, nz, one, pct, type Row, type T } from './bits';

export const PROC_TABS = ['requisitions', 'orders', 'counts', 'transfers', 'suppliers'] as const;

export async function ProcurementArea({ tab: q }: { tab?: string }) {
  const t = await getTranslations();
  const tab = (PROC_TABS as readonly string[]).includes(q ?? '') ? q! : 'requisitions';
  const chips = <Chips active={tab} items={PROC_TABS.map((k): [string, string, string] => [k === 'requisitions' ? '/more/procurement' : `/more/procurement?tab=${k}`, k, t(`proc.tab.${k}`)])} />;
  const action = tab === 'requisitions' ? <ActBtn act="addReq" className="btn small">{t('proc.newReq')}</ActBtn>
    : tab === 'counts' ? <ActBtn act="addCount" className="btn small">{t('proc.newCount')}</ActBtn>
    : tab === 'transfers' ? <ActBtn act="addStockXfer" className="btn small">{t('proc.newXfer')}</ActBtn> : undefined;
  return (
    <>
      <Header title={t('proc.title')} action={action} />
      {chips}
      {tab === 'requisitions' && <Reqs t={t} />}
      {tab === 'orders' && <Orders t={t} />}
      {tab === 'counts' && <Counts t={t} />}
      {tab === 'transfers' && <Transfers t={t} />}
      {tab === 'suppliers' && <Suppliers t={t} />}
    </>
  );
}

const reason = (t: T, r: Row) => (r.status === 'rejected' && r.reject_reason ? <div className="s">{t('trace.reason', { r: r.reject_reason })}</div> : null);
const Resubmit = ({ act, id, status, t }: { act: string; id: string; status: string; t: T }) =>
  status === 'draft' || status === 'rejected' ? <ActBtn act={act} ctx={{ id }} className="btn small">{t('proc.submit')}</ActBtn> : null;

async function Reqs({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data } = await sb.from('purchase_requisition').select('id,qty,needed_by,est_rate,purpose,status,reject_reason,item(name,unit),farm(name)').order('created_at', { ascending: false }).limit(200);
  return (
    <Card title={t('proc.tab.requisitions')} testid="reqs">
      <div className="list">
        {(data ?? []).map((r: Row) => (
          <div className="item" key={r.id} data-testid="req-row" data-item={one(r.item)?.name}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{one(r.item)?.name} · {fmtN(Number(r.qty))} {one(r.item)?.unit}</div>
              <div className="s">{[one(r.farm)?.name, r.needed_by ? t('proc.neededBy', { date: dmy(r.needed_by) }) : null, r.est_rate != null ? `₹${r.est_rate}` : null, r.purpose].filter(Boolean).join(' · ')}</div>
              {reason(t, r)}
            </div>
            <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <AStatus status={r.status} t={t} /><Resubmit act="submitReq" id={r.id} status={r.status} t={t} />
              <Decide act="decideReq" id={r.id} status={r.status === 'submitted' ? 'submitted' : ''} t={t} />
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('proc.noReqs')}</div>}
      </div>
    </Card>
  );
}

async function Orders({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const [{ data }, { data: rule }] = await Promise.all([
    sb.from('purchase_order').select('id,po_no,po_date,expected_on,status,total,vendor(name)').order('po_date', { ascending: false }).order('po_no', { ascending: false }).limit(100),
    sb.from('tenant_rule').select('value').eq('key', 'po_approval_above').maybeSingle(),
  ]);
  return (
    <Card title={t('proc.tab.orders')} testid="pos">
      <div className="s" data-testid="po-limit">{rule?.value != null ? t('proc.poLimit', { amt: fmtINR(Number(rule.value)) }) : t('proc.poNoLimit')}</div>
      <div className="list">
        {(data ?? []).map((p: Row) => (
          <div className="item" key={p.id} data-testid="po-row" data-no={p.po_no}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{p.po_no} · {one(p.vendor)?.name}</div>
              <div className="s">{fmtINR(Number(p.total))} · {dmy(p.po_date)}{p.expected_on ? ` · ${t('sections.expected', { date: dmy(p.expected_on) })}` : ''}</div>
            </div>
            <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <AStatus status={p.status} t={t} />
              {['draft', 'submitted'].includes(p.status) && <ActBtn act="approvePO" ctx={{ id: p.id }} className="btn small">{t('trace.approve')}</ActBtn>}
              {['draft', 'submitted', 'approved'].includes(p.status) && <ActBtn act="cancelPO" ctx={{ id: p.id }} className="btn small secondary">{t('proc.cancelPo')}</ActBtn>}
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('sections.noPos')}</div>}
      </div>
    </Card>
  );
}

async function Counts({ t }: { t: T }) {
  const [sb, locale] = [await createClient(), await getLocale()];
  const dmy = dateFmt(locale);
  const { data } = await sb.from('stock_count').select('id,counted_on,note,status,reject_reason,store(name),stock_count_line(counted_qty,system_qty,item(name,unit))').order('created_at', { ascending: false }).limit(100);
  return (
    <Card title={t('proc.tab.counts')} testid="counts">
      <div className="list">
        {(data ?? []).map((c: Row) => (
          <div key={c.id} data-testid="count-row" data-note={c.note ?? ''}>
            <div className="item">
              <div style={{ minWidth: 0 }}>
                <div className="t">{one(c.store)?.name} · {dmy(c.counted_on)}</div>
                <div className="s">{t('proc.nLines', { n: c.stock_count_line?.length ?? 0 })}{c.note ? ` · ${c.note}` : ''}</div>
                {reason(t, c)}
              </div>
              <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <AStatus status={c.status} t={t} /><Resubmit act="submitCount" id={c.id} status={c.status} t={t} />
                <Decide act="decideCount" id={c.id} status={c.status === 'submitted' ? 'submitted' : ''} t={t} />
              </div>
            </div>
            {(c.stock_count_line ?? []).map((l: Row, i: number) => (
              <div className="item" key={i} style={{ paddingLeft: 16 }} data-testid="count-line">
                <div className="s">{one(l.item)?.name}: {nz(l.counted_qty, 2)} {one(l.item)?.unit}{l.system_qty != null ? ` · ${t('proc.book', { n: nz(l.system_qty, 2) })} · ${t('proc.diff', { n: (Number(l.counted_qty) - Number(l.system_qty)).toFixed(2) })}` : ''}</div>
              </div>
            ))}
          </div>
        ))}
        {!data?.length && <div className="s">{t('proc.noCounts')}</div>}
      </div>
    </Card>
  );
}

async function Transfers({ t }: { t: T }) {
  const sb = await createClient();
  const { data } = await sb.from('stock_transfer').select('id,qty,received_qty,status,reject_reason,item(name,unit),src:store!from_store(name),dst:store!to_store(name)').order('created_at', { ascending: false }).limit(100);
  return (
    <Card title={t('proc.tab.transfers')} testid="stock-xfers">
      <div className="list">
        {(data ?? []).map((x: Row) => (
          <div className="item" key={x.id} data-testid="xfer-row" data-item={one(x.item)?.name}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{one(x.item)?.name} · {nz(x.qty, 2)} {one(x.item)?.unit}</div>
              <div className="s">{one(x.src)?.name} → {one(x.dst)?.name}{x.received_qty != null ? ` · ${t('proc.receivedQty', { n: nz(x.received_qty, 2) })}` : ''}</div>
              {reason(t, x)}
            </div>
            <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <AStatus status={x.status} t={t} />
              <Decide act="decideStockXfer" id={x.id} status={x.status === 'submitted' ? 'submitted' : ''} t={t} />
              {x.status === 'approved' && <ActBtn act="sendStockXfer" ctx={{ id: x.id }} className="btn small">{t('proc.send')}</ActBtn>}
              {x.status === 'in_transit' && <ActBtn act="receiveStockXfer" ctx={{ id: x.id, qty: String(x.qty) }} className="btn small">{t('proc.receive')}</ActBtn>}
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('proc.noXfers')}</div>}
      </div>
    </Card>
  );
}

async function Suppliers({ t }: { t: T }) {
  const sb = await createClient();
  const { data } = await sb.from('supplier_kpi').select('vendor_id,name,purchase_orders,receipts,on_time_pct,avg_bill_vs_po_pct').order('name');
  return (
    <Card title={t('proc.tab.suppliers')} testid="suppliers">
      <Tbl head={[`-${t('proc.supplier')}`, t('proc.pos'), t('proc.receipts'), t('proc.onTime'), t('proc.billVsPo')]} empty={t('proc.noSuppliers')}
        rows={(data ?? []).map((r: Row) => ({ key: r.vendor_id, cells: [r.name, nz(r.purchase_orders), nz(r.receipts), pct(r.on_time_pct), r.avg_bill_vs_po_pct == null ? '—' : `${Number(r.avg_bill_vs_po_pct) > 0 ? '+' : ''}${r.avg_bill_vs_po_pct}%`] }))} />
    </Card>
  );
}
