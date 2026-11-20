-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/requirement_gaps_test.sql
-- 0061: alert lifecycle + escalation, waiting-list "space free" alert, payment proof paths, requisition → PO,
-- feed days-remaining alert.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; hs uuid := '3cc7357e-09d6-5972-a12d-5f5aa2949a3c';
        p uuid; s1 uuid; c1 uuid; a bigint; old_a bigint; bf uuid; bs uuid; fl uuid; it uuid; st uuid; v uuid; rq uuid;
        today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  delete from notification where tenant_id = ks;
  -- alerts: one fresh, one 2 h old and unacknowledged (escalates)
  insert into notification (tenant_id, kind, severity, title) values (ks, 'alert', 'warning', 'Setter 2 too hot') returning id into a;
  insert into notification (tenant_id, kind, severity, title, created_at) values (ks, 'alert', 'critical', 'Generator down', now() - interval '2 hours') returning id into old_a;
  -- sales: S1 hatched today = 1,000 saleable; SO-GA holds 600, SO-GB (500) waits
  insert into chick_product (tenant_id, name, category, price) values (ks, 'Gap DOC', 'broiler', 40) returning id into p;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, full_hatch_flow, chick_product_id)
    values (ks, hat, hs, 'KS-GAP-1', 'hatchery', today - 21, 1100, false, p) returning id into s1;
  insert into hatch_record (tenant_id, batch_id, hatched_on, chicks_a, chicks_b, culls) values (ks, s1, today, 900, 100, 0);
  update hatch_record set status = 'approved' where batch_id = s1;
  insert into customer (tenant_id, name) values (ks, 'Gap Traders') returning id into c1;
  insert into sales_order (tenant_id, order_no, customer_id, product_id, qty, hatch_date, price) values (ks, 'SO-GA', c1, p, 600, today, 0);
  insert into sales_order (tenant_id, order_no, customer_id, product_id, qty, hatch_date, price) values (ks, 'SO-GB', c1, p, 500, today, 0);
  -- breeder farm with 1,000 kg feed on hand, eating 800 kg/day -> 1.3 days
  insert into farm (tenant_id, name, farm_type) values (ks, 'Gap Breeder', 'breeder') returning id into bf;
  insert into shed (tenant_id, farm_id, name, capacity_birds) values (ks, bf, 'Gap House', 6000) returning id into bs;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, females_placed, males_placed)
    values (ks, bf, bs, 'KS-GAP-BR', 'breeder', '2026-03-01', 5500, 5000, 500) returning id into fl;
  insert into item (tenant_id, name, category, unit) values (ks, 'Gap Breeder Mash', 'feed', 'kg') returning id into it;
  insert into store (tenant_id, farm_id, name) values (ks, bf, 'Gap Feed Store') returning id into st;
  insert into stock_movement (tenant_id, store_id, item_id, move_type, qty, moved_on) values (ks, st, it, 'grn', 1000, today);
  -- an approved requisition
  select id into v from vendor where tenant_id = ks limit 1;
  insert into purchase_requisition (tenant_id, farm_id, item_id, qty, needed_by, est_rate, purpose) values (ks, bf, it, 500, today + 7, 30, 'gap test') returning id into rq;
  update purchase_requisition set status = 'approved' where id = rq;
  perform set_config('t.a', a::text, true), set_config('t.old', old_a::text, true), set_config('t.fl', fl::text, true),
          set_config('t.v', v::text, true), set_config('t.rq', rq::text, true), set_config('t.so', (select id::text from sales_order where order_no = 'SO-GA'), true);
end $$;

