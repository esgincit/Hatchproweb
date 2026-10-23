-- 0021: sync_outbox_receipt (0001) was created without row-level security, so anyone holding the public anon key
-- could read or write every tenant's mobile-sync receipts through the API. The sync-apply edge function inserts
-- them with the caller's JWT, so tenant isolation (the same rule every other tenant table has) is all it needs.
alter table sync_outbox_receipt enable row level security;
create policy sync_outbox_receipt_tenant_isolation on sync_outbox_receipt
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());
-- the 0017 suspension policies (sync_outbox_receipt_active_*) already exist and take effect now that RLS is on
