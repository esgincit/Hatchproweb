-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/stock_credit_test.sql
-- 0046: multi-line GRN with running totals + over-receipt cap, no negative stock, credit limit warn/block.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; f uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; v uuid; i1 uuid; i2 uuid; po uuid; c uuid;
begin
  insert into vendor (tenant_id, name, category) values (ks, 'Test Feeds', 'feed') returning id into v;
  insert into item (tenant_id, name, category, unit) values (ks, 'Test feed A', 'feed', 'kg') returning id into i1;
  insert into item (tenant_id, name, category, unit) values (ks, 'Test feed B', 'feed', 'kg') returning id into i2;
  insert into purchase_order (tenant_id, farm_id, vendor_id, po_no, po_date, status) values (ks, f, v, 'PO-T1', '2026-11-01', 'approved') returning id into po;
  insert into po_line (po_id, item_id, qty, rate) values (po, i1, 100, 30), (po, i2, 50, 40);
  insert into customer (tenant_id, name, credit_limit) values (ks, 'Limit Test Traders', 1000) returning id into c;
  perform set_config('t.po', po::text, true), set_config('t.i1', i1::text, true), set_config('t.i2', i2::text, true), set_config('t.c', c::text, true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ declare po uuid := current_setting('t.po')::uuid; i1 uuid := current_setting('t.i1')::uuid; i2 uuid := current_setting('t.i2')::uuid; st uuid;
begin
  begin perform receive_grn(po, 10, 300, '2026-11-02'); assert false, 'multi-line PO without item';
  exception when raise_exception then null; end;
  perform receive_grn(po, 50, 1500, '2026-11-02', null, null, i1);
  assert (select status from purchase_order where id = po) = 'partial', 'partial after half';
  perform receive_grn(po, 60, 1800, '2026-11-03', null, null, i1);                     -- 110 of 100: within 10 %
  begin perform receive_grn(po, 1, 30, '2026-11-03', null, null, i1); assert false, 'over-received';
  exception when raise_exception then null; end;
  assert (select status from purchase_order where id = po) = 'partial', 'item B still open';
  perform receive_grn(po, 50, 2000, '2026-11-04', null, null, i2);
  assert (select status from purchase_order where id = po) = 'closed', 'closed when every line is in';
  select store_id into st from stock_movement where ref_id = po limit 1;
  begin insert into stock_movement (store_id, item_id, move_type, qty, moved_on) values (st, i1, 'issue', -111, '2026-11-05'); assert false, 'issued more than stock';
  exception when raise_exception then null; end;
  insert into stock_movement (store_id, item_id, move_type, qty, moved_on) values (st, i1, 'issue', -110, '2026-11-05');
end $$;

-- credit: warn by default (owner), block when the rule says so (finance), owner may still raise it
do $$ begin
  perform create_sale(current_setting('t.c')::uuid, 'egg', 300, 'egg', 5, '2026-11-05');   -- 1,500 > 1,000
  assert (select count(*) from notification where title = 'Over credit limit · Limit Test Traders') = 1, 'credit warning';
  insert into tenant_rule (key, value) values ('credit_limit_policy', '"block"');
end $$;
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  begin perform create_sale(current_setting('t.c')::uuid, 'egg', 10, 'egg', 5, '2026-11-05'); assert false, 'finance sold over limit';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin
  assert create_sale(current_setting('t.c')::uuid, 'egg', 10, 'egg', 5, '2026-11-05') is not null, 'owner override';
end $$;
rollback;
\echo stock_credit_test OK
