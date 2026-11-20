'use server';
// Customer portal: a portal user has no tenant claim, so everything goes through the portal_* functions (0050).
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { proofPathOk } from '@/lib/schemas';

const PAY = z.object({ order_no: z.string().trim().min(1).max(20), ref: z.string().trim().min(4).max(60) });

/** Payment reference + optional proof. The browser has already uploaded the file into <tenant>/payment/<order id>/ with the customer's own login (0061 storage policy); the DB checks the path again. */
export async function submitPortalPayment(order_no: string, ref: string, proof_path?: string | null): Promise<{ ok: boolean; msg: string }> {
  const t = await getTranslations('portal');
  const p = PAY.safeParse({ order_no, ref });
  if (!p.success) return { ok: false, msg: t('refBad') };
  if (proof_path && !proofPathOk(proof_path)) return { ok: false, msg: t('proofBad') };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, msg: t('notCustomer') };
  const { error } = await sb.rpc('portal_submit_payment', { p_order_no: p.data.order_no, p_ref: p.data.ref, p_proof_path: proof_path || null });
  if (error) return { ok: false, msg: error.message };
  revalidatePath('/portal');
  return { ok: true, msg: t('paySent') };
}
