// Port of demo/index.html platformScreen (:478-490). Real numbers only — the demo padded tenants/MRR/birds for show.
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/shell/SignOutButton';
import { ActBtn } from '@/components/ui/ActBtn';
import { Toaster } from '@/components/ui/Toast';
import { Header } from '@/components/ui/bits';
import { dmy, fmtL, fmtN } from '@/lib/format';

const PRICE: Record<string, number> = { starter: 999, growth: 2999, pro: 7999, enterprise: 25000 };

export default async function Admin() {
  const sb = await createClient();
  const [{ data: tenants }, { data: kpi }, { data: farms }, { data: users }, { data: rates }] = await Promise.all([
    sb.from('tenant').select('id,name,plan,status,state').order('name'),
    sb.from('v_batch_kpi').select('tenant_id,birds_alive,state'),
    sb.from('farm').select('tenant_id'),
    sb.from('app_user').select('tenant_id'),
    sb.from('market_rate').select('product,rate_date').is('tenant_id', null).order('rate_date', { ascending: false }).limit(50),
  ]);
  const count = (xs: { tenant_id: string | null }[] | null, id: string) => (xs ?? []).filter((x) => x.tenant_id === id).length;
  const rows = (tenants ?? []).map((t) => ({
    t, farms: count(farms, t.id), users: count(users, t.id),
    birds: (kpi ?? []).filter((k) => k.tenant_id === t.id && k.state !== 'closed').reduce((a, k) => a + Number(k.birds_alive), 0),
  }));
  const mrr = rows.filter((r) => r.t.status === 'active').reduce((a, r) => a + (PRICE[r.t.plan] ?? 0), 0);
  const lastRate = (p: string) => rates?.find((r) => r.product === p)?.rate_date;
  const feeds: [string, string | undefined][] = [['NECC egg rates', lastRate('egg')], ['Broiler farm-gate rates', lastRate('broiler_farmgate')], ['Maize & soya', lastRate('maize')]];

  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <div className="tenant">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>HP</span>
            <span><div className="name">HatchPro Platform</div><div className="sub">Platform admin · all tenants</div></span>
          </div>
        </header>
        <main className="screen"><div className="wrap">
          <Header title="Platform console" action={<ActBtn act="tenantOpen" className="btn small">+ Add tenant</ActBtn>} />
          <div className="grid2">
            <div className="tile"><div className="lbl">Tenants</div><div className="val">{rows.length}</div><div className="delta flat">{rows.filter((r) => r.t.status === 'trial').length} in trial</div></div>
            <div className="tile"><div className="lbl">MRR</div><div className="val">{fmtL(mrr)}</div><div className="delta flat">active plans</div></div>
            <div className="tile"><div className="lbl">Birds under mgmt</div><div className="val">{fmtN(rows.reduce((a, r) => a + r.birds, 0))}</div><div className="delta flat">across {rows.reduce((a, r) => a + r.farms, 0)} farms</div></div>
            <div className="tile"><div className="lbl">Users</div><div className="val">{rows.reduce((a, r) => a + r.users, 0)}</div><div className="delta flat">farm-side logins</div></div>
          </div>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Tenants</div>
            <div className="list">
              {rows.map(({ t, farms: f, users: u, birds }) => (
                <div className="item" key={t.id}>
                  <div><div className="t">{t.name}</div><div className="s">{t.state} · {f} farms · {fmtN(birds)} birds · {u} users</div></div>
                  <div className="r">
                    <span className={`pill ${t.status === 'trial' ? 'warn' : t.status === 'suspended' ? 'crit' : 'info'}`}>{t.status === 'active' ? t.plan : t.status}</span>
                    <div className="s">₹{fmtN(PRICE[t.plan] ?? 0)}/mo</div>
                    <ActBtn act="tenantManage" className="btn small secondary" style={{ marginTop: 4 }}>Manage</ActBtn>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Data feeds</div>
            <div className="list">
              {feeds.map(([a, d]) => (
                <div className="item" key={a}><div><div className="t">{a}</div><div className="s">{d ? 'last update ' + dmy(d) : 'no data yet'}</div></div>
                  <div className="r"><span className={`pill ${d ? 'good' : 'warn'}`}>{d ? 'OK' : 'Attention'}</span></div></div>
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
