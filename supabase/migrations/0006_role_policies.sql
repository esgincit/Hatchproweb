-- 0006: roles enforced in the database, not only in the app.
-- Anyone signed in can call PostgREST directly with their JWT, so the app's role checks (lib/auth/permissions.ts)
-- are mirrored here as RESTRICTIVE write policies: they AND with the existing tenant-isolation policies.
-- The write functions (0004/0005) are SECURITY INVOKER, so these policies apply inside them too.
-- Reads stay tenant-wide; roadmap Phase 13 can narrow reads (e.g. money tables) if needed.

create or replace function auth_roles() returns text[]
language sql stable as $$
  select coalesce(array(select jsonb_array_elements_text(
    coalesce(current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' -> 'roles', '[]'::jsonb))), '{}')
$$;

-- true for platform staff, or when the caller holds any of the given roles
create or replace function auth_has_role(variadic r text[]) returns boolean
language sql stable as $$ select auth_is_platform() or auth_roles() && r $$;

-- table → roles allowed to INSERT / UPDATE / DELETE (owner + manager always included below)
do $$
declare
  rec record;
  roles text;
begin
  for rec in select * from (values
    ('farm',                 '{}'),
    ('shed',                 '{}'),
    ('batch',                '{}'),
    ('daily_shed_log',       '{shed_supervisor,labour,veterinarian}'),
    ('egg_production',       '{shed_supervisor,labour,veterinarian}'),
    ('mortality_event',      '{shed_supervisor,labour,veterinarian}'),
    ('disease_case',         '{shed_supervisor,labour,veterinarian}'),
    ('media',                '{shed_supervisor,labour,veterinarian,store_keeper}'),
    ('vaccination_schedule', '{shed_supervisor,veterinarian}'),
    ('vet_visit',            '{shed_supervisor,veterinarian}'),
    ('vendor',               '{finance,store_keeper}'),
    ('customer',             '{finance}'),
    ('invoice',              '{finance}'),
    ('payment',              '{finance}'),
    ('bill',                 '{finance,store_keeper}'),
    ('item',                 '{finance,store_keeper}'),
    ('store',                '{store_keeper}'),
    ('purchase_order',       '{finance,store_keeper}'),
    ('stock_movement',       '{finance,store_keeper,shed_supervisor}'),
    ('asset',                '{store_keeper,shed_supervisor,labour}'),
    ('maintenance_ticket',   '{store_keeper,shed_supervisor,labour}'),
    ('worker',               '{finance}'),
    ('worker_advance',       '{finance}'),
    ('attendance',           '{shed_supervisor}'),
    ('tenant_document',      '{}'),
    ('user_role_assignment', '{}')
  ) as t(tbl, extra)
  loop
    roles := format('auth_has_role(variadic array[''tenant_owner'',''farm_manager'']::text[] || %L::text[])', rec.extra);
    execute format('create policy %I on %I as restrictive for insert with check (%s)', rec.tbl || '_roles_ins', rec.tbl, roles);
    execute format('create policy %I on %I as restrictive for update using (%s) with check (%s)', rec.tbl || '_roles_upd', rec.tbl, roles, roles);
    execute format('create policy %I on %I as restrictive for delete using (%s)', rec.tbl || '_roles_del', rec.tbl, roles);
  end loop;
end $$;

-- children without tenant_id follow their parent's writers
create policy batch_state_history_roles on batch_state_history as restrictive for all
  using (auth_has_role('tenant_owner', 'farm_manager')) with check (auth_has_role('tenant_owner', 'farm_manager'));
create policy po_line_roles on po_line as restrictive for all
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper'))
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper'));

-- local market rates: money roles only (platform feeds are written by edge functions with the service role)
create policy market_rate_roles on market_rate as restrictive for insert
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance'));
create policy market_rate_roles_upd on market_rate as restrictive for update
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance'));
create policy market_rate_roles_del on market_rate as restrictive for delete
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance'));

-- tenant row: farms may read it, only platform staff change plan/status/legal details
create policy tenant_write_platform_only on tenant as restrictive for update using (auth_is_platform());
create policy tenant_insert_platform_only on tenant as restrictive for insert with check (auth_is_platform());
create policy tenant_delete_platform_only on tenant as restrictive for delete using (auth_is_platform());

-- app_user: owners manage their people; anyone may update their own row, but only these columns
create policy app_user_roles_ins on app_user as restrictive for insert with check (auth_has_role('tenant_owner'));
create policy app_user_roles_del on app_user as restrictive for delete using (auth_has_role('tenant_owner'));
create policy app_user_roles_upd on app_user as restrictive for update
  using (auth_has_role('tenant_owner') or id = auth.uid()) with check (auth_has_role('tenant_owner') or id = auth.uid());
revoke update on app_user from authenticated;
grant update (full_name, email, phone, language, active_farm_type) on app_user to authenticated;
