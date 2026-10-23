-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/sync_receipt_test.sql
-- 0021: sync_outbox_receipt is tenant-isolated (it had no RLS before) — own rows only; anon sees nothing.
begin;
set local role authenticated;
-- VKR owner writes a receipt for VKR, and can't write one for KS
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  insert into sync_outbox_receipt (client_op_id, tenant_id, device_id) values ('00000000-0000-4000-8000-0000000000a1', '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'test-phone');
  assert exists (select 1 from sync_outbox_receipt where client_op_id = '00000000-0000-4000-8000-0000000000a1'), 'own receipt visible';
  begin
    insert into sync_outbox_receipt (client_op_id, tenant_id, device_id) values ('00000000-0000-4000-8000-0000000000a2', 'b146bf5d-6213-556e-8e71-8d4c156ad36d', 'test-phone');
    assert false, 'wrote a receipt for another tenant';
  exception when insufficient_privilege then null; end;
end $$;
-- KS owner can't see VKR's receipt
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin
  assert not exists (select 1 from sync_outbox_receipt), 'other tenant reads receipts';
end $$;
-- anonymous (public anon key): nothing
reset role;
set local role anon;
set local request.jwt.claims = '{}';
do $$ begin
  assert not exists (select 1 from sync_outbox_receipt), 'anon reads receipts';
  raise notice 'sync_receipt_test: all assertions passed';
end $$;
rollback;
