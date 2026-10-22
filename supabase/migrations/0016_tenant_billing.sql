-- 0016: only the platform admin and finance team change tenant rows (plan / status). Mirrors TEAM.billing in permissions.ts.
-- auth_roles() not auth_has_role(): the latter lets every platform team through. provision-tenant runs as service_role (no RLS).
drop policy if exists tenant_billing_ins on tenant;
drop policy if exists tenant_billing_upd on tenant;
drop policy if exists tenant_billing_del on tenant;
create policy tenant_billing_ins on tenant as restrictive for insert with check (auth_roles() && '{platform_admin,platform_finance}');
create policy tenant_billing_upd on tenant as restrictive for update
  using (auth_roles() && '{platform_admin,platform_finance}') with check (auth_roles() && '{platform_admin,platform_finance}');
create policy tenant_billing_del on tenant as restrictive for delete using ('platform_admin' = any(auth_roles()));

-- application review: admin, sales and ops only (TEAM.applications)
drop policy if exists apply_review_team on onboarding_application;
create policy apply_review_team on onboarding_application as restrictive for update to authenticated
  using (auth_roles() && '{platform_admin,platform_sales,platform_ops}') with check (auth_roles() && '{platform_admin,platform_sales,platform_ops}');
