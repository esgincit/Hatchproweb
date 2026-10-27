// Support "view tenant" (roadmap Phase 11 impersonation, read-only by design): platform support/admin see a farm's
// setup, live batches, users and recent alerts to help on a call — they cannot act as the farm. Every open is written
// to audit_log first (0031: append-only; the farm's owner can read it), and the page refuses to render if that fails.
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { TEAM } from '@/lib/auth/permissions';
import { Back, Header } from '@/components/ui/bits';
import { dateFmt, fmtN } from '@/lib/format';

// last 4 digits only, whatever the stored format ("+91 98490 12345", "9849012345", …)
const mask = (p: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? '••••••' + d.slice(-4) : '—'; };

export default async function TenantView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, locale, sb] = await Promise.all([getTranslations('admin'), getLocale(), createClient()]);
  const dmy = dateFmt(locale);
  const { data: { user } } = await sb.auth.getUser();
  const me = claimsFromUser(user);
  if (!user || !me.platform) redirect('/platform/login');
  if (!me.roles.some((r) => (TEAM.support as readonly string[]).includes(r))) notFound();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const { data: tenant } = await sb.from('tenant').select('id,name,state,plan,status').eq('id', id).maybeSingle();
  if (!tenant) notFound();
  const { error: auditErr } = await sb.from('audit_log').insert({ tenant_id: id, user_id: user.id, action: 'support.view', entity_type: 'tenant', entity_id: id });
  if (auditErr) throw new Error('could not record the support view: ' + auditErr.message); // no unaudited views

  const [{ data: sub }, { data: farms }, { data: kpi }, { data: users }, { data: alerts }, { data: audit }] = await Promise.all([
    sb.from('subscription').select('plan,status,trial_ends_on,current_period_end').eq('tenant_id', id).maybeSingle(),
    sb.from('farm').select('id,name,farm_type,district,shed(id)').eq('tenant_id', id).order('created_at'),
    sb.from('v_batch_kpi').select('code,farm_type,state,age_days,birds_alive,mortality_pct').eq('tenant_id', id).neq('state', 'closed').order('code'),
    sb.from('app_user').select('full_name,phone,user_role_assignment(role)').eq('tenant_id', id).order('full_name'),
    sb.from('notification').select('title,severity,created_at').eq('tenant_id', id).eq('severity', 'critical').order('created_at', { ascending: false }).limit(10),
    sb.from('audit_log').select('action,created_at,user_id').eq('tenant_id', id).order('created_at', { ascending: false }).limit(10),
  ]);

  return (
    <div className="app"><div className="col"><main className="screen"><div className="wrap">
      <Back href="/admin" />
      <Header title={tenant.name} />
      <div className="card stripe warn" role="note">{t('viewNotice')}</div>
      <div className="card"><div className="kv">
        <div>{t('state')}</div><div>{tenant.state ?? '—'}</div>
        <div>{t('plan')}</div><div>{sub?.plan ?? tenant.plan} · {sub?.status ?? tenant.status}</div>
        <div>{t('periodEnd')}</div><div>{sub?.current_period_end ? dmy(sub.current_period_end) : sub?.trial_ends_on ? dmy(sub.trial_ends_on) : '—'}</div>
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('farmsH')}</div><div className="list">
        {(farms ?? []).map((f) => <div className="item" key={f.id}><div><div className="t">{f.name}</div><div className="s">{f.farm_type} · {f.district ?? ''} · {t('shedsN', { n: (f.shed ?? []).length })}</div></div></div>)}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('batchesH')}</div><div className="tablewrap"><table>
        <thead><tr><th>{t('batchCol')}</th><th className="n">{t('age')}</th><th className="n">{t('birdsCol')}</th><th className="n">{t('mort')}</th></tr></thead>
        <tbody>{(kpi ?? []).map((k) => <tr key={k.code}><td>{k.code} · {k.state}</td><td className="n">{k.age_days}</td><td className="n">{fmtN(Number(k.birds_alive))}</td><td className="n">{Number(k.mortality_pct).toFixed(2)}%</td></tr>)}</tbody>
      </table></div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('usersH')}</div><div className="list">
        {(users ?? []).map((u, i) => <div className="item" key={i}><div><div className="t">{u.full_name}</div><div className="s">{mask(u.phone)} · {((u.user_role_assignment ?? []) as { role: string }[]).map((r) => r.role).join(', ')}</div></div></div>)}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('alertsH')}</div><div className="list">
        {(alerts ?? []).map((a, i) => <div className="item" key={i}><div><div className="t">{a.title}</div><div className="s">{dmy(a.created_at.slice(0, 10))}</div></div></div>)}
        {!alerts?.length && <div className="s">—</div>}
      </div></div>
      <div className="card" data-testid="audit"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('auditH')}</div><div className="list">
        {(audit ?? []).map((a, i) => <div className="item" key={i}><div><div className="t">{a.action}</div><div className="s">{new Date(a.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div></div></div>)}
      </div></div>
    </div></main></div></div>
  );
}
