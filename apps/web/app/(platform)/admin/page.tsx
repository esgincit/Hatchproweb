import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/shell/SignOutButton';

// Header copy from demo/index.html:224. Phase 11 builds the full console.
export default async function Admin() {
  const sb = await createClient();
  const { data: tenants } = await sb.from('tenant').select('id, name, plan, status').order('name');
  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <div className="tenant">
            <span className="avatar" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>PO</span>
            <span><div className="name">PoultryOS Platform</div><div className="sub">Platform admin · all tenants</div></span>
          </div>
        </header>
        <main className="screen"><div className="wrap">
          <div className="h2">Tenants</div>
          <div className="card"><div className="list">
            {(tenants ?? []).map((t) => (
              <div className="item" key={t.id}>
                <div><div className="t">{t.name}</div><div className="s">{t.plan} · {t.status}</div></div>
              </div>
            ))}
          </div></div>
          <SignOutButton to="/platform/login" />
        </div></main>
      </div>
    </div>
  );
}
