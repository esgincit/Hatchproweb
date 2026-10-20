// View-model shapes = demo/data.json (what demo/index.html's screens read), filled from Supabase by load.ts.
import type { FarmType } from '@/lib/farm-types';

export type Grades = Partial<Record<'jumbo' | 'large' | 'medium' | 'small' | 'cracked' | 'dirty', number>>;
export type Log = {
  id: string; date: string; day: number; birds: number; mortality: number; culls: number; feed_kg: number;
  water: number; eggs: number; grades: Grades | null; avg_w: number | null; tmax: number | null; tmin: number | null; remarks: string | null;
};
export type Vacc = { id: string; name: string; due: string; done: string | null };
export type Curve = { week: number; egg: number | null; weight: number | null }[];
export type Batch = {
  id: string; code: string; ft: FarmType; breed: string; age: number; doc: number; doc_rate: number; state: string;
  placed: string; shed_name: string; farm_name: string; logs: Log[]; vacc: Vacc[]; curve: Curve;
  cum: { dead: number; feed: number; eggs: number; saleable: number }; // from v_batch_kpi (all-time)
};
export type Shed = { id: string; name: string; type: string; capacity: number };
export type Farm = { id: string; name: string; farm_type: FarmType; district: string; capacity: number; sheds: Shed[] };
export type Bill = { id: string; no: string; vendor: string; category: string; date: string; due: string; total: number; paid: number; status: string; batch: string | null };
export type Invoice = { id: string; no: string; customer: string; product: string; qty: number; unit: string; rate: number; date: string; due: string; total: number; paid: number; status: string; batch: string | null };
export type Tenant = {
  id: string; name: string; plan: string; state: string; status: string;
  farms: Farm[]; batches: Batch[];
  users: { id: string; name: string; role: string; phone: string }[];
  vendors: { id: string; name: string; category: string; contact: string; phone: string; terms: number; rating: number | null; gstin: string | null }[];
  customers: { id: string; name: string; kind: string; phone: string; credit_limit: number; credit_days: number }[];
  workers: { id: string; name: string; role: string; wage: number }[];
  attendance: Record<string, Record<string, 'P' | 'H' | 'A' | 'L'>>; // worker id → date → code
  assets: { id: string; name: string; category: string; next_service: string; status: string }[];
  tickets: { id: string; asset: string; opened: string; issue: string; priority: string; status: string; cost: number | null }[];
  bills: Bill[]; invoices: Invoice[];
  vet_visits: { batch: string; date: string; vet: string; findings: string; prescription: string }[];
  disease_cases: { id: string; batch: string; opened: string; disease: string; confidence: number; vet_confirmed: boolean; status: string; notes: string }[];
  notifications: { id: number; kind: string; severity: string; title: string; body: string; ago_h: number; read: boolean }[];
  pos: { id: string; no: string; vendor: string; item: string; qty: number; rate: number; total: number; expected: string; status: string }[];
  stock: { item: string; unit: string; qty: number; reorder: number }[];
};
export type Rate = { date: string; rate: number };
export type View = {
  today: string;
  rates: Record<'egg' | 'broiler_farmgate' | 'maize' | 'soya', Rate[]>;
  diseases: { code: string; name: string; signs: string }[];
  t: Tenant;
};
