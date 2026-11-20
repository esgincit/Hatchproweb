// Form schemas: validated in the browser for instant feedback and again in the server action (the real guard).
import { z } from 'zod';
import { RULE_KEYS, parseRule } from './rules';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blank, s.optional());
const id = z.string().uuid();
const text = z.string().trim().min(1).max(120);
// real calendar days only: 2026-02-30 would otherwise roll over to 2 March
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d + 'T00:00:00Z').toISOString().startsWith(d));
const notFuture = date.refine((d) => d <= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })); // IST, same as the DB guard
const phone = opt(z.string().trim().regex(/^\+?[\d\s-]{10,16}$/)); // mobile or STD landline
const int = (min = 0) => z.coerce.number().int().min(min);
const money = z.coerce.number().positive().max(1e10);

const dec = (min: number, max: number) => z.coerce.number().min(min).max(max);
const yes = z.literal('yes');
export const DIET_STAGES = ['starter', 'grower', 'pre_breeder', 'breeder_1', 'breeder_2'] as const;
export const WATER_TREAT = ['none', 'chlorine', 'sanitizer', 'medication'] as const;
export const WATER_QUAL = ['normal', 'cloudy', 'discolored', 'odor'] as const;
export const VENT = ['normal', 'reduced', 'off'] as const;
export const LITTER = ['good', 'damp', 'wet', 'caked'] as const;
export const POWER = ['mains', 'generator', 'off'] as const;
export const MACHINE_KINDS = ['setter', 'hatcher', 'combined'] as const;
const DECIDE = z.object({ id, decision: z.enum(['approve', 'reject']), reason: opt(z.string().trim().max(300)) })
  .refine((x) => x.decision === 'approve' || !!x.reason, { path: ['reason'] });

export const TIERS = ['platinum', 'gold', 'standard'] as const;
export const CHICK_CATS = ['broiler', 'layer', 'breeder', 'other'] as const;
export const PAY_RESULTS = ['verified', 'partial', 'rejected'] as const;
export const OWNERSHIPS = ['own', 'hired'] as const;
export const DOA_RESOLUTIONS = ['replace', 'credit_note', 'none'] as const;
const why = z.string().trim().min(1).max(300);
const note = (n: number) => opt(z.string().trim().max(n));

