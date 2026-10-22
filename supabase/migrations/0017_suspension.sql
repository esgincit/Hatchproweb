-- 0017: a suspended tenant is read-only at the database, whatever path writes (app, raw API, RPC).
-- security definer so the lookup ignores tenant RLS; platform staff / no-tenant callers are unaffected.
create or replace function auth_tenant_active() returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is_platform() or auth_tenant_id() is null
      or not exists (select 1 from tenant where id = auth_tenant_id() and status = 'suspended')
$$;
revoke execute on function auth_tenant_active() from public, anon;
grant execute on function auth_tenant_active() to authenticated;

do $$
declare t text;
begin
  for t in
    select c.table_name from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and x.table_type = 'BASE TABLE'
      and c.table_name not in ('tenant', 'onboarding_application')
  loop
    execute format('drop policy if exists %1$s_active_ins on %1$I; drop policy if exists %1$s_active_upd on %1$I; drop policy if exists %1$s_active_del on %1$I;', t);
    execute format('create policy %1$s_active_ins on %1$I as restrictive for insert to authenticated with check ((select auth_tenant_active()))', t);
    execute format('create policy %1$s_active_upd on %1$I as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()))', t);
    execute format('create policy %1$s_active_del on %1$I as restrictive for delete to authenticated using ((select auth_tenant_active()))', t);
  end loop;
end $$;
