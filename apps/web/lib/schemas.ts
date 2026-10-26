// Form schemas: validated in the browser for instant feedback and again in the server action (the real guard).
import { z } from 'zod';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blank, s.optional());
const id = z.string().uuid();
const text = z.string().trim().min(1).max(120);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const int = (min = 0) => z.coerce.number().int().min(min);
const money = z.coerce.number().positive().max(1e10);

export const FARM_TYPES = ['broiler', 'layer', 'hatchery', 'breeder'] as const;
export const SHED_TYPES = ['cage', 'deep_litter', 'environment_controlled'] as const;
export const VENDOR_CATS = ['doc_hatchery', 'feed', 'feed_ingredient', 'medicine', 'vaccine', 'equipment', 'transport', 'labour_contractor', 'packaging', 'fuel', 'other'] as const;
export const BILL_CATS = ['chick', 'feed', 'medicine', 'vaccine', 'equipment', 'transport', 'labour', 'fuel', 'other'] as const;
export const PRODUCTS = ['egg', 'bird', 'manure', 'spent_hen', 'doc'] as const;
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
export const STAFF_ROLES = ['farm_manager', 'finance', 'shed_supervisor', 'labour', 'veterinarian', 'store_keeper', 'auditor'] as const;
export const LANGS = ['en', 'te', 'hi', 'ta', 'kn'] as const;
/** Indian mobile: any formatting, last 10 digits starting 6-9 */
const mobile = z.string().transform((s) => s.replace(/\D/g, '').slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/));

export const SCHEMAS = {
  addFarm: z.object({ name: text, farm_type: z.enum(FARM_TYPES), district: opt(text), village: opt(text), capacity: opt(int(1)) }),
  addShed: z.object({ farm_id: id, name: text, shed_type: z.enum(SHED_TYPES), capacity: int(1), area_sqft: opt(int(1)) }),
  addBatch: z.object({ shed_id: id, code: text, breed_id: opt(id), placed: date, doc: int(1), doc_rate: z.coerce.number().min(0), vendor_id: opt(id) }),
  mort: z.object({ batch_id: id, date, count: int(1), cause: opt(z.string().max(20)), notes: opt(z.string().max(500)) }),
  vaccDone: z.object({ vacc_id: id, date }),
  addVisit: z.object({ batch_id: id, date, vet: text, findings: opt(z.string().max(1000)), prescription: opt(z.string().max(1000)) }),
  saleOpen: z.object({ customer_id: id, product: z.enum(PRODUCTS), qty: money, unit: text, rate: money, date, batch_id: opt(id) }),
  addBill: z.object({ vendor_id: id, category: z.enum(BILL_CATS), total: money, date, batch_id: opt(id), bill_no: opt(z.string().max(40)) }),
  payOpen: z.object({ kind: z.enum(['bill', 'invoice']), id, amount: money, mode: z.enum(PAY_MODES), date, utr: opt(z.string().max(40)) }),
  addCustomer: z.object({ name: text, kind: z.enum(CUSTOMER_KINDS), phone: opt(z.string().max(20)), credit_limit: z.coerce.number().min(0), credit_days: int(0) }),
  addVendor: z.object({
    name: text, category: z.enum(VENDOR_CATS), contact: opt(text), phone: opt(z.string().max(20)),
    gstin: opt(z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/)), terms: int(0),
  }),
  addWorker: z.object({ name: text, role: z.enum(WORKER_ROLES), farm_id: id, wage: money, phone: opt(z.string().max(20)) }),
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
  raisePO: z.object({ vendor_id: id, item_id: id, qty: money, rate: money, expected: date, date }),
  grnOpen: z.object({ po_id: id, qty: money, bill_amount: money, date, lot: opt(z.string().max(40)), expiry: opt(date) }),
  addRate: z.object({ product: z.enum(RATE_PRODUCTS), zone: text, rate: money, date }),
  addDoc: z.object({ name: text, ref_no: opt(z.string().max(60)), expires: opt(date) }),
  addAdvance: z.object({ worker_id: id, amount: money, date, reason: opt(z.string().max(200)) }),
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
});
export type Application = z.infer<typeof APPLY>;

export type ActKey = keyof typeof SCHEMAS;
export const isAct = (a: string): a is ActKey => a in SCHEMAS;
