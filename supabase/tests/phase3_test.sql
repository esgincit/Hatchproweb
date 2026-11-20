-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/phase3_test.sql
-- 0051: PO approval threshold + delegation, stock count adjustments, store transfer in transit, API keys, module privacy.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
delete from subscription where tenant_id in ('b146bf5d-6213-556e-8e71-8d4c156ad36d', '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c'); -- plan defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; v uuid; i uuid; s1 uuid; s2 uuid;
begin
  insert into vendor (tenant_id, name, category) values (ks, 'P3 Vendor', 'feed') returning id into v;
  insert into item (tenant_id, name, category, unit) values (ks, 'P3 feed', 'feed', 'kg') returning id into i;
  insert into store (tenant_id, farm_id, name) values (ks, hat, 'P3 Store A') returning id into s1;
  insert into store (tenant_id, farm_id, name) values (ks, hat, 'P3 Store B') returning id into s2;
  insert into tenant_rule (tenant_id, key, value) values (ks, 'po_approval_above', '1000') on conflict (tenant_id, key) do update set value = excluded.value;
  insert into user_role_assignment (tenant_id, user_id, role) values (ks, 'fffcd169-07c0-5f0d-aa8b-3c382ca8f861', 'procurement_officer');  -- delegator must hold the role (0052)
  perform set_config('t.v', v::text, true), set_config('t.i', i::text, true), set_config('t.s1', s1::text, true), set_config('t.s2', s2::text, true);
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ declare no text; po uuid;
begin
  no := raise_po(current_setting('t.v')::uuid, current_setting('t.i')::uuid, 100, 30, current_date + 5, current_date);
  select id into po from purchase_order where po_no = no;
  assert (select status from purchase_order where id = po) = 'submitted', 'big PO waits for approval';
  begin perform receive_grn(po, 100, 3000, current_date); assert false, 'received unapproved PO';
  exception when raise_exception then null; end;
  perform set_config('t.po', po::text, true);
  begin perform tenant_modules('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c'); assert false, 'read another tenant''s plan';
  exception when insufficient_privilege then null; end;
  begin perform create_api_key('iot gateway', '{readings:write}'); assert false, 'api without module';
  exception when raise_exception then null; end;
end $$;

-- farm manager can't approve POs ... until the procurement officer delegates for a day
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
do $$ begin
  begin update purchase_order set status = 'approved' where id = current_setting('t.po')::uuid; assert false, 'manager approved PO';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"fffcd169-07c0-5f0d-aa8b-3c382ca8f861","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["procurement_officer"]}}';
do $$ begin
  begin insert into approval_delegation (to_user, roles, ends_at, reason) values ('9a7b4e00-d286-5aa1-9627-b38cdd6051a3', '{finance}', now() + interval '1 day', 'leave');
    assert false, 'delegated a role not held'; exception when raise_exception then null; end;
  insert into approval_delegation (to_user, roles, ends_at, reason) values ('9a7b4e00-d286-5aa1-9627-b38cdd6051a3', '{procurement_officer}', now() + interval '1 day', 'on leave');
end $$;
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
update purchase_order set status = 'approved' where id = current_setting('t.po')::uuid;

-- owner receives; stock count + transfer
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ declare po uuid := current_setting('t.po')::uuid; st uuid; c uuid; tr uuid; i uuid := current_setting('t.i')::uuid;
begin
  assert (select status from purchase_order where id = po) = 'approved', 'delegate approved';
  perform receive_grn(po, 100, 3000, current_date);
  select store_id into st from stock_movement where ref_id = po;
  insert into stock_count (store_id, counted_on) values (st, current_date) returning id into c;
  insert into stock_count_line (count_id, item_id, counted_qty) values (c, i, 96);
  update stock_count set status = 'submitted' where id = c;
  begin insert into stock_count_line (count_id, item_id, counted_qty) values (c, i, 1); assert false, 'edited submitted count';
  exception when raise_exception or unique_violation then null; end;
  update stock_count set status = 'approved' where id = c;
  assert (select sum(qty) from stock_movement where store_id = st and item_id = i) = 96, 'count adjusted -4';
  insert into stock_transfer (from_store, to_store, item_id, qty) values (st, current_setting('t.s2')::uuid, i, 50) returning id into tr;
  update stock_transfer set status = 'approved' where id = tr;
  update stock_transfer set status = 'in_transit', sent_on = current_date where id = tr;
  assert (select sum(qty) from stock_movement where store_id = st and item_id = i) = 46, 'left source';
  update stock_transfer set status = 'received', received_qty = 49, received_on = current_date where id = tr;
  assert (select sum(qty) from stock_movement where store_id = current_setting('t.s2')::uuid and item_id = i) = 49, 'arrived (1 short)';
  insert into stock_transfer (from_store, to_store, item_id, qty) values (st, current_setting('t.s2')::uuid, i, 47) returning id into tr;
  update stock_transfer set status = 'approved' where id = tr;
  begin update stock_transfer set status = 'in_transit' where id = tr; assert false, 'sent more than in stock';
  exception when raise_exception then null; end;
  assert (select on_time_pct from supplier_kpi where vendor_id = current_setting('t.v')::uuid) = 100.0, 'supplier on time';
end $$;

-- API keys with the module
reset role;
insert into subscription (tenant_id, plan, status, features) values ('b146bf5d-6213-556e-8e71-8d4c156ad36d', 'pro', 'active', '{"modules":["core","api"]}');
set local role authenticated;
do $$ declare k text;
begin
  k := create_api_key('iot gateway', '{readings:write}');
  assert length(k) = 48 and (select count(*) from api_key where prefix = left(k, 8) and key_hash <> k) = 1, 'only hash stored';
  perform set_config('t.k', k, true);
end $$;
reset role;
do $$ begin
  assert (select tenant_id from api_key_lookup(current_setting('t.k'))) = 'b146bf5d-6213-556e-8e71-8d4c156ad36d', 'key resolves';
  assert (select count(*) from api_key_lookup('nope')) = 0, 'bad key';
end $$;
rollback;
\echo phase3_test OK
