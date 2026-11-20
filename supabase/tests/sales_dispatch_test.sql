-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/sales_dispatch_test.sql
-- 0043/0045: reservation vs waiting list, deposit slabs, payment verification (finance only), confirm + price lock,
-- credit customers, cancellation frees space, expiry, allocation (sales proposes / HM approves, over-allocation
-- blocked), dispatch gates, invoice at dispatch, delivery + DOA claim, order status sync, delivery trace.
begin;
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; hs uuid := '3cc7357e-09d6-5972-a12d-5f5aa2949a3c';
        p uuid; s1 uuid; s2 uuid; c1 uuid; c2 uuid; v1 uuid; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select id into v1 from vaccine_master where tenant_id is null order by name limit 1;
  insert into tenant_rule (tenant_id, key, value) values (ks, 'planning_hes_pct', '80'), (ks, 'planning_cull_pct', '2')
    on conflict (tenant_id, key) do update set value = excluded.value;
  insert into chick_product (tenant_id, name, category, price, required_vaccines, max_dispatch_age_hours)
    values (ks, 'Broiler DOC – test', 'broiler', 40, array[v1], 72) returning id into p;
  -- S1 hatched today: 1,000 saleable; S2 set 5 days ago: 2,000 eggs -> 1,568 expected (80 % x 98 %)
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, full_hatch_flow, chick_product_id)
    values (ks, hat, hs, 'KS-S-1', 'hatchery', today - 21, 1100, false, p) returning id into s1;
  insert into hatch_record (tenant_id, batch_id, hatched_on, chicks_a, chicks_b, culls) values (ks, s1, today, 900, 100, 0);
  update hatch_record set status = 'approved' where batch_id = s1;
  insert into chick_quality_inspection (tenant_id, batch_id, inspected_on, sample_size, dispatch_eligible) values (ks, s1, today, 100, true);
  update chick_quality_inspection set status = 'approved' where batch_id = s1;
  insert into chick_vaccination (tenant_id, batch_id, vaccine_id, vaccine_lot, expiry, qty) values (ks, s1, v1, 'MD-1', today + 90, 1000);
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, full_hatch_flow, chick_product_id)
    values (ks, hat, hs, 'KS-S-2', 'hatchery', today - 5, 2000, false, p) returning id into s2;
  insert into customer (tenant_id, name, tier, credit_limit) values (ks, 'Platinum Traders', 'platinum', 0) returning id into c1;
  insert into customer (tenant_id, name, tier, credit_limit, credit_days) values (ks, 'Credit Agencies', 'standard', 1000000, 15) returning id into c2;
  perform set_config('t.p', p::text, true), set_config('t.s1', s1::text, true), set_config('t.c1', c1::text, true), set_config('t.c2', c2::text, true),
          set_config('t.today', today::text, true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;

-- sales officer books
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["sales_officer"]}}';
do $$ declare p uuid := current_setting('t.p')::uuid; d date := current_setting('t.today')::date; o record;
begin
  assert (select saleable from chick_supply where code = 'KS-S-2') = 1568, 'planned supply';
  insert into sales_order (order_no, customer_id, product_id, qty, hatch_date, price) values ('SO-A', current_setting('t.c1')::uuid, p, 600, d, 0);
  select * into o from sales_order where order_no = 'SO-A';
  assert o.status = 'reserved' and o.price = 40 and o.deposit_pct = 50 and o.deposit_due = 12000 and o.reserve_expires_at > now(), format('A %s', to_jsonb(o));
  insert into sales_order (order_no, customer_id, product_id, qty, hatch_date, price) values ('SO-B', current_setting('t.c2')::uuid, p, 500, d, 0);
  select * into o from sales_order where order_no = 'SO-B';
  assert o.status = 'waitlisted' and o.suggested_hatch_date is not null, format('B %s', to_jsonb(o));
  insert into sales_order (order_no, customer_id, product_id, qty, hatch_date, price) values ('SO-C', current_setting('t.c2')::uuid, p, 300, d, 0);
  insert into sales_order (order_no, customer_id, product_id, qty, hatch_date, price) values ('SO-D', current_setting('t.c2')::uuid, p, 100, d, 0);
  assert (select deposit_pct from sales_order where order_no = 'SO-D') = 0 and (select payment_status from sales_order where order_no = 'SO-D') = 'waived', 'small order: no deposit';
  assert (select available from chick_availability where product_id = p and week = date_trunc('week', d)::date) = 0, 'week full';
  begin update sales_order set status = 'confirmed' where order_no = 'SO-A'; assert false, 'confirmed without deposit';
  exception when raise_exception then null; end;
  -- 0047: no client-side deposit games, no self-granted credit, no under-list price
  begin update sales_order set deposit_pct = 0, deposit_due = 0, payment_status = 'waived' where order_no = 'SO-A'; assert false, 'sales waived deposit';
  exception when raise_exception then null; end;
  begin update sales_order set credit_override_reason = 'trusted' where order_no = 'SO-A'; assert false, 'sales granted credit';
  exception when raise_exception then null; end;
  begin update sales_order set price = 30 where order_no = 'SO-A'; assert false, 'sales priced under list';
  exception when raise_exception then null; end;
  begin update sales_order set payment_status = 'verified', deposit_paid = 12000 where order_no = 'SO-A'; assert false, 'sales verified payment';
  exception when raise_exception then null; end;
  update sales_order set status = 'confirmed' where order_no = 'SO-C';                 -- credit customer: no deposit needed
  assert (select price_locked_at is not null from sales_order where order_no = 'SO-C'), 'price locked';
  begin update sales_order set price = 35, price_change_reason = 'discount' where order_no = 'SO-C'; assert false, 'sales changed locked price';
  exception when raise_exception then null; end;
  begin update sales_order set status = 'dispatched' where order_no = 'SO-C'; assert false, 'skipped to dispatched';
  exception when raise_exception then null; end;
  update sales_order set status = 'cancelled', cancel_reason = 'customer postponed' where order_no = 'SO-C';
  assert (select count(*) from notification where title like 'Space freed%') = 1, 'waiting list told';
  begin update sales_order set status = 'reserved' where order_no = 'SO-B'; assert false, 'B moved in without space';
  exception when raise_exception then null; end;
