import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { FarmType } from '@/lib/farm-types';

/** The Broiler/Layer/Hatchery view the user picked; a single-type tenant needs no pick. */
export const currentMode = cache(async (): Promise<FarmType | undefined> => {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return undefined;
  const [{ data: me }, { data: farms }] = await Promise.all([
    sb.from('app_user').select('active_farm_type').eq('id', user.id).maybeSingle(),
    sb.from('farm').select('farm_type'),
  ]);
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  return (me?.active_farm_type as FarmType | null) ?? (types.length === 1 ? types[0] : undefined);
});
