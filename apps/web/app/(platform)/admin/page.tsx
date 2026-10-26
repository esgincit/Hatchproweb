// Port of demo/index.html platformScreen (:478-490). Real numbers only — the demo padded tenants/MRR/birds for show.
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { SignOutButton } from '@/components/shell/SignOutButton';
import Link from 'next/link';
import { Toaster } from '@/components/ui/Toast';
import { Header } from '@/components/ui/bits';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';
import { dateFmt, daysBetween, fmtL, fmtN } from '@/lib/format';
import { Applications, type AppRow } from '@/components/admin/Applications';
import { TenantManage } from '@/components/admin/TenantManage';
import { TEAM } from '@/lib/auth/permissions';

const PRICE: Record<string, number> = { starter: 999, growth: 2999, pro: 7999, enterprise: 25000 };

export default async function Admin() {
  const [t, locale, sb] = await Promise.all([getTranslations('admin'), getLocale(), createClient()]);
  const dmy = dateFmt(locale);
  // defence in depth: middleware already guards /admin
  const { data: { user } } = await sb.auth.getUser();
  const me = claimsFromUser(user);
  if (!user || !me.platform) redirect('/platform/login');
  const sees = (k: keyof typeof TEAM) => me.roles.some((r) => (TEAM[k] as readonly string[]).includes(r));
  const [{ data: tenants }, { data: kpi }, { data: farms }, { data: users }, { data: rates }, { data: apps }] = await Promise.all([
    sb.from('tenant').select('id,name,plan,status,state').order('name'),
    sb.from('v_batch_kpi').select('tenant_id,birds_alive,state'),
    sb.from('farm').select('tenant_id'),
    sb.from('app_user').select('tenant_id'),
    sb.from('market_rate').select('product,rate_date').is('tenant_id', null).order('rate_date', { ascending: false }).limit(50),
    sb.from('onboarding_application').select('*').eq('status', 'submitted').order('created_at'),
  ]);
  // attached documents (0030): 10-minute signed links; storage policy limits reads to the applications teams
  const docPaths = (apps ?? []).flatMap((a) => (a.documents ?? []).map((d: { path: string }) => d.path));
  const { data: signed } = docPaths.length && sees('applications') ? await sb.storage.from('documents').createSignedUrls(docPaths, 600) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const appRows = (apps ?? []).map((a) => ({ ...a, documents: (a.documents ?? []).map((d: { path: string; name: string }) => ({ ...d, url: urlOf.get(d.path) ?? null })) }));
  // pipeline, usage (30 d) and sync health — counted here from live rows (usage_daily has no writer yet)
  // ponytail: row-count queries per tenant; switch to a nightly usage_daily rollup when tenants number in the hundreds
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString(), since24 = new Date(Date.now() - 864e5).toISOString();
  const [{ data: pipe }, { data: logs30 }, { data: media30 }, { data: ai30 }, { data: rem30 }, { data: lastLogs }, { data: sync24 }, { data: pushSubs }] = await Promise.all([
    sees('sales') || sees('applications') ? sb.from('onboarding_application').select('status').gte('created_at', since30) : Promise.resolve({ data: [] }),
    sees('sales') ? sb.from('daily_shed_log').select('tenant_id').gte('created_at', since30) : Promise.resolve({ data: [] }),
    sees('sales') ? sb.from('media').select('tenant_id').gte('created_at', since30) : Promise.resolve({ data: [] }),
    sees('sales') ? sb.from('disease_case').select('tenant_id').not('ai_model_version', 'is', null).gte('opened_on', since30.slice(0, 10)) : Promise.resolve({ data: [] }),
    sees('sales') ? sb.from('reminder_log').select('tenant_id').gte('sent_at', since30) : Promise.resolve({ data: [] }),
    sees('ops') ? sb.from('daily_shed_log').select('tenant_id,log_date').order('log_date', { ascending: false }).limit(2000) : Promise.resolve({ data: [] }),
    sees('ops') ? sb.from('sync_outbox_receipt').select('tenant_id').gte('applied_at', since24) : Promise.resolve({ data: [] }),
    sees('ops') ? sb.from('push_subscription').select('tenant_id') : Promise.resolve({ data: [] }),
  ]);
  const by = (xs: { tenant_id: string | null }[] | null) => (id: string) => (xs ?? []).filter((x) => x.tenant_id === id).length;
  const pipeCount = (s: string) => (pipe ?? []).filter((p) => p.status === s).length;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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
            <span><div className="name">{t('platform')}</div><div className="sub">{me.roles.filter((r) => r.startsWith('platform_')).map((r) => t(`team.${r}`)).join(' · ') || t('sub')}</div></span>
          </div>
          <LanguagePicker compact />
        </header>
        <main className="screen"><div className="wrap">
          <Header title={t('console')} action={sees('applications') ? <Link href="/apply" className="btn small">{t('addTenant')}</Link> : undefined} />
          <div className="grid2">
            <div className="tile"><div className="lbl">{t('tenants')}</div><div className="val">{rows.length}</div><div className="delta flat">{t('inTrial', { n: rows.filter((r) => r.tt.status === 'trial').length })}</div></div>
            <div className="tile"><div className="lbl">{t('mrr')}</div><div className="val">{fmtL(mrr)}</div><div className="delta flat">{t('activePlans')}</div></div>
            <div className="tile"><div className="lbl">{t('birds')}</div><div className="val">{fmtN(rows.reduce((a, r) => a + r.birds, 0))}</div><div className="delta flat">{t('acrossFarms', { n: rows.reduce((a, r) => a + r.farms, 0) })}</div></div>
            <div className="tile"><div className="lbl">{t('users')}</div><div className="val">{rows.reduce((a, r) => a + r.users, 0)}</div><div className="delta flat">{t('farmLogins')}</div></div>
          </div>
          {sees('applications') && <Applications rows={appRows as AppRow[]} />}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('tenants')}</div>
            <div className="list">
              {rows.map(({ tt, farms: f, users: u, birds }) => (
                <div className="item" key={tt.id}>
                  <div><div className="t">{tt.name}</div><div className="s">{t('tenantLine', { state: tt.state ?? '', farms: f, birds: fmtN(birds), users: u })}</div></div>
                  <div className="r">
                    <span className={`pill ${tt.status === 'trial' ? 'warn' : tt.status === 'suspended' ? 'crit' : 'info'}`}>{tt.status === 'active' ? tt.plan : tt.status}</span>
                    <div className="s">{t('perMonth', { n: fmtN(PRICE[tt.plan] ?? 0) })}</div>
                    {sees('billing') && <TenantManage id={tt.id} name={tt.name} plan={tt.plan} status={tt.status} />}
                    {sees('support') && <Link className="btn small secondary" href={`/admin/tenant/${tt.id}`}>{t('viewTenant')}</Link>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {(sees('sales') || sees('applications')) && <div className="card" data-testid="pipeline">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('pipeline')}</div>
            <div className="kv">
              <div>{t('pipeSubmitted')}</div><div>{pipeCount('submitted')}</div>
              <div>{t('pipeApproved')}</div><div>{pipeCount('approved')}</div>
              <div>{t('pipeRejected')}</div><div>{pipeCount('rejected')}</div>
              <div>{t('pipeConversion')}</div><div>{(pipe ?? []).length ? `${Math.round((100 * pipeCount('approved')) / (pipe ?? []).length)}%` : '—'}</div>
            </div>
          </div>}
          {sees('sales') && <div className="card" data-testid="usage">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('usage')}</div>
            <div className="tablewrap"><table>
              <thead><tr><th>{t('tenants')}</th><th className="n">{t('uLogs')}</th><th className="n">{t('uPhotos')}</th><th className="n">{t('uAi')}</th><th className="n">{t('uReminders')}</th></tr></thead>
              <tbody>{rows.map(({ tt }) => (
                <tr key={tt.id}><td>{tt.name}</td><td className="n">{by(logs30)(tt.id)}</td><td className="n">{by(media30)(tt.id)}</td><td className="n">{by(ai30)(tt.id)}</td><td className="n">{by(rem30)(tt.id)}</td></tr>
              ))}</tbody>
            </table></div>
          </div>}
          {sees('ops') && <div className="card" data-testid="sync-health">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('syncHealth')}</div>
            <div className="list">{rows.map(({ tt }) => {
              const last = (lastLogs ?? []).find((l) => l.tenant_id === tt.id)?.log_date as string | undefined;
              const stale = !last || daysBetween(last, today) > 2;
              return (
                <div className="item" key={tt.id}>
                  <div><div className="t">{tt.name}</div>
                    <div className="s">{t('syncLine', { last: last ? dmy(last) : '—', replays: by(sync24)(tt.id), push: by(pushSubs)(tt.id) })}</div></div>
                  <div className="r"><span className={`pill ${stale ? 'warn' : 'good'}`}>{stale ? t('attention') : 'OK'}</span></div>
                </div>
              );
            })}</div>
          </div>}
          {sees('feeds') && <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>{t('feeds')}</div>
            <div className="list">
              {feeds.map(([a, d]) => (
                <div className="item" key={a}><div><div className="t">{a}</div><div className="s">{d ? t('lastUpdate', { date: dmy(d) }) : t('noData')}</div></div>
                  <div className="r"><span className={`pill ${d ? 'good' : 'warn'}`}>{d ? 'OK' : t('attention')}</span></div></div>
              ))}
            </div>
          </div>}
          <SignOutButton to="/platform/login" />
        </div></main>
      </div>
      <Toaster />
    </div>
  );
}
