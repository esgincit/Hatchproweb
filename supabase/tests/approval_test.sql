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
  r := record_payment('bill', (select id from bill where status <> 'paid' and id <> b and total <= 50000 and total - paid > 1000 limit 1), 1000, 'cash', current_date);
  assert r = 'paid', 'small payment goes through';
  -- splitting a big bill into small payments still needs approval; a second request waits for the first
  begin perform record_payment('bill', b, 1000, 'cash', current_date); assert false, 'second request while one is pending';
  exception when raise_exception then null; end;
  -- going round record_payment: direct payment row / bill.paid edit / pre-approved request are refused
  begin insert into payment (direction, party_type, party_id, ref_type, ref_id, amount, mode, paid_on)
    select 'out', 'vendor', vendor_id, 'bill', id, 1000, 'cash', current_date from bill where id = b;
    assert false, 'direct payment row on big bill'; exception when raise_exception then null; end;
  begin update bill set paid = total where id = b; assert false, 'direct bill.paid edit'; exception when raise_exception then null; end;
  begin update bill set vendor_id = (select id from vendor where id <> (select vendor_id from bill where id = b) limit 1) where id = b;
    assert false, 'redirecting a big bill'; exception when raise_exception then null; end;
  begin insert into payment (direction, party_type, party_id, ref_type, ref_id, amount, mode, paid_on)
    values ('out', 'vendor', (select vendor_id from bill where id = b), 'other', gen_random_uuid(), 90000, 'cash', current_date);
    assert false, 'untied outgoing payment'; exception when raise_exception then null; end;
  begin update payment set amount = amount + 1 where id = (select id from payment limit 1); assert false, 'editing a payment';
  exception when raise_exception then null; end;
  begin insert into bill (farm_id, vendor_id, bill_no, bill_date, due_date, category, total, paid, status)
    select farm_id, vendor_id, 'X-PAID', current_date, current_date, 'feed', 90000, 90000, 'paid' from bill where id = b;
    assert false, 'born-paid big bill'; exception when raise_exception then null; end;
  begin update bill set status = 'paid' where id = b; assert false, 'marking a big bill paid'; exception when raise_exception then null; end;
  begin delete from bill where id = b; assert false, 'deleting a big bill'; exception when raise_exception then null; end;
  begin update bill set total = 40000 where id = b; assert false, 'lowering a big bill'; exception when raise_exception then null; end;
  begin insert into payment_approval (bill_id, amount, mode, paid_on, status, requested_by) values (b, 10, 'cash', current_date, 'approved', auth.uid());
    assert false, 'pre-approved request'; exception when insufficient_privilege then null; end;
  begin insert into payment_approval (bill_id, amount, mode, paid_on, requested_by) values (b, 10, 'cash', current_date, gen_random_uuid());
    assert false, 'spoofed requester'; exception when insufficient_privilege then null; end;
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
