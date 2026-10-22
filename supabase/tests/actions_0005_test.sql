-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/actions_0005_test.sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$
declare b uuid; inv text; a uuid; tk uuid; v uuid; po text; poid uuid; it uuid; var numeric; stock_before numeric; bills int; notes int;
begin
  -- stage change + close with sale
  select id into b from batch where code = 'VKR-B-2026-14';
  perform set_batch_state(b, 'finishing', current_date);
  assert (select state from batch where id = b) = 'finishing', 'state changed';
  assert exists (select 1 from batch_state_history where batch_id = b and state = 'finishing'), 'history row';
  inv := close_batch(b, current_date, (select id from customer order by name limit 1), 15000, 112);
  assert (select state from batch where id = b) = 'closed' and (select closed_on from batch where id = b) = current_date, 'closed';
  assert (select total from invoice where invoice_no = inv) = 1680000 and (select product from invoice where invoice_no = inv) = 'bird', 'lifting invoice 15000 kg × ₹112';
  begin perform close_batch(b, current_date); assert false, 'double close must fail'; exception when raise_exception then null; end;
  begin perform set_batch_state(b, 'growing', current_date); assert false, 'closed batch stage must fail'; exception when raise_exception then null; end;

  -- equipment: high issue → ticket + critical notification; close with cost → equipment bill
  select id into a from asset order by name limit 1;
  select count(*) into notes from notification;
  tk := report_issue(a, 'Fan motor burnt', 'high', current_date);
  assert (select status from asset where id = a) = 'fault', 'asset flagged';
  assert (select count(*) from notification) = notes + 1, 'critical notification';
  select id into v from vendor where category = 'equipment' limit 1;
  select count(*) into bills from bill;
  perform close_ticket(tk, current_date, 4500, v);
  assert (select status from maintenance_ticket where id = tk) = 'closed', 'ticket closed';
  assert (select count(*) from bill) = bills + 1 and exists (select 1 from bill where total = 4500 and category = 'equipment'), 'equipment bill';

  a := add_asset((select id from farm order by created_at limit 1), 'Test genset', 'generator', 250000, current_date + 90, current_date, v);
  assert exists (select 1 from asset where id = a and next_service_on = current_date + 90), 'asset added';

  -- PO → GRN with a bill that differs from the PO → variance reported, stock up, PO closed
  select id into it from item where name ilike '%layer%' or category = 'feed' order by name limit 1;
  select coalesce(sum(qty), 0) into stock_before from stock_movement where item_id = it;
  po := raise_po((select id from vendor where category = 'feed' limit 1), it, 100, 1500, current_date + 3, current_date);
  select id into poid from purchase_order where po_no = po;
  assert (select count(*) from po_line where po_id = poid) = 1, 'po line';
  var := receive_grn(poid, 100, 157500 * 1.04, current_date, 'LOT9');
  assert var > 3, 'bill 4% over PO flagged, got ' || var;
  assert (select sum(qty) from stock_movement where item_id = it) = stock_before + 100, 'stock up by 100';
  assert (select status from purchase_order where id = poid) = 'closed', 'po closed';
  assert exists (select 1 from bill where po_id = poid), 'bill linked to PO';
  begin perform receive_grn(poid, 1, 1, current_date); assert false, 'second GRN must fail'; exception when raise_exception then null; end;

  -- documents & advances default the tenant
  insert into tenant_document (name, expires_on) values ('Fire NOC', current_date + 20);
  insert into worker_advance (worker_id, amount, given_on) values ((select id from worker limit 1), 2000, current_date);
  assert (select count(*) from tenant_document) = 1 and (select count(*) from worker_advance) = 1, 'tenant-scoped inserts';
  raise notice 'actions_0005_test: all assertions passed';
end $$;
rollback;
