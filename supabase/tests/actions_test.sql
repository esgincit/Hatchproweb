-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/actions_test.sql
-- Exercises 0004 functions as the VKR owner under RLS, asserts the side effects, rolls everything back.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';

do $$
declare shed uuid; b uuid; n int; v uuid; inv text; i record; bl record; bills_before int; opening int;
begin
  -- free shed: VKR Shed B (its batch is closed)
  select s.id into shed from shed s where s.name = 'Shed B';
  select id into v from vendor where category = 'doc_hatchery' limit 1;
  select count(*) into bills_before from bill;

  b := place_batch(shed, 'TEST-B-1', null, current_date - 3, 10000, 40, v);
  select count(*) into n from vaccination_schedule where batch_id = b;
  assert n > 0, 'vaccination schedule generated';
  assert (select count(*) from bill) = bills_before + 1, 'DOC bill booked';
  assert (select total from bill where batch_id = b) = 400000, 'DOC bill = 10000 × ₹40';
  assert (select tenant_id from batch where id = b) = '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'tenant_id defaulted from JWT';

  begin perform place_batch(shed, 'TEST-B-2', null, current_date, 100, 0); assert false, 'second active batch must fail';
  exception when raise_exception then null; end;

  perform record_mortality(b, current_date - 3, 12, 'HEAT', 'hot afternoon');
  perform record_mortality(b, current_date - 3, 3);
  assert (select mortality from daily_shed_log where batch_id = b and log_date = current_date - 3) = 15, 'mortality accumulates in the day log';
  assert (select birds_opening from daily_shed_log where batch_id = b and log_date = current_date - 3) = 10000, 'first day opens with chicks placed';

  perform save_daily_log(b, current_date - 2, '{"mortality":5,"culls":1,"feed_kg":350,"tmax":33.5,"avg_w":180}');
  select birds_opening into opening from daily_shed_log where batch_id = b and log_date = current_date - 2;
  assert opening = 10000 - 15, 'next day opening = previous opening − deaths − culls';
  perform save_daily_log(b, current_date - 2, '{"mortality":6,"culls":1,"feed_kg":360}');
  assert (select mortality from daily_shed_log where batch_id = b and log_date = current_date - 2) = 6, 'same-day save updates, not duplicates';

  -- layer eggs replace per save
  select l.id into b from batch l where l.code = 'VKR-L-2026-02';
  perform save_daily_log(b, current_date, '{"mortality":2,"eggs":{"large":9000,"cracked":200,"dirty":0}}');
  assert (select sum(count) from egg_production e join daily_shed_log d on d.id = e.daily_log_id where d.batch_id = b and d.log_date = current_date) = 9200, 'eggs saved, zero grades skipped';

  -- sale on credit → due = date + credit days; GST 0 for eggs, 5% manure
  inv := create_sale((select id from customer order by name limit 1), 'egg', 3000, 'egg', 5.5, current_date);
  select * into i from invoice where invoice_no = inv;
  assert i.total = 16500 and i.gst_pct = 0, 'egg sale total, GST exempt';
  assert i.due_date = current_date + (select credit_days from customer where id = i.customer_id), 'due = date + credit days';
  inv := create_sale((select id from customer order by name limit 1), 'manure', 10, 'tonne', 1000, current_date);
  assert (select total from invoice where invoice_no = inv) = 10500, 'manure 5% GST';

  -- payments: partial then full; never more than outstanding
  perform record_payment('invoice', i.id, 6500, 'upi', current_date);
  assert (select status from invoice where id = i.id) = 'partial', 'partial';
  begin perform record_payment('invoice', i.id, 99999, 'upi', current_date); assert false, 'overpay must fail';
  exception when raise_exception then null; end;
  perform record_payment('invoice', i.id, 10000, 'cash', current_date);
  assert (select status from invoice where id = i.id) = 'paid', 'paid';
  assert (select count(*) from payment where ref_id = i.id and direction = 'in') = 2, 'two receipts';

  inv := create_bill((select id from vendor order by name limit 1), 'feed', 12345, current_date);
  select * into bl from bill where bill_no = inv;
  perform record_payment('bill', bl.id, 12345, 'neft', current_date, 'UTR1');
  assert (select status from bill where id = bl.id) = 'paid', 'bill paid';

  -- RLS: KS rows are invisible, so their batch cannot be written
  begin perform record_mortality((select id from batch where code like 'KS-%' limit 1), current_date, 1);
    raise exception 'unexpected: KS batch visible';
  exception when raise_exception then
    if sqlerrm <> 'batch not found' then raise; end if;
  end;
  raise notice 'actions_test: all assertions passed';
end $$;
rollback;
