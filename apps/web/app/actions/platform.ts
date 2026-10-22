'use server';
// Platform team decisions on applications. Approve → provision-tenant edge function (creates tenant,
// owner login, farms + sheds from the application). Reject → note, via RLS (platform-only policy).
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';

type Result = { ok: true } | { ok: false; error: string };
const PLANS = ['starter', 'growth', 'pro', 'enterprise'];

async function platformClient() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user && claimsFromUser(user).platform ? sb : null;
}

export async function approveApplication(id: string, plan: string, trialDays: number): Promise<Result> {
  const sb = await platformClient();
  if (!sb) return { ok: false, error: 'forbidden' };
  if (!PLANS.includes(plan) || !(trialDays >= 0 && trialDays <= 90)) return { ok: false, error: 'invalid plan or trial' };
  const { error } = await sb.functions.invoke('provision-tenant', { body: { application_id: id, plan, trial_days: trialDays } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    return { ok: false, error: (ctx ? await ctx.text().catch(() => '') : '') || error.message };
  }
  revalidatePath('/admin');
  return { ok: true };
}

export async function rejectApplication(id: string, note: string): Promise<Result> {
  const sb = await platformClient();
  if (!sb) return { ok: false, error: 'forbidden' };
  const { data: { user } } = await sb.auth.getUser();
  const { error } = await sb.from('onboarding_application')
    .update({ status: 'rejected', review_note: note.slice(0, 500), reviewed_by: user!.id, reviewed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'submitted');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true };
}
