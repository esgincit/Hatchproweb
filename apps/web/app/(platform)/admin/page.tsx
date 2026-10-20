// Port of demo/index.html platformScreen (:478-490). Real numbers only — the demo padded tenants/MRR/birds for show.
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { ActBtn } from '@/components/ui/ActBtn';
import { Toaster } from '@/components/ui/Toast';
import { Header } from '@/components/ui/bits';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { dateFmt, fmtL, fmtN } from '@/lib/format';

const PRICE: Record<string, number> = { starter: 999, growth: 2999, pro: 7999, enterprise: 25000 };

export default async function Admin() {
  const [t, locale, sb] = await Promise.all([getTranslations('admin'), getLocale(), createClient()]);
  const dmy = dateFmt(locale);
  // defence in depth: middleware already guards /admin
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !claimsFromUser(user).platform) redirect('/platform/login');
  const [{ data: tenants }, { data: kpi }, { data: farms }, { data: users }, { data: rates }] = await Promise.all([
    sb.from('tenant').select('id,name,plan,status,state').order('name'),
    sb.from('v_batch_kpi').select('tenant_id,birds_alive,state'),
    sb.from('farm').select('tenant_id'),
    sb.from('app_user').select('tenant_id'),
    sb.from('market_rate').select('product,rate_date').is('tenant_id', null).order('rate_date', { ascending: false }).limit(50),
  ]);
  const count = (xs: { tenant_id: string | null }[] | null, id: string) => (xs ?? []).filter((x) => x.tenant_id === id).length;
  const rows = (tenants ?? []).map((tt) => ({
    tt, farms: count(farms, tt.id), users: count(users, tt.id),
    birds: (kpi ?? []).filter((k) => k.tenant_id === tt.id && k.state !== 'closed').reduce((a, k) => a + Number(k.birds_alive), 0),
  }));
  const mrr = rows.filter((r) => r.tt.status === 'active').reduce((a, r) => a + (PRICE[r.tt.plan] ?? 0), 0);
  const lastRate = (p: string) => rates?.find((r) => r.product === p)?.rate_date;
  const feeds: [string, string | undefined][] = [[t('fEgg'), lastRate('egg')], [t('fBroiler'), lastRate('broiler_farmgate')], [t('fFeed'), lastRate('maize')]];

  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <div className="tenant">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>HP</span>
            <span><div className="name">{t('platform')}</div><div className="sub">{t('sub')}</div></span>
          </div>
          <LanguagePicker compact />
        </header>
        <main className="screen"><div className="wrap">
          <Header title={t('console')} action={<ActBtn act="tenantOpen" className="btn small">{t('addTenant')}</ActBtn>} />
          <div className="grid2">
            <div className="tile"><div className="lbl">{t('tenants')}</div><div className="val">{rows.length}</div><div className="delta flat">{t('inTrial', { n: rows.filter((r) => r.tt.status === 'trial').length })}</div></div>
            <div className="tile"><div className="lbl">{t('mrr')}</div><div className="val">{fmtL(mrr)}</div><div className="delta flat">{t('activePlans')}</div></div>
            <div className="tile"><div className="lbl">{t('birds')}</div><div className="val">{fmtN(rows.reduce((a, r) => a + r.birds, 0))}</div><div className="delta flat">{t('acrossFarms', { n: rows.reduce((a, r) => a + r.farms, 0) })}</div></div>
            <div className="tile"><div className="lbl">{t('users')}</div><div className="val">{rows.reduce((a, r) => a + r.users, 0)}</div><div className="delta flat">{t('farmLogins')}</div></div>
          </div>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('tenants')}</div>
            <div className="list">
              {rows.map(({ tt, farms: f, users: u, birds }) => (
                <div className="item" key={tt.id}>
                  <div><div className="t">{tt.name}</div><div className="s">{t('tenantLine', { state: tt.state ?? '', farms: f, birds: fmtN(birds), users: u })}</div></div>
                  <div className="r">
                    <span className={`pill ${tt.status === 'trial' ? 'warn' : tt.status === 'suspended' ? 'crit' : 'info'}`}>{tt.status === 'active' ? tt.plan : tt.status}</span>
                    <div className="s">{t('perMonth', { n: fmtN(PRICE[tt.plan] ?? 0) })}</div>
                    <ActBtn act="tenantManage" className="btn small secondary" style={{ marginTop: 4 }}>{t('manage')}</ActBtn>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('feeds')}</div>
            <div className="list">
              {feeds.map(([a, d]) => (
                <div className="item" key={a}><div><div className="t">{a}</div><div className="s">{d ? t('lastUpdate', { date: dmy(d) }) : t('noData')}</div></div>
                  <div className="r"><span className={`pill ${d ? 'good' : 'warn'}`}>{d ? 'OK' : t('attention')}</span></div></div>
              ))}
            </div>
          </div>
          <SignOutButton to="/platform/login" />
        </div></main>
      </div>
      <Toaster />
    </div>
  );
}
