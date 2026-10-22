-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/suspension_test.sql
begin;
update tenant set status = 'suspended' where name = 'VKR Poultry Farms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from vendor) > 0, 'suspended tenant still reads its data';
  begin insert into vendor (name, category) values ('Suspended Co', 'feed'); assert false, 'insert while suspended';
  exception when insufficient_privilege then null; end;
  update vendor set name = name || '!';
  assert not exists (select 1 from vendor where name like '%!'), 'update while suspended';
  begin perform record_payment('bill', (select id from bill where total > paid limit 1), 1, 'cash', current_date); assert false, 'rpc while suspended';
  exception when insufficient_privilege or raise_exception then null; end; -- FOR UPDATE can't see the row → 'document not found'
  assert not exists (select 1 from payment where paid_on = current_date and amount = 1), 'no payment written';
end $$;
-- other tenant unaffected
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000aa","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin
  insert into vendor (name, category) values ('Active Co', 'feed');
  raise notice 'suspension_test: all assertions passed';
end $$;
rollback;
