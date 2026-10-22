-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/roles_test.sql
-- Direct API calls with a supervisor's JWT: shed work allowed, money / batch placement / admin changes refused.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["shed_supervisor"]}}';
do $$
declare b uuid; inv uuid; n int;
begin
  select id into b from batch where code = 'VKR-B-2026-14';
  perform record_mortality(b, current_date, 2);                       -- allowed
  assert exists (select 1 from mortality_event where batch_id = b and event_date = current_date), 'supervisor records mortality';

  begin perform place_batch((select id from shed where name = 'Shed B'), 'X-SUP', null, current_date, 10, 1);
    assert false, 'supervisor placed a batch'; exception when insufficient_privilege then null; end;
  select id into inv from invoice where status <> 'paid' limit 1;
  -- refused either by the row lock (row not writable → not found) or by the payment insert policy
  begin perform record_payment('invoice', inv, 1, 'cash', current_date); exception when others then null; end;
  assert not exists (select 1 from payment where ref_id = inv and paid_on = current_date and amount = 1), 'supervisor recorded a payment';
  begin insert into worker_advance (worker_id, amount, given_on) values ((select id from worker limit 1), 500, current_date);
    assert false, 'supervisor gave an advance'; exception when insufficient_privilege then null; end;
  begin insert into user_role_assignment (user_id, role) values (auth.uid(), 'tenant_owner');
    assert false, 'supervisor promoted themselves'; exception when insufficient_privilege then null; end;
  update tenant set plan = 'enterprise';                                -- restrictive policy → 0 rows, no error
  assert (select plan from tenant) <> 'enterprise', 'tenant plan unchanged';
  begin update app_user set is_platform_staff = true where id = auth.uid();
    assert false, 'is_platform_staff writable'; exception when insufficient_privilege then null; end;
  update app_user set language = 'kn' where id = auth.uid();          -- own preferences: allowed
  assert (select language from app_user where id = auth.uid()) = 'kn', 'own language saved';
  update app_user set language = 'kn' where id <> auth.uid();          -- other people's rows: silently 0
  get diagnostics n = row_count;
  assert n = 0, 'supervisor edited other users';
  raise notice 'roles_test: supervisor checks passed';
end $$;

-- manager and owner limits on people
set local request.jwt.claims = '{"sub":"c3227e8d-aa55-5373-a235-cbd85bb4726a","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["farm_manager"]}}';
do $$
begin
  begin insert into user_role_assignment (tenant_id, user_id, role) values (auth_tenant_id(), auth.uid(), 'tenant_owner');
    assert false, 'manager made themselves owner'; exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$
declare n int;
begin
  begin insert into app_user (id, tenant_id, full_name, is_platform_staff) values (gen_random_uuid(), auth_tenant_id(), 'X', true);
    assert false, 'owner created a platform-staff profile'; exception when insufficient_privilege then null; end;
  insert into app_user (id, tenant_id, full_name) values ('00000000-0000-0000-0000-0000000000aa', auth_tenant_id(), 'New labourer');
  insert into user_role_assignment (tenant_id, user_id, role) values (auth_tenant_id(), '00000000-0000-0000-0000-0000000000aa', 'labour');
  begin insert into user_role_assignment (tenant_id, user_id, role) values (auth_tenant_id(), '00000000-0000-0000-0000-0000000000aa', 'tenant_owner');
    assert false, 'owner granted owner'; exception when insufficient_privilege then null; end;
  delete from app_user where id = auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'owner deleted own profile';
  raise notice 'roles_test: all assertions passed';
end $$;
rollback;
