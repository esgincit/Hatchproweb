-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/worker_bank_test.sql
-- 0022 worker_bank: only owner/manager/finance read or write account numbers; tenant-isolated; formats checked.
begin;
select set_config('t.w', (select w.id::text from worker w join tenant t on t.id = w.tenant_id where t.name = 'VKR Poultry Farms' limit 1), true);
select set_config('t.ks_w', (select w.id::text from worker w join tenant t on t.id = w.tenant_id where t.name = 'KS Farms' limit 1), true);
set local role authenticated;

-- VKR finance: saves and reads; bad formats are refused; can't attach details to another tenant's worker
set local request.jwt.claims = '{"sub":"8817e673-99a9-53c8-9f77-28599a17f0f5","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["finance"]}}';
do $$
declare w uuid := current_setting('t.w')::uuid; ks uuid := current_setting('t.ks_w')::uuid;
begin
  insert into worker_bank (worker_id, account_no, ifsc) values (w, '123456789012', 'SBIN0001234');
  assert (select ifsc from worker_bank where worker_id = w) = 'SBIN0001234', 'finance reads it back';
  begin update worker_bank set account_no = '12345' where worker_id = w; assert false, 'short account accepted';
  exception when check_violation then null; end;
  begin update worker_bank set ifsc = 'sbin1234' where worker_id = w; assert false, 'bad IFSC accepted';
  exception when check_violation then null; end;
  begin insert into worker_bank (worker_id, account_no, ifsc) values (ks, '123456789012', 'HDFC0000001'); assert false, 'other tenant worker';
  exception when insufficient_privilege then null; end;
end $$;

-- VKR supervisor: reads workers, but never their bank details, and can't change them
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["shed_supervisor"]}}';
do $$
begin
  assert (select count(*) from worker) > 0, 'supervisor still sees workers';
  assert (select count(*) from worker_bank) = 0, 'supervisor sees bank details';
  update worker_bank set account_no = '999999999';
end $$;

-- KS owner: other tenant, sees nothing
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin assert (select count(*) from worker_bank) = 0, 'cross-tenant read'; end $$;

reset role;
do $$ begin assert (select account_no from worker_bank where worker_id = current_setting('t.w')::uuid) = '123456789012', 'supervisor update changed nothing'; end $$;
rollback;
\echo worker_bank_test OK