-- 1. escalation (cron, no user): only the old unacknowledged alert escalates, once
do $$ begin
  assert alert_escalate() >= 1, 'escalated';                               -- also the other demo farm's old alerts
  assert alert_escalate() = 0, 'escalates once';
  assert (select count(*) from notification where entity_type = 'escalation' and dedupe_key = 'escalate:' || current_setting('t.old') and severity = 'critical') = 1, 'escalation alert';
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$ declare a bigint := current_setting('t.a')::bigint; begin
  begin perform alert_step(a, 'action', ''); assert false, 'action without a note'; exception when raise_exception then null; end;
  perform alert_step(a, 'ack');
  begin perform alert_step(a, 'ack'); assert false, 'acked twice'; exception when raise_exception then null; end;
  perform alert_step(a, 'action', 'Opened the damper, temp falling');
  perform alert_step(a, 'resolve');                                        -- note already given at the action step
  assert (select acknowledged_by is not null and actioned_at is not null and resolved_at is not null and action_note like 'Opened%' from notification where id = a), 'lifecycle';
  begin perform alert_step(a, 'resolve', 'again'); assert false, 'resolved twice'; exception when raise_exception then null; end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from audit_log where after ->> 'notification_id' = current_setting('t.a') and action like 'alert_%') = 3, 'steps audited';
end $$;
set local role authenticated;
-- another farm cannot touch it
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  begin perform alert_step(current_setting('t.old')::bigint, 'ack'); assert false, 'other tenant acked'; exception when raise_exception then null; end;
end $$;

-- 2. waiting list: cancelling SO-GA frees 600 -> SO-GB (500) gets a "space free" alert
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin
  assert (select status from sales_order where order_no = 'SO-GB') = 'waitlisted', 'B waits';
  update sales_order set status = 'cancelled', cancel_reason = 'customer postponed' where order_no = 'SO-GA';
end $$;
do $$ begin
  assert (select count(*) from notification where title like 'Space free for waiting order SO-GB%') = 1, 'space-free alert';
end $$;

-- 3. payment proof must sit in the order's own folder
do $$ declare so uuid := current_setting('t.so')::uuid; begin
  begin update sales_order set payment_proof_path = 'b146bf5d-6213-556e-8e71-8d4c156ad36d/other/x.jpg' where id = so; assert false, 'foreign proof path';
  exception when raise_exception then null; end;
  update sales_order set payment_proof_path = 'b146bf5d-6213-556e-8e71-8d4c156ad36d/payment/' || so || '/utr.jpg' where id = so;
end $$;

-- 4. requisition -> PO (procurement officer)
set local request.jwt.claims = '{"sub":"fffcd169-07c0-5f0d-aa8b-3c382ca8f861","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["procurement_officer"]}}';
do $$ declare no text; r record; begin
  no := requisition_to_po(current_setting('t.rq')::uuid, current_setting('t.v')::uuid, 32, null);
  select * into r from purchase_requisition where id = current_setting('t.rq')::uuid;
  assert r.status = 'ordered' and r.po_id = (select id from purchase_order where po_no = no), 'requisition ordered + linked';
  assert (select farm_id from purchase_order where po_no = no) = r.farm_id, 'PO on the requisition''s farm';
  assert (select qty from po_line pl join purchase_order po on po.id = pl.po_id where po.po_no = no) = 500, 'PO qty';
  begin perform requisition_to_po(current_setting('t.rq')::uuid, current_setting('t.v')::uuid, 32, null); assert false, 'ordered twice';
  exception when raise_exception then null; end;
end $$;

-- 5. feed days remaining: logging 800 kg/day with 1,000 kg on hand raises one alert for the day
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$ declare fl uuid := current_setting('t.fl')::uuid; d date := (now() at time zone 'Asia/Kolkata')::date; begin
  insert into breeder_daily (batch_id, log_date, female_mort, feed_f_kg, water_l) values (fl, d - 1, 5, 800, 1000);
  insert into breeder_daily (batch_id, log_date, female_mort, feed_f_kg, water_l) values (fl, d, 5, 800, 1000);
end $$;
reset role;
do $$ begin
  assert (select days_left from feed_days_left where farm_id = (select farm_id from batch where id = current_setting('t.fl')::uuid)) = 1.3, 'days left';
  assert (select count(*) from notification where title = 'Feed running low') = 1, 'one feed alert a day';
end $$;
rollback;
\echo requirement_gaps_test OK