end $$;

-- finance verifies the deposit; sales confirms
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  begin update sales_order set payment_status = 'verified', deposit_paid = 11000 where order_no = 'SO-A'; assert false, 'verified short deposit';
  exception when raise_exception then null; end;
  update sales_order set payment_status = 'verified', deposit_paid = 12000, payment_ref = 'UTR123' where order_no = 'SO-A';
end $$;
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["sales_officer"]}}';
do $$ declare s1 uuid := current_setting('t.s1')::uuid; oa uuid; od uuid;
begin
  update sales_order set status = 'confirmed' where order_no in ('SO-A', 'SO-D');
  select id into oa from sales_order where order_no = 'SO-A';
  select id into od from sales_order where order_no = 'SO-D';
  assert (select priority from allocation_queue where order_id = oa) = 1, 'platinum first';
  insert into order_allocation (order_id, batch_id, qty) values (oa, s1, 600);
  begin insert into order_allocation (order_id, batch_id, qty) values (od, s1, 401); assert false, 'over-allocated setting';
  exception when raise_exception then null; end;
  begin update order_allocation set status = 'approved' where order_id = oa; assert false, 'sales approved allocation';
  exception when raise_exception then null; end;
  assert (select allocated from chick_stock where batch_id = s1) = 600 and (select available from chick_stock where batch_id = s1) = 400, 'stock nets allocation';
end $$;
-- legacy one-step DOC sale can't eat allocated chicks
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  begin perform create_sale(current_setting('t.c2')::uuid, 'doc', 401, 'chick', 40, current_setting('t.today')::date, current_setting('t.s1')::uuid); assert false, 'direct sale over stock';
  exception when sqlstate 'HP466' then null; end;
end $$;
-- hatchery manager approves
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_manager"]}}';
update order_allocation set status = 'approved' where order_id = (select id from sales_order where order_no = 'SO-A');
do $$ begin assert (select status from sales_order where order_no = 'SO-A') = 'allocated', 'order allocated'; end $$;

