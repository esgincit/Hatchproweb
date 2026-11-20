// Plan modules (0050/0051 auth_has_module): the Sales / Dispatch screens only exist when the tenant's plan has them. The DB refuses inserts anyway.
// (tenant_modules() itself is not callable by users since 0051; auth_has_module() answers for the caller's own tenant.)
import type { createClient } from '@/lib/supabase/server';

export async function hasModule(sb: Awaited<ReturnType<typeof createClient>>, module: string): Promise<boolean> {
  const { data } = await sb.rpc('auth_has_module', { p_module: module });
  return data === true;
}
