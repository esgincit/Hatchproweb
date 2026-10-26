import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { addDays, daysBetween } from '@/lib/format';
import type { FarmType } from '@/lib/farm-types';
import type { Batch, Grades, Log, Rate, Tenant, View } from './types';

/** IST calendar date. APP_TODAY (dev only) pins it so the fixed-date seed looks live. */
export const todayIST = () => process.env.APP_TODAY || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

const ATT: Record<string, 'P' | 'H' | 'A' | 'L'> = { present: 'P', half: 'H', absent: 'A', leave: 'L' };
const n = (v: unknown) => (v == null ? 0 : Number(v));
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows are mapped field-by-field below */

/**
 * Everything the tenant screens read, scoped by RLS to the signed-in user's tenant.
 * `mode` narrows farms/batches to the farm type the user picked (Broiler / Layer / Hatchery view).
 * ponytail: one round of parallel queries per request; split per screen when tenants get large.
 */
export const loadView = cache(async (mode?: FarmType): Promise<View> => {
  const sb = await createClient();
  const today = todayIST();
  const since = addDays(today, -90);
  const monthStart = today.slice(0, 8) + '01';
  const q = await Promise.all([
    sb.from('tenant').select('id,name,plan,state,status').maybeSingle(),
    sb.from('farm').select('id,name,farm_type,district,village,lat,lng,capacity_birds,shed(id,name,shed_type,capacity_birds,area_sqft)').order('created_at'),
    sb.from('batch').select('id,code,farm_type,placed_on,doc_count,doc_rate,state,contract_id,breed(id,name),farm(name),shed(name)').order('placed_on', { ascending: false }),
    sb.from('daily_shed_log')
      .select('id,batch_id,log_date,birds_opening,mortality,culls,feed_kg,water_litres,temp_min_c,temp_max_c,humidity_pct,avg_weight_g,remarks,created_by,egg_production(grade,count)')
      .gte('log_date', since).order('log_date'),
    sb.from('v_batch_kpi').select('batch_id,cum_mortality,feed_kg,eggs,saleable_eggs'),
    sb.from('vaccination_schedule').select('id,batch_id,due_date,done_on,vaccine_master(name)').order('due_date'),
    sb.from('breed_standard_curve').select('breed_id,age_week,std_egg_pct,std_weight_g').order('age_week'),
    sb.from('app_user').select('id,full_name,phone,user_role_assignment(role)').order('created_at'),
    sb.from('vendor').select('id,name,category,contact_name,phone,payment_terms_days,rating,gstin').order('name'),
    sb.from('customer').select('id,name,kind,phone,credit_limit,credit_days').order('name'),
    sb.from('worker').select('id,name,role,wage_rate,farm_id').eq('active', true).order('name'),
    sb.from('attendance').select('worker_id,att_date,status').gte('att_date', monthStart),
    sb.from('asset').select('id,name,category,next_service_on,status,farm_id,shed_id').order('name'),
    sb.from('maintenance_ticket').select('id,opened_on,issue,priority,status,cost,asset_id,asset(name)').order('opened_on', { ascending: false }),
    sb.from('bill').select('id,bill_no,category,bill_date,due_date,total,paid,status,batch_id,vendor(name)').order('bill_date', { ascending: false }),
    sb.from('invoice')
      .select('id,invoice_no,product,qty,unit,rate,invoice_date,due_date,total,paid,status,batch_id,customer_id,customer(name)')
      .order('invoice_date', { ascending: false }),
    sb.from('vet_visit').select('batch_id,visit_date,vet_name,findings,prescription').order('visit_date', { ascending: false }),
    sb.from('disease_case').select('id,batch_id,opened_on,ai_top_condition,ai_confidence,vet_confirmed,status,notes').order('opened_on', { ascending: false }),
    sb.from('notification').select('id,kind,severity,title,body,created_at,read_at').order('created_at', { ascending: false }).limit(50),
    sb.from('purchase_order').select('id,po_no,expected_on,status,total,vendor(name),po_line(qty,rate,item(name))').order('po_date', { ascending: false }),
    sb.from('v_stock_balance').select('item_id,qty,store_id'),
    sb.from('item').select('id,name,unit,reorder_level,category'),
    sb.from('market_rate').select('product,rate_date,rate').is('tenant_id', null)
      .in('product', ['egg', 'broiler_farmgate', 'maize', 'soya']).in('zone', ['Hyderabad', 'Telangana'])
      .gte('rate_date', addDays(today, -60)).order('rate_date'),
    sb.from('disease_master').select('code,name,signs').order('name'),
    sb.from('tenant_document').select('id,name,ref_no,expires_on').order('expires_on'),
    sb.from('payment_approval').select('id,amount,paid_on,bill(bill_no,vendor(name))').eq('status', 'pending').order('created_at'),
    sb.from('worker_advance').select('id,worker_id,amount,given_on,reason,worker(name)').gte('given_on', monthStart).order('given_on', { ascending: false }),
    sb.from('store').select('id,farm_id'),
    sb.from('hatch_record').select('batch_id,candled_on,clears,dead_germ,hatched_on,chicks_a,chicks_b,culls'),
    sb.from('contract').select('id,name,customer_id,base_rate,std_fcr,fcr_bonus,fcr_penalty,min_rate,allowed_mort_pct,mort_penalty,active,customer(name)').order('created_at'),
    sb.from('contract_settlement').select('batch_id,settled_on,lifted_birds,lifted_kg,feed_kg,dead,fcr,rate,mort_charge,net,invoice_no'),
  ]);
  const err = q.find((r) => r.error)?.error;
  if (err) throw new Error(err.message);
  const [tenantRows, farms, batches, logs, kpi, vacc, curves, users, vendors, customers, workers, att, assets, tickets, bills, invoices, visits, cases, notifs, pos, stock, items, rates, diseases, docs, approvals, advances, stores, hatches, contracts, settlements] =
    q.map((r) => r.data ?? []) as any[][];
  const tenant = tenantRows as any;

  const codeOf = new Map<string, string>(batches.map((b) => [b.id, b.code]));
  const placedOf = new Map<string, string>(batches.map((b) => [b.id, b.placed_on]));
  const logsBy = new Map<string, Log[]>();
  for (const l of logs) {
    const placed = placedOf.get(l.batch_id);
    if (!placed) continue;
    const grades: Grades | null = l.egg_production?.length ? Object.fromEntries(l.egg_production.map((e: any) => [e.grade, e.count])) : null;
    const list = logsBy.get(l.batch_id) ?? [];
    list.push({
      id: l.id, date: l.log_date, day: daysBetween(placed, l.log_date), birds: l.birds_opening, mortality: l.mortality, culls: l.culls,
      feed_kg: n(l.feed_kg), water: n(l.water_litres), eggs: grades ? Object.values(grades).reduce((a, c) => a + (c ?? 0), 0) : 0, grades,
      avg_w: l.avg_weight_g, tmax: l.temp_max_c == null ? null : n(l.temp_max_c), tmin: l.temp_min_c == null ? null : n(l.temp_min_c), remarks: l.remarks,
      rh: l.humidity_pct == null ? null : n(l.humidity_pct), by: l.created_by ?? null,
    });
    logsBy.set(l.batch_id, list);
  }
  const kpiBy = new Map<string, any>(kpi.map((k) => [k.batch_id, k]));

  const allBatches: Batch[] = batches.map((b) => {
    const k = kpiBy.get(b.id);
    const breed = one<any>(b.breed);
    return {
      id: b.id, code: b.code, ft: b.farm_type, breed: breed?.name ?? '', age: daysBetween(b.placed_on, today), doc: b.doc_count, doc_rate: n(b.doc_rate),
      state: b.state, placed: b.placed_on, shed_name: one<any>(b.shed)?.name ?? '', farm_name: one<any>(b.farm)?.name ?? '',
      logs: logsBy.get(b.id) ?? [],
      vacc: vacc.filter((v) => v.batch_id === b.id).map((v) => ({ id: v.id, name: one<any>(v.vaccine_master)?.name ?? '', due: v.due_date, done: v.done_on })),
      curve: curves.filter((c) => c.breed_id === breed?.id).map((c) => ({ week: c.age_week, egg: c.std_egg_pct == null ? null : n(c.std_egg_pct), weight: c.std_weight_g })),
      cum: { dead: n(k?.cum_mortality), feed: n(k?.feed_kg), eggs: n(k?.eggs), saleable: n(k?.saleable_eggs) },
      hatch: hatches.find((h) => h.batch_id === b.id) ?? null,
      contract_id: b.contract_id ?? null,
      settlement: ((s) => (s ? { ...s, lifted_kg: n(s.lifted_kg), feed_kg: n(s.feed_kg), fcr: n(s.fcr), rate: n(s.rate), mort_charge: n(s.mort_charge), net: n(s.net) } : null))(settlements.find((s) => s.batch_id === b.id)),
    };
  });

  const qty = new Map<string, number>();
  for (const s of stock) qty.set(s.item_id, (qty.get(s.item_id) ?? 0) + n(s.qty));
  // complete feed (not ingredients) on hand per farm, via each farm's store — drives silo levels in the 3D farm
  const farmOfStore = new Map<string, string>(stores.map((s) => [s.id, s.farm_id]));
  const feedItems = new Set(items.filter((i) => i.category === 'feed').map((i) => i.id));
  const feedByFarm: Record<string, number> = {};
  for (const s of stock) {
    const f = farmOfStore.get(s.store_id);
    if (f && feedItems.has(s.item_id)) feedByFarm[f] = (feedByFarm[f] ?? 0) + n(s.qty);
  }
  const attendance: Tenant['attendance'] = {};
  for (const a of att) (attendance[a.worker_id] ??= {})[a.att_date] = ATT[a.status] ?? 'P';

  const t: Tenant = {
    id: tenant?.id ?? '', name: tenant?.name ?? '', plan: tenant?.plan ?? 'starter', state: tenant?.state ?? '', status: tenant?.status ?? 'active',
    farms: farms
      .filter((f) => !mode || f.farm_type === mode)
      .map((f) => ({
        id: f.id, name: f.name, farm_type: f.farm_type, district: f.district ?? '', village: f.village ?? '', capacity: n(f.capacity_birds),
        lat: f.lat == null ? null : n(f.lat), lng: f.lng == null ? null : n(f.lng), feed_kg: f.id in feedByFarm ? Math.round(feedByFarm[f.id]) : null,
        sheds: (f.shed ?? []).map((s: any) => ({ id: s.id, name: s.name, type: s.shed_type, capacity: n(s.capacity_birds), area: s.area_sqft })),
      })),
    batches: allBatches.filter((b) => !mode || b.ft === mode),
    users: users.map((u) => ({ id: u.id, name: u.full_name, phone: u.phone ?? '', role: u.user_role_assignment?.[0]?.role ?? '' })),
    vendors: vendors.map((v) => ({
      id: v.id, name: v.name, category: v.category, contact: v.contact_name ?? '', phone: v.phone ?? '',
      terms: v.payment_terms_days, rating: v.rating == null ? null : n(v.rating), gstin: v.gstin,
    })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, kind: c.kind, phone: c.phone ?? '', credit_limit: n(c.credit_limit), credit_days: c.credit_days ?? 0 })),
    contracts: contracts.map((c) => ({
      id: c.id, name: c.name, customer_id: c.customer_id, customer: one<any>(c.customer)?.name ?? '', active: c.active,
      base_rate: n(c.base_rate), std_fcr: n(c.std_fcr), fcr_bonus: n(c.fcr_bonus), fcr_penalty: n(c.fcr_penalty), min_rate: n(c.min_rate),
      allowed_mort_pct: n(c.allowed_mort_pct), mort_penalty: n(c.mort_penalty),
    })),
    workers: workers.map((w) => ({ id: w.id, name: w.name, role: w.role, wage: n(w.wage_rate), farm_id: w.farm_id ?? null })),
    attendance,
    assets: assets.map((a) => ({ id: a.id, name: a.name, category: a.category, next_service: a.next_service_on ?? today, status: a.status, farm_id: a.farm_id ?? null, shed_id: a.shed_id ?? null })),
    tickets: tickets.map((k) => ({
      id: k.id, asset_id: k.asset_id ?? null, asset: one<any>(k.asset)?.name ?? '', opened: k.opened_on, issue: k.issue, priority: k.priority, status: k.status, cost: k.cost == null ? null : n(k.cost),
    })),
    bills: bills.map((b) => ({
      id: b.id, no: b.bill_no, vendor: one<any>(b.vendor)?.name ?? '', category: b.category, date: b.bill_date, due: b.due_date,
      total: n(b.total), paid: n(b.paid), status: b.status, batch: codeOf.get(b.batch_id) ?? null,
    })),
    invoices: invoices.map((i) => ({
      id: i.id, no: i.invoice_no, customer_id: i.customer_id, customer: one<any>(i.customer)?.name ?? '', product: i.product, qty: n(i.qty), unit: i.unit, rate: n(i.rate),
      date: i.invoice_date, due: i.due_date, total: n(i.total), paid: n(i.paid), status: i.status, batch: codeOf.get(i.batch_id) ?? null,
    })),
    vet_visits: visits.map((v) => ({ batch: codeOf.get(v.batch_id) ?? '', date: v.visit_date, vet: v.vet_name, findings: v.findings ?? '', prescription: v.prescription ?? '' })),
    disease_cases: cases.map((c) => ({
      id: c.id, batch: codeOf.get(c.batch_id) ?? '', opened: c.opened_on, disease: c.ai_top_condition ?? '', confidence: n(c.ai_confidence),
      vet_confirmed: !!c.vet_confirmed, status: c.status, notes: c.notes ?? '',
    })),
    notifications: notifs.map((x) => ({
      id: x.id, kind: x.kind, severity: x.severity, title: x.title, body: x.body ?? '', read: !!x.read_at,
      ago_h: Math.max(0, Math.round((Date.now() - new Date(x.created_at).getTime()) / 36e5)),
    })),
    pos: pos.map((p) => {
      const l = p.po_line?.[0];
      return { id: p.id, no: p.po_no, vendor: one<any>(p.vendor)?.name ?? '', item: one<any>(l?.item)?.name ?? '', qty: n(l?.qty), rate: n(l?.rate), total: n(p.total), expected: p.expected_on ?? today, status: p.status };
    }),
    stock: items
      .filter((i) => qty.has(i.id))
      .map((i) => ({ item_id: i.id, item: i.name, unit: i.unit, qty: Math.round((qty.get(i.id) ?? 0) * 10) / 10, reorder: n(i.reorder_level) })),
    docs: docs.map((d) => ({ id: d.id, name: d.name, ref_no: d.ref_no, expires: d.expires_on })),
    approvals: approvals.map((a) => { const bl = one<any>(a.bill); return { id: a.id, bill_no: bl?.bill_no ?? '', vendor: one<any>(bl?.vendor)?.name ?? '', amount: n(a.amount), date: a.paid_on }; }),
    advances: advances.map((a) => ({ id: a.id, worker_id: a.worker_id, worker: one<any>(a.worker)?.name ?? '', amount: n(a.amount), date: a.given_on, reason: a.reason ?? '' })),
  };

  const series = (p: string): Rate[] => rates.filter((r) => r.product === p).map((r) => ({ date: r.rate_date, rate: n(r.rate) }));
  return {
    today,
    rates: { egg: series('egg'), broiler_farmgate: series('broiler_farmgate'), maize: series('maize'), soya: series('soya') },
    diseases: diseases.map((d) => ({ code: d.code, name: d.name, signs: d.signs ?? '' })),
    t,
  };
});
