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
  TIERS, CHICK_CATS, PAY_RESULTS, OWNERSHIPS, DOA_RESOLUTIONS, PROOF_EXT, PROOF_MAX_BYTES,
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
  /** chick sales + dispatch (0043–0045) */
  products: { id: string; name: string; price: number | null; active: boolean }[];
  /** hatched settings with a product and chicks still free to allocate */
  stock: { id: string; code: string; product: string; available: number }[];
  vehicles: { id: string; reg: string }[];
  /** approved allocations and how many chicks of each are not on a trip yet */
  allocs: { id: string; order_no: string; customer: string; code: string; left: number }[];
  /** finance / procurement / settings (0050-0053) */
  stores: { id: string; name: string }[];
  invoices: { id: string; no: string; customer_id: string; customer: string }[];
  orders: { id: string; no: string; customer_id: string; customer: string; deposit: number }[];
  notes: { id: string; no: string; customer_id: string }[];
  users: { id: string; name: string }[];
  branches: { id: string; name: string }[];
};

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST embeds */
async function loadLookups(): Promise<Lookups> {
  const sb = createClient();
  const [farms, sheds, breeds, vendors, customers, batches, diseases, bills, invoices, assets, items, pos, vaccines, workers, contracts, lots, machines, products, stock, stockBatches, vehicles, allocs, stores, invoicesAll, orders, notes, users, branches] = await Promise.all([
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
    sb.from('chick_product').select('id,name,price,active').order('name'),
    sb.from('chick_stock').select('batch_id,code,available'),
    sb.from('batch').select('id,chick_product_id').not('chick_product_id', 'is', null),
    sb.from('vehicle').select('id,reg_no').eq('active', true).order('reg_no'),
    sb.from('order_allocation').select('id,qty,batch(code),sales_order(order_no,customer(name)),dispatch_line(qty_loaded)').eq('status', 'approved'),
    sb.from('store').select('id,name').order('name'),
    sb.from('invoice').select('id,invoice_no,customer_id,customer(name)').order('invoice_date', { ascending: false }).limit(200),
    sb.from('sales_order').select('id,order_no,customer_id,deposit_paid,customer(name)').gt('deposit_paid', 0).order('created_at', { ascending: false }).limit(200),
    sb.from('credit_note').select('id,note_no,customer_id').eq('status', 'approved'),
    sb.from('app_user').select('id,full_name').order('full_name'),
    sb.from('branch').select('id,name').eq('active', true).order('name'),
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
    products: d(products).map((p) => ({ id: p.id, name: p.name, price: p.price == null ? null : Number(p.price), active: p.active })),
    stock: d(stock).flatMap((x) => {
      const b = d(stockBatches).find((y) => y.id === x.batch_id);
      return b ? [{ id: x.batch_id, code: x.code, product: b.chick_product_id, available: Number(x.available) }] : [];
    }),
    vehicles: d(vehicles).map((x) => ({ id: x.id, reg: x.reg_no })),
    allocs: d(allocs).map((a) => ({
      id: a.id, order_no: one(a.sales_order)?.order_no ?? '', customer: one(one(a.sales_order)?.customer)?.name ?? '', code: one(a.batch)?.code ?? '',
      left: a.qty - (a.dispatch_line ?? []).reduce((n: number, l: any) => n + l.qty_loaded, 0),
    })),
    stores: d(stores),
    invoices: d(invoicesAll).map((i) => ({ id: i.id, no: i.invoice_no, customer_id: i.customer_id, customer: one(i.customer)?.name ?? '' })),
    orders: d(orders).map((o) => ({ id: o.id, no: o.order_no, customer_id: o.customer_id, customer: one(o.customer)?.name ?? '', deposit: Number(o.deposit_paid) })),
    notes: d(notes).map((n) => ({ id: n.id, no: n.note_no, customer_id: n.customer_id })),
    users: d(users).map((u) => ({ id: u.id, name: u.full_name })),
    branches: d(branches),
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
  reserveOrder: (c) => ({ act: 'reserveOrder', input: { order_id: c.order } }),
  waiveDeposit: (c) => ({ act: 'waiveDeposit', input: { order_id: c.order } }),
  releaseAlloc: (c) => ({ act: 'releaseAlloc', input: { id: c.id } }),
  submitTrip: (c) => ({ act: 'submitTrip', input: { id: c.trip } }),
  completeTrip: (c) => ({ act: 'completeTrip', input: { id: c.trip } }),
  ackAlert: (c) => ({ act: 'ackAlert', input: { id: c.id } }),
  submitReq: (c) => ({ act: 'submitReq', input: { id: c.id } }),
  approvePO: (c) => ({ act: 'approvePO', input: { id: c.id } }),
  cancelPO: (c) => ({ act: 'cancelPO', input: { id: c.id } }),
  submitCount: (c) => ({ act: 'submitCount', input: { id: c.id } }),
  toggleBranch: (c) => ({ act: 'toggleBranch', input: { id: c.id, active: c.active } }),
  toggleWebhook: (c) => ({ act: 'toggleWebhook', input: { id: c.id, active: c.active } }),
  revokeDelegation: (c) => ({ act: 'revokeDelegation', input: { id: c.id } }),
  revokeSupport: (c) => ({ act: 'revokeSupport', input: { id: c.id } }),
  revokeApiKey: (c) => ({ act: 'revokeApiKey', input: { id: c.id } }),
  unlinkPortal: (c) => ({ act: 'unlinkPortal', input: { customer_id: c.customer } }),
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
    if (key === 'deliverTrip') await attachPod(values, t);
    if (key === 'recordPayment') { const bad = await attachProof(values, t); if (bad) return { fields: ['proof'], error: bad }; }
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
      if (a.startsWith('approve:') && a !== 'approve:decideDoa') { // one tap on a record row
        const r = await runAct(keyOf(a), { id: ctx.id, decision: 'approve' });
        lookups.current = null;
        return r.ok ? (toast(r.msg), router.refresh()) : toast(r.error);
      }
      lookups.current ??= await loadLookups();
      const s = build(keyOf(a), { ...ctx, _d: a.startsWith('approve:') ? 'approve' : 'reject' }, lookups.current, t, today);
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

/** Proof-of-delivery photo -> private evidence bucket (0027: <tenant>/<batch>/<date>/<uuid>). Best effort (0056 lets dispatch_officer, hatchery_ops_manager and hatchery_manager write to the bucket): a failed upload is reported and the delivery is still recorded. */
async function attachPod(values: Record<string, unknown>, t: TFn) {
  const file = values.pod;
  const batch = String(values.pod_batch ?? '');
  delete values.pod; delete values.pod_batch;
  if (!(file instanceof File)) return;
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  const tenant = (session?.user.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${tenant}/${batch}/${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}/${crypto.randomUUID()}.${ext}`;
  const up = batch && tenant ? await sb.storage.from('evidence').upload(path, file, { contentType: file.type || 'image/jpeg' }) : { error: new Error('no batch') };
  if (up.error) toast(t('sales.podFailed', { err: up.error.message }));
  else values.pod_path = path;
}

/** Payment proof -> private evidence bucket (0061: <tenant>/payment/<order id>/<uuid>.<ext>). Unlike the POD photo a refused upload stops the save: the reference alone would not carry the proof the finance officer expects. Returns an error text, or nothing. */
async function attachProof(values: Record<string, unknown>, t: TFn): Promise<string | void> {
  const file = values.proof;
  delete values.proof;
  if (!(file instanceof File)) return;
  const ext = PROOF_EXT[file.type as keyof typeof PROOF_EXT];
  if (!ext || file.size > PROOF_MAX_BYTES) return t('gap.proofBad');
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  const tenant = (session?.user.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
  const path = `${tenant}/payment/${values.order_id}/${crypto.randomUUID()}.${ext}`;
  const up = tenant ? await sb.storage.from('evidence').upload(path, file, { contentType: file.type }) : { error: new Error('no tenant') };
  if (up.error) return t('gap.proofFailed', { err: up.error.message });
  values.proof_path = path;
}

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
  const s = (k: string, p?: Record<string, string | number>) => t(`sales.${k}`, p);
  const fi = (k: string, p?: Record<string, string | number>) => t(`fin.${k}`, p);
  const pr = (k: string, p?: Record<string, string | number>) => t(`proc.${k}`, p);
  const sg = (k: string, p?: Record<string, string | number>) => t(`setg.${k}`, p);
  const realToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // dates the DB checks against the real clock (APP_TODAY only pins demo screens)
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
          { id: 'tier', label: s('f.tier'), type: 'select', options: enumOpts(TIERS, 'sales.tier'), value: 'standard', half: true },
          { id: 'delivery_address', label: s('f.address'), half: true },
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
    // ---- chick sales + dispatch (0043–0049). Labels live in `sales.*`.
    case 'addProduct':
      return {
        title: s('ttl.product'), submit: f('save'),
        fields: [
          { id: 'name', label: s('f.name'), required: true },
          { id: 'category', label: s('f.category'), type: 'select', options: enumOpts(CHICK_CATS, 'sales.cat'), half: true },
          num('price', s('f.listPrice'), { step: 'any' }), num('max_age_hours', s('f.maxAge')),
          { id: 'required_vaccine', label: s('f.vaccine'), type: 'select', options: [none, ...L.vaccines.map((v): Opt => [v.id, v.name])] },
        ],
      };
    case 'setTier':
      return {
        title: s('ttl.tier', { name: ctx.name ?? '' }), submit: f('save'), hidden: { customer_id: ctx.customer },
        fields: [
          { id: 'tier', label: s('f.tier'), type: 'select', options: enumOpts(TIERS, 'sales.tier'), value: ctx.tier || 'standard' },
          { id: 'delivery_address', label: s('f.address'), type: 'textarea', value: ctx.addr },
        ],
      };
    case 'setBatchProduct':
      return {
        title: s('ttl.setProduct', { code: ctx.code ?? '' }), intro: s('setProductHint'), submit: f('save'), hidden: { batch_id: ctx.batch },
        fields: [{ id: 'product_id', label: s('f.product'), type: 'select', options: [none, ...L.products.map((p): Opt => [p.id, p.name])], value: ctx.product ?? '' }],
      };
    case 'addOrder': {
      const live = L.products.filter((p) => p.active);
      if (!live.length || !L.customers.length) return { title: s('ttl.order'), intro: s(live.length ? 'needCustomer' : 'needProduct'), fields: [], submit: f('save') };
      return {
        title: s('ttl.order'), intro: s('orderIntro'), submit: s('bookSubmit'),
        fields: [
          { id: 'customer_id', label: s('f.customer'), type: 'select', options: L.customers.map((c): Opt => [c.id, c.name]), value: ctx.customer },
          { id: 'product_id', label: s('f.product'), type: 'select', options: live.map((p): Opt => [p.id, `${p.name}${p.price != null ? ` · ${fmtINR(p.price)}` : ''}`]) },
          num('qty', s('f.qty'), { required: true }),
          { id: 'hatch_date', label: s('f.hatchDate'), type: 'date', half: true, required: true, value: addDays(realToday, 14) },
          num('price', s('f.price'), { step: 'any', hint: s('f.priceHint') }),
          { id: 'notes', label: f('notes'), type: 'textarea' },
        ],
      };
    }
    case 'verifyPayment':
      return {
        title: s('ttl.verify', { no: ctx.no ?? '' }), intro: s('verifyIntro', { due: ctx.due ?? '0' }), submit: f('save'), hidden: { order_id: ctx.order },
        fields: [
          { id: 'result', label: s('f.result'), type: 'select', options: enumOpts(PAY_RESULTS, 'sales.verify'), half: true },
          num('deposit_paid', s('f.paid'), { required: true, value: ctx.due }),
          { id: 'payment_ref', label: s('f.ref'), value: ctx.ref },
        ],
      };
    case 'confirmOrder':
      return {
        title: s('ttl.confirm', { no: ctx.no ?? '' }), intro: s('confirmIntro'), submit: s('confirm'), hidden: { order_id: ctx.order },
        fields: [{ id: 'credit_override_reason', label: s('f.override'), hint: s('f.overrideHint') }],
      };
    case 'cancelOrder':
      return {
        title: s('ttl.cancel', { no: ctx.no ?? '' }), submit: s('cancelSubmit'), danger: true, hidden: { order_id: ctx.order },
        fields: [{ id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }],
      };
    case 'moveOrder':
      return { title: s('ttl.move', { no: ctx.no ?? '' }), submit: f('save'), hidden: { order_id: ctx.order }, fields: [{ id: 'hatch_date', label: s('f.newDate'), type: 'date', value: ctx.date, required: true }] };
    case 'priceOrder':
      return {
        title: s('ttl.price', { no: ctx.no ?? '' }), intro: s('priceIntro'), submit: f('save'), hidden: { order_id: ctx.order },
        fields: [num('price', s('f.newPrice'), { required: true, value: ctx.price, step: 'any' }), { id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }],
      };
    case 'allocate': {
      const opts = L.stock.filter((x) => x.product === ctx.product && x.available > 0).map((x): Opt => [x.id, `${x.code} · ${s('availLine', { n: x.available })}`]);
      if (!opts.length) return { title: s('ttl.allocate', { no: ctx.no ?? '' }), intro: s('noStock'), fields: [], submit: f('save') };
      return {
        title: s('ttl.allocate', { no: ctx.no ?? '' }), intro: s('allocIntro', { n: ctx.open ?? '' }), submit: s('allocSubmit'), hidden: { order_id: ctx.order },
        fields: [
          { id: 'batch_id', label: s('f.setting'), type: 'select', options: opts, follow: { target: 'qty', values: Object.fromEntries(L.stock.map((x) => [x.id, Math.min(x.available, +(ctx.open ?? 0) || x.available)])) } },
          num('qty', s('f.qty'), { required: true, value: Math.min(L.stock.find((x) => x.id === opts[0][0])?.available ?? 0, +(ctx.open ?? 0) || Infinity) }),
          { id: 'note', label: f('notes'), type: 'textarea' },
        ],
      };
    }
    case 'addVehicle':
      return {
        title: s('ttl.vehicle'), submit: f('save'),
        fields: [
          { id: 'reg_no', label: s('f.reg'), required: true, half: true, placeholder: 'AP21 TB 0001' },
          { id: 'ownership', label: s('f.ownership'), type: 'select', options: enumOpts(OWNERSHIPS, 'sales.own'), half: true },
          num('capacity_boxes', s('f.capacity')),
          { id: 'temp_controlled', label: s('f.cold'), type: 'select', half: true, options: yn },
          { id: 'fitness_expiry', label: s('f.fitness'), type: 'date', half: true }, { id: 'insurance_expiry', label: s('f.insurance'), type: 'date', half: true },
          { id: 'permit_expiry', label: s('f.permit'), type: 'date', half: true },
        ],
      };
    case 'addTrip': {
      const live = L.vehicles;
      if (!live.length) return { title: s('ttl.trip'), intro: s('needVehicle'), fields: [], submit: f('save') };
      return {
        title: s('ttl.trip'), submit: f('save'),
        fields: [
          { id: 'vehicle_id', label: s('f.vehicle'), type: 'select', options: live.map((x): Opt => [x.id, x.reg]) },
          { id: 'driver_name', label: s('f.driver'), required: true, half: true }, { id: 'route', label: s('f.route'), half: true },
          { id: 'planned_on', label: s('f.planned'), type: 'date', value: realToday, required: true },
        ],
      };
    }
    case 'addLoad': {
      const left = L.allocs.filter((a) => a.left > 0);
      if (!left.length) return { title: s('ttl.load'), intro: s('needAlloc'), fields: [], submit: f('save') };
      return {
        title: s('ttl.load'), intro: s('loadIntro'), submit: f('save'), hidden: { dispatch_id: ctx.trip },
        fields: [
          { id: 'allocation_id', label: s('f.allocation'), type: 'select', options: left.map((a): Opt => [a.id, `${a.order_no} · ${a.customer} · ${a.code} · ${s('leftLine', { n: a.left })}`]), follow: { target: 'qty_loaded', values: Object.fromEntries(left.map((a) => [a.id, a.left])) } },
          num('qty_loaded', s('f.loaded'), { required: true, value: left[0].left }), num('boxes', s('f.boxes')),
          { id: 'age_override_reason', label: s('f.ageReason') },
        ],
      };
    }
    case 'deliverTrip': {
      const lines = JSON.parse(ctx.lines || '[]') as { id: string; label: string; loaded: number }[];
      return {
        title: s('ttl.deliver', { no: ctx.no ?? '' }), intro: s('deliverIntro'), submit: s('deliverSubmit'), hidden: { dispatch_id: ctx.trip, pod_batch: ctx.batch ?? '' },
        fields: [
          { id: 'receiver_name', label: s('f.receiver'), required: true, half: true }, { id: 'delivery_note', label: s('f.deliveryNote'), half: true },
          { id: 'pod', label: s('f.pod'), type: 'file', hint: s('f.podHint') },
          ...lines.flatMap((l, i): Field[] => {
            const pre = lines.length > 1 ? `${l.label} · ` : '';
            return [
              num(`d${i}`, pre + s('f.delivered'), { required: true, value: l.loaded, hint: s('loadedLine', { n: l.loaded }) }),
              num(`s${i}`, pre + s('f.short'), { required: true, value: '0' }), num(`o${i}`, pre + s('f.doa'), { required: true, value: '0' }),
            ];
          }),
        ],
        transform: (v) => ({
          receiver_name: v.receiver_name, delivery_note: v.delivery_note, pod: v.pod,
          lines: lines.map((l, i) => ({ id: l.id, delivered: v[`d${i}`], short: v[`s${i}`], doa: v[`o${i}`] })),
        }),
      };
    }
    case 'doaClaim':
      return {
        title: s('ttl.claim', { label: ctx.label ?? '' }), intro: s('claimIntro', { n: ctx.max ?? '' }), submit: s('claimSubmit'), hidden: { dispatch_line_id: ctx.line },
        fields: [
          { id: 'reported_on', label: s('f.claimDate'), type: 'date', value: realToday, max: realToday, half: true, required: true },
          num('qty', s('f.claimQty'), { required: true, value: ctx.max }), { id: 'customer_note', label: f('notes'), type: 'textarea' },
        ],
      };
    case 'decideDoa':
      return ctx._d === 'approve'
        ? { title: s('ttl.decideClaim'), submit: tr('approve'), hidden: { id: ctx.id, decision: 'approve' }, fields: [{ id: 'resolution', label: s('f.resolution'), type: 'select', options: enumOpts(DOA_RESOLUTIONS, 'sales.res') }] }
        : { title: e('rejectTitle'), submit: tr('reject'), danger: true, hidden: { id: ctx.id, decision: 'reject' }, fields: [{ id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }] };
    case 'decideDaily': case 'decideEggs': case 'decideCandling': case 'decideXfer': case 'decideHatch': case 'decideQuality': case 'decideAlloc': case 'decideTrip':
    case 'decideCreditNote': case 'decideRefund': case 'decideReq': case 'decideCount': case 'decideStockXfer': // opened by reject:<act>
      return { title: e('rejectTitle'), submit: tr('reject'), danger: true, hidden: { id: ctx.id, decision: 'reject' }, fields: [{ id: 'reason', label: tr('form.reason'), type: 'textarea', required: true }] };
    // ---- finance / procurement / settings (0050-0056). Labels live in `fin.*`, `proc.*`, `setg.*`.
    case 'addCreditNote': {
      if (!L.customers.length) return { title: fi('ttl.note'), intro: f('needCustomer'), fields: [], submit: f('save') };
      return {
        title: fi('ttl.note'), intro: fi('noteIntro'), submit: f('save'),
        fields: [
          { id: 'customer_id', label: s('f.customer'), type: 'select', options: L.customers.map((c): Opt => [c.id, c.name]) },
          { id: 'invoice_id', label: fi('f.invoice'), type: 'select', options: [none, ...L.invoices.map((i): Opt => [i.id, `${i.no} · ${i.customer}`])] },
          num('amount', f('amount'), { required: true, step: 'any' }), date('issued_on', fi('f.issued')),
          { id: 'reason', label: tr('form.reason'), type: 'textarea', required: true },
        ],
      };
    }
    case 'addRefund': {
      if (!L.customers.length) return { title: fi('ttl.refund'), intro: f('needCustomer'), fields: [], submit: f('save') };
      return {
        title: fi('ttl.refund'), intro: fi('refundIntro'), submit: f('save'),
        fields: [
          { id: 'customer_id', label: s('f.customer'), type: 'select', options: L.customers.map((c): Opt => [c.id, c.name]) },
          { id: 'sales_order_id', label: fi('f.order'), type: 'select', options: [none, ...L.orders.map((o): Opt => [o.id, `${o.no} · ${o.customer} · ${fmtINR(o.deposit)}`])] },
          { id: 'credit_note_id', label: fi('f.note'), type: 'select', options: [none, ...L.notes.map((n): Opt => [n.id, n.no])] },
          num('amount', f('amount'), { required: true, step: 'any' }), { id: 'mode', label: f('pay.mode'), type: 'select', options: enumOpts(PAY_MODES, 'forms.pay'), value: 'upi', half: true },
          { id: 'utr', label: f('pay.utr'), half: true }, { ...date('paid_on', fi('f.paidOn')), required: false, value: '' },
        ],
      };
    }
    case 'actAlert': case 'resolveAlert': {
      const need = act === 'actAlert' || ctx.needNote === '1';
      return {
        title: t(act === 'actAlert' ? 'gap.alert.actionTitle' : 'gap.alert.resolveTitle'), intro: ctx.title, submit: t(act === 'actAlert' ? 'gap.alert.action' : 'gap.alert.resolve'), hidden: { id: ctx.id },
        fields: [{ id: 'note', label: t('gap.alert.note'), type: 'textarea', required: need, hint: need ? undefined : t('gap.alert.noteOptional') }],
      };
    }
    case 'recordPayment':
      return {
        title: t('gap.pay.title', { no: ctx.no ?? '' }), submit: f('save'), hidden: { order_id: ctx.order },
        fields: [
          { id: 'payment_ref', label: t('gap.pay.ref'), required: true, hint: '(4–60)', value: ctx.ref },
          { id: 'proof', label: t('gap.pay.proof'), type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', hint: t('gap.pay.proofHint') },
        ],
      };
    case 'raiseReqPO': {
      if (!L.vendors.length) return { title: t('gap.req.poTitle'), intro: t('gap.req.needVendor'), fields: [], submit: f('save') };
      return {
        title: t('gap.req.poTitle'), intro: ctx.label, submit: t('gap.req.raise'), hidden: { req_id: ctx.req },
        fields: [
          { id: 'vendor_id', label: t('gap.req.vendor'), type: 'select', options: vendorOpts() },
          num('rate', t('gap.req.rate'), { required: true, step: 'any', value: ctx.rate }),
          { id: 'expected', label: t('gap.req.expected'), type: 'date', half: true, value: ctx.expected },
        ],
      };
    }
    case 'setLock':
      return { title: fi('ttl.lock'), intro: fi('lockIntro'), submit: f('save'), fields: [{ id: 'date', label: fi('f.lockDate'), type: 'date', value: ctx.date ?? '' }] };
    case 'setLimit':
      return { title: fi(`limit.${ctx.key}`), intro: fi('limitIntro'), submit: f('save'), hidden: { key: ctx.key ?? '' }, fields: [num('value', fi('f.limit'), { step: 'any', value: ctx.value ?? '' })] };
    case 'addReq': {
      if (!L.farms.length || !L.items.length) return { title: pr('ttl.req'), intro: f('po.needBoth'), fields: [], submit: f('save') };
      return {
        title: pr('ttl.req'), submit: f('save'),
        fields: [
          { id: 'farm_id', label: f('shed.farm'), type: 'select', options: L.farms.map((x): Opt => [x.id, x.name]), half: true },
          { id: 'item_id', label: f('po.item'), type: 'select', options: L.items.map((i): Opt => [i.id, `${i.name} · ${i.unit}`]), value: ctx.item, half: true },
          num('qty', f('po.qty'), { required: true, step: 'any' }), num('est_rate', pr('f.estRate'), { step: 'any' }),
          { id: 'needed_by', label: pr('f.neededBy'), type: 'date', half: true }, { id: 'status', label: pr('f.send'), type: 'select', half: true, options: [['submitted', pr('sendOpt.submit')], ['draft', pr('sendOpt.draft')]] },
          { id: 'purpose', label: pr('f.purpose'), type: 'textarea' },
        ],
      };
    }
    case 'addCount': {
      if (!L.stores.length || !L.items.length) return { title: pr('ttl.count'), intro: pr('needStore'), fields: [], submit: f('save') };
      return {
        title: pr('ttl.count'), intro: pr('countIntro'), submit: f('save'),
        fields: [
          { id: 'store_id', label: pr('f.store'), type: 'select', options: L.stores.map((x): Opt => [x.id, x.name]), half: true }, date('counted_on', pr('f.countedOn')),
          { id: 'note', label: f('notes') },
          ...L.items.map((i, k): Field => num(`q${k}`, `${i.name} · ${i.unit}`, { step: 'any', value: '' })),
        ],
        transform: (v) => ({
          store_id: v.store_id, counted_on: v.counted_on, note: v.note,
          lines: L.items.flatMap((i, k) => (v[`q${k}`] === '' || v[`q${k}`] == null ? [] : [{ item_id: i.id, counted_qty: v[`q${k}`] }])),
        }),
      };
    }
    case 'addStockXfer': {
      if (L.stores.length < 2 || !L.items.length) return { title: pr('ttl.xfer'), intro: pr('needTwoStores'), fields: [], submit: f('save') };
      return {
        title: pr('ttl.xfer'), submit: f('save'),
        fields: [
          { id: 'from_store', label: pr('f.from'), type: 'select', options: L.stores.map((x): Opt => [x.id, x.name]), half: true },
          { id: 'to_store', label: pr('f.to'), type: 'select', options: L.stores.map((x): Opt => [x.id, x.name]), value: L.stores[1].id, half: true },
          { id: 'item_id', label: f('po.item'), type: 'select', options: L.items.map((i): Opt => [i.id, `${i.name} · ${i.unit}`]) },
          num('qty', f('po.qty'), { required: true, step: 'any' }),
        ],
      };
    }
    case 'sendStockXfer':
      return { title: pr('ttl.send'), submit: f('save'), hidden: { id: ctx.id }, fields: [date('sent_on', pr('f.sentOn'))] };
    case 'receiveStockXfer':
      return { title: pr('ttl.receive'), submit: f('save'), hidden: { id: ctx.id }, fields: [num('received_qty', pr('f.receivedQty'), { required: true, value: ctx.qty, step: 'any' }), date('received_on', pr('f.receivedOn'))] };
    case 'addBranch':
      return {
        title: sg('ttl.branch'), submit: f('save'),
        fields: [
          { id: 'name', label: f('name'), required: true }, { id: 'code', label: sg('f.code'), half: true }, { id: 'gstin', label: f('vendor.gstin'), half: true, placeholder: '36ABCDE1234F1Z5' },
          { id: 'state', label: sg('f.state'), half: true }, { id: 'district', label: f('farm.district'), half: true },
        ],
      };
    case 'setFarmBranch':
      return { title: sg('ttl.farmBranch', { name: ctx.name ?? '' }), submit: f('save'), hidden: { farm_id: ctx.farm }, fields: [{ id: 'branch_id', label: sg('f.branch'), type: 'select', options: [none, ...L.branches.map((b): Opt => [b.id, b.name])], value: ctx.branch ?? '' }] };
    case 'addPm': {
      if (!L.assets.length) return { title: sg('ttl.pm'), intro: sg('needAsset'), fields: [], submit: f('save') };
      return {
        title: sg('ttl.pm'), intro: sg('pmIntro'), submit: f('save'),
        fields: [
          { id: 'asset_id', label: sg('f.asset'), type: 'select', options: L.assets.map((a): Opt => [a.id, a.name]) }, { id: 'task', label: sg('f.task'), required: true },
          num('every_days', sg('f.everyDays')), num('every_batches', sg('f.everyBatches')), { ...date('last_done_on', sg('f.lastDone')), required: false },
        ],
      };
    }
    case 'pmDone':
      return { title: sg('ttl.pmDone'), submit: f('save'), hidden: { id: ctx.id }, fields: [date()] };
    case 'addDelegation': {
      const mine: string[] = JSON.parse(ctx.roles || '[]');
      return {
        title: sg('ttl.delegate'), intro: sg('delegateIntro'), submit: f('save'),
        fields: [
          { id: 'to_user', label: sg('f.to'), type: 'select', options: L.users.map((u): Opt => [u.id, u.name]) },
          { id: 'role', label: f('worker.role'), type: 'select', half: true, options: mine.map((r): Opt => [r, t(`roles.${r}`)]) },
          num('days', sg('f.days'), { value: '7', required: true }), { id: 'reason', label: tr('form.reason'), required: true },
        ],
        transform: (v) => ({ to_user: v.to_user, roles: v.role ? [v.role] : [], days: v.days, reason: v.reason }),
      };
    }
    case 'grantSupport':
      return {
        title: sg('ttl.support'), intro: sg('supportIntro'), submit: f('save'),
        fields: [
          { id: 'hours', label: sg('f.duration'), type: 'select', value: '24', half: true, options: [['1', sg('dur.1')], ['4', sg('dur.4')], ['24', sg('dur.24')], ['72', sg('dur.72')], ['144', sg('dur.144')]] },
          { id: 'reason', label: tr('form.reason'), type: 'textarea', required: true },
        ],
      };
    case 'linkPortal':
      return { title: sg('ttl.portal', { name: ctx.name ?? '' }), intro: sg('portalIntro'), submit: sg('portalSubmit'), hidden: { customer_id: ctx.customer }, fields: [{ id: 'email', label: sg('f.email'), required: true, placeholder: 'customer@example.com' }] };
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
