'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { landingFor } from '@/lib/auth/route-guard';
import { FARM_TYPES, type FarmType } from '@/lib/farm-types';

export async function setFarmType(ft: FarmType) {
  if (!FARM_TYPES.includes(ft)) throw new Error('Unknown farm type');
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { error } = await sb.from('app_user').update({ active_farm_type: ft }).eq('id', user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/', 'layout');
  redirect(landingFor(claimsFromUser(user)));
}
