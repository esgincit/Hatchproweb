'use server';
// One entry point for every form (act key = demo ACT key). Validate → write through RLS → refresh screens.
// Multi-row effects live in SQL functions (supabase/migrations/0004_actions.sql) so they are one transaction.
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { SCHEMAS, isAct, type ActKey } from '@/lib/schemas';
import { fmtINR } from '@/lib/format';
import { settle, type ContractTerms } from '@/lib/settlement';
import { claimsFromUser } from '@/lib/auth/claims';
import { canAct } from '@/lib/auth/permissions';
import { transferRef } from '@/lib/trace';
import { RULES, ruleDef, parseRule, pairOk } from '@/lib/rules';

export type ActResult = { ok: true; msg: string; href?: string } | { ok: false; error: string; fields?: string[] };

export async function runAct(act: string, input: Record<string, unknown>): Promise<ActResult> {
  const t = await getTranslations('forms');
  if (!isAct(act)) return { ok: false, error: t('unknown') };
  const parsed = SCHEMAS[act].safeParse(input);
  if (!parsed.success) return { ok: false, error: t('invalid'), fields: parsed.error.issues.map((i) => String(i.path[0])) };

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: t('signedOut') };
  if (!canAct(claimsFromUser(user).roles, act)) return { ok: false, error: t('forbidden') };
  const { data: ten } = await sb.from('tenant').select('status').maybeSingle(); // RLS: own tenant only
  if (ten?.status === 'suspended') return { ok: false, error: t('forbidden') }; // ponytail: app-level; DB-level block if suspension must stop raw API writes

  const res = await write(act, parsed.data as never, sb, t);
  if (!res.ok && /duplicate key/.test(res.error)) return { ok: false, error: t('duplicate') }; // unique code / name already used
  if (res.ok) revalidatePath('/', 'layout');
  return res;
}

type Sb = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
type In<K extends ActKey> = import('zod').infer<(typeof SCHEMAS)[K]>;

const DECIDE_TABLE = {
  decideDaily: 'breeder_daily', decideEggs: 'hatching_egg_collection', decideCandling: 'candling', decideXfer: 'hatcher_transfer',
  decideHatch: 'hatch_record', decideQuality: 'chick_quality_inspection', decideAlloc: 'order_allocation',
  decideCreditNote: 'credit_note', decideRefund: 'refund', decideReq: 'purchase_requisition', decideCount: 'stock_count', decideStockXfer: 'stock_transfer',
} as const;
const ORDER = 'order_no,status,suggested_hatch_date,reserve_expires_at';
const ist = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fail = (e: { message: string } | null): ActResult | null => (e ? { ok: false, error: e.message } : null);
/** An UPDATE that RLS filters to zero rows (someone else's id) is not an error to PostgREST: say so instead of a false success. */
const touched = (r: { data: unknown[] | null; error: { message: string } | null }, ok: ActResult, t: T): ActResult => fail(r.error) ?? (r.data?.length ? ok : { ok: false, error: t('notFound') });

