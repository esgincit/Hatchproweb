'use client';
// Opens the right form for every ActBtn (demo ACT keys). Mounted once in the app shell.
// Lookup lists (farms, sheds, vendors…) load on first use through the browser client — RLS scopes them to the tenant.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { runAct } from '@/app/actions/forms';
import {
  SCHEMAS, isAct, FARM_TYPES, SHED_TYPES, VENDOR_CATS, BILL_CATS, PRODUCTS, CUSTOMER_KINDS, WORKER_ROLES, PAY_MODES,
  STAGES, PRIORITIES, ASSET_CATS, ITEM_CATS, RATE_PRODUCTS, STAFF_ROLES,
} from '@/lib/schemas';
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n/locales';
import { addDays, fmtINR } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { FormSheet, type FormSpec, type Field } from './FormSheet';

export type ActCtx = Record<string, string>;
export const openAct = (act: string, ctx: ActCtx = {}) => window.dispatchEvent(new CustomEvent('hp-act', { detail: { act, ctx } }));

type Opt = [string, string];
type Lookups = {
  farms: { id: string; name: string; farm_type: string }[];
  sheds: { id: string; name: string; farm_id: string; busy: boolean }[];
  breeds: { id: string; name: string; farm_type: string }[];
  vendors: { id: string; name: string; category: string }[];
  customers: { id: string; name: string }[];
  batches: { id: string; code: string; shed: string; ft: string; active: boolean }[];
  diseases: { code: string; name: string }[];
  open: { kind: 'bill' | 'invoice'; id: string; no: string; party: string; out: number }[];
  assets: { id: string; name: string }[];
  items: { id: string; name: string; unit: string }[];
  pos: { id: string; no: string; vendor: string; item: string; qty: number; rate: number }[];
  vaccines: { id: string; name: string; farm_type: string; age_day: number }[];
  workers: { id: string; name: string }[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST embeds */
async function loadLookups(): Promise<Lookups> {
  const sb = createClient();
  const [farms, sheds, breeds, vendors, customers, batches, diseases, bills, invoices, assets, items, pos, vaccines, workers] = await Promise.all([
    sb.from('farm').select('id,name,farm_type').order('created_at'),
    sb.from('shed').select('id,name,farm_id,batch(state)').order('name'),
    sb.from('breed').select('id,name,farm_type').order('name'),
    sb.from('vendor').select('id,name,category').order('name'),
    sb.from('customer').select('id,name').order('name'),
    sb.from('batch').select('id,code,farm_type,state,shed(name)').order('placed_on', { ascending: false }),
    sb.from('disease_master').select('code,name').order('name'),
    sb.from('bill').select('id,bill_no,total,paid,vendor(name)').neq('status', 'paid').order('due_date'),
    sb.from('invoice').select('id,invoice_no,total,paid,customer(name)').neq('status', 'paid').order('due_date'),
    sb.from('asset').select('id,name').order('name'),
    sb.from('item').select('id,name,unit').order('name'),
    sb.from('purchase_order').select('id,po_no,vendor(name),po_line(qty,rate,item(name))').in('status', ['approved', 'submitted', 'partial']).order('po_date'),
    sb.from('vaccine_master').select('id,name,farm_type,age_day').order('age_day'),
    sb.from('worker').select('id,name').eq('active', true).order('name'),
  ]);
  const d = (r: { data: unknown }) => (r.data ?? []) as any[];
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  return {
    farms: d(farms),
    sheds: d(sheds).map((s) => ({ id: s.id, name: s.name, farm_id: s.farm_id, busy: (s.batch ?? []).some((b: any) => b.state !== 'closed') })),
    breeds: d(breeds),
    vendors: d(vendors),
    customers: d(customers),
    batches: d(batches).map((b) => ({ id: b.id, code: b.code, shed: one(b.shed)?.name ?? '', ft: b.farm_type, active: b.state !== 'closed' })),
    diseases: d(diseases),
    open: [
      ...d(bills).map((b) => ({ kind: 'bill' as const, id: b.id, no: b.bill_no, party: one(b.vendor)?.name ?? '', out: Number(b.total) - Number(b.paid) })),
      ...d(invoices).map((i) => ({ kind: 'invoice' as const, id: i.id, no: i.invoice_no, party: one(i.customer)?.name ?? '', out: Number(i.total) - Number(i.paid) })),
    ],
    assets: d(assets),
    items: d(items),
    pos: d(pos).map((p) => {
      const l = p.po_line?.[0];
      return { id: p.id, no: p.po_no, vendor: one(p.vendor)?.name ?? '', item: one(l?.item)?.name ?? '', qty: Number(l?.qty ?? 0), rate: Number(l?.rate ?? 0) };
    }),
    vaccines: d(vaccines),
    workers: d(workers),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Next code in the tenant's own pattern: VKR-B-2026-14 → VKR-B-2026-15. */
export function nextBatchCode(codes: string[], year: string) {
  const nums = codes.map((c) => c.match(/^(.*?)(\d+)$/)).filter((m): m is RegExpMatchArray => !!m);
  if (!nums.length) return `B-${year}-01`;
  const best = nums.reduce((a, m) => (+m[2] > +a[2] ? m : a));
  return best[1] + String(+best[2] + 1).padStart(best[2].length, '0');
}

// Acts that reuse another form, and acts that just navigate.
const ALIAS: Record<string, string> = { addShedPick: 'addShed', addVisitPick: 'addVisit' };
const NAV: Record<string, string> = { attToday: '/more/people' };
// file downloads (app/api/export/[kind]); `report` rows pass the kind they export, or the printable page (app/(app)/report/[kind])
const DOWNLOAD: Record<string, (c: ActCtx) => string | null> = {
  tally: () => '/api/export/tally', gstr: () => '/api/export/gstr1', stmt: () => '/api/export/statements',
  payroll: () => '/api/export/bankfile', report: (c) => (c.kind ? `/api/export/${c.kind}` : c.page ? `/report/${c.page}` : null),
};
// Register grid: each tap moves the day one step P → H → A → L → P (blank days start at P).
const NEXT_ATT: Record<string, string> = { P: 'half', H: 'absent', A: 'leave', L: 'present' };
const DIRECT: Record<string, (c: ActCtx) => { act: string; input: Record<string, unknown> }> = {
  attSet: (c) => ({ act: 'attSet', input: c }),
  attCycle: (c) => ({ act: 'attSet', input: { worker_id: c.worker_id, date: c.date, status: NEXT_ATT[c.code] ?? 'present' } }),
  confirmCase: (c) => ({ act: 'confirmCase', input: { case_id: c.case } }),
  closeCase: (c) => ({ act: 'closeCase', input: { case_id: c.case } }),
  approvePay: (c) => ({ act: 'decidePay', input: { approval_id: c.approval, approve: 'yes' } }),
  rejectPay: (c) => ({ act: 'decidePay', input: { approval_id: c.approval, approve: 'no' } }),
};

export function ActionHost({ today }: { today: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [act, setAct] = useState<string>('');
  const [open, setOpen] = useState(false);
  const lookups = useRef<Lookups | null>(null);

  const finish = useCallback((r: Awaited<ReturnType<typeof runAct>>) => {
    if (!r.ok) return r;
    toast(r.msg);
    setOpen(false);
    lookups.current = null; // new farms/sheds/batches next time
    if (r.href) router.push(r.href);
    router.refresh();
  }, [router]);

  const submit = useCallback(async (values: Record<string, unknown>) => {
    const key = ALIAS[act] ?? act;
    if (!isAct(key)) return { error: t('forms.unknown') };
    const local = SCHEMAS[key].safeParse(values);
    if (!local.success) return { fields: local.error.issues.map((i) => String(i.path[0])), error: t('forms.invalid') };
    const r = await runAct(key, values);
    return r.ok ? (finish(r), undefined) : { fields: r.fields, error: r.error };
  }, [act, finish, t]);

  useEffect(() => {
    const on = async (e: Event) => {
      const { act: a, ctx } = (e as CustomEvent<{ act: string; ctx: ActCtx }>).detail;
      if (a === 'remind') return; // components/money/RemindSheet owns this act
      if (NAV[a]) return router.push(NAV[a]);
      if (a === 'attSubmit') return toast(t('forms.att.ok')); // each tap already saved
      const dl = DOWNLOAD[a]?.(ctx);
      if (dl) { window.location.href = dl; return; }
      const direct = DIRECT[a]?.(ctx);
      if (direct) { // one tap, no form
        const r = await runAct(direct.act, direct.input);
        return r.ok ? (toast(r.msg), router.refresh()) : toast(r.error);
      }
      lookups.current ??= await loadLookups();
      const s = build(ALIAS[a] ?? a, ctx, lookups.current, t, today);
      if (!s) return toast(t('common.comingNext'));
      setAct(a);
      setSpec(s);
      setOpen(true);
    };
    window.addEventListener('hp-act', on);
    return () => window.removeEventListener('hp-act', on);
  }, [router, t, today]);

  return <FormSheet spec={spec} open={open} onOpenChange={setOpen} onSubmit={submit} />;
}

type TFn = ReturnType<typeof useTranslations>;

function build(act: string, ctx: ActCtx, L: Lookups, t: TFn, today: string): FormSpec | null {
  const f = (k: string, p?: Record<string, string | number>) => t(`forms.${k}`, p);
  const none: Opt = ['', f('none')];
  const date = (id = 'date', label = f('date')): Field => ({ id, label, type: 'date', value: today, max: today, half: true, required: true });
  const activeBatches = L.batches.filter((b) => b.active);
  const batchOpts: Opt[] = activeBatches.map((b) => [b.id, `${b.code} · ${b.shed}`]);
  const vendorOpts = (cat?: string): Opt[] => L.vendors.filter((v) => !cat || v.category === cat).map((v) => [v.id, v.name]);
  const enumOpts = (vals: readonly string[], ns: string): Opt[] => vals.map((v) => [v, t(`${ns}.${v}`)]);

  switch (act) {
    case 'addFarm':
      return {
        title: f('farm.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('farm.name'), required: true },
          { id: 'farm_type', label: f('farm.type'), type: 'select', options: enumOpts(FARM_TYPES, 'farmType'), value: 'broiler' },
          { id: 'district', label: f('farm.district'), half: true },
          { id: 'village', label: f('farm.village'), half: true },
          { id: 'capacity', label: f('farm.capacity'), type: 'number' },
        ],
      };
    case 'addShed':
      if (!L.farms.length) return { title: f('shed.title'), intro: f('needFarm'), fields: [], submit: f('save') };
      return {
        title: f('shed.title'), submit: f('save'),
        fields: [
          { id: 'farm_id', label: f('shed.farm'), type: 'select', options: L.farms.map((x) => [x.id, x.name]), value: ctx.farm ?? L.farms[0].id },
          { id: 'name', label: f('shed.name'), required: true },
          { id: 'shed_type', label: f('shed.type'), type: 'select', options: enumOpts(SHED_TYPES, 'forms.shed'), value: 'deep_litter' },
          { id: 'capacity', label: f('shed.capacity'), type: 'number', half: true, required: true },
          { id: 'area_sqft', label: f('shed.area'), type: 'number', half: true },
        ],
      };
    case 'addBatch': {
      const free = L.sheds.filter((s) => !s.busy);
      if (!free.length) return { title: f('batch.title'), intro: f('noFreeShed'), fields: [], submit: f('save') };
      const farmOf = (s: (typeof free)[number]) => L.farms.find((x) => x.id === s.farm_id);
      const shed = free.find((s) => s.id === ctx.shed) ?? free[0];
      const ft = farmOf(shed)?.farm_type ?? 'broiler';
      return {
        title: f('batch.title'), intro: f('batch.intro'), submit: f('batch.submit'),
        fields: [
          { id: 'shed_id', label: f('batch.shed'), type: 'select', options: free.map((s) => [s.id, `${farmOf(s)?.name ?? ''} · ${s.name}`]), value: shed.id },
          { id: 'code', label: f('batch.code'), value: nextBatchCode(L.batches.filter((b) => b.ft === ft).map((b) => b.code), today.slice(0, 4)), required: true },
          { id: 'breed_id', label: f('batch.breed'), type: 'select', options: [none, ...L.breeds.map((b): Opt => [b.id, `${b.name} · ${t(`farmType.${b.farm_type}`)}`])] },
          date('placed', f('batch.placed')),
          { id: 'doc', label: f('batch.doc'), type: 'number', half: true, required: true },
          { id: 'doc_rate', label: f('batch.rate'), type: 'number', half: true, value: 0 },
          { id: 'vendor_id', label: f('batch.vendor'), type: 'select', options: [none, ...vendorOpts('doc_hatchery')], half: true },
        ],
      };
    }
    case 'mort':
      if (!batchOpts.length) return { title: f('mort.title'), intro: f('noActiveBatch'), fields: [], submit: f('save') };
      return {
        title: f('mort.title'), submit: f('mort.submit'),
        fields: [
          { id: 'batch_id', label: f('batch.label'), type: 'select', options: batchOpts, value: ctx.batch ?? batchOpts[0][0] },
          date(),
          { id: 'count', label: f('mort.count'), type: 'number', half: true, required: true },
          { id: 'cause', label: f('mort.cause'), type: 'select', options: [none, ...L.diseases.map((d): Opt => [d.code, d.name])] },
          { id: 'notes', label: f('notes'), type: 'textarea' },
        ],
      };
    case 'vaccDone':
      if (!ctx.vacc) return null; // the batch quick-action needs a schedule row; rows carry their own button
      return { title: f('vacc.title', { name: ctx.name ?? '' }), submit: f('vacc.submit'), hidden: { vacc_id: ctx.vacc }, fields: [date()] };
    case 'addVisit':
      if (!batchOpts.length) return { title: f('visit.title'), intro: f('noActiveBatch'), fields: [], submit: f('save') };
      return {
        title: f('visit.title'), submit: f('save'),
        fields: [
          { id: 'batch_id', label: f('batch.label'), type: 'select', options: batchOpts, value: ctx.batch ?? batchOpts[0][0] },
          date(),
          { id: 'vet', label: f('visit.vet'), half: true, required: true },
          { id: 'findings', label: f('visit.findings'), type: 'textarea' },
          { id: 'prescription', label: f('visit.rx'), type: 'textarea' },
        ],
      };
    case 'saleOpen':
      if (!L.customers.length) return { title: f('sale.title'), intro: f('needCustomer'), fields: [], submit: f('save') };
      return {
        title: f('sale.title'), intro: f('sale.intro'), submit: f('sale.submit'),
        fields: [
          { id: 'customer_id', label: f('sale.customer'), type: 'select', options: L.customers.map((c) => [c.id, c.name]) },
          { id: 'product', label: f('sale.product'), type: 'select', options: enumOpts(PRODUCTS, 'forms.sale'), value: 'egg', half: true },
          { id: 'unit', label: f('sale.unit'), half: true, value: 'egg', required: true },
          { id: 'qty', label: f('sale.qty'), type: 'number', half: true, required: true },
          { id: 'rate', label: f('sale.rate'), type: 'number', half: true, required: true },
          date(),
          { id: 'batch_id', label: f('optionalBatch'), type: 'select', options: [none, ...batchOpts], half: true, value: ctx.batch ?? '' },
        ],
      };
    case 'addBill':
      if (!L.vendors.length) return { title: f('bill.title'), intro: f('needVendor'), fields: [], submit: f('save') };
      return {
        title: f('bill.title'), submit: f('bill.submit'),
        fields: [
          { id: 'vendor_id', label: f('bill.vendor'), type: 'select', options: vendorOpts() },
          { id: 'category', label: f('bill.category'), type: 'select', options: enumOpts(BILL_CATS, 'billCat'), value: 'feed', half: true },
          { id: 'total', label: f('amount'), type: 'number', half: true, required: true },
          date(),
          { id: 'bill_no', label: f('bill.no'), half: true },
          { id: 'batch_id', label: f('optionalBatch'), type: 'select', options: [none, ...batchOpts], value: ctx.batch ?? '' },
        ],
      };
    case 'payOpen':
    case 'payQuick': {
      const docs = L.open.filter((d) => !ctx.kind || (d.kind === ctx.kind && d.id === ctx.id));
      if (!docs.length) return { title: f('pay.title'), intro: f('pay.nothing'), fields: [], submit: f('save') };
      const first = docs[0];
      return {
        title: ctx.kind === 'invoice' ? f('pay.titleIn') : ctx.kind === 'bill' ? f('pay.titleOut') : f('pay.title'),
        submit: f('pay.submit'),
        fields: [
          { id: 'doc', label: f('pay.doc'), type: 'select', value: `${first.kind}:${first.id}`,
            options: docs.map((d): Opt => [`${d.kind}:${d.id}`, `${d.kind === 'bill' ? '↗' : '↙'} ${d.party} · ${d.no} · ${fmtINR(d.out)}`]) },
          { id: 'amount', label: f('amount'), type: 'number', half: true, value: Math.round(first.out * 100) / 100, required: true },
          { id: 'mode', label: f('pay.mode'), type: 'select', options: enumOpts(PAY_MODES, 'forms.pay'), value: 'upi', half: true },
          date(),
          { id: 'utr', label: f('pay.utr'), half: true },
        ],
        transform: ({ doc, ...rest }) => { const [kind, id] = (doc ?? '').split(':'); return { ...rest, kind, id }; },
      };
    }
    case 'addCustomer':
      return {
        title: f('customer.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'kind', label: f('customer.kind'), type: 'select', options: enumOpts(CUSTOMER_KINDS, 'forms.customer'), half: true },
          { id: 'phone', label: f('phone'), type: 'tel', half: true },
          { id: 'credit_limit', label: f('customer.limit'), type: 'number', half: true, value: 0 },
          { id: 'credit_days', label: f('customer.days'), type: 'number', half: true, value: 7 },
        ],
      };
    case 'addVendor':
      return {
        title: f('vendor.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'category', label: f('vendor.category'), type: 'select', options: enumOpts(VENDOR_CATS, 'vendorCat'), value: 'feed' },
          { id: 'contact', label: f('vendor.contact'), half: true },
          { id: 'phone', label: f('phone'), type: 'tel', half: true },
          { id: 'gstin', label: f('vendor.gstin'), half: true, placeholder: '36ABCDE1234F1Z5' },
          { id: 'terms', label: f('vendor.terms'), type: 'number', half: true, value: 15 },
        ],
      };
    case 'addWorker':
      if (!L.farms.length) return { title: f('worker.title'), intro: f('needFarm'), fields: [], submit: f('save') };
      return {
        title: f('worker.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'role', label: f('worker.role'), type: 'select', options: enumOpts(WORKER_ROLES, 'forms.worker'), value: 'helper', half: true },
          { id: 'farm_id', label: f('shed.farm'), type: 'select', options: L.farms.map((x) => [x.id, x.name]), half: true },
          { id: 'wage', label: f('worker.wage'), type: 'number', half: true, required: true },
          { id: 'phone', label: f('phone'), type: 'tel', half: true },
        ],
      };
    case 'closeBatch':
      return {
        title: f('close.title'), intro: f('close.intro'), submit: f('close.submit'), danger: true, hidden: { batch_id: ctx.batch },
        fields: [
          date(),
          { id: 'customer_id', label: f('close.customer'), type: 'select', options: [none, ...L.customers.map((c): Opt => [c.id, c.name])], half: true },
          { id: 'weight_kg', label: f('close.weight'), type: 'number', half: true },
          { id: 'rate', label: f('close.rate'), type: 'number', half: true },
        ],
      };
    case 'batchState':
      return {
        title: f('stage.title'), submit: f('stage.submit'), hidden: { batch_id: ctx.batch },
        fields: [{ id: 'state', label: f('stage.state'), type: 'select', options: enumOpts(STAGES, 'state'), value: ctx.state, half: true }, date()],
      };
    case 'addVacc': {
      const vs = L.vaccines.filter((v) => !ctx.ft || v.farm_type === ctx.ft);
      return {
        title: f('addVacc.title'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { id: 'vaccine_id', label: f('addVacc.vaccine'), type: 'select', options: vs.map((v): Opt => [v.id, `${v.name} · ${t('common.day', { n: v.age_day })}`]) },
          { ...date('due', f('addVacc.due')), max: undefined },
        ],
      };
    }
    case 'reportIssue':
      return {
        title: f('issue.title', { name: ctx.name ?? '' }), submit: f('issue.submit'), hidden: { asset_id: ctx.asset },
        fields: [
          { id: 'issue', label: f('issue.issue'), type: 'textarea', required: true },
          { id: 'priority', label: f('issue.priority'), type: 'select', options: enumOpts(PRIORITIES, 'forms.issue'), value: 'medium', half: true },
          date(),
        ],
      };
    case 'closeTicket':
      return {
        title: f('ticket.title', { name: ctx.name ?? '' }), submit: f('ticket.submit'), hidden: { ticket_id: ctx.ticket },
        fields: [
          date(),
          { id: 'cost', label: f('ticket.cost'), type: 'number', half: true },
          { id: 'vendor_id', label: f('ticket.vendor'), type: 'select', options: [none, ...vendorOpts()] },
        ],
      };
    case 'addAsset':
      if (!L.farms.length) return { title: f('asset.title'), intro: f('needFarm'), fields: [], submit: f('save') };
      return {
        title: f('asset.title'), intro: f('asset.intro'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'farm_id', label: f('shed.farm'), type: 'select', options: L.farms.map((x): Opt => [x.id, x.name]), half: true },
          { id: 'category', label: f('asset.category'), type: 'select', options: enumOpts(ASSET_CATS, 'assetCat'), half: true, value: 'fan' },
          { id: 'cost', label: f('asset.cost'), type: 'number', half: true },
          { ...date('date', f('asset.purchased')) },
          { id: 'next_service', label: f('asset.next'), type: 'date', value: addDays(today, 90), half: true, required: true },
          { id: 'vendor_id', label: f('ticket.vendor'), type: 'select', options: [none, ...vendorOpts()] },
        ],
      };
    case 'serviceDone':
      return {
        title: f('service.title', { name: ctx.name ?? '' }), submit: f('service.submit'), hidden: { asset_id: ctx.asset },
        fields: [date(), { id: 'next_service', label: f('asset.next'), type: 'date', value: addDays(today, 90), half: true, required: true }],
      };
    case 'addItem':
      return {
        title: f('item.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'category', label: f('item.category'), type: 'select', options: enumOpts(ITEM_CATS, 'itemCat'), value: 'feed', half: true },
          { id: 'unit', label: f('item.unit'), value: 'bag50', half: true, required: true },
          { id: 'reorder', label: f('item.reorder'), type: 'number', half: true },
          { id: 'gst', label: f('item.gst'), type: 'number', half: true, value: 0 },
        ],
      };
    case 'raisePO':
      if (!L.vendors.length || !L.items.length) return { title: f('po.title'), intro: f('po.needBoth'), fields: [], submit: f('save') };
      return {
        title: f('po.title'), submit: f('po.submit'),
        fields: [
          { id: 'vendor_id', label: f('bill.vendor'), type: 'select', options: vendorOpts(), value: ctx.vendor },
          { id: 'item_id', label: f('po.item'), type: 'select', options: L.items.map((i): Opt => [i.id, `${i.name} · ${i.unit}`]), value: ctx.item },
          { id: 'qty', label: f('po.qty'), type: 'number', half: true, required: true },
          { id: 'rate', label: f('po.rate'), type: 'number', half: true, required: true },
          { id: 'expected', label: f('po.expected'), type: 'date', value: addDays(today, 3), half: true, required: true },
          date(),
        ],
      };
    case 'grnOpen': {
      if (!L.pos.length) return { title: f('grn.title'), intro: f('grn.none'), fields: [], submit: f('save') };
      const po = L.pos.find((p) => p.id === ctx.po) ?? L.pos[0];
      return {
        title: f('grn.title'), intro: f('grn.intro'), submit: f('grn.submit'),
        fields: [
          { id: 'po_id', label: f('grn.po'), type: 'select', value: po.id,
            options: L.pos.map((p): Opt => [p.id, `${p.no} · ${p.vendor} · ${p.item} · ${p.qty} @ ₹${p.rate}`]) },
          { id: 'qty', label: f('grn.qty'), type: 'number', value: po.qty, half: true, required: true },
          { id: 'bill_amount', label: f('grn.bill'), type: 'number', half: true, required: true },
          date(),
          { id: 'lot', label: f('grn.lot'), half: true },
          { id: 'expiry', label: f('grn.expiry'), type: 'date', half: true },
        ],
      };
    }
    case 'addRate':
      return {
        title: f('rate.title'), submit: f('save'),
        fields: [
          { id: 'product', label: f('rate.product'), type: 'select', options: enumOpts(RATE_PRODUCTS, 'forms.rate'), value: 'egg', half: true },
          { id: 'zone', label: f('rate.zone'), value: f('rate.local'), half: true, required: true },
          { id: 'rate', label: f('rate.rate'), type: 'number', half: true, required: true },
          date(),
        ],
      };
    case 'addDoc':
      return {
        title: f('doc.title'), submit: f('save'),
        fields: [
          { id: 'name', label: f('doc.name'), required: true, placeholder: 'PCB consent to operate' },
          { id: 'ref_no', label: f('doc.ref'), half: true },
          { id: 'expires', label: f('doc.expires'), type: 'date', half: true },
        ],
      };
    case 'setBank':
      if (!L.workers.length) return { title: f('bank.title'), intro: f('advance.noWorkers'), fields: [], submit: f('save') };
      return {
        title: f('bank.title'), intro: f('bank.intro'), submit: f('save'),
        fields: [
          { id: 'worker_id', label: f('advance.worker'), type: 'select', options: L.workers.map((w): Opt => [w.id, w.name]), value: ctx.worker },
          { id: 'account_no', label: f('bank.account'), required: true, half: true },
          { id: 'ifsc', label: f('bank.ifsc'), required: true, half: true },
        ],
      };
    case 'addAdvance':
      if (!L.workers.length) return { title: f('advance.title'), intro: f('advance.noWorkers'), fields: [], submit: f('save') };
      return {
        title: f('advance.title'), submit: f('save'),
        fields: [
          { id: 'worker_id', label: f('advance.worker'), type: 'select', options: L.workers.map((w): Opt => [w.id, w.name]), value: ctx.worker },
          { id: 'amount', label: f('amount'), type: 'number', half: true, required: true },
          date(),
          { id: 'reason', label: f('advance.reason') },
        ],
      };
    case 'inviteUser':
      return {
        title: f('invite.title'), intro: f('invite.intro'), submit: f('invite.submit'),
        fields: [
          { id: 'name', label: f('name'), required: true },
          { id: 'phone', label: f('invite.phone'), type: 'tel', placeholder: '98490 12345', half: true, required: true },
          { id: 'role', label: f('worker.role'), type: 'select', options: STAFF_ROLES.map((r): Opt => [r, t(`roles.${r}`)]), value: 'shed_supervisor', half: true },
          { id: 'language', label: t('common.language'), type: 'select', options: LOCALES.map((l): Opt => [l, LOCALE_NAMES[l]]), value: 'te', half: true },
          { id: 'farm_id', label: f('invite.farm'), type: 'select', options: [[ '', f('invite.allFarms') ], ...L.farms.map((x): Opt => [x.id, x.name])], half: true },
        ],
      };
    default:
      return null;
  }
}
