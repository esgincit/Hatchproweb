-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/audit_test.sql
-- 0031: tenant members can read but not write/alter audit rows; platform staff add rows only as themselves.
begin;
insert into audit_log (tenant_id, user_id, action, entity_type) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', null, 'seed.check', 'tenant');
set local role authenticated;
-- VKR owner
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from audit_log where action = 'seed.check') = 1, 'owner reads own audit';
  begin insert into audit_log (action, entity_type, user_id) values ('fake', 'x', 'd847552a-9978-5cbf-aedf-2f20c382f6c6'); assert false, 'tenant wrote audit';
  exception when insufficient_privilege then null; end;
  delete from audit_log where action = 'seed.check';
  update audit_log set action = 'edited' where action = 'seed.check';
end $$;
-- platform support: can log as itself, not as someone else
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","app_metadata":{"roles":["platform_support"],"platform":true}}';
do $$ begin
  begin insert into audit_log (tenant_id, user_id, action, entity_type) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'd847552a-9978-5cbf-aedf-2f20c382f6c6', 'support_view', 'tenant'); assert false, 'logged as someone else';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin assert (select count(*) from audit_log where action = 'seed.check') = 1, 'audit row deleted/edited'; end $$;
rollback;
\echo audit_test OK
