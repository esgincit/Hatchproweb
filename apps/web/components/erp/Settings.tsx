// Settings: modules the plan includes, branches, preventive-maintenance schedules, approval limits, delegation, API keys, webhooks, support access.
// Owner screen (delegation is also offered to the roles that can hand their approvals on). RLS and the module policies are the real guards.
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { ALL_MODULES, hasModule } from '@/lib/modules';
import { DELEGATORS } from '@/lib/auth/permissions';
import { dateFmt, fmtINR } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Header } from '@/components/ui/bits';
import { Card, one, type Row, type T } from './bits';
import { SecretCreate } from './Secrets';

const LIMITS = ['po_approval_above', 'finance_owner_above', 'stock_adjust_owner_above'] as const;
const LIMIT_DEFAULT: Record<string, number | null> = { po_approval_above: null, finance_owner_above: 50000, stock_adjust_owner_above: 25000 };
const stamp = (locale: string, iso: string) => new Date(iso).toLocaleString(locale === 'en' ? 'en-IN' : locale, { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export async function SettingsArea({ roles }: { roles: string[] }) {
  const [t, locale, sb] = [await getTranslations(), await getLocale(), await createClient()];
  const owner = roles.includes('tenant_owner');
  const delegator = roles.filter((r) => DELEGATORS.includes(r));
  const mods = await Promise.all(ALL_MODULES.map(async (m) => [m, await hasModule(sb, m)] as const));
  const has = (m: string) => mods.find(([k]) => k === m)?.[1] ?? false;
  return (
    <>
      <Header title={t('setg.title')} />
      {owner && <Modules mods={mods} t={t} sb={sb} />}
      {owner && <Branches t={t} on={has('branches')} />}
      {owner && <Pm t={t} locale={locale} />}
      {owner && <Limits t={t} />}
      <Delegation t={t} locale={locale} mine={delegator} owner={owner} />
      {owner && <Keys t={t} locale={locale} on={has('api')} />}
      {owner && <Hooks t={t} on={has('api')} />}
      {owner && <Support t={t} locale={locale} />}
    </>
  );
}

async function Modules({ mods, t, sb }: { mods: (readonly [string, boolean])[]; t: T; sb: Awaited<ReturnType<typeof createClient>> }) {
  const { data } = await sb.from('tenant').select('plan').maybeSingle();
  return (
    <Card title={t('setg.modules')} testid="modules">
      <div className="s">{t('setg.plan', { plan: data?.plan ?? '' })}</div>
      <div className="list">
        {mods.map(([m, on]) => (
          <div className="item" key={m} data-testid="module-row" data-module={m}>
            <div><div className="t">{t(`setg.mod.${m}`)}</div></div>
            <div className="r"><span className={`pill ${on ? 'good' : 'neutral'}`}>{on ? t('setg.included') : t('setg.notIncluded')}</span></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function Branches({ t, on }: { t: T; on: boolean }) {
  const sb = await createClient();
  const [{ data: bs }, { data: farms }] = await Promise.all([
    sb.from('branch').select('id,name,code,state,district,gstin,active').order('name'),
    sb.from('farm').select('id,name,branch_id').order('name'),
  ]);
  return (
    <Card title={t('setg.branches')} testid="branches" action={on ? <ActBtn act="addBranch" className="btn small">{t('setg.addBranch')}</ActBtn> : undefined}>
      {!on && <div className="s" data-testid="branches-off">{t('setg.needPlan')}</div>}
      <div className="list">
        {(bs ?? []).map((b: Row) => (
          <div className="item" key={b.id} data-testid="branch-row" data-name={b.name}>
            <div><div className="t">{b.name}{b.code ? ` · ${b.code}` : ''}</div><div className="s">{[b.district, b.state, b.gstin].filter(Boolean).join(' · ')}</div></div>
            <div className="r row" style={{ gap: 6 }}>
              <span className={`pill ${b.active ? 'good' : 'neutral'}`}>{b.active ? t('setg.active') : t('setg.inactive')}</span>
              <ActBtn act="toggleBranch" ctx={{ id: b.id, active: b.active ? 'no' : 'yes' }} className="btn small secondary">{b.active ? t('setg.deactivate') : t('setg.activate')}</ActBtn>
            </div>
          </div>
        ))}
        {(farms ?? []).map((f: Row) => (
          <div className="item" key={f.id} data-testid="farm-branch-row" data-name={f.name}>
            <div><div className="t">{f.name}</div><div className="s">{(bs ?? []).find((b: Row) => b.id === f.branch_id)?.name ?? t('setg.noBranch')}</div></div>
            <div className="r"><ActBtn act="setFarmBranch" ctx={{ farm: f.id, name: f.name, branch: f.branch_id ?? '' }} className="btn small secondary">{t('setg.setBranch')}</ActBtn></div>
          </div>
        ))}
        {!bs?.length && on && <div className="s">{t('setg.noBranches')}</div>}
      </div>
    </Card>
  );
}

async function Pm({ t, locale }: { t: T; locale: string }) {
  const sb = await createClient();
  const dmy = dateFmt(locale);
  const [{ data: due }, { data: all }] = await Promise.all([
    sb.from('pm_due').select('schedule_id,asset,task,last_done_on,due_on,batches_since,every_batches,due').order('due_on', { nullsFirst: false }),
    sb.from('pm_schedule').select('id').eq('active', true),
  ]);
  return (
    <Card title={t('setg.pm')} testid="pm" action={<ActBtn act="addPm" className="btn small">{t('setg.addPm')}</ActBtn>}>
      <div className="s">{t('setg.pmCount', { n: all?.length ?? 0, d: (due ?? []).filter((x: Row) => x.due).length })}</div>
      <div className="list">
        {(due ?? []).map((p: Row) => (
          <div className={`item stripe ${p.due ? 'warn' : ''}`} key={p.schedule_id} data-testid="pm-row" data-task={p.task} data-due={p.due ? 'yes' : 'no'}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{p.asset} · {p.task}</div>
              <div className="s">{[t('setg.lastDone', { date: dmy(p.last_done_on) }), p.due_on ? t('setg.dueOn', { date: dmy(p.due_on) }) : null, p.every_batches ? t('setg.batchesSince', { n: p.batches_since, of: p.every_batches }) : null].filter(Boolean).join(' · ')}</div>
            </div>
            <div className="r row" style={{ gap: 6 }}>
              {p.due && <span className="pill warn">{t('setg.dueNow')}</span>}
              <ActBtn act="pmDone" ctx={{ id: p.schedule_id }} className="btn small secondary">{t('setg.markDone')}</ActBtn>
            </div>
          </div>
        ))}
        {!due?.length && <div className="s">{t('setg.noPm')}</div>}
      </div>
    </Card>
  );
}

async function Limits({ t }: { t: T }) {
  const sb = await createClient();
  const { data } = await sb.from('tenant_rule').select('key,value').in('key', [...LIMITS]);
  return (
    <Card title={t('setg.limits')} testid="limits">
      <div className="list">
        {LIMITS.map((k) => {
          const v = data?.find((r) => r.key === k)?.value ?? LIMIT_DEFAULT[k];
          return (
            <div className="item" key={k} data-limit={k}>
              <div><div className="t">{t(`fin.limit.${k}`)}</div></div>
              <div className="r row" style={{ gap: 6 }}>
                <span className="pill neutral" data-testid="limit-value">{v == null ? t('setg.off') : fmtINR(Number(v))}</span>
                <ActBtn act="setLimit" ctx={{ key: k, value: v == null ? '' : String(v) }} className="btn small secondary">{t('trace.rules.change')}</ActBtn>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

async function Delegation({ t, locale, mine, owner }: { t: T; locale: string; mine: string[]; owner: boolean }) {
  const sb = await createClient();
  const { data } = await sb.from('approval_delegation').select('id,roles,starts_at,ends_at,reason,revoked_at,to:app_user!to_user(full_name),from:app_user!from_user(full_name)').order('created_at', { ascending: false }).limit(50);
  if (!owner && !mine.length) return null;
  const live = (d: Row) => !d.revoked_at && new Date(d.ends_at) > new Date();
  return (
    <Card title={t('setg.delegation')} testid="delegation" action={mine.length ? <ActBtn act="addDelegation" ctx={{ roles: JSON.stringify(mine) }} className="btn small">{t('setg.delegate')}</ActBtn> : undefined}>
      <div className="s">{t('setg.delegationHint')}</div>
      <div className="list">
        {(data ?? []).map((d: Row) => (
          <div className="item" key={d.id} data-testid="delegation-row">
            <div style={{ minWidth: 0 }}>
              <div className="t">{one(d.from)?.full_name} → {one(d.to)?.full_name}</div>
              <div className="s">{(d.roles as string[]).map((r) => (t.has(`roles.${r}`) ? t(`roles.${r}`) : r)).join(', ')} · {t('setg.until', { date: stamp(locale, d.ends_at) })} · {d.reason}</div>
            </div>
            <div className="r row" style={{ gap: 6 }}>
              <span className={`pill ${live(d) ? 'good' : 'neutral'}`}>{d.revoked_at ? t('setg.revoked') : live(d) ? t('setg.active') : t('setg.expired')}</span>
              {live(d) && <ActBtn act="revokeDelegation" ctx={{ id: d.id }} className="btn small secondary">{t('setg.revoke')}</ActBtn>}
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('setg.noDelegations')}</div>}
      </div>
    </Card>
  );
}

async function Keys({ t, locale, on }: { t: T; locale: string; on: boolean }) {
  const sb = await createClient();
  const { data } = await sb.from('api_key').select('id,name,prefix,scopes,last_used_at,revoked_at,created_at').order('created_at', { ascending: false });
  return (
    <Card title={t('setg.apiKeys')} testid="api-keys" action={on ? <SecretCreate kind="key" /> : undefined}>
      {!on ? <div className="s" data-testid="api-off">{t('setg.needPlan')}</div> : <div className="s">{t('setg.keysHint')}</div>}
      <div className="list">
        {(data ?? []).map((k: Row) => (
          <div className="item" key={k.id} data-testid="key-row" data-name={k.name}>
            <div style={{ minWidth: 0 }}>
              <div className="t">{k.name} · <code data-testid="key-prefix">{k.prefix}…</code></div>
              <div className="s">{(k.scopes as string[]).join(', ')} · {k.last_used_at ? t('setg.lastUsed', { date: stamp(locale, k.last_used_at) }) : t('setg.neverUsed')}</div>
            </div>
            <div className="r row" style={{ gap: 6 }}>
              <span className={`pill ${k.revoked_at ? 'crit' : 'good'}`} data-testid="key-state">{k.revoked_at ? t('setg.revoked') : t('setg.active')}</span>
              {!k.revoked_at && <ActBtn act="revokeApiKey" ctx={{ id: k.id }} className="btn small secondary">{t('setg.revoke')}</ActBtn>}
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('setg.noKeys')}</div>}
      </div>
    </Card>
  );
}

async function Hooks({ t, on }: { t: T; on: boolean }) {
  const sb = await createClient();
  const { data } = await sb.from('webhook_subscription').select('id,url,events,active').order('created_at', { ascending: false });
  return (
    <Card title={t('setg.webhooks')} testid="webhooks" action={on ? <SecretCreate kind="hook" /> : undefined}>
      {!on ? <div className="s">{t('setg.needPlan')}</div> : <div className="s">{t('setg.hooksHint')}</div>}
      <div className="list">
        {(data ?? []).map((w: Row) => (
          <div className="item" key={w.id} data-testid="hook-row" data-url={w.url}>
            <div style={{ minWidth: 0 }}><div className="t" style={{ wordBreak: 'break-all' }}>{w.url}</div><div className="s">{(w.events as string[]).join(', ')}</div></div>
            <div className="r row" style={{ gap: 6 }}>
              <span className={`pill ${w.active ? 'good' : 'neutral'}`} data-testid="hook-state">{w.active ? t('setg.active') : t('setg.paused')}</span>
              <ActBtn act="toggleWebhook" ctx={{ id: w.id, active: w.active ? 'no' : 'yes' }} className="btn small secondary">{w.active ? t('setg.pause') : t('setg.resume')}</ActBtn>
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('setg.noHooks')}</div>}
      </div>
    </Card>
  );
}

async function Support({ t, locale }: { t: T; locale: string }) {
  const sb = await createClient();
  const { data } = await sb.from('support_access_grant').select('id,reason,expires_at,revoked_at').order('created_at', { ascending: false }).limit(20);
  const live = (g: Row) => !g.revoked_at && new Date(g.expires_at) > new Date();
  return (
    <Card title={t('setg.support')} testid="support" action={<ActBtn act="grantSupport" className="btn small">{t('setg.grant')}</ActBtn>}>
      <div className="s">{t('setg.supportHint')}</div>
      <div className="list">
        {(data ?? []).map((g: Row) => (
          <div className="item" key={g.id} data-testid="grant-row">
            <div style={{ minWidth: 0 }}><div className="t">{g.reason}</div><div className="s">{t('setg.until', { date: stamp(locale, g.expires_at) })}</div></div>
            <div className="r row" style={{ gap: 6 }}>
              <span className={`pill ${live(g) ? 'warn' : 'neutral'}`} data-testid="grant-state">{g.revoked_at ? t('setg.revoked') : live(g) ? t('setg.open') : t('setg.expired')}</span>
              {live(g) && <ActBtn act="revokeSupport" ctx={{ id: g.id }} className="btn small secondary">{t('setg.revoke')}</ActBtn>}
            </div>
          </div>
        ))}
        {!data?.length && <div className="s">{t('setg.noGrants')}</div>}
      </div>
    </Card>
  );
}
