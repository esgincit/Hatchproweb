-- 0031: audit_log is append-only evidence. 0001 gave it only the tenant-isolation FOR ALL policy, so any tenant
-- member could insert, edit or delete audit rows. Now: service-role writers (provision-tenant, invite-user) are
-- unaffected (RLS bypass); a signed-in user may only add rows as platform staff, as themselves (support views,
-- app/(platform)/admin/tenant/[id]); nobody edits or deletes. Tenant members still READ their own tenant's log
-- (so a farm can see when support looked at its data).
create policy audit_log_insert_platform on audit_log as restrictive for insert to authenticated
  with check (auth_is_platform() and user_id = auth.uid());
create policy audit_log_no_update on audit_log as restrictive for update to authenticated using (false);
create policy audit_log_no_delete on audit_log as restrictive for delete to authenticated using (false);
