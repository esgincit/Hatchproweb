-- 0018: 0017 picked tables by tenant_id; these tenant-owned child tables have none (scoped via their parent).
do $$
declare t text;
begin
  foreach t in array array['po_line', 'batch_state_history'] loop
    execute format('drop policy if exists %1$s_active_ins on %1$I; drop policy if exists %1$s_active_upd on %1$I; drop policy if exists %1$s_active_del on %1$I;', t);
    execute format('create policy %1$s_active_ins on %1$I as restrictive for insert to authenticated with check ((select auth_tenant_active()))', t);
    execute format('create policy %1$s_active_upd on %1$I as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()))', t);
    execute format('create policy %1$s_active_del on %1$I as restrictive for delete to authenticated using ((select auth_tenant_active()))', t);
  end loop;
end $$;
