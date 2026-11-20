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
  STAGES, PRIORITIES, ASSET_CATS, ITEM_CATS, RATE_PRODUCTS, STAFF_ROLES, DIET_STAGES, WATER_TREAT, WATER_QUAL, VENT, LITTER, POWER, MACHINE_KINDS,
} from '@/lib/schemas';
import { LOCALES, LOCALE_NAMES } from '@/lib/i18n/locales';
import { addDays, fmtINR } from '@/lib/format';
import { settleable } from '@/lib/trace';
import { ruleDef } from '@/lib/rules';
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
  batches: { id: string; code: string; shed: string; shed_id: string; ft: string; active: boolean }[];
  /** setters, hatchers and combined machines (assets with a machine kind, 0041) */
  machines: { id: string; name: string; no: string | null; kind: string; cap: number }[];
  diseases: { code: string; name: string }[];
  open: { kind: 'bill' | 'invoice'; id: string; no: string; party: string; out: number }[];
  assets: { id: string; name: string }[];
  items: { id: string; name: string; unit: string }[];
  pos: { id: string; no: string; vendor: string; item: string; qty: number; rate: number }[];
  vaccines: { id: string; name: string; farm_type: string; age_day: number }[];
  workers: { id: string; name: string }[];
  contracts: { id: string; name: string }[];
  /** received egg transfers with eggs still free to set */
  lots: { id: string; ref: string; src: string; left: number }[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST embeds */
async function loadLookups(): Promise<Lookups> {
  const sb = createClient();
  const [farms, sheds, breeds, vendors, customers, batches, diseases, bills, invoices, assets, items, pos, vaccines, workers, contracts, lots, machines] = await Promise.all([
    sb.from('farm').select('id,name,farm_type').order('created_at'),
    sb.from('shed').select('id,name,farm_id,batch(state)').order('name'),
    sb.from('breed').select('id,name,farm_type').order('name'),
    sb.from('vendor').select('id,name,category').order('name'),
    sb.from('customer').select('id,name').order('name'),
    sb.from('batch').select('id,code,farm_type,state,shed_id,shed(name)').order('placed_on', { ascending: false }),
    sb.from('disease_master').select('code,name').order('name'),
    sb.from('bill').select('id,bill_no,total,paid,vendor(name)').neq('status', 'paid').order('due_date'),
    sb.from('invoice').select('id,invoice_no,total,paid,customer(name)').neq('status', 'paid').order('due_date'),
    sb.from('asset').select('id,name').order('name'),
    sb.from('item').select('id,name,unit').order('name'),
    sb.from('purchase_order').select('id,po_no,vendor(name),po_line(qty,rate,item(name))').in('status', ['approved', 'submitted', 'partial']).order('po_date'),
    sb.from('vaccine_master').select('id,name,farm_type,age_day').order('age_day'),
    sb.from('worker').select('id,name').eq('active', true).order('name'),
    sb.from('contract').select('id,name').eq('active', true).order('created_at'),
    sb.from('egg_transfer').select('id,ref,received_qty,receipt_rejects,batch(code),vendor(name),setting_lot(qty)').eq('status', 'received').order('received_on'),
    sb.from('asset').select('id,name,machine_no,machine_kind,capacity_eggs').not('machine_kind', 'is', null).order('name'),
  ]);
  const d = (r: { data: unknown }) => (r.data ?? []) as any[];
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  return {
    farms: d(farms),
    sheds: d(sheds).map((s) => ({ id: s.id, name: s.name, farm_id: s.farm_id, busy: (s.batch ?? []).some((b: any) => b.state !== 'closed') })),
    breeds: d(breeds),
    vendors: d(vendors),
    customers: d(customers),
    batches: d(batches).map((b) => ({ id: b.id, code: b.code, shed: one(b.shed)?.name ?? '', shed_id: b.shed_id, ft: b.farm_type, active: b.state !== 'closed' })),
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
    machines: d(machines).map((m) => ({ id: m.id, name: m.name, no: m.machine_no, kind: m.machine_kind, cap: m.capacity_eggs })),
    workers: d(workers),
    contracts: d(contracts),
    lots: d(lots).map((x) => ({
      id: x.id, ref: x.ref, src: one(x.batch)?.code ?? one(x.vendor)?.name ?? '',
      left: settleable(x.received_qty, x.receipt_rejects, (x.setting_lot ?? []).reduce((a: number, l: any) => a + l.qty, 0)),
    })).filter((x) => x.left > 0),
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
const ALIAS: Record<string, string> = { addShedPick: 'addShed', addVisitPick: 'addVisit', rejectTransfer: 'decideTransfer' };
const keyOf = (a: string) => ALIAS[a] ?? a.replace(/^(approve|reject):/, ''); // approve:decideDaily / reject:decideDaily act on that approval flow
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
  submitTransfer: (c) => ({ act: 'submitTransfer', input: { transfer_id: c.transfer } }),
  approveTransfer: (c) => ({ act: 'decideTransfer', input: { transfer_id: c.transfer, decision: 'approve' } }),
  cancelTransfer: (c) => ({ act: 'cancelTransfer', input: { transfer_id: c.transfer } }),
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
    const key = keyOf(act);
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
        lookups.current = null;
        return r.ok ? (toast(r.msg), router.refresh()) : toast(r.error);
      }
      if (a.startsWith('approve:')) { // one tap on a record row
        const r = await runAct(keyOf(a), { id: ctx.id, decision: 'approve' });
        return r.ok ? (toast(r.msg), router.refresh()) : toast(r.error);
      }
      lookups.current ??= await loadLookups();
      const s = build(keyOf(a), ctx, lookups.current, t, today);
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
  const tr = (k: string, p?: Record<string, string | number>) => t(`trace.${k}`, p);
  const enumOpts = (vals: readonly string[], ns: string): Opt[] => vals.map((v) => [v, t(`${ns}.${v}`)]);
  const e = (k: string, p?: Record<string, string | number>) => t(`erp.${k}`, p);
  const num = (id: string, label: string, o: Partial<Field> = {}): Field => ({ id, label, type: 'number', half: true, ...o });
  const pick = (id: string, label: string, vals: readonly string[], ns: string): Field => ({ id, label, type: 'select', half: true, options: [none, ...enumOpts(vals, `erp.${ns}`)] });
  const yn: Opt[] = [['no', e('no')], ['yes', e('yes')]];
  const machineOpts = (kinds: string[]): Opt[] => L.machines.filter((m) => kinds.includes(m.kind)).map((m): Opt => [m.id, `${m.name}${m.no ? ` · ${m.no}` : ''} · ${e('f.capShort', { n: m.cap })}`]);

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
          ...(ft === 'breeder'
            ? [{ id: 'females_placed', label: e('f.females'), type: 'number', half: true, required: true } as Field, { id: 'males_placed', label: e('f.males'), type: 'number', half: true, required: true } as Field]
            : [{ id: 'doc', label: f('batch.doc'), type: 'number', half: true, required: true } as Field]),
          { id: 'doc_rate', label: f('batch.rate'), type: 'number', half: true, value: 0 },
          { id: 'vendor_id', label: f('batch.vendor'), type: 'select', options: [none, ...vendorOpts('doc_hatchery')], half: true },
        ],
        // breeder flock: the chicks placed are females + males
        transform: ft === 'breeder' ? (v) => ({ ...v, doc: String((+v.females_placed || 0) + (+v.males_placed || 0)) }) : undefined,
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
          { id: 'product', label: f('sale.product'), type: 'select', options: enumOpts(PRODUCTS, 'forms.sale'), value: ctx.product ?? 'egg', half: true },
          { id: 'unit', label: f('sale.unit'), half: true, value: ctx.unit ?? 'egg', required: true },
          { id: 'qty', label: f('sale.qty'), type: 'number', half: true, required: true, value: ctx.qty }, // hatchery dispatch prefills chicks in stock
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
            follow: { target: 'amount', values: Object.fromEntries(docs.map((d) => [`${d.kind}:${d.id}`, Math.round(d.out * 100) / 100])) }, // the amount is what that document still owes
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
    case 'addContract':
      if (!L.customers.length) return { title: f('contract.title'), intro: f('needCustomer'), fields: [], submit: f('save') };
      return {
        title: f('contract.title'), intro: f('contract.intro'), submit: f('save'),
        fields: [
          { id: 'customer_id', label: f('contract.integrator'), type: 'select', options: L.customers.map((c): Opt => [c.id, c.name]) },
          { id: 'name', label: f('name'), required: true, value: `${today.slice(0, 4)} growing charge` },
          { id: 'base_rate', label: f('contract.base'), type: 'number', half: true, required: true },
          { id: 'std_fcr', label: f('contract.stdFcr'), type: 'number', half: true, required: true, value: '1.7' },
          { id: 'fcr_bonus', label: f('contract.bonus'), type: 'number', half: true, value: '0.1' },
          { id: 'fcr_penalty', label: f('contract.penalty'), type: 'number', half: true, value: '0.1' },
          { id: 'min_rate', label: f('contract.floor'), type: 'number', half: true, value: '0' },
          { id: 'allowed_mort_pct', label: f('contract.allowedMort'), type: 'number', half: true, value: '5' },
          { id: 'mort_penalty', label: f('contract.mortPenalty'), type: 'number', half: true, value: '0' },
        ],
      };
    case 'linkContract':
      if (!L.contracts.length) return { title: f('contract.linkTitle'), intro: f('contract.noneYet'), fields: [], submit: f('save') };
      return {
        title: f('contract.linkTitle'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [{ id: 'contract_id', label: f('contract.label'), type: 'select', options: L.contracts.map((c): Opt => [c.id, c.name]) }],
      };
    case 'settleContract':
      return {
        title: f('contract.settleTitle'), intro: f('contract.settleIntro'), submit: f('contract.settleSubmit'), hidden: { batch_id: ctx.batch },
        fields: [
          date(),
          { id: 'lifted_birds', label: f('contract.liftedBirds'), type: 'number', half: true, required: true, value: ctx.birds },
          { id: 'lifted_kg', label: f('contract.liftedKg'), type: 'number', half: true, required: true, value: ctx.kg },
        ],
      };
    case 'hatchCandle':
      return {
        title: f('hatch.candleTitle'), intro: f('hatch.candleIntro', { set: ctx.set ?? '' }), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { ...date(), value: ctx.candled ?? today },
          { id: 'clears', label: f('hatch.clears'), type: 'number', half: true, required: true, value: ctx.clears },
          { id: 'dead_germ', label: f('hatch.deadGerm'), type: 'number', half: true, required: true, value: ctx.dead },
        ],
      };
    case 'hatchResult':
      return {
        title: f('hatch.resultTitle'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { ...date(), value: ctx.hatched ?? today },
          { id: 'chicks_a', label: f('hatch.chicksA'), type: 'number', half: true, required: true, value: ctx.a },
          { id: 'chicks_b', label: f('hatch.chicksB'), type: 'number', half: true, required: true, value: ctx.b ?? '0' },
          { id: 'culls', label: f('hatch.culls'), type: 'number', half: true, required: true, value: ctx.culls ?? '0' },
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
    case 'addTransfer': {
      const flocks = L.batches.filter((b) => b.ft === 'breeder' && b.active);
      const hatcheries = L.farms.filter((x) => x.farm_type === 'hatchery');
      if (!flocks.length && !L.vendors.length) return { title: tr('form.title'), intro: tr('form.needSource'), fields: [], submit: f('save') };
      if (!hatcheries.length) return { title: tr('form.title'), intro: tr('form.needHatchery'), fields: [], submit: f('save') };
      return {
        title: tr('form.title'), submit: f('save'),
        fields: [
          { id: 'src', label: tr('form.source'), type: 'select', options: [
            ...flocks.map((b): Opt => [`flock:${b.id}`, tr('form.flock', { name: b.code })]),
            ...L.vendors.map((x): Opt => [`vendor:${x.id}`, tr('form.supplier', { name: x.name })])] },
          { id: 'to_farm_id', label: tr('form.to'), type: 'select', options: hatcheries.map((x): Opt => [x.id, x.name]) },
          date('laid_from', tr('form.laidFrom')), date('laid_to', tr('form.laidTo')), date('sent_on', tr('form.sentOn')),
          { id: 'qty', label: tr('form.qty'), type: 'number', half: true, required: true },
          { id: 'trays', label: tr('form.trays'), type: 'number', half: true },
          { id: 'vehicle_no', label: tr('form.vehicle'), half: true },
          { id: 'driver_name', label: tr('form.driver'), half: true },
          { id: 'status', label: tr('form.status'), type: 'select', value: 'submitted', options: [['submitted', tr('form.asSubmit')], ['draft', tr('form.asDraft')]] },
        ],
        transform: ({ src, ...rest }) => { const [kind, id] = (src ?? '').split(':'); return { ...rest, [kind === 'flock' ? 'flock_id' : 'vendor_id']: id }; },
      };
    }
    case 'decideTransfer': // opened by rejectTransfer: approve is one tap
      return {
        title: tr('form.rejectTitle'), submit: tr('reject'), danger: true, hidden: { transfer_id: ctx.transfer, decision: 'reject' },
        fields: [{ id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }],
      };
    case 'receiveTransfer':
      return {
        title: tr('form.receiveTitle'), submit: tr('receive'), hidden: { transfer_id: ctx.transfer },
        fields: [
          { id: 'received_qty', label: tr('form.receivedQty'), type: 'number', half: true, required: true, value: ctx.qty },
          { id: 'rejects', label: tr('form.rejects'), type: 'number', half: true, required: true, value: '0' },
          date('date', tr('form.receiveDate')),
          { id: 'note', label: tr('form.receiptNote'), type: 'textarea' },
        ],
      };
    case 'loadSetting': {
      if (!L.lots.length) return { title: tr('form.loadTitle'), intro: tr('form.noneReceived'), fields: [], submit: f('save') };
      const first = L.lots[0];
      return {
        title: tr('form.loadTitle'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { id: 'transfer_id', label: tr('form.transfer'), type: 'select', value: first.id,
            follow: { target: 'qty', values: Object.fromEntries(L.lots.map((x) => [x.id, x.left])) },
            options: L.lots.map((x): Opt => [x.id, tr('form.transferOpt', { ref: x.ref, src: x.src, left: x.left })]) },
          { id: 'qty', label: tr('form.loadQty'), type: 'number', required: true, value: first.left },
          { id: 'age_override_reason', label: tr('form.override') },
        ],
      };
    }
    case 'setRule': {
      const r = ruleDef(ctx.key ?? '');
      if (!r) return null;
      const bool = r.key === 'allow_self_approval' ? [tr('rules.allowed'), tr('rules.blocked')] : [e('yes'), e('no')];
      const field: Field = r.kind === 'bool' ? { id: 'value', label: e(`rule.${r.key}`), type: 'select', value: ctx.value, options: [['yes', bool[0]], ['no', bool[1]]] }
        : r.kind === 'enum' ? { id: 'value', label: e(`rule.${r.key}`), type: 'select', value: ctx.value, options: enumOpts(r.opts!, 'erp.rule.v') }
        : { id: 'value', label: r.key === 'egg_max_storage_days' ? tr('rules.daysVal') : e(`rule.${r.key}`), type: 'number', step: 'any', required: true, value: ctx.value, hint: `(${r.min}–${r.max})` };
      return { title: tr('rules.formTitle'), submit: f('save'), hidden: { key: ctx.key }, fields: [field] };
    }
    // ---- breeder flock (0038/0039): the flock / house / machine id comes from the button that opened the form
    case 'breederDaily':
      return {
        title: e('daily.title'), intro: e('daily.intro'), submit: e('submit'), hidden: { batch_id: ctx.batch },
        fields: [
          date(),
          num('female_mort', e('f.femaleMort'), { value: '0', required: true }), num('male_mort', e('f.maleMort'), { value: '0', required: true }),
          num('female_culls', e('f.femaleCulls'), { value: '0', required: true }), num('male_culls', e('f.maleCulls'), { value: '0', required: true }),
          num('feed_f_kg', e('f.feedF'), { step: 'any' }), num('feed_m_kg', e('f.feedM'), { step: 'any' }),
          pick('diet_stage', e('f.diet'), DIET_STAGES, 'diet'), num('cleanup_hours', e('f.cleanup'), { step: 'any' }),
          num('water_l', e('f.water'), { step: 'any' }), num('light_hours', e('f.light'), { step: 'any' }),
          pick('water_treatment', e('f.waterTreat'), WATER_TREAT, 'wtreat'), pick('water_quality', e('f.waterQual'), WATER_QUAL, 'wqual'),
          { id: 'remarks', label: f('notes'), type: 'textarea' },
        ],
      };
    case 'bodyWeight':
      return {
        title: e('bw.title'), intro: e('bw.intro'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('bw.weighedOn')),
          { id: 'sex', label: e('f.sex'), type: 'select', half: true, options: [['F', e('f.female')], ['M', e('f.male')]] },
          num('sample_size', e('f.sample'), { required: true }), num('avg_g', e('f.avgG'), { required: true }),
          num('uniformity_pct', e('f.uniformity'), { step: 'any' }), num('cv_pct', e('f.cv'), { step: 'any' }),
          num('fleshing_score', e('f.fleshing'), { hint: '1–5' }),
        ],
      };
    case 'eggCollection':
      return {
        title: e('egg.title'), intro: e('egg.intro'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('egg.collectedOn')), num('collection_no', e('egg.no'), { value: '1', required: true, hint: '1–6' }),
          num('nest', e('egg.nest'), { required: true }), num('floor', e('egg.floor'), { value: '0', required: true }),
          num('broken', e('egg.broken'), { value: '0' }), num('cracked', e('egg.cracked'), { value: '0' }),
          num('dirty', e('egg.dirty'), { value: '0' }), num('dirty_treated', e('egg.dirtyTreated'), { value: '0' }),
          num('misshapen', e('egg.misshapen'), { value: '0' }), num('double_yolk', e('egg.doubleYolk'), { value: '0' }),
          num('small', e('egg.small'), { value: '0' }), num('soft_shell', e('egg.softShell'), { value: '0' }),
        ],
      };
    case 'medication':
      return {
        title: e('med.title'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('med.givenOn')), { id: 'medicine', label: e('med.medicine'), required: true },
          { id: 'dosage', label: e('med.dosage'), half: true, required: true, placeholder: '0.5 g/L' }, num('duration_days', e('med.days'), { required: true }),
          { id: 'reason', label: e('med.reason'), type: 'textarea', required: true },
          { id: 'prescribed_by', label: e('med.by'), half: true }, num('withdrawal_days', e('med.withdrawal')),
        ],
      };
    case 'biosecurity':
      return {
        title: e('bio.title'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('bio.on')), { id: 'nature', label: e('bio.nature'), type: 'textarea', required: true },
          num('birds_affected', e('bio.birds')), { id: 'responsible', label: e('bio.responsible'), half: true },
          { id: 'action_taken', label: e('bio.action'), type: 'textarea' },
          { ...date('follow_up_on', e('bio.followUp')), required: false, max: undefined, value: '' },
        ],
      };
    case 'houseReading':
      return {
        title: e('house.title'), submit: f('save'), hidden: { shed_id: ctx.shed },
        fields: [
          num('temp_c', e('f.temp'), { step: 'any' }), num('rh_pct', e('f.rh'), { step: 'any' }),
          num('nh3_ppm', e('f.nh3'), { step: 'any' }), num('lux', e('f.lux'), { step: 'any' }),
          pick('ventilation', e('f.vent'), VENT, 'vent'), pick('litter', e('f.litter'), LITTER, 'litter'), pick('power', e('f.power'), POWER, 'power'),
        ],
      };
    // ---- hatchery (0041/0042/0044)
    case 'addMachine': {
      const hf = L.farms.filter((x) => x.farm_type === 'hatchery');
      if (!hf.length) return { title: e('machine.addTitle'), intro: tr('form.needHatchery'), fields: [], submit: f('save') };
      return {
        title: e('machine.addTitle'), intro: e('machine.intro'), submit: f('save'),
        fields: [
          { id: 'farm_id', label: f('shed.farm'), type: 'select', options: hf.map((x): Opt => [x.id, x.name]) },
          { id: 'name', label: f('name'), required: true, half: true }, { id: 'machine_no', label: e('machine.no'), half: true },
          { id: 'machine_kind', label: e('machine.kind'), type: 'select', half: true, options: enumOpts(MACHINE_KINDS, 'erp.kind') },
          { id: 'stage', label: e('machine.stage'), type: 'select', half: true, options: [['multi', e('stage.multi')], ['single', e('stage.single')]] },
          num('capacity_eggs', e('machine.capacity'), { required: true }),
        ],
      };
    }
    case 'machineReading':
      return {
        title: e('machine.reading', { name: ctx.name ?? '' }), submit: f('save'), hidden: { asset_id: ctx.asset },
        fields: [
          num('temp_c', e('f.temp'), { step: 'any' }), num('wet_bulb_c', e('f.wetBulb'), { step: 'any' }),
          num('rh_pct', e('f.rh'), { step: 'any' }), num('fan_rpm', e('f.fan')),
          { id: 'alarm', label: e('f.alarm'), type: 'select', half: true, options: [none, ['no', e('no')], ['yes', e('yes')]] },
        ],
      };
    case 'loadSetter': {
      const opts = machineOpts(['setter', 'combined']);
      if (!opts.length) return { title: e('setter.title'), intro: e('setter.none'), fields: [], submit: f('save') };
      return { title: e('setter.title'), intro: e('setter.intro', { n: ctx.eggs ?? '' }), submit: f('save'), hidden: { batch_id: ctx.batch }, fields: [{ id: 'setter_id', label: e('setter.pick'), type: 'select', options: opts }] };
    }
    case 'candling': {
      const first = ctx.stage === '1';
      return {
        title: e(first ? 'candle.title1' : 'candle.title2'), intro: e('candle.intro'), submit: f('save'), hidden: { batch_id: ctx.batch, stage: ctx.stage },
        fields: [
          date('date', e('candle.on')), num('eggs_candled', e('candle.candled'), { required: true, value: ctx.eggs }),
          ...(first
            ? [num('infertile', e('candle.infertile'), { required: true, value: '0' }), num('early_dead', e('candle.earlyDead'), { required: true, value: '0' }), num('dirty', e('candle.dirty'), { required: true, value: '0' })]
            : [num('mid_dead', e('candle.midDead'), { required: true, value: '0' }), num('late_dead', e('candle.lateDead'), { required: true, value: '0' })]),
        ],
      };
    }
    case 'hatcherTransfer': {
      const opts = machineOpts(['hatcher', 'combined']);
      if (!opts.length) return { title: e('xfer.title'), intro: e('xfer.none'), fields: [], submit: f('save') };
      return {
        title: e('xfer.title'), intro: e('xfer.intro'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { id: 'hatcher_id', label: e('xfer.hatcher'), type: 'select', options: opts }, date('date', e('xfer.movedOn')),
          num('eggs', e('xfer.eggs'), { required: true, value: ctx.eggs }),
        ],
      };
    }
    case 'hatchFull':
      return {
        title: f('hatch.resultTitle'), intro: e('hatch.intro'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('hatch.on')), num('chicks_a', f('hatch.chicksA'), { required: true }), num('chicks_b', f('hatch.chicksB'), { required: true, value: '0' }),
          num('culls', f('hatch.culls'), { required: true, value: '0' }), num('dead_in_hatcher', e('hatch.deadIn'), { required: true, value: '0' }),
          num('unhatched', e('hatch.unhatched'), { required: true, value: '0' }),
        ],
      };
    case 'releaseHatcher':
      return {
        title: e('release.title'), intro: e('release.intro'), submit: e('release.submit'), hidden: { batch_id: ctx.batch },
        fields: [
          ...(['chicks_removed', 'waste_recorded', 'cleaned', 'disinfected', 'inspected'] as const).map((k): Field => ({ id: k, label: e(`release.${k}`), type: 'select', options: yn, value: 'no' })),
          { id: 'disinfectant', label: e('release.disinfectant'), half: true }, { id: 'notes', label: f('notes'), half: true },
        ],
      };
    case 'chickQuality':
      return {
        title: e('quality.title'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          date('date', e('quality.on')), num('sample_size', e('f.sample'), { required: true }),
          num('avg_weight_g', e('quality.weight'), { step: 'any' }), num('uniformity_pct', e('f.uniformity'), { step: 'any' }),
          num('navel_defects', e('quality.navel'), { value: '0', required: true }), num('leg_defects', e('quality.leg'), { value: '0', required: true }),
          num('other_defects', e('quality.other'), { value: '0', required: true }),
          { id: 'dispatch_eligible', label: e('quality.eligible'), type: 'select', half: true, options: [['yes', e('yes')], ['no', e('no')]] },
          { id: 'remarks', label: f('notes'), type: 'textarea' },
        ],
      };
    case 'chickVaccine':
      return {
        title: e('vacc.title'), intro: e('vacc.intro'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [
          { id: 'vaccine_id', label: e('vacc.vaccine'), type: 'select', options: L.vaccines.map((v): Opt => [v.id, v.name]) },
          { id: 'vaccine_lot', label: e('vacc.lot'), half: true, required: true }, { ...date('expiry', e('vacc.expiry')), max: undefined, value: '' },
          num('qty', e('vacc.qty'), { required: true, value: ctx.qty }), { id: 'override_reason', label: e('vacc.override') },
        ],
      };
    case 'decideDaily': case 'decideEggs': case 'decideCandling': case 'decideXfer': case 'decideHatch': case 'decideQuality': // opened by reject:<act>
      return { title: e('rejectTitle'), submit: tr('reject'), danger: true, hidden: { id: ctx.id, decision: 'reject' }, fields: [{ id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }] };
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
