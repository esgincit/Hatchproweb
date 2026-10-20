import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { tabsFor } from '@/lib/auth/permissions';
import { AppShell } from '@/components/shell/AppShell';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

const ROLE_LABEL: Record<string, string> = {
  tenant_owner: 'Owner', farm_manager: 'Manager', finance: 'Finance', shed_supervisor: 'Supervisor',
  labour: 'Labour', veterinarian: 'Vet', store_keeper: 'Store', auditor: 'Auditor',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const c = claimsFromUser(user);
  if (!c.tenantId) redirect('/login?error=no-access');

  const [{ data: me }, { data: tenant }, { count: unread }, { data: farms }] = await Promise.all([
    sb.from('app_user').select('active_farm_type').eq('id', user.id).maybeSingle(),
    sb.from('tenant').select('name, state, plan, status').eq('id', c.tenantId).maybeSingle(),
    sb.from('notification').select('id', { count: 'exact', head: true }).is('read_at', null),
    sb.from('farm').select('farm_type'),
  ]);
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  const mode = (me?.active_farm_type as FarmType | null) ?? (types.length === 1 ? types[0] : null);
  if (!mode) redirect('/welcome');

  const plan = tenant?.plan ? tenant.plan[0].toUpperCase() + tenant.plan.slice(1) : '';
  const sub = [ROLE_LABEL[c.roles[0]] ?? c.roles[0], tenant?.state, plan + (tenant?.status === 'trial' ? ' trial' : '')]
    .filter(Boolean)
    .join(' · ');

  return (
    <AppShell tenantName={tenant?.name ?? 'HatchPro'} sub={sub} unread={unread ?? 0}
      tabs={tabsFor(c.roles)} mode={mode} modes={pickerOptions(types)}>
      {children}
    </AppShell>
  );
}
