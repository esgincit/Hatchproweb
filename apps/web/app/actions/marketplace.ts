'use server';
// Marketplace actions (0032). They run as the signed-in user; RLS decides who may do what:
// vendors manage their own listings, the platform marketing team reviews, farmers contact approved paid listings.
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';

export type Res = { ok: true; phone?: string } | { ok: false; error: string };
const CATS = ['feed', 'medicine', 'vaccine', 'equipment', 'chicks', 'transport', 'services', 'other'] as const;
const LISTING = z.object({
  id: z.string().uuid().optional(), title: z.string().trim().min(3).max(120), category: z.enum(CATS),
  description: z.string().trim().max(1000).optional(), price_text: z.string().trim().max(60).optional(), area: z.string().trim().max(120).optional(),
});
const fail = (e: { message: string } | null): Res | null => (e ? { ok: false, error: e.message } : null);

export async function saveListing(input: unknown): Promise<Res> {
  const p = LISTING.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  const { data: adv } = await sb.from('advertiser').select('id').eq('user_id', user.id).maybeSingle();
  if (!adv) return { ok: false, error: 'not a vendor' };
  const { id, ...v } = p.data;
  const { error } = id ? await sb.from('product_listing').update(v).eq('id', id) : await sb.from('product_listing').insert({ ...v, advertiser_id: adv.id });
  return fail(error) ?? { ok: true };
}

export async function deleteListing(id: string): Promise<Res> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
  const sb = await createClient();
  const { error } = await sb.from('product_listing').delete().eq('id', id);
  return fail(error) ?? { ok: true };
}

export async function reviewListing(id: string, approve: boolean, note?: string): Promise<Res> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'invalid' };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!claimsFromUser(user).platform) return { ok: false, error: 'forbidden' };
  const { data, error } = await sb.from('product_listing').update({ status: approve ? 'approved' : 'rejected', review_note: note?.slice(0, 300) ?? null }).eq('id', id).select('id');
  return fail(error) ?? (data?.length ? { ok: true } : { ok: false, error: 'forbidden' }); // RLS (0032): only the marketing team updates; other staff match 0 rows
}

/** Farmer taps "Contact": record the lead for the vendor, then hand back the vendor's phone for call / WhatsApp. */
export async function contactListing(listingId: string, message?: string): Promise<Res> {
  if (!z.string().uuid().safeParse(listingId).success) return { ok: false, error: 'invalid' };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  const [{ data: me }, { data: l }] = await Promise.all([
    sb.from('app_user').select('full_name,phone').eq('id', user.id).maybeSingle(),
    sb.from('product_listing').select('id,advertiser(phone)').eq('id', listingId).maybeSingle(), // RLS: approved + paid only
  ]);
  if (!l) return { ok: false, error: 'not available' };
  const { error } = await sb.from('listing_lead').insert({ listing_id: listingId, contact_name: me?.full_name ?? null, contact_phone: me?.phone ?? null, message: message?.slice(0, 500) ?? null });
  return fail(error) ?? { ok: true, phone: (Array.isArray(l.advertiser) ? l.advertiser[0] : l.advertiser)?.phone };
}
