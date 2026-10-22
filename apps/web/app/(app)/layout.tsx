import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { tabsFor } from '@/lib/auth/permissions';
import { AppShell } from '@/components/shell/AppShell';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { todayIST } from '@/lib/view/load';
import { pickerOptions, type FarmType } from '@/lib/farm-types';

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
  if (tenant?.status === 'suspended') {
    const t = await getTranslations('suspended');
    return <div className="app"><main className="screen"><div className="wrap"><div className="card stripe crit" role="alert"><h2>{t('title')}</h2><p className="s">{t('body')}</p></div><SignOutButton /></div></main></div>;
  }
  const types = [...new Set((farms ?? []).map((f) => f.farm_type as FarmType))];
  const mode = (me?.active_farm_type as FarmType | null) ?? (types.length === 1 ? types[0] : null);
  if (!mode) redirect('/welcome');

  const t = await getTranslations();
  const plan = tenant?.plan ? tenant.plan[0].toUpperCase() + tenant.plan.slice(1) : '';
  const sub = [c.roles[0] ? t(`roles.${c.roles[0]}`) : '', tenant?.state, plan + (tenant?.status === 'trial' ? ' trial' : '')]
    .filter(Boolean)
    .join(' · ');

  return (
    <AppShell tenantName={tenant?.name ?? 'HatchPro'} sub={sub} unread={unread ?? 0}
      tabs={tabsFor(c.roles)} mode={mode} modes={pickerOptions(types)} today={todayIST()} roles={c.roles}>
      {children}
    </AppShell>
  );
}