export const FARM_TYPES = ['broiler', 'layer', 'hatchery', 'breeder'] as const;
export const SHED_TYPES = ['cage', 'deep_litter', 'environment_controlled'] as const;
export const VENDOR_CATS = ['doc_hatchery', 'feed', 'feed_ingredient', 'medicine', 'vaccine', 'equipment', 'transport', 'labour_contractor', 'packaging', 'fuel', 'other'] as const;
export const BILL_CATS = ['chick', 'feed', 'medicine', 'vaccine', 'equipment', 'transport', 'labour', 'fuel', 'other'] as const;
export const PRODUCTS = ['egg', 'bird', 'manure', 'spent_hen', 'doc', 'gc'] as const; // gc = growing charge (contract farming)
export const CUSTOMER_KINDS = ['trader', 'retailer', 'integrator', 'wholesaler'] as const;
export const WORKER_ROLES = ['supervisor', 'helper', 'driver', 'security'] as const;
export const PAY_MODES = ['upi', 'neft', 'cash', 'cheque'] as const;
export const ATT = ['present', 'half', 'absent', 'leave'] as const;
export const GRADES = ['jumbo', 'large', 'medium', 'small', 'cracked', 'dirty'] as const;
export const STAGES = ['placed', 'brooding', 'growing', 'laying', 'finishing', 'lifting'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const ASSET_CATS = ['feeder', 'drinker', 'fan', 'generator', 'incubator', 'grader', 'vehicle', 'other'] as const;
export const ITEM_CATS = ['feed', 'feed_ingredient', 'medicine', 'vaccine', 'disinfectant', 'equipment', 'spare', 'packaging', 'fuel', 'other'] as const;
export const RATE_PRODUCTS = ['egg', 'broiler_farmgate', 'maize', 'soya'] as const;
export const STAFF_ROLES = ['farm_manager', 'finance', 'shed_supervisor', 'labour', 'veterinarian', 'store_keeper', 'auditor', 'hatchery_manager', 'hatchery_ops_manager', 'hatchery_technician', 'sales_officer', 'dispatch_officer', 'procurement_officer'] as const;
export const LIMIT_KEYS = ['po_approval_above', 'finance_owner_above', 'stock_adjust_owner_above'] as const;
export const API_SCOPES = ['readings:write', 'orders:read', 'stock:read', 'trace:read'] as const;
export const WEBHOOK_EVENTS = ['order.status', 'dispatch.status'] as const;
export const LANGS =['en', 'te', 'hi', 'ta', 'kn'] as const;
/** Indian mobile: any formatting, last 10 digits starting 6-9 */
const mobile = z.string().transform((s) => s.replace(/\D/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/));

export const SCHEMAS = {
  addFarm: z.object({ name: text, farm_type: z.enum(FARM_TYPES), district: opt(text), village: opt(text), capacity: opt(int(1)) }),
  addShed: z.object({ farm_id: id, name: text, shed_type: z.enum(SHED_TYPES), capacity: int(1), area_sqft: opt(int(1)) }),
  // breeder flocks also split the birds placed into females + males (0038): both or neither, and they add up to the chicks placed
  addBatch: z.object({ shed_id: id, code: text, breed_id: opt(id), placed: notFuture, doc: int(1), doc_rate: z.coerce.number().min(0), vendor_id: opt(id), females_placed: opt(int(0)), males_placed: opt(int(0)) })
    .refine((x) => (x.females_placed == null) === (x.males_placed == null), { path: ['females_placed'] })
    .refine((x) => x.females_placed == null || x.females_placed + (x.males_placed ?? 0) === x.doc, { path: ['doc'] }),
  mort: z.object({ batch_id: id, date, count: int(1), cause: opt(z.string().max(20)), notes: opt(z.string().max(500)) }),
  vaccDone: z.object({ vacc_id: id, date }),
  addVisit: z.object({ batch_id: id, date, vet: text, findings: opt(z.string().max(1000)), prescription: opt(z.string().max(1000)) }),
  saleOpen: z.object({ customer_id: id, product: z.enum(PRODUCTS), qty: money, unit: text, rate: money, date, batch_id: opt(id) }),
  addBill: z.object({ vendor_id: id, category: z.enum(BILL_CATS), total: money, date, batch_id: opt(id), bill_no: opt(z.string().max(40)) }),
  payOpen: z.object({ kind: z.enum(['bill', 'invoice']), id, amount: money, mode: z.enum(PAY_MODES), date, utr: opt(z.string().max(40)) }),
  addCustomer: z.object({ name: text, kind: z.enum(CUSTOMER_KINDS), phone, credit_limit: z.coerce.number().min(0), credit_days: int(0), tier: opt(z.enum(TIERS)), delivery_address: note(300) }),
  addVendor: z.object({
    name: text, category: z.enum(VENDOR_CATS), contact: opt(text), phone,
    gstin: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/)), terms: int(0),
  }),
  addWorker: z.object({ name: text, role: z.enum(WORKER_ROLES), farm_id: id, wage: money, phone }),
  attSet: z.object({ worker_id: id, date, status: z.enum(ATT) }),
  logSave: z.object({
    batch_id: id, date, mortality: int(0), culls: int(0), feed_bags: z.coerce.number().min(0), water: opt(z.coerce.number().min(0)),
    tmin: opt(z.coerce.number().min(-10).max(60)), tmax: opt(z.coerce.number().min(-10).max(60)), rh: opt(z.coerce.number().min(0).max(100)),
    avg_w: opt(int(1)), remarks: opt(z.string().max(500)), eggs: opt(z.partialRecord(z.enum(GRADES), z.coerce.number().int().min(0))),
  }),
  closeBatch: z.object({ batch_id: id, date, customer_id: opt(id), weight_kg: opt(money), rate: opt(money) }),
  batchState: z.object({ batch_id: id, state: z.enum(STAGES), date }),
  addVacc: z.object({ batch_id: id, vaccine_id: id, due: date }),
  confirmCase: z.object({ case_id: id }),
  closeCase: z.object({ case_id: id }),
  reportIssue: z.object({ asset_id: id, issue: z.string().trim().min(3).max(500), priority: z.enum(PRIORITIES), date }),
  closeTicket: z.object({ ticket_id: id, date, cost: opt(z.coerce.number().min(0)), vendor_id: opt(id) }),
  addAsset: z.object({ farm_id: id, name: text, category: z.enum(ASSET_CATS), cost: opt(z.coerce.number().min(0)), next_service: date, date, vendor_id: opt(id) }),
  serviceDone: z.object({ asset_id: id, date, next_service: date }),
  addItem: z.object({ name: text, category: z.enum(ITEM_CATS), unit: z.string().trim().min(1).max(20), reorder: opt(z.coerce.number().min(0)), gst: opt(z.coerce.number().min(0).max(28)) }),
  raisePO: z.object({ vendor_id: id, item_id: id, qty: money, rate: money, expected: date, date }).refine((x) => x.expected >= x.date, { path: ['expected'] }),
  grnOpen: z.object({ po_id: id, qty: money, bill_amount: money, date, lot: opt(z.string().max(40)), expiry: opt(date) })
    .refine((x) => !x.expiry || x.expiry >= x.date, { path: ['expiry'] }), // goods that arrive already expired are refused
  addRate: z.object({ product: z.enum(RATE_PRODUCTS), zone: text, rate: money, date }),
  addDoc: z.object({ name: text, ref_no: opt(z.string().max(60)), expires: opt(date) }),
  addAdvance: z.object({ worker_id: id, amount: money, date, reason: opt(z.string().max(200)) }),
  // contract broiler (0029): terms, link a batch, settle at harvest (the server computes the charge — lib/settlement.ts)
  addContract: z.object({
    customer_id: id, name: text, base_rate: money, std_fcr: z.coerce.number().min(1).max(4),
    fcr_bonus: z.coerce.number().min(0).max(100), fcr_penalty: z.coerce.number().min(0).max(100), min_rate: z.coerce.number().min(0).max(1000),
    allowed_mort_pct: z.coerce.number().min(0).max(100), mort_penalty: z.coerce.number().min(0).max(10000),
  }),
  linkContract: z.object({ batch_id: id, contract_id: id }),
  settleContract: z.object({ batch_id: id, date, lifted_birds: int(1), lifted_kg: money }),
  // labour shift entry: ADDS to the day (add_shift_log, 0028); op_id makes an offline replay a no-op
  shiftLog: z.object({
    op_id: id, batch_id: id, date, shift: z.enum(['morning', 'evening', 'night']),
    mortality: int(0), culls: int(0), feed_bags: z.coerce.number().min(0).max(500), water: opt(z.coerce.number().min(0).max(100000)),
  }),
  // hatchery setting (hatch_record, 0025 — DB trigger checks counts against eggs set)
  hatchCandle: z.object({ batch_id: id, date, clears: int(), dead_germ: int() }),
  hatchResult: z.object({ batch_id: id, date, chicks_a: int(), chicks_b: int(), culls: int() }),
  // salary bank file (worker_bank, 0022 — same format checks)
  setBank: z.object({
    worker_id: id,
    account_no: z.string().trim().regex(/^[0-9]{9,18}$/, '9–18 digits'),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'e.g. SBIN0001234'),
  }),
  // WhatsApp payment reminder (click-to-chat): log who reminded which customer about which invoices, in which language
  remind: z.object({ customer_id: id, invoice_ids: z.array(id).min(1).max(50), amount: money, lang: z.enum(LANGS) }),
  decidePay: z.object({ approval_id: id, approve: z.enum(['yes', 'no']) }),
  // egg transfer farm -> hatchery, setting sources, tenant rules (0036). Exactly one source: breeder flock or bought-in supplier.
  addTransfer: z.object({
    flock_id: opt(id), vendor_id: opt(id), to_farm_id: id, laid_from: date, laid_to: date, sent_on: notFuture,
    trays: opt(int(0)), qty: int(1), vehicle_no: opt(z.string().trim().max(20)), driver_name: opt(z.string().trim().max(80)), status: z.enum(['draft', 'submitted']),
  }).refine((x) => !!x.flock_id !== !!x.vendor_id, { path: ['flock_id'] })
    .refine((x) => x.laid_to >= x.laid_from, { path: ['laid_to'] })
    .refine((x) => x.sent_on >= x.laid_to, { path: ['sent_on'] }),
  submitTransfer: z.object({ transfer_id: id }),
  decideTransfer: z.object({ transfer_id: id, decision: z.enum(['approve', 'reject']), reason: opt(z.string().trim().max(300)) })
    .refine((x) => x.decision === 'approve' || !!x.reason, { path: ['reason'] }),
  cancelTransfer: z.object({ transfer_id: id }), // approved, not yet received (0037)
  receiveTransfer: z.object({ transfer_id: id, received_qty: int(0), rejects: int(0), date: notFuture, note: opt(z.string().trim().max(500)) })
    .refine((x) => x.rejects <= x.received_qty, { path: ['rejects'] }),
  loadSetting: z.object({ batch_id: id, transfer_id: id, qty: int(1), age_override_reason: opt(z.string().trim().max(300)) }),
  setRule: z.object({ key: z.string().refine((k) => RULE_KEYS.includes(k)), value: z.string().trim().min(1).max(10) })
    .refine((x) => parseRule(x.key, x.value) !== null, { path: ['value'] }),
  // ---- breeder flock (0038/0039): daily record, weights, egg collection, health, house readings
  breederDaily: z.object({
    batch_id: id, date: notFuture, female_mort: int(0), male_mort: int(0), female_culls: int(0), male_culls: int(0),
    feed_f_kg: opt(dec(0, 1e5)), feed_m_kg: opt(dec(0, 1e5)), diet_stage: opt(z.enum(DIET_STAGES)), cleanup_hours: opt(dec(0, 24)),
    water_l: opt(dec(0, 1e6)), water_treatment: opt(z.enum(WATER_TREAT)), water_quality: opt(z.enum(WATER_QUAL)), light_hours: opt(dec(0, 24)), remarks: opt(z.string().max(500)),
  }),
  bodyWeight: z.object({
    batch_id: id, date: notFuture, sex: z.enum(['F', 'M']), sample_size: int(1), avg_g: int(1),
    uniformity_pct: opt(dec(0, 100)), cv_pct: opt(dec(0, 100)), fleshing_score: opt(int(1).max(5)),
  }).refine((x) => x.sex === 'M' || x.fleshing_score == null, { path: ['fleshing_score'] }),
  eggCollection: z.object({
    batch_id: id, date: notFuture, collection_no: int(1).max(6), nest: int(0), floor: int(0).default(0), broken: int(0).default(0), cracked: int(0).default(0), dirty: int(0).default(0),
    dirty_treated: int(0).default(0), misshapen: int(0).default(0), double_yolk: int(0).default(0), small: int(0).default(0), soft_shell: int(0).default(0),
  }).refine((x) => x.dirty_treated <= x.dirty, { path: ['dirty_treated'] })
    .refine((x) => x.broken + x.cracked + x.dirty + x.misshapen + x.double_yolk + x.small + x.soft_shell <= x.nest, { path: ['nest'] }),
  medication: z.object({
    batch_id: id, date: notFuture, medicine: text, dosage: z.string().trim().min(1).max(60), duration_days: int(1).max(90),
    reason: z.string().trim().min(1).max(500), prescribed_by: opt(z.string().trim().max(120)), withdrawal_days: opt(int(0).max(120)),
  }),
  biosecurity: z.object({
    batch_id: id, date, nature: z.string().trim().min(3).max(500), birds_affected: opt(int(0)), action_taken: opt(z.string().trim().max(1000)),
    responsible: opt(z.string().trim().max(120)), follow_up_on: opt(date),
  }).refine((x) => !x.follow_up_on || x.follow_up_on >= x.date, { path: ['follow_up_on'] }),
  houseReading: z.object({
    shed_id: id, temp_c: opt(dec(-20, 60)), rh_pct: opt(dec(0, 100)), nh3_ppm: opt(dec(0, 1000)), lux: opt(dec(0, 1e5)),
    ventilation: opt(z.enum(VENT)), litter: opt(z.enum(LITTER)), power: opt(z.enum(POWER)),
  }),
  // ---- hatchery (0041/0042): machines, setter loading, candling, hatcher, hatch, release, chick quality, vaccination
  addMachine: z.object({ farm_id: id, name: text, machine_kind: z.enum(MACHINE_KINDS), machine_no: opt(z.string().trim().max(20)), capacity_eggs: int(1), stage: z.enum(['single', 'multi']) }),
  machineReading: z.object({
    asset_id: id, temp_c: opt(dec(-20, 60)), wet_bulb_c: opt(dec(-20, 60)), rh_pct: opt(dec(0, 100)), fan_rpm: opt(int(0)), alarm: opt(z.enum(['yes', 'no'])),
  }),
  loadSetter: z.object({ batch_id: id, setter_id: id }),
  // stage 1 = day 10 (infertile / early dead / dirty), stage 2 = day 18 (mid / late dead)
  candling: z.object({
    batch_id: id, stage: z.coerce.number().int().min(1).max(2), date: notFuture, eggs_candled: int(0),
    infertile: opt(int(0)), early_dead: opt(int(0)), dirty: opt(int(0)), mid_dead: opt(int(0)), late_dead: opt(int(0)),
  }).refine((x) => (x.stage === 1 ? [x.infertile, x.early_dead, x.dirty] : [x.mid_dead, x.late_dead]).every((n) => n != null), { path: ['infertile'] }),
  hatcherTransfer: z.object({ batch_id: id, hatcher_id: id, date: notFuture, eggs: int(1) }),
  hatchFull: z.object({ batch_id: id, date: notFuture, chicks_a: int(0), chicks_b: int(0), culls: int(0), dead_in_hatcher: int(0), unhatched: int(0) }),
  releaseHatcher: z.object({
    batch_id: id, chicks_removed: yes, waste_recorded: yes, cleaned: yes, disinfected: yes, inspected: yes,
    disinfectant: opt(z.string().trim().max(80)), notes: opt(z.string().trim().max(500)),
  }),
  chickQuality: z.object({
    batch_id: id, date: notFuture, sample_size: int(1), avg_weight_g: opt(dec(1, 200)), uniformity_pct: opt(dec(0, 100)),
    navel_defects: int(0), leg_defects: int(0), other_defects: int(0), dispatch_eligible: z.enum(['yes', 'no']), remarks: opt(z.string().trim().max(500)),
  }).refine((x) => x.navel_defects + x.leg_defects + x.other_defects <= x.sample_size, { path: ['sample_size'] }),
  chickVaccine: z.object({
    batch_id: id, vaccine_id: id, vaccine_lot: z.string().trim().min(1).max(40), expiry: date, qty: int(1), override_reason: opt(z.string().trim().max(300)),
  }),
  // approve / reject one record: the six approval flows share one shape, each act key carries its own role list
  decideDaily: DECIDE, decideEggs: DECIDE, decideCandling: DECIDE, decideXfer: DECIDE, decideHatch: DECIDE, decideQuality: DECIDE,
  // ---- chick sales (0043/0047/0049): product master, tiers, orders, payment verification, allocation
  addProduct: z.object({ name: z.string().trim().min(1).max(80), category: z.enum(CHICK_CATS), price: opt(dec(0, 1e6)), max_age_hours: opt(int(1)), required_vaccine: opt(id) }),
  setTier: z.object({ customer_id: id, tier: z.enum(TIERS), delivery_address: note(300) }),
  setBatchProduct: z.object({ batch_id: id, product_id: opt(id) }),
  addOrder: z.object({ customer_id: id, product_id: id, qty: int(1), hatch_date: date, price: opt(dec(0, 1e6)), notes: note(500) }),
  verifyPayment: z.object({ order_id: id, result: z.enum(PAY_RESULTS), deposit_paid: dec(0, 1e10), payment_ref: note(60) })
    .refine((x) => x.result === 'rejected' || x.deposit_paid > 0, { path: ['deposit_paid'] }),
  confirmOrder: z.object({ order_id: id, credit_override_reason: note(300) }),
  cancelOrder: z.object({ order_id: id, reason: why }),
  moveOrder: z.object({ order_id: id, hatch_date: date }),
  reserveOrder: z.object({ order_id: id }),
  priceOrder: z.object({ order_id: id, price: dec(0, 1e6), reason: why }),
  waiveDeposit: z.object({ order_id: id }),
  allocate: z.object({ order_id: id, batch_id: id, qty: int(1), note: note(300) }),
  decideAlloc: DECIDE,
  releaseAlloc: z.object({ id }),
  // ---- dispatch (0045): vehicles, trips, loading, delivery + POD, DOA claims
  addVehicle: z.object({
    reg_no: z.string().trim().toUpperCase().min(4).max(20), ownership: z.enum(OWNERSHIPS), capacity_boxes: opt(int(1)), temp_controlled: opt(z.enum(['yes', 'no'])),
    fitness_expiry: opt(date), insurance_expiry: opt(date), permit_expiry: opt(date),
  }),
  addTrip: z.object({ vehicle_id: id, driver_name: z.string().trim().min(1).max(80), route: note(200), planned_on: date }),
  addLoad: z.object({ dispatch_id: id, allocation_id: id, qty_loaded: int(1), boxes: opt(int(1)), age_override_reason: note(300) }),
  submitTrip: z.object({ id }),
  decideTrip: DECIDE,
  deliverTrip: z.object({
    dispatch_id: id, receiver_name: z.string().trim().min(1).max(80), delivery_note: note(500), pod_path: note(200),
    lines: z.array(z.object({ id, delivered: int(0), short: int(0), doa: int(0) })).min(1).max(50),
  }).refine((x) => x.lines.every((l) => l.doa <= l.delivered), { path: ['lines'] }),
  completeTrip: z.object({ id }),
  doaClaim: z.object({ dispatch_line_id: id, reported_on: notFuture, qty: int(1), customer_note: note(500) }),
  decideDoa: z.object({ id, decision: z.enum(['approve', 'reject']), resolution: opt(z.enum(DOA_RESOLUTIONS)), reason: note(300) })
    .refine((x) => x.decision === 'reject' || !!x.resolution, { path: ['resolution'] })
    .refine((x) => x.decision === 'approve' || !!x.reason, { path: ['reason'] }),
  // ---- finance / procurement / settings (0050-0053, 0056): the approval flows reuse DECIDE (a reason is required to reject)
  addCreditNote: z.object({ customer_id: id, invoice_id: opt(id), amount: money, reason: z.string().trim().min(3).max(300), issued_on: date }),
  decideCreditNote: DECIDE, decideRefund: DECIDE, decideReq: DECIDE, decideCount: DECIDE, decideStockXfer: DECIDE,
  addRefund: z.object({ customer_id: id, sales_order_id: opt(id), credit_note_id: opt(id), amount: money, mode: z.enum(PAY_MODES), utr: note(40), paid_on: opt(date) }),
  setLock: z.object({ date: opt(date) }), // blank = reopen the books
  setLimit: z.object({ key: z.enum(LIMIT_KEYS), value: opt(z.coerce.number().positive().max(1e10)) }), // blank = back to the default / off
  addReq: z.object({ farm_id: id, item_id: id, qty: money, needed_by: opt(date), est_rate: opt(z.coerce.number().min(0).max(1e8)), purpose: note(300), status: z.enum(['draft', 'submitted']) }),
  submitReq: z.object({ id }),
  approvePO: z.object({ id }), cancelPO: z.object({ id }),
  addCount: z.object({ store_id: id, counted_on: date, note: note(300), lines: z.array(z.object({ item_id: id, counted_qty: z.coerce.number().min(0).max(1e9) })).min(1).max(300) }),
  submitCount: z.object({ id }),
  addStockXfer: z.object({ from_store: id, to_store: id, item_id: id, qty: money }).refine((x) => x.from_store !== x.to_store, { path: ['to_store'] }),
  sendStockXfer: z.object({ id, sent_on: date }),
  receiveStockXfer: z.object({ id, received_qty: z.coerce.number().min(0).max(1e9), received_on: date }),
  addBranch: z.object({ name: z.string().trim().min(1).max(80), code: note(20), state: note(60), district: note(60), gstin: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/)) }),
  toggleBranch: z.object({ id, active: z.enum(['yes', 'no']) }),
  setFarmBranch: z.object({ farm_id: id, branch_id: opt(id) }),
  addPm: z.object({ asset_id: id, task: z.string().trim().min(3).max(200), every_days: opt(int(1)), every_batches: opt(int(1)), last_done_on: opt(date) })
    .refine((x) => x.every_days != null || x.every_batches != null, { path: ['every_days'] }),
  pmDone: z.object({ id, date }),
  addDelegation: z.object({ to_user: id, roles: z.array(z.string().max(40)).min(1).max(6), days: int(1).max(60), reason: z.string().trim().min(3).max(200) }),
  revokeDelegation: z.object({ id }),
  grantSupport: z.object({ hours: int(1).max(144), reason: z.string().trim().min(3).max(300) }), // the DB caps a grant at 7 days from its creation
  revokeSupport: z.object({ id }),
  toggleWebhook: z.object({ id, active: z.enum(['yes', 'no']) }),
  revokeApiKey: z.object({ id }),
  linkPortal: z.object({ customer_id: id, email: z.string().trim().email().max(120) }),
  unlinkPortal: z.object({ customer_id: id }),
  inviteUser: z.object({ name: text, phone: mobile, role: z.enum(STAFF_ROLES), language: z.enum(LANGS), farm_id: opt(id) }),
} as const;

