-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/owners_test.sql
begin;
-- a second VKR owner to try deleting (created as postgres, bypassing RLS)
insert into app_user (id, tenant_id, full_name) values ('00000000-0000-0000-0000-0000000000bb', '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'Co-owner');
insert into user_role_assignment (tenant_id, user_id, role) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', '00000000-0000-0000-0000-0000000000bb', 'tenant_owner');
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$
declare n int;
begin
  delete from app_user where id = '00000000-0000-0000-0000-0000000000bb';
  get diagnostics n = row_count;
  assert n = 0, 'owner deleted a co-owner';
  delete from user_role_assignment where user_id = '00000000-0000-0000-0000-0000000000bb';
  get diagnostics n = row_count;
  assert n = 0, 'owner removed a co-owner''s role';
  raise notice 'owners_test: all assertions passed';
end $$;
rollback;
