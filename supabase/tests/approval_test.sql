-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/approval_test.sql
begin;
set local role authenticated;
-- finance user pays a big bill → becomes a request, nothing paid yet
set local request.jwt.claims = '{"sub":"8817e673-99a9-53c8-9f77-28599a17f0f5","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["finance"]}}';
create temp table t_bill on commit drop as select id, total - paid as out from bill where status <> 'paid' and total - paid > 60000 limit 1;
do $$
declare b uuid; o numeric; r text;
begin
  select id, out into b, o from t_bill;
  r := record_payment('bill', b, o, 'neft', current_date);
  assert r = 'pending', 'big payment by finance needs approval';
  assert (select paid from bill where id = b) + o > (select total from bill where id = b) - 1, 'bill untouched';
  assert not exists (select 1 from payment where ref_id = b and paid_on = current_date and amount = o), 'no payment yet';
  begin perform decide_payment((select id from payment_approval where bill_id = b), true); assert false, 'finance approved own request';
  exception when raise_exception then null; end;
  r := record_payment('bill', (select id from bill where status <> 'paid' and id <> b and total - paid > 1000 limit 1), 1000, 'cash', current_date);
  assert r = 'paid', 'small payment goes through';
end $$;
-- owner approves → paid
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$
declare b uuid; o numeric;
begin
  select id, out into b, o from t_bill;
  assert decide_payment((select id from payment_approval where bill_id = b), true) = 'approved', 'owner approves';
  assert exists (select 1 from payment where ref_id = b and amount = o), 'payment recorded on approval';
  assert (select status from payment_approval where bill_id = b) = 'approved', 'request closed';
  raise notice 'approval_test: all assertions passed';
end $$;
rollback;
