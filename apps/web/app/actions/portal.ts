'use server';
// Customer portal: a portal user has no tenant claim, so everything goes through the portal_* functions (0050).
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const PAY = z.object({ order_no: z.string().trim().min(1).max(20), ref: z.string().trim().min(4).max(60) });

/** Payment reference only: portal users cannot write to the evidence bucket (its policy needs a tenant claim), so no proof file. */
export async function submitPortalPayment(order_no: string, ref: string): Promise<{ ok: boolean; msg: string }> {
  const t = await getTranslations('portal');
  const p = PAY.safeParse({ order_no, ref });
  if (!p.success) return { ok: false, msg: t('refBad') };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, msg: t('notCustomer') };
  const { error } = await sb.rpc('portal_submit_payment', { p_order_no: p.data.order_no, p_ref: p.data.ref, p_proof_path: null });
  if (error) return { ok: false, msg: error.message };
  revalidatePath('/portal');
  return { ok: true, msg: t('paySent') };
}
