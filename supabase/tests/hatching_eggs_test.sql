-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/hatching_eggs_test.sql
-- 0039: hatching-egg collection (settable, floor/dirty rules, alerts, approval), egg KPIs, farm egg store limit on
-- transfers, receipt discrepancy note.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; bf uuid; bs uuid; fl uuid;
begin
  insert into farm (tenant_id, name, farm_type) values (ks, 'KS Breeder – Test', 'breeder') returning id into bf;
  insert into shed (tenant_id, farm_id, name, capacity_birds) values (ks, bf, 'BR House 1', 6000) returning id into bs;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, females_placed, males_placed)
    values (ks, bf, bs, 'KS-BR-T1', 'breeder', '2026-03-01', 5500, 5000, 500) returning id into fl;
  perform set_config('t.fl', fl::text, true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$ declare fl uuid := current_setting('t.fl')::uuid; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; r record;
begin
  insert into breeder_daily (batch_id, log_date, female_mort) values (fl, '2026-10-10', 0);
  -- 1st collection: 3,000 nest + 100 floor; 60 rejects -> 2,940 settable; floor 3.2 % (no alert)
  insert into hatching_egg_collection (batch_id, collected_on, collection_no, nest, floor, cracked, dirty, small)
    values (fl, '2026-10-10', 1, 3000, 100, 20, 30, 10);
  -- 2nd: 900 nest + 100 floor = 10 % floor -> alert
  insert into hatching_egg_collection (batch_id, collected_on, collection_no, nest, floor) values (fl, '2026-10-10', 2, 900, 100);
  assert (select settable from hatching_egg_collection where batch_id = current_setting('t.fl')::uuid and collection_no =1) = 2940, 'settable excludes floor + rejects';
  assert (select count(*) from notification where title like 'Floor eggs high%') = 1, 'floor alert once';
  begin insert into hatching_egg_collection (batch_id, collected_on, collection_no, nest, dirty, dirty_treated) values (fl, '2026-10-10', 3, 100, 10, 5);
    assert false, 'treated dirty eggs without rule'; exception when raise_exception then null; end;
  begin insert into hatching_egg_collection (batch_id, collected_on, collection_no, nest, cracked) values (fl, '2026-10-10', 3, 10, 11);
    assert false, 'rejects beyond nest'; exception when raise_exception then null; end;
  select * into r from flock_egg_day where batch_id = fl and collected_on = '2026-10-10';
  assert r.total = 4100 and r.settable = 3840 and r.females = 5000 and r.hen_day_pct = 82 and r.floor_pct = 4.88, format('egg day %s', to_jsonb(r));
  assert (select in_store from flock_egg_store where batch_id = fl) = 3840, 'store';

  insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status, vehicle_no, driver_name)
    values ('TRF-A', fl, hat, '2026-10-10', '2026-10-10', '2026-10-11', 3000, 'submitted', 'AP21 TA 1234', 'Ravi');
  begin insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty)
    values ('TRF-B', fl, hat, '2026-10-10', '2026-10-10', '2026-10-11', 841); assert false, 'more than store';
  exception when raise_exception then null; end;
  assert (select in_store from flock_egg_store where batch_id = fl) = 840, 'store after transfer';
  -- transfer of eggs laid 10 days before sending -> old-egg alert (not blocked)
  insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty) values ('TRF-OLD', fl, hat, '2026-10-01', '2026-10-10', '2026-10-11', 100);
  assert (select count(*) from notification where title = 'Old eggs sent · TRF-OLD') = 1, 'old egg alert';
end $$;

-- farm manager approves collection + transfer; hatchery tech receives short with a note
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
update hatching_egg_collection set status = 'approved' where batch_id = current_setting('t.fl')::uuid and collection_no =1;
update egg_transfer set status = 'approved' where ref = 'TRF-A';
do $$ begin
  begin update hatching_egg_collection set nest = 3100 where batch_id = current_setting('t.fl')::uuid and collection_no =1; assert false, 'edited approved collection';
  exception when raise_exception then null; end;
  -- 0041: eggs already committed (3,100) — rejecting collection 2 would leave 2,940 collected
  begin update hatching_egg_collection set status = 'rejected', reject_reason = 'miscount' where batch_id = current_setting('t.fl')::uuid and collection_no =2; assert false, 'store went negative';
  exception when raise_exception then null; end;
  update egg_transfer set status = 'rejected', reject_reason = 'too old' where ref = 'TRF-OLD';
  begin update egg_transfer set status = 'submitted', qty = 100 where ref = 'TRF-OLD';
    update hatching_egg_collection set nest = 800 where batch_id = current_setting('t.fl')::uuid and collection_no =2;  -- 3,740 collected vs 3,100 committed: fine
    update egg_transfer set qty = 700 where ref = 'TRF-OLD';               -- 3,700 committed vs 3,740: fine
    update hatching_egg_collection set nest = 700 where batch_id = current_setting('t.fl')::uuid and collection_no =2; assert false, 'edit made store negative';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ begin
  begin update egg_transfer set status = 'received', received_qty = 2990, received_on = '2026-10-11' where ref = 'TRF-A'; assert false, 'short without note';
  exception when raise_exception then null; end;
  update egg_transfer set status = 'received', received_qty = 2990, receipt_rejects = 12, received_on = '2026-10-11', receipt_note = '1 tray broken in transit' where ref = 'TRF-A';
  assert (select count(*) from notification where title = 'Egg receipt short/over · TRF-A') = 1, 'discrepancy alert';
  begin update egg_transfer set receipt_note = 'changed' where ref = 'TRF-A'; assert false, 'changed receipt note';
  exception when raise_exception then null; end;
end $$;

set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from hatching_egg_collection) + (select count(*) from flock_egg_day) + (select count(*) from flock_egg_store) = 0, 'cross-tenant read';
end $$;
rollback;
\echo hatching_eggs_test OK