async function write<K extends ActKey>(act: K, v: In<K>, sb: Sb, t: T): Promise<ActResult> {
  switch (act) {
    case 'addFarm': {
      const x = v as In<'addFarm'>;
      const { error } = await sb.from('farm').insert({ name: x.name, farm_type: x.farm_type, district: x.district, village: x.village, capacity_birds: x.capacity });
      return fail(error) ?? { ok: true, msg: t('farm.ok', { name: x.name }) };
    }
    case 'addShed': {
      const x = v as In<'addShed'>;
      const { error } = await sb.from('shed').insert({ farm_id: x.farm_id, name: x.name, shed_type: x.shed_type, capacity_birds: x.capacity, area_sqft: x.area_sqft });
      return fail(error) ?? { ok: true, msg: t('shed.ok', { name: x.name }) };
    }
    case 'addBatch': {
      const x = v as In<'addBatch'>;
      const { error } = await sb.rpc('place_batch', {
        p_shed: x.shed_id, p_code: x.code, p_breed: x.breed_id ?? null, p_placed: x.placed, p_doc: x.doc, p_doc_rate: x.doc_rate, p_vendor: x.vendor_id ?? null,
      });
      if (error) return fail(error)!;
      if (x.females_placed != null) { // breeder flock: record the sex split (0038); the DB re-checks it adds up
        const r = await sb.from('batch').update({ females_placed: x.females_placed, males_placed: x.males_placed ?? 0 }).eq('shed_id', x.shed_id).eq('code', x.code).select('id');
        if (r.error || !r.data?.length) return { ok: false, error: r.error?.message ?? t('notFound') };
      }
      return { ok: true, msg: t('batch.ok', { code: x.code }), href: `/farm/batch/${encodeURIComponent(x.code)}` };
    }
    case 'mort': {
      const x = v as In<'mort'>;
      const { error } = await sb.rpc('record_mortality', { p_batch: x.batch_id, p_date: x.date, p_count: x.count, p_cause: x.cause ?? null, p_notes: x.notes ?? null });
      return fail(error) ?? { ok: true, msg: t('mort.ok', { n: x.count }) };
    }
    case 'vaccDone': {
      const x = v as In<'vaccDone'>;
      const { data: { user } } = await sb.auth.getUser();
      return touched(await sb.from('vaccination_schedule').update({ done_on: x.date, done_by: user?.id }).eq('id', x.vacc_id).select('id'), { ok: true, msg: t('vacc.ok') }, t);
    }
    case 'addVisit': {
      const x = v as In<'addVisit'>;
      const { data: b } = await sb.from('batch').select('farm_id').eq('id', x.batch_id).maybeSingle();
      if (!b) return { ok: false, error: t('notFound') };
      const { error } = await sb.from('vet_visit').insert({ farm_id: b.farm_id, batch_id: x.batch_id, visit_date: x.date, vet_name: x.vet, findings: x.findings, prescription: x.prescription });
      return fail(error) ?? { ok: true, msg: t('visit.ok') };
    }
    case 'saleOpen': {
      const x = v as In<'saleOpen'>;
      const { data, error } = await sb.rpc('create_sale', {
        p_customer: x.customer_id, p_product: x.product, p_qty: x.qty, p_unit: x.unit, p_rate: x.rate, p_date: x.date, p_batch: x.batch_id ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('sale.ok', { no: String(data) }), href: '/money?view=ar' };
    }
    case 'addBill': {
      const x = v as In<'addBill'>;
      const { data, error } = await sb.rpc('create_bill', {
        p_vendor: x.vendor_id, p_category: x.category, p_total: x.total, p_date: x.date, p_batch: x.batch_id ?? null, p_bill_no: x.bill_no ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('bill.ok', { no: String(data) }), href: '/money?view=ap' };
    }
    case 'payOpen': {
      const x = v as In<'payOpen'>;
      const { data, error } = await sb.rpc('record_payment', { p_kind: x.kind, p_id: x.id, p_amount: x.amount, p_mode: x.mode, p_date: x.date, p_utr: x.utr ?? null });
      return fail(error) ?? { ok: true, msg: data === 'pending' ? t('pay.pending', { amt: fmtINR(x.amount) }) : t('pay.ok', { amt: fmtINR(x.amount) }) };
    }
    case 'decidePay': {
      const x = v as In<'decidePay'>;
      const { error } = await sb.rpc('decide_payment', { p_id: x.approval_id, p_approve: x.approve === 'yes' });
      return fail(error) ?? { ok: true, msg: x.approve === 'yes' ? t('pay.approved') : t('pay.rejected') };
    }
    case 'addCustomer': {
      const x = v as In<'addCustomer'>;
      const { error } = await sb.from('customer').insert({ name: x.name, kind: x.kind, phone: x.phone, credit_limit: x.credit_limit, credit_days: x.credit_days, tier: x.tier ?? 'standard', delivery_address: x.delivery_address ?? null });
      return fail(error) ?? { ok: true, msg: t('customer.ok', { name: x.name }) };
    }
    case 'addVendor': {
      const x = v as In<'addVendor'>;
      const { error } = await sb.from('vendor').insert({
        name: x.name, category: x.category, contact_name: x.contact, phone: x.phone, gstin: x.gstin, payment_terms_days: x.terms, is_verified: !!x.gstin,
      });
      return fail(error) ?? { ok: true, msg: t('vendor.ok', { name: x.name }) };
    }
    case 'addWorker': {
      const x = v as In<'addWorker'>;
      const { error } = await sb.from('worker').insert({ name: x.name, role: x.role, farm_id: x.farm_id, wage_rate: x.wage, phone: x.phone });
      return fail(error) ?? { ok: true, msg: t('worker.ok', { name: x.name }) };
    }
    case 'attSet': {
      const x = v as In<'attSet'>;
      const { error } = await sb.from('attendance').upsert({ worker_id: x.worker_id, att_date: x.date, status: x.status }, { onConflict: 'worker_id,att_date' });
      return fail(error) ?? { ok: true, msg: t('att.ok') };
    }
    case 'logSave': {
      const x = v as In<'logSave'>;
      const p = {
        mortality: x.mortality, culls: x.culls, feed_kg: Math.round(x.feed_bags * 50 * 10) / 10, water: x.water, tmin: x.tmin, tmax: x.tmax, rh: x.rh,
        avg_w: x.avg_w, remarks: x.remarks, ...(x.eggs ? { eggs: x.eggs } : {}),
      };
      const { error } = await sb.rpc('save_daily_log', { p_batch: x.batch_id, p_date: x.date, p });
      if (error) return fail(error)!;
      const { data: b } = await sb.from('batch').select('code').eq('id', x.batch_id).maybeSingle();
      return { ok: true, msg: t('log.ok'), href: b ? `/farm/batch/${encodeURIComponent(b.code)}` : undefined };
    }
    case 'closeBatch': {
      const x = v as In<'closeBatch'>;
      const { data, error } = await sb.rpc('close_batch', {
        p_batch: x.batch_id, p_date: x.date, p_customer: x.customer_id ?? null, p_weight_kg: x.weight_kg ?? null, p_rate: x.rate ?? null,
      });
      return fail(error) ?? { ok: true, msg: data ? t('close.okSale', { no: String(data) }) : t('close.ok') };
    }
    case 'batchState': {
      const x = v as In<'batchState'>;
      const { error } = await sb.rpc('set_batch_state', { p_batch: x.batch_id, p_state: x.state, p_date: x.date });
      return fail(error) ?? { ok: true, msg: t('stage.ok') };
    }
    case 'addVacc': {
      const x = v as In<'addVacc'>;
      const { error } = await sb.from('vaccination_schedule').insert({ batch_id: x.batch_id, vaccine_id: x.vaccine_id, due_date: x.due });
      return fail(error) ?? { ok: true, msg: t('addVacc.ok') };
    }
    case 'confirmCase': {
      const x = v as In<'confirmCase'>;
      return touched(await sb.from('disease_case').update({ vet_confirmed: true }).eq('id', x.case_id).select('id'), { ok: true, msg: t('case.confirmed') }, t);
    }
    case 'closeCase': {
      const x = v as In<'closeCase'>;
      return touched(await sb.from('disease_case').update({ status: 'resolved' }).eq('id', x.case_id).select('id'), { ok: true, msg: t('case.resolved') }, t);
    }
    case 'reportIssue': {
      const x = v as In<'reportIssue'>;
      const { error } = await sb.rpc('report_issue', { p_asset: x.asset_id, p_issue: x.issue, p_priority: x.priority, p_date: x.date });
      return fail(error) ?? { ok: true, msg: x.priority === 'high' ? t('issue.okHigh') : t('issue.ok') };
    }
    case 'closeTicket': {
      const x = v as In<'closeTicket'>;
      const { error } = await sb.rpc('close_ticket', { p_ticket: x.ticket_id, p_date: x.date, p_cost: x.cost ?? null, p_vendor: x.vendor_id ?? null });
      return fail(error) ?? { ok: true, msg: x.cost && x.vendor_id ? t('ticket.okBill', { amt: fmtINR(x.cost) }) : t('ticket.ok') };
    }
    case 'addAsset': {
      const x = v as In<'addAsset'>;
      const { error } = await sb.rpc('add_asset', {
        p_farm: x.farm_id, p_name: x.name, p_category: x.category, p_cost: x.cost ?? null, p_next_service: x.next_service, p_date: x.date, p_vendor: x.vendor_id ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('asset.ok', { name: x.name }) };
    }
    case 'serviceDone': {
      const x = v as In<'serviceDone'>;
      if (x.next_service <= x.date) return { ok: false, error: t('service.nextAfter'), fields: ['next_service'] };
      return touched(await sb.from('asset').update({ next_service_on: x.next_service, status: 'ok' }).eq('id', x.asset_id).select('id'), { ok: true, msg: t('service.ok') }, t);
    }
    case 'addItem': {
      const x = v as In<'addItem'>;
      const { error } = await sb.from('item').insert({ name: x.name, category: x.category, unit: x.unit, reorder_level: x.reorder, gst_pct: x.gst ?? 0 });
      return fail(error) ?? { ok: true, msg: t('item.ok', { name: x.name }) };
    }
    case 'raisePO': {
      const x = v as In<'raisePO'>;
      const { data, error } = await sb.rpc('raise_po', { p_vendor: x.vendor_id, p_item: x.item_id, p_qty: x.qty, p_rate: x.rate, p_expected: x.expected, p_date: x.date });
      return fail(error) ?? { ok: true, msg: t('po.ok', { no: String(data) }), href: '/more/stock' };
    }
    case 'grnOpen': {
      const x = v as In<'grnOpen'>;
      const { data, error } = await sb.rpc('receive_grn', {
        p_po: x.po_id, p_qty: x.qty, p_bill_amount: x.bill_amount, p_date: x.date, p_lot: x.lot ?? null, p_expiry: x.expiry ?? null,
      });
      if (error) return fail(error)!;
      const variance = Number(data ?? 0);
      return { ok: true, msg: Math.abs(variance) <= 1 ? t('grn.ok', { qty: x.qty }) : t('grn.variance', { qty: x.qty, pct: variance.toFixed(1) }) };
    }
    case 'addRate': {
      const x = v as In<'addRate'>;
      const unit = x.product === 'egg' ? 'per_egg' : 'per_kg';
      const { error } = await sb.from('market_rate').insert({ source: 'tenant', zone: x.zone, product: x.product, rate_date: x.date, rate: x.rate, unit });
      return fail(error) ?? { ok: true, msg: t('rate.ok') };
    }
    case 'addDoc': {
      const x = v as In<'addDoc'>;
      const { error } = await sb.from('tenant_document').insert({ name: x.name, ref_no: x.ref_no, expires_on: x.expires });
      return fail(error) ?? { ok: true, msg: t('doc.ok', { name: x.name }) };
    }
    case 'inviteUser': {
      const x = v as In<'inviteUser'>;
      // creating a login needs the service role → edge function (it re-checks owner + staff-role rules)
      const { data, error } = await sb.functions.invoke('invite-user', { body: x });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const body = ctx ? await ctx.json().catch(() => null) : null;
        return { ok: false, error: body?.error ?? error.message };
      }
      return { ok: true, msg: t('invite.ok', { name: x.name, phone: String(data?.phone ?? '') }), href: '/more/users' };
    }
    case 'addContract': {
      const x = v as In<'addContract'>;
      const { error } = await sb.from('contract').insert(x);
      return fail(error) ?? { ok: true, msg: t('contract.ok', { name: x.name }) };
    }
    case 'linkContract': {
      const x = v as In<'linkContract'>;
      const { data, error } = await sb.from('batch').update({ contract_id: x.contract_id }).eq('id', x.batch_id).eq('farm_type', 'broiler').select('id');
      return fail(error) ?? (data?.length ? { ok: true, msg: t('contract.linked') } : { ok: false, error: t('contract.broilerOnly') });
    }
    case 'settleContract': {
      // computed here from the database's own placed / dead / feed — the browser only supplies what was lifted
      const x = v as In<'settleContract'>;
      const [{ data: b }, { data: k }] = await Promise.all([
        sb.from('batch').select('doc_count,contract_id,contract(base_rate,std_fcr,fcr_bonus,fcr_penalty,min_rate,allowed_mort_pct,mort_penalty)').eq('id', x.batch_id).maybeSingle(),
        sb.from('v_batch_kpi').select('cum_mortality,feed_kg').eq('batch_id', x.batch_id).maybeSingle(),
      ]);
      const c = b?.contract as unknown as Record<string, number> | null;
      if (!b || !c) return { ok: false, error: t('contract.none') };
      const terms = Object.fromEntries(Object.entries(c).map(([kk, vv]) => [kk, Number(vv)])) as unknown as ContractTerms;
      const h = { placed: b.doc_count, dead: Number(k?.cum_mortality ?? 0), liftedBirds: x.lifted_birds, liftedKg: x.lifted_kg, feedKg: Number(k?.feed_kg ?? 0) };
      const s = settle(terms, h);
      if (!s || s.net <= 0) return { ok: false, error: t('contract.nothing') };
      const { data: no, error } = await sb.rpc('record_settlement', {
        p_batch: x.batch_id, p_date: x.date, p_lifted_birds: x.lifted_birds, p_lifted_kg: x.lifted_kg, p_feed_kg: h.feedKg,
        p_dead: h.dead, p_fcr: s.fcr, p_rate: s.rate, p_mort_charge: s.mortCharge, p_net: s.net,
      });
      return fail(error) ?? { ok: true, msg: t('contract.settled', { no: String(no), amt: fmtINR(s.net) }) };
    }
    case 'shiftLog': {
      const x = v as In<'shiftLog'>;
      const { error } = await sb.rpc('add_shift_log', {
        p_op: x.op_id, p_batch: x.batch_id, p_date: x.date, p_shift: x.shift,
        p: { mortality: x.mortality, culls: x.culls, feed_kg: Math.round(x.feed_bags * 50 * 10) / 10, water: x.water },
      });
      return fail(error) ?? { ok: true, msg: t('shift.ok') }; // 'duplicate' (offline replay) is also fine
    }
    case 'hatchCandle': {
      const x = v as In<'hatchCandle'>;
      const { error } = await sb.from('hatch_record').upsert({ batch_id: x.batch_id, candled_on: x.date, clears: x.clears, dead_germ: x.dead_germ }, { onConflict: 'batch_id' });
      return fail(error) ?? { ok: true, msg: t('hatch.candleOk') };
    }
    case 'hatchResult': {
      const x = v as In<'hatchResult'>;
      const { error } = await sb.from('hatch_record').upsert({ batch_id: x.batch_id, hatched_on: x.date, chicks_a: x.chicks_a, chicks_b: x.chicks_b, culls: x.culls }, { onConflict: 'batch_id' });
      return fail(error) ?? { ok: true, msg: t('hatch.resultOk', { n: x.chicks_a + x.chicks_b }) };
    }
    case 'setBank': {
      const x = v as In<'setBank'>;
      const { error } = await sb.from('worker_bank').upsert({ worker_id: x.worker_id, account_no: x.account_no, ifsc: x.ifsc, updated_at: new Date().toISOString() });
      return fail(error) ?? { ok: true, msg: t('bank.ok') };
    }
    case 'addAdvance': {
      const x = v as In<'addAdvance'>;
      const { error } = await sb.from('worker_advance').insert({ worker_id: x.worker_id, amount: x.amount, given_on: x.date, reason: x.reason });
      return fail(error) ?? { ok: true, msg: t('advance.ok', { amt: fmtINR(x.amount) }) };
    }
    case 'addTransfer': {
      const x = v as In<'addTransfer'>;
      const ref = transferRef(x.sent_on);
      const { error } = await sb.from('egg_transfer').insert({
        ref, flock_id: x.flock_id ?? null, source_vendor_id: x.vendor_id ?? null, to_farm_id: x.to_farm_id, laid_from: x.laid_from, laid_to: x.laid_to,
        sent_on: x.sent_on, trays: x.trays ?? null, qty: x.qty, vehicle_no: x.vehicle_no ?? null, driver_name: x.driver_name ?? null, status: x.status,
      });
      return fail(error) ?? { ok: true, msg: t('xfer.added', { ref }), href: '/more/transfers' };
    }
    case 'submitTransfer': {
      const x = v as In<'submitTransfer'>;
      return touched(await sb.from('egg_transfer').update({ status: 'submitted' }).eq('id', x.transfer_id).eq('status', 'draft').select('id'), { ok: true, msg: t('xfer.submitted') }, t);
    }
    case 'decideTransfer': {
      const x = v as In<'decideTransfer'>;
      const ok = x.decision === 'approve';
      const patch = ok ? { status: 'approved' } : { status: 'rejected', reject_reason: x.reason };
      return touched(await sb.from('egg_transfer').update(patch).eq('id', x.transfer_id).in('status', ['draft', 'submitted']).select('id'), { ok: true, msg: ok ? t('xfer.approved') : t('xfer.rejected') }, t);
    }
    case 'cancelTransfer': {
      const x = v as In<'cancelTransfer'>;
      return touched(await sb.from('egg_transfer').update({ status: 'cancelled' }).eq('id', x.transfer_id).eq('status', 'approved').select('id'), { ok: true, msg: t('xfer.cancelled') }, t);
    }
    case 'receiveTransfer': {
      const x = v as In<'receiveTransfer'>;
      return touched(await sb.from('egg_transfer').update({ status: 'received', received_qty: x.received_qty, receipt_rejects: x.rejects, received_on: x.date, receipt_note: x.note ?? null })
        .eq('id', x.transfer_id).eq('status', 'approved').select('id'), { ok: true, msg: t('xfer.received', { n: x.received_qty - x.rejects }) }, t);
    }
    case 'loadSetting': {
      const x = v as In<'loadSetting'>;
      const { error } = await sb.from('setting_lot').insert({ batch_id: x.batch_id, transfer_id: x.transfer_id, qty: x.qty, age_override_reason: x.age_override_reason ?? null });
      return fail(error) ?? { ok: true, msg: t('xfer.loaded', { n: x.qty }) };
    }
    case 'setRule': {
      const x = v as In<'setRule'>;
      const value = parseRule(x.key, x.value)!; // the schema already refused anything else
      if (typeof value === 'number') {
        const { data } = await sb.from('tenant_rule').select('key,value').in('key', RULES.filter((r) => r.kind === 'num').map((r) => r.key));
        const cur = (k: string) => Number(data?.find((r) => r.key === k)?.value ?? ruleDef(k)!.def);
        if (!pairOk(x.key, value, cur)) return { ok: false, error: t('erp.pairBad'), fields: ['value'] };
      }
      const { error } = await sb.from('tenant_rule').upsert({ key: x.key, value, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,key' });
      return fail(error) ?? { ok: true, msg: t('xfer.ruleSaved') };
    }
    // ---- breeder flock (0038/0039). A record is re-submitted by upsert, which is how a rejected one is corrected; approved ones are locked by the DB.
    case 'breederDaily': {
      const x = v as In<'breederDaily'>;
      const { error } = await sb.from('breeder_daily').upsert({
        batch_id: x.batch_id, log_date: x.date, female_mort: x.female_mort, male_mort: x.male_mort, female_culls: x.female_culls, male_culls: x.male_culls,
        feed_f_kg: x.feed_f_kg ?? null, feed_m_kg: x.feed_m_kg ?? null, diet_stage: x.diet_stage ?? null, cleanup_hours: x.cleanup_hours ?? null,
        water_l: x.water_l ?? null, water_treatment: x.water_treatment ?? null, water_quality: x.water_quality ?? null, light_hours: x.light_hours ?? null,
        remarks: x.remarks ?? null, status: 'submitted',
      }, { onConflict: 'batch_id,log_date' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'bodyWeight': {
      const x = v as In<'bodyWeight'>;
      const { error } = await sb.from('body_weight_record').upsert({
        batch_id: x.batch_id, weighed_on: x.date, sex: x.sex, sample_size: x.sample_size, avg_g: x.avg_g,
        uniformity_pct: x.uniformity_pct ?? null, cv_pct: x.cv_pct ?? null, fleshing_score: x.fleshing_score ?? null,
      }, { onConflict: 'batch_id,weighed_on,sex' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'eggCollection': {
      const { date: d, ...x } = v as In<'eggCollection'>;
      const { error } = await sb.from('hatching_egg_collection').upsert({ ...x, collected_on: d, status: 'submitted' }, { onConflict: 'batch_id,collected_on,collection_no' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'medication': {
      const x = v as In<'medication'>;
      const { error } = await sb.from('medication_record').insert({
        batch_id: x.batch_id, given_on: x.date, medicine: x.medicine, dosage: x.dosage, duration_days: x.duration_days, reason: x.reason,
        prescribed_by: x.prescribed_by ?? null, withdrawal_days: x.withdrawal_days ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'biosecurity': {
      const x = v as In<'biosecurity'>;
      const { data: b } = await sb.from('batch').select('farm_id,shed_id').eq('id', x.batch_id).maybeSingle();
      if (!b) return { ok: false, error: t('notFound') };
      const { error } = await sb.from('biosecurity_incident').insert({
        farm_id: b.farm_id, shed_id: b.shed_id, occurred_on: x.date, nature: x.nature, birds_affected: x.birds_affected ?? null,
        action_taken: x.action_taken ?? null, responsible: x.responsible ?? null, follow_up_on: x.follow_up_on ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'houseReading': {
      const x = v as In<'houseReading'>;
      const { error } = await sb.from('env_reading').insert({
        shed_id: x.shed_id, read_at: new Date().toISOString(), temp_c: x.temp_c ?? null, rh_pct: x.rh_pct ?? null, nh3_ppm: x.nh3_ppm ?? null, lux: x.lux ?? null,
        ventilation: x.ventilation ?? null, litter: x.litter ?? null, power: x.power ?? null, source: 'manual',
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    // ---- hatchery (0041/0042/0044)
    case 'addMachine': {
      const x = v as In<'addMachine'>;
      const { error } = await sb.from('asset').insert({
        farm_id: x.farm_id, name: x.name, category: 'incubator', machine_kind: x.machine_kind, machine_no: x.machine_no ?? null, capacity_eggs: x.capacity_eggs, stage: x.stage, status: 'ok',
      });
      return fail(error) ?? { ok: true, msg: t('erp.machineAdded', { name: x.name }) };
    }
    case 'machineReading': {
      const x = v as In<'machineReading'>;
      const { error } = await sb.from('env_reading').insert({
        asset_id: x.asset_id, read_at: new Date().toISOString(), temp_c: x.temp_c ?? null, wet_bulb_c: x.wet_bulb_c ?? null, rh_pct: x.rh_pct ?? null,
        fan_rpm: x.fan_rpm ?? null, alarm: x.alarm ? x.alarm === 'yes' : null, source: 'manual',
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'loadSetter': {
      const x = v as In<'loadSetter'>;
      const { error } = await sb.rpc('load_setter', { p_batch: x.batch_id, p_setter: x.setter_id });
      return fail(error) ?? { ok: true, msg: t('erp.setterLoaded') };
    }
    case 'candling': {
      const x = v as In<'candling'>;
      const first = x.stage === 1;
      const { error } = await sb.from('candling').upsert({
        batch_id: x.batch_id, stage: x.stage, candled_on: x.date, eggs_candled: x.eggs_candled,
        infertile: first ? x.infertile : null, early_dead: first ? x.early_dead : null, dirty: first ? x.dirty : null,
        mid_dead: first ? null : x.mid_dead, late_dead: first ? null : x.late_dead, status: 'submitted',
      }, { onConflict: 'batch_id,stage' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'hatcherTransfer': {
      const x = v as In<'hatcherTransfer'>;
      const { error } = await sb.from('hatcher_transfer').upsert({ batch_id: x.batch_id, hatcher_id: x.hatcher_id, moved_on: x.date, eggs: x.eggs, status: 'submitted' }, { onConflict: 'batch_id' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'hatchFull': {
      const { date: d, ...x } = v as In<'hatchFull'>;
      const { error } = await sb.from('hatch_record').upsert({ ...x, hatched_on: d, status: 'submitted' }, { onConflict: 'batch_id' });
      return fail(error) ?? { ok: true, msg: t('hatch.resultOk', { n: x.chicks_a + x.chicks_b }) };
    }
    case 'releaseHatcher': {
      const x = v as In<'releaseHatcher'>;
      const { data: h } = await sb.from('hatcher_transfer').select('hatcher_id').eq('batch_id', x.batch_id).maybeSingle();
      if (!h) return { ok: false, error: t('notFound') };
      const { error } = await sb.from('machine_release').insert({
        batch_id: x.batch_id, hatcher_id: h.hatcher_id, chicks_removed: true, waste_recorded: true, cleaned: true, disinfected: true, inspected: true,
        disinfectant: x.disinfectant ?? null, notes: x.notes ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('erp.released') };
    }
    case 'chickQuality': {
      const x = v as In<'chickQuality'>;
      const { error } = await sb.from('chick_quality_inspection').upsert({
        batch_id: x.batch_id, inspected_on: x.date, sample_size: x.sample_size, avg_weight_g: x.avg_weight_g ?? null, uniformity_pct: x.uniformity_pct ?? null,
        navel_defects: x.navel_defects, leg_defects: x.leg_defects, other_defects: x.other_defects, dispatch_eligible: x.dispatch_eligible === 'yes',
        remarks: x.remarks ?? null, status: 'submitted',
      }, { onConflict: 'batch_id' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'chickVaccine': {
      const x = v as In<'chickVaccine'>;
      const { error } = await sb.from('chick_vaccination').insert({
        batch_id: x.batch_id, vaccine_id: x.vaccine_id, vaccine_lot: x.vaccine_lot, expiry: x.expiry, qty: x.qty, expired_override_reason: x.override_reason ?? null,
      });
      if (error) return fail(error)!;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return { ok: true, msg: x.expiry < today ? t('erp.vaccExpired', { lot: x.vaccine_lot }) : t('erp.saved') }; // the DB flags it and alerts the owner either way
    }
    case 'decideDaily': case 'decideEggs': case 'decideCandling': case 'decideXfer': case 'decideHatch': case 'decideQuality': case 'decideAlloc':
    case 'decideCreditNote': case 'decideRefund': case 'decideReq': case 'decideCount': case 'decideStockXfer': {
      const x = v as In<'decideDaily'>;
      const ok = x.decision === 'approve';
      const patch = ok ? { status: 'approved' } : { status: 'rejected', reject_reason: x.reason };
      return touched(await sb.from(DECIDE_TABLE[act as keyof typeof DECIDE_TABLE]).update(patch).eq('id', x.id).in('status', ['draft', 'submitted']).select('id'), { ok: true, msg: ok ? t('erp.approved') : t('erp.rejected') }, t);
    }
    // ---- chick sales (0043/0047/0049): the DB decides reserved vs waitlisted, the deposit, who may verify / confirm / override
    case 'addProduct': {
      const x = v as In<'addProduct'>;
      const { error } = await sb.from('chick_product').insert({
        name: x.name, category: x.category, price: x.price ?? null, max_dispatch_age_hours: x.max_age_hours ?? null, required_vaccines: x.required_vaccine ? [x.required_vaccine] : [],
      });
      return fail(error) ?? { ok: true, msg: t('sales.productAdded', { name: x.name }) };
    }
    case 'setTier': {
      const x = v as In<'setTier'>;
      return touched(await sb.from('customer').update({ tier: x.tier, delivery_address: x.delivery_address ?? null }).eq('id', x.customer_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'setBatchProduct': {
      const x = v as In<'setBatchProduct'>;
      return touched(await sb.from('batch').update({ chick_product_id: x.product_id ?? null }).eq('id', x.batch_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'addOrder': {
      const x = v as In<'addOrder'>;
      for (let i = 0; i < 3; i++) { // order numbers are max+1: a concurrent booking can take ours first
        const { data: no, error: e1 } = await sb.rpc('next_doc_no', { kind: 'order' });
        if (e1) return fail(e1)!;
        const { data, error } = await sb.from('sales_order').insert({
          order_no: no, customer_id: x.customer_id, product_id: x.product_id, qty: x.qty, hatch_date: x.hatch_date, price: x.price ?? 0, notes: x.notes ?? null,
        }).select(ORDER).single();
        if (error && /duplicate key/.test(error.message) && i < 2) continue;
        if (error) return fail(error)!;
        if (data.status === 'reserved') return { ok: true, msg: t('sales.orderReserved', { no: data.order_no, until: ist(data.reserve_expires_at) }) };
        return { ok: true, msg: data.suggested_hatch_date ? t('sales.orderWaitlisted', { no: data.order_no, date: data.suggested_hatch_date }) : t('sales.orderWaitlistedNone', { no: data.order_no }) };
      }
      return { ok: false, error: t('duplicate') };
    }
    case 'verifyPayment': {
      const x = v as In<'verifyPayment'>;
      const patch = { payment_status: x.result, ...(x.result === 'rejected' ? {} : { deposit_paid: x.deposit_paid }), ...(x.payment_ref ? { payment_ref: x.payment_ref } : {}) };
      return touched(await sb.from('sales_order').update(patch).eq('id', x.order_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'confirmOrder': {
      const x = v as In<'confirmOrder'>;
      const patch = { status: 'confirmed', ...(x.credit_override_reason ? { credit_override_reason: x.credit_override_reason } : {}) };
      return touched(await sb.from('sales_order').update(patch).eq('id', x.order_id).eq('status', 'reserved').select('id'), { ok: true, msg: t('sales.confirmed') }, t);
    }
    case 'cancelOrder': {
      const x = v as In<'cancelOrder'>;
      return touched(await sb.from('sales_order').update({ status: 'cancelled', cancel_reason: x.reason }).eq('id', x.order_id).select('id'), { ok: true, msg: t('sales.cancelled') }, t);
    }
    case 'moveOrder': {
      const x = v as In<'moveOrder'>;
      return touched(await sb.from('sales_order').update({ hatch_date: x.hatch_date }).eq('id', x.order_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'reserveOrder': {
      const x = v as In<'reserveOrder'>;
      return touched(await sb.from('sales_order').update({ status: 'reserved' }).eq('id', x.order_id).eq('status', 'waitlisted').select('id'), { ok: true, msg: t('sales.reserved') }, t);
    }
    case 'priceOrder': {
      const x = v as In<'priceOrder'>;
      return touched(await sb.from('sales_order').update({ price: x.price, price_change_reason: x.reason }).eq('id', x.order_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'waiveDeposit': {
      const x = v as In<'waiveDeposit'>;
      return touched(await sb.from('sales_order').update({ payment_status: 'waived' }).eq('id', x.order_id).select('id'), { ok: true, msg: t('sales.waived') }, t);
    }
    case 'allocate': {
      const x = v as In<'allocate'>;
      const { error } = await sb.from('order_allocation').insert({ order_id: x.order_id, batch_id: x.batch_id, qty: x.qty, note: x.note ?? null });
      return fail(error) ?? { ok: true, msg: t('sales.allocated') };
    }
    case 'releaseAlloc': {
      const x = v as In<'releaseAlloc'>;
      return touched(await sb.from('order_allocation').update({ status: 'released' }).eq('id', x.id).eq('status', 'approved').select('id'), { ok: true, msg: t('sales.released') }, t);
    }
    // ---- dispatch (0045)
    case 'addVehicle': {
      const x = v as In<'addVehicle'>;
      const { error } = await sb.from('vehicle').insert({
        reg_no: x.reg_no, ownership: x.ownership, capacity_boxes: x.capacity_boxes ?? null, temp_controlled: x.temp_controlled === 'yes',
        fitness_expiry: x.fitness_expiry ?? null, insurance_expiry: x.insurance_expiry ?? null, permit_expiry: x.permit_expiry ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('sales.vehicleAdded', { reg: x.reg_no }) };
    }
    case 'addTrip': {
      const x = v as In<'addTrip'>;
      const { data, error } = await sb.from('dispatch').insert({ vehicle_id: x.vehicle_id, driver_name: x.driver_name, route: x.route ?? null, planned_on: x.planned_on }).select('dispatch_no').single();
      return fail(error) ?? { ok: true, msg: t('sales.tripAdded', { no: data!.dispatch_no }) };
    }
    case 'addLoad': {
      const x = v as In<'addLoad'>;
      const { error } = await sb.from('dispatch_line').insert({
        dispatch_id: x.dispatch_id, allocation_id: x.allocation_id, qty_loaded: x.qty_loaded, boxes: x.boxes ?? null, age_override_reason: x.age_override_reason ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'submitTrip': {
      const x = v as In<'submitTrip'>;
      return touched(await sb.from('dispatch').update({ status: 'submitted' }).eq('id', x.id).in('status', ['draft', 'rejected']).select('id'), { ok: true, msg: t('sales.tripSubmitted') }, t);
    }
    case 'decideTrip': {
      const x = v as In<'decideTrip'>;
      const ok = x.decision === 'approve';
      return touched(await sb.from('dispatch').update(ok ? { status: 'approved' } : { status: 'rejected', reject_reason: x.reason }).eq('id', x.id).eq('status', 'submitted').select('id'),
        { ok: true, msg: ok ? t('sales.tripConfirmed') : t('erp.rejected') }, t);
    }
    case 'deliverTrip': {
      const x = v as In<'deliverTrip'>;
      for (const l of x.lines) {
        const r = await sb.from('dispatch_line').update({ qty_delivered: l.delivered, qty_short: l.short, qty_doa: l.doa }).eq('id', l.id).eq('dispatch_id', x.dispatch_id).select('id');
        if (r.error) return fail(r.error)!;
        if (!r.data?.length) return { ok: false, error: t('notFound') };
      }
      const patch = { status: 'delivered', receiver_name: x.receiver_name, delivery_note: x.delivery_note ?? null, ...(x.pod_path ? { pod_path: x.pod_path } : {}) };
      return touched(await sb.from('dispatch').update(patch).eq('id', x.dispatch_id).eq('status', 'approved').select('id'), { ok: true, msg: t('sales.delivered') }, t);
    }
    case 'completeTrip': {
      const x = v as In<'completeTrip'>;
      return touched(await sb.from('dispatch').update({ status: 'completed' }).eq('id', x.id).eq('status', 'delivered').select('id'), { ok: true, msg: t('sales.tripCompleted') }, t);
    }
    case 'doaClaim': {
      const x = v as In<'doaClaim'>;
      const { error } = await sb.from('doa_claim').insert({ dispatch_line_id: x.dispatch_line_id, reported_on: x.reported_on, qty: x.qty, customer_note: x.customer_note ?? null });
      return fail(error) ?? { ok: true, msg: t('sales.claimed') };
    }
    case 'decideDoa': {
      const x = v as In<'decideDoa'>;
      const ok = x.decision === 'approve';
      return touched(await sb.from('doa_claim').update(ok ? { status: 'approved', resolution: x.resolution } : { status: 'rejected', reject_reason: x.reason }).eq('id', x.id).eq('status', 'submitted').select('id'),
        { ok: true, msg: ok ? t('erp.approved') : t('erp.rejected') }, t);
    }
    // ---- finance (0050): credit notes, refunds, period lock, approval limits. The DB checks totals, the owner threshold and the lock.
    case 'addCreditNote': {
      const x = v as In<'addCreditNote'>;
      const { error } = await sb.from('credit_note').insert({ customer_id: x.customer_id, invoice_id: x.invoice_id ?? null, amount: x.amount, reason: x.reason, issued_on: x.issued_on, note_no: '' });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'addRefund': {
      const x = v as In<'addRefund'>;
      const { error } = await sb.from('refund').insert({
        customer_id: x.customer_id, sales_order_id: x.sales_order_id ?? null, credit_note_id: x.credit_note_id ?? null, amount: x.amount, mode: x.mode, utr: x.utr ?? null, paid_on: x.paid_on ?? null,
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'setLock': case 'setLimit': {
      const x = v as In<'setLock'> & In<'setLimit'>;
      const key = act === 'setLock' ? 'books_locked_until' : x.key;
      const value = act === 'setLock' ? x.date : x.value;
      const r = value == null
        ? await sb.from('tenant_rule').delete().eq('key', key)
        : await sb.from('tenant_rule').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id,key' });
      return fail(r.error) ?? { ok: true, msg: t('erp.saved') };
    }
    // ---- procurement (0051/0053): requisitions, PO approval, stock counts, store transfers
    case 'addReq': {
      const x = v as In<'addReq'>;
      const { error } = await sb.from('purchase_requisition').insert({
        farm_id: x.farm_id, item_id: x.item_id, qty: x.qty, needed_by: x.needed_by ?? null, est_rate: x.est_rate ?? null, purpose: x.purpose ?? null, status: x.status,
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'submitReq': {
      const x = v as In<'submitReq'>;
      return touched(await sb.from('purchase_requisition').update({ status: 'submitted' }).eq('id', x.id).in('status', ['draft', 'rejected']).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'approvePO': {
      const x = v as In<'approvePO'>;
      return touched(await sb.from('purchase_order').update({ status: 'approved' }).eq('id', x.id).in('status', ['draft', 'submitted']).select('id'), { ok: true, msg: t('erp.approved') }, t);
    }
    case 'cancelPO': {
      const x = v as In<'cancelPO'>;
      return touched(await sb.from('purchase_order').update({ status: 'cancelled' }).eq('id', x.id).in('status', ['draft', 'submitted', 'approved']).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'addCount': {
      const x = v as In<'addCount'>;
      const { data: c, error } = await sb.from('stock_count').insert({ store_id: x.store_id, counted_on: x.counted_on, note: x.note ?? null, status: 'draft' }).select('id').single();
      if (error) return fail(error)!;
      const l = await sb.from('stock_count_line').insert(x.lines.map((r) => ({ count_id: c.id, item_id: r.item_id, counted_qty: r.counted_qty })));
      if (l.error) { await sb.from('stock_count').delete().eq('id', c.id); return fail(l.error)!; } // no half-saved sheet
      return { ok: true, msg: t('erp.saved') };
    }
    case 'submitCount': {
      const x = v as In<'submitCount'>;
      return touched(await sb.from('stock_count').update({ status: 'submitted' }).eq('id', x.id).in('status', ['draft', 'rejected']).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'addStockXfer': {
      const x = v as In<'addStockXfer'>;
      const { error } = await sb.from('stock_transfer').insert({ from_store: x.from_store, to_store: x.to_store, item_id: x.item_id, qty: x.qty });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'sendStockXfer': {
      const x = v as In<'sendStockXfer'>;
      return touched(await sb.from('stock_transfer').update({ status: 'in_transit', sent_on: x.sent_on }).eq('id', x.id).eq('status', 'approved').select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'receiveStockXfer': {
      const x = v as In<'receiveStockXfer'>;
      return touched(await sb.from('stock_transfer').update({ status: 'received', received_qty: x.received_qty, received_on: x.received_on }).eq('id', x.id).eq('status', 'in_transit').select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    // ---- settings (0050-0052, 0056)
    case 'addBranch': {
      const x = v as In<'addBranch'>;
      const { error } = await sb.from('branch').insert({ name: x.name, code: x.code ?? null, state: x.state ?? null, district: x.district ?? null, gstin: x.gstin ?? null });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'toggleBranch': {
      const x = v as In<'toggleBranch'>;
      return touched(await sb.from('branch').update({ active: x.active === 'yes' }).eq('id', x.id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'setFarmBranch': {
      const x = v as In<'setFarmBranch'>;
      return touched(await sb.from('farm').update({ branch_id: x.branch_id ?? null }).eq('id', x.farm_id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'addPm': {
      const x = v as In<'addPm'>;
      const { error } = await sb.from('pm_schedule').insert({
        asset_id: x.asset_id, task: x.task, every_days: x.every_days ?? null, every_batches: x.every_batches ?? null, ...(x.last_done_on ? { last_done_on: x.last_done_on } : {}),
      });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'pmDone': {
      const x = v as In<'pmDone'>;
      return touched(await sb.from('pm_schedule').update({ last_done_on: x.date }).eq('id', x.id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'addDelegation': {
      const x = v as In<'addDelegation'>;
      const { error } = await sb.from('approval_delegation').insert({ to_user: x.to_user, roles: x.roles, ends_at: new Date(Date.now() + x.days * 864e5).toISOString(), reason: x.reason });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'revokeDelegation': {
      const x = v as In<'revokeDelegation'>;
      return touched(await sb.from('approval_delegation').update({ revoked_at: new Date().toISOString() }).eq('id', x.id).is('revoked_at', null).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'grantSupport': {
      const x = v as In<'grantSupport'>;
      const { error } = await sb.from('support_access_grant').insert({ reason: x.reason, expires_at: new Date(Date.now() + x.hours * 36e5).toISOString() });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'revokeSupport': {
      const x = v as In<'revokeSupport'>;
      return touched(await sb.from('support_access_grant').update({ revoked_at: new Date().toISOString() }).eq('id', x.id).is('revoked_at', null).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'toggleWebhook': {
      const x = v as In<'toggleWebhook'>;
      return touched(await sb.from('webhook_subscription').update({ active: x.active === 'yes' }).eq('id', x.id).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'revokeApiKey': {
      const x = v as In<'revokeApiKey'>;
      return touched(await sb.from('api_key').update({ revoked_at: new Date().toISOString() }).eq('id', x.id).is('revoked_at', null).select('id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'linkPortal': { // the RPC refuses every failure with one generic message: shown as is
      const x = v as In<'linkPortal'>;
      const { error } = await sb.rpc('link_portal_user', { p_customer: x.customer_id, p_email: x.email });
      return fail(error) ?? { ok: true, msg: t('erp.saved') };
    }
    case 'unlinkPortal': {
      const x = v as In<'unlinkPortal'>;
      return touched(await sb.from('customer_portal_user').delete().eq('customer_id', x.customer_id).select('user_id'), { ok: true, msg: t('erp.saved') }, t);
    }
    case 'remind': {
      const x = v as In<'remind'>;
      const { error } = await sb.from('reminder_log').insert({ customer_id: x.customer_id, invoice_ids: x.invoice_ids, amount: x.amount, channel: 'wa_link', lang: x.lang });
      return fail(error) ?? { ok: true, msg: t('remindOk') };
    }
  }
  return { ok: false, error: t('unknown') };
}