-- dispatch team loads; ops manager confirms
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["dispatch_officer"]}}';
do $$ declare v uuid; d uuid; a uuid;
begin
  insert into vehicle (reg_no, capacity_boxes, temp_controlled) values ('AP21 TB 0001', 80, true) returning id into v;
  insert into dispatch (vehicle_id, driver_name, planned_on, route) values (v, 'Suresh', current_setting('t.today')::date, 'Nandyal - Kurnool') returning id into d;
  select a2.id into a from order_allocation a2 join sales_order o on o.id = a2.order_id where o.order_no = 'SO-A';
  begin insert into dispatch_line (dispatch_id, allocation_id, qty_loaded) values (d, a, 601); assert false, 'loaded more than allocated';
  exception when raise_exception then null; end;
  insert into dispatch_line (dispatch_id, allocation_id, qty_loaded, boxes) values (d, a, 600, 6);
  update dispatch set status = 'submitted' where id = d;
  begin update dispatch set status = 'approved' where id = d; assert false, 'dispatch team confirmed';
  exception when raise_exception then null; end;
  perform set_config('t.d', d::text, true);
end $$;
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_ops_manager"]}}';
update dispatch set status = 'approved' where id = current_setting('t.d')::uuid;
do $$ begin
  assert (select dispatched_at is not null from dispatch where id = current_setting('t.d')::uuid), 'stamped';
  assert (select status from sales_order where order_no = 'SO-A') = 'dispatched', 'order dispatched';
  assert (select total from invoice i join dispatch_line l on l.id = i.dispatch_line_id where l.dispatch_id = current_setting('t.d')::uuid) = 24000, 'invoice at dispatch';
end $$;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_manager"]}}';
do $$ begin
  begin update order_allocation set status = 'released' where order_id = (select id from sales_order where order_no = 'SO-A'); assert false, 'released dispatched chicks';
  exception when raise_exception then null; end;
end $$;

-- delivery + POD, DOA claim, completion
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["dispatch_officer"]}}';
do $$ declare d uuid := current_setting('t.d')::uuid; l uuid;
begin
  begin update dispatch_line set qty_loaded = 500 where dispatch_id = d; assert false, 'changed load after dispatch';
  exception when raise_exception then null; end;
  begin update dispatch set status = 'delivered', receiver_name = 'Ramesh' where id = d; assert false, 'delivered without counts';
  exception when raise_exception then null; end;
  update dispatch_line set qty_delivered = 595, qty_short = 5, qty_doa = 5 where dispatch_id = d;
  update dispatch set status = 'delivered', receiver_name = 'Ramesh', pod_path = 'pod/x.jpg' where id = d;
  assert (select status from sales_order where order_no = 'SO-A') = 'delivered', 'order delivered';
  select id into l from dispatch_line where dispatch_id = d;
  insert into doa_claim (dispatch_line_id, reported_on, qty, customer_note) values (l, current_setting('t.today')::date, 5, '5 dead in boxes');
  begin insert into doa_claim (dispatch_line_id, reported_on, qty) values (l, current_setting('t.today')::date, 591); assert false, 'claimed more than delivered';
  exception when raise_exception then null; end;
  assert (select count(*) from delivery_trace where dispatch_id = d and setting_code = 'KS-S-1' and customer = 'Platinum Traders' and vaccines like '%MD-1%') = 1, 'delivery trace';
  update dispatch set status = 'completed' where id = d;
  assert (select status from sales_order where order_no = 'SO-A') = 'completed', 'order completed';
end $$;

-- reservation expiry (cron function, service role)
reset role;
insert into sales_order (tenant_id, order_no, customer_id, product_id, qty, hatch_date, price)
  values ('b146bf5d-6213-556e-8e71-8d4c156ad36d', 'SO-E', current_setting('t.c2')::uuid, current_setting('t.p')::uuid, 50, current_setting('t.today')::date + 16, 0);
update sales_order set reserve_expires_at = now() - interval '1 minute' where order_no = 'SO-E';
do $$ begin
  assert expire_reservations() >= 1, 'expired some';
  assert (select status from sales_order where order_no = 'SO-E') = 'expired', 'expired';
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from sales_order) + (select count(*) from order_allocation) + (select count(*) from dispatch) + (select count(*) from dispatch_line)
       + (select count(*) from vehicle) + (select count(*) from doa_claim) + (select count(*) from delivery_trace) + (select count(*) from chick_product) = 0, 'cross-tenant read';
end $$;
rollback;
\echo sales_dispatch_test OK
