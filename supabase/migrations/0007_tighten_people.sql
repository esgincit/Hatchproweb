-- 0007: close two escalation paths left by 0006 (security review).

-- 1) Creating a profile must not set is_platform_staff (nothing trusts it for access — the JWT does —
--    but scripts/create_demo_users.ts reads it, so it must never be user-writable). Owners also may not
--    delete their own row (would orphan the tenant).
revoke insert on app_user from authenticated;
grant insert (id, tenant_id, full_name, email, phone, language, active_farm_type) on app_user to authenticated;
drop policy app_user_roles_del on app_user;
create policy app_user_roles_del on app_user as restrictive for delete
  using (auth_has_role('tenant_owner') and id <> auth.uid());

-- 2) Role assignments: owners only (not managers), and owner / platform roles only by platform staff.
drop policy user_role_assignment_roles_ins on user_role_assignment;
drop policy user_role_assignment_roles_upd on user_role_assignment;
drop policy user_role_assignment_roles_del on user_role_assignment;
create policy user_role_assignment_owner_only on user_role_assignment as restrictive for all
  using (auth_has_role('tenant_owner'))
  with check (
    auth_is_platform()
    or (auth_has_role('tenant_owner') and role not in ('tenant_owner', 'platform_admin', 'platform_support', 'platform_finance', 'platform_marketing', 'platform_sales', 'platform_ops'))
  );