/* ---------- public application (no login) — not an ActKey, submitted by app/actions/apply.ts ---------- */
const optText = (max = 120) => opt(z.string().trim().max(max));
const count = opt(z.coerce.number().int().min(0).max(1_000_000));
export const SHED_ROW = z.object({
  name: text, length_ft: opt(z.coerce.number().positive().max(2000)), width_ft: opt(z.coerce.number().positive().max(500)),
  type: z.enum(['open', 'environment_controlled', 'semi_ec']), floor: z.enum(['deep_litter', 'cage', 'slatted']), capacity: int(1),
});
export const APPLY = z.object({
  business_name: text, legal_name: optText(), entity_type: z.enum(['proprietor', 'partnership', 'llp', 'pvt_ltd', 'fpo', 'cooperative']),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/),
  gstin: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/)), udyam: optText(40), fssai: optText(20), pcb_ref: optText(60), trade_licence: optText(60),
  owner_name: text, phone: mobile, alt_phone: opt(mobile), email: opt(z.string().trim().email().max(120)), whatsapp: opt(mobile), language: z.enum(LANGS),
  farm_types: z.array(z.enum(FARM_TYPES)).min(1),
  site_name: text, village: optText(), mandal: optText(), district: text, state: text, pin: z.string().trim().regex(/^\d{6}$/),
  lat: opt(z.coerce.number().min(6).max(38)), lng: opt(z.coerce.number().min(68).max(98)), // India bounds
  land_acres: opt(z.coerce.number().positive().max(10_000)), ownership: z.enum(['owned', 'leased']),
  sheds: z.array(SHED_ROW).min(1).max(60),
  current_birds: count, breed: optText(60), model: z.enum(['independent', 'integrator', 'own_integration']), integrator: optText(80), monthly_volume: count,
  labour_supervisor: count, labour_worker: count, labour_vaccinator: count, labour_driver: count, labour_technician: count,
  consent: z.literal(true),
  // 0030: verified mobile (apply-otp) + documents uploaded into that check's folder
  phone_check_id: id,
  documents: z.array(z.object({ path: z.string().max(200), name: z.string().trim().max(120) })).max(5).default([]),
});
export type Application = z.infer<typeof APPLY>;

export type ActKey = keyof typeof SCHEMAS;
export const isAct = (a: string): a is ActKey => a in SCHEMAS;
