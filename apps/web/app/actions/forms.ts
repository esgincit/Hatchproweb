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
  decideHatch: 'hatch_record', decideQuality: 'chick_quality_inspection',
} as const;
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
      const { error } = await sb.from('customer').insert({ name: x.name, kind: x.kind, phone: x.phone, credit_limit: x.credit_limit, credit_days: x.credit_days });
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
    case 'decideDaily': case 'decideEggs': case 'decideCandling': case 'decideXfer': case 'decideHatch': case 'decideQuality': {
      const x = v as In<'decideDaily'>;
      const ok = x.decision === 'approve';
      const patch = ok ? { status: 'approved' } : { status: 'rejected', reject_reason: x.reason };
      return touched(await sb.from(DECIDE_TABLE[act as keyof typeof DECIDE_TABLE]).update(patch).eq('id', x.id).in('status', ['draft', 'submitted']).select('id'), { ok: true, msg: ok ? t('erp.approved') : t('erp.rejected') }, t);
    }
    case 'remind': {
      const x = v as In<'remind'>;
      const { error } = await sb.from('reminder_log').insert({ customer_id: x.customer_id, invoice_ids: x.invoice_ids, amount: x.amount, channel: 'wa_link', lang: x.lang });
      return fail(error) ?? { ok: true, msg: t('remindOk') };
    }
  }
  return { ok: false, error: t('unknown') };
}
