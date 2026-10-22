-- 0008: owners can remove their staff, but not themselves or another owner — that is platform staff's call.
drop policy app_user_roles_del on app_user;
create policy app_user_roles_del on app_user as restrictive for delete
  using (
    auth_is_platform()
    or (auth_has_role('tenant_owner') and id <> auth.uid()
        and not exists (select 1 from user_role_assignment r where r.user_id = app_user.id and r.role = 'tenant_owner'))
  );

-- Same for role rows: owners may change or remove staff roles only; owner / platform roles are platform staff's.
-- Writes only — reads must stay visible, the app_user delete guard above depends on seeing owner rows.
drop policy user_role_assignment_owner_only on user_role_assignment;
create policy user_role_assignment_ins on user_role_assignment as restrictive for insert
  with check (auth_is_platform()
    or (auth_has_role('tenant_owner') and role not in ('tenant_owner', 'platform_admin', 'platform_support', 'platform_finance', 'platform_marketing', 'platform_sales', 'platform_ops')));
create policy user_role_assignment_upd on user_role_assignment as restrictive for update
  using (auth_is_platform()
    or (auth_has_role('tenant_owner') and role not in ('tenant_owner', 'platform_admin', 'platform_support', 'platform_finance', 'platform_marketing', 'platform_sales', 'platform_ops')))
  with check (auth_is_platform()
    or (auth_has_role('tenant_owner') and role not in ('tenant_owner', 'platform_admin', 'platform_support', 'platform_finance', 'platform_marketing', 'platform_sales', 'platform_ops')));
create policy user_role_assignment_del on user_role_assignment as restrictive for delete
  using (auth_is_platform()
    or (auth_has_role('tenant_owner') and role not in ('tenant_owner', 'platform_admin', 'platform_support', 'platform_finance', 'platform_marketing', 'platform_sales', 'platform_ops')));
