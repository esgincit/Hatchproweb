'use server';
// Public "apply for access" (no login). Writes with the anon key; RLS only allows a fresh 'submitted' row
// and nobody can read applications back except platform staff.
import { createClient } from '@supabase/supabase-js';
import { getTranslations } from 'next-intl/server';
import { APPLY } from '@/lib/schemas';

export async function submitApplication(input: unknown): Promise<{ ok: true } | { ok: false; error: string; fields?: string[] }> {
  const t = await getTranslations('apply');
  const p = APPLY.safeParse(input);
  if (!p.success) return { ok: false, error: t('invalid'), fields: p.error.issues.map((i) => String(i.path[0])) };
  const a = p.data;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const e164 = (m?: string) => (m ? '+91' + m : null);
  const { error } = await sb.from('onboarding_application').insert({
    business_name: a.business_name, legal_name: a.legal_name ?? null, entity_type: a.entity_type, pan: a.pan, gstin: a.gstin ?? null,
    udyam: a.udyam ?? null, fssai: a.fssai ?? null, pcb_ref: a.pcb_ref ?? null, trade_licence: a.trade_licence ?? null,
    owner_name: a.owner_name, phone: e164(a.phone), alt_phone: e164(a.alt_phone), email: a.email ?? null, whatsapp: e164(a.whatsapp ?? a.phone),
    language: a.language, farm_types: a.farm_types, state: a.state, district: a.district,
    sites: [{
      name: a.site_name, village: a.village, mandal: a.mandal, district: a.district, state: a.state, pin: a.pin, lat: a.lat, lng: a.lng,
      land_acres: a.land_acres, ownership: a.ownership,
      sheds: a.sheds.map((s) => ({ ...s, type: s.floor === 'cage' ? 'cage' : s.type === 'environment_controlled' ? 'environment_controlled' : 'deep_litter', housing: s.type })),
    }],
    operations: { current_birds: a.current_birds, breed: a.breed, model: a.model, integrator: a.integrator, monthly_volume: a.monthly_volume },
    labour: { supervisor: a.labour_supervisor, worker: a.labour_worker, vaccinator: a.labour_vaccinator, driver: a.labour_driver, technician: a.labour_technician },
    consent: a.consent,
  });
  if (error) return { ok: false, error: error.code === '23505' ? t('duplicate') : error.message };
  return { ok: true };
}
