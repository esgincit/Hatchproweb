-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/trace_approvals_test.sql
-- 0036: approval lock (guard_locked), egg transfer -> setting lot traceability, egg-age override, mixed-source estimate,
-- self-approval rule, roles, tenant isolation.
begin;
-- fixtures (as postgres): a KS breeder flock + a 1,000-egg hatchery setting on 2026-10-20
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; bf uuid; bs uuid; fl uuid; st uuid;
begin
  insert into farm (tenant_id, name, farm_type) values (ks, 'KS Breeder – Test', 'breeder') returning id into bf;
  insert into shed (tenant_id, farm_id, name, capacity_birds) values (ks, bf, 'BR House 1', 6000) returning id into bs;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count)
    values (ks, bf, bs, 'KS-BR-T1', 'breeder', '2026-03-01', 5000) returning id into fl;
  insert into hatching_egg_collection (tenant_id, batch_id, collected_on, collection_no, nest) values (ks, fl, '2026-10-10', 1, 1300); -- 0039 egg store
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, full_hatch_flow)   -- legacy one-form hatch (0044)
    values (ks, '72c46a7d-d72c-5676-bc8a-70c996df7088', '3cc7357e-09d6-5972-a12d-5f5aa2949a3c', 'KS-H-T1', 'hatchery', '2026-10-20', 1000, false)
    returning id into st;
  perform set_config('t.fl', fl::text, true), set_config('t.st', st::text, true);
end $$;
set local role authenticated;

-- farm technician (shed_supervisor) raises two transfers
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$
declare fl uuid := current_setting('t.fl')::uuid; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088';
begin
  insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status)
    values ('TRF-T1', fl, hat, '2026-10-14', '2026-10-16', '2026-10-17', 700, 'submitted');
  insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status)
    values ('TRF-T2', fl, hat, '2026-10-10', '2026-10-12', '2026-10-13', 400, 'submitted');
  begin insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status)
    values ('TRF-X', fl, hat, '2026-10-10', '2026-10-12', '2026-10-13', 1, 'approved'); assert false, 'inserted approved';
  exception when raise_exception then null; end;
  begin insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty)
    values ('TRF-Y', fl, '6a64e5e8-e4e5-566b-95ac-f81460035e76', '2026-10-10', '2026-10-12', '2026-10-13', 1); assert false, 'sent to broiler farm';
  exception when raise_exception then null; end;
  begin update egg_transfer set status = 'approved' where ref = 'TRF-T1'; assert false, 'technician approved';
  exception when raise_exception then null; end;
  begin update egg_transfer set status = 'received', received_qty = 700, received_on = '2026-10-18' where ref = 'TRF-T1'; assert false, 'received before approval';
  exception when raise_exception then null; end;
end $$;

-- farm manager approves (C1 accountable), rejection needs a reason, approved rows are locked
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
do $$ begin
  begin update egg_transfer set status = 'rejected' where ref = 'TRF-T2'; assert false, 'rejected without reason';
  exception when raise_exception then null; end;
  update egg_transfer set status = 'approved' where ref in ('TRF-T1', 'TRF-T2');
  assert (select count(*) from egg_transfer where status = 'approved' and approved_by = '9a7b4e00-d286-5aa1-9627-b38cdd6051a3' and approved_at is not null) = 2, 'approval stamped';
  begin update egg_transfer set qty = 800 where ref = 'TRF-T1'; assert false, 'edited approved qty';
  exception when raise_exception then null; end;
  begin update egg_transfer set status = 'draft' where ref = 'TRF-T1'; assert false, 'reopened approved';
  exception when raise_exception then null; end;
  begin delete from egg_transfer where ref = 'TRF-T1'; assert false, 'deleted approved';
  exception when raise_exception then null; end;
end $$;

-- hatchery technician confirms receipt; receipt then locks
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; t1 uuid; t2 uuid;
begin
  update egg_transfer set status = 'received', received_qty = 700, receipt_rejects = 20, received_on = '2026-10-18' where ref = 'TRF-T1';
  update egg_transfer set status = 'received', received_qty = 400, received_on = '2026-10-14' where ref = 'TRF-T2';
  assert (select count(*) from egg_transfer where status = 'received') = 2, 'received';
  begin update egg_transfer set received_qty = 650 where ref = 'TRF-T1'; assert false, 'changed confirmed receipt';
  exception when raise_exception then null; end;
  begin update egg_transfer set status = 'cancelled' where ref = 'TRF-T1'; assert false, 'received -> cancelled';
  exception when raise_exception then null; end;
  begin update egg_transfer set status = 'approved' where ref = 'TRF-T1'; assert false, 'received -> approved';
  exception when raise_exception then null; end;
  -- 0037: no forged audit rows, no reading another tenant's rules
  begin perform audit_add('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'approved', 'x', null, null, null); assert false, 'called audit_add';
  exception when insufficient_privilege then null; end;
  assert tenant_rule_value('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'egg_max_storage_days', '99') = '99', 'read other tenant rule';
  select id into t1 from egg_transfer where ref = 'TRF-T1';
  select id into t2 from egg_transfer where ref = 'TRF-T2';
  begin insert into setting_lot (batch_id, transfer_id, qty) values (st, t1, 681); assert false, 'set more than settable (680)';
  exception when raise_exception then null; end;
  insert into setting_lot (batch_id, transfer_id, qty) values (st, t1, 680);
  begin insert into setting_lot (batch_id, transfer_id, qty) values (st, t2, 320); assert false, '10-day-old eggs without reason';
  exception when raise_exception then null; end;
  begin insert into setting_lot (batch_id, transfer_id, qty, age_override_reason) values (st, t2, 320, 'short week'); assert false, 'technician overrode egg age';
  exception when raise_exception then null; end;
end $$;

-- owner: over-age override, capacity check, candle + hatch, then sources lock
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; t2 uuid; r record;
begin
  select id into t2 from egg_transfer where ref = 'TRF-T2';
  begin insert into setting_lot (batch_id, transfer_id, qty, age_override_reason) values (st, t2, 321, 'short week'); assert false, 'sources beyond eggs set';
  exception when raise_exception then null; end;
  insert into setting_lot (batch_id, transfer_id, qty, age_override_reason) values (st, t2, 320, 'short week');
  insert into hatch_record (batch_id, candled_on, clears, dead_germ, hatched_on, chicks_a, chicks_b, culls)
    values (st, '2026-10-30', 100, 50, '2026-11-10', 700, 50, 20);
  begin delete from setting_lot where transfer_id = t2; assert false, 'changed sources after candling';
  exception when raise_exception then null; end;
  select * into r from setting_trace where transfer_ref = 'TRF-T1';
  assert r.estimated and r.share = 0.68 and r.chicks = 510 and r.eggs_set = 680, format('trace row %s', to_jsonb(r));
  assert (select sum(chicks) from setting_trace where batch_id = st) = 750, 'shares add up to the hatch';
  assert (select count(*) from audit_log where entity_type = 'egg_transfer' and action = 'approved'
            and entity_id in (select id from egg_transfer where ref in ('TRF-T1', 'TRF-T2'))) = 2, 'approvals audit-logged';
  -- C1 self-approval switch
  insert into tenant_rule (key, value) values ('allow_self_approval', 'false');
end $$;

set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
do $$ begin
  -- forged submitter is ignored: the row is stamped with the caller, so the self-approval rule still bites
  insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status, submitted_by)
    values ('TRF-T3', current_setting('t.fl')::uuid, '72c46a7d-d72c-5676-bc8a-70c996df7088', '2026-10-20', '2026-10-21', '2026-10-22', 100, 'submitted',
            '436f615f-c815-5957-8623-ca639dcdb5e4');
  assert (select submitted_by from egg_transfer where ref = 'TRF-T3') = '9a7b4e00-d286-5aa1-9627-b38cdd6051a3', 'submitter stamped';
  begin update egg_transfer set submitted_by = '436f615f-c815-5957-8623-ca639dcdb5e4' where ref = 'TRF-T3';
    assert (select submitted_by from egg_transfer where ref = 'TRF-T3') = '9a7b4e00-d286-5aa1-9627-b38cdd6051a3', 'submitter rewritten';
  end;
  begin update egg_transfer set status = 'approved' where ref = 'TRF-T3'; assert false, 'self-approved with rule off';
  exception when raise_exception then null; end;
  begin insert into tenant_rule (key, value) values ('egg_max_storage_days', '30'); assert false, 'manager changed rules';
  exception when insufficient_privilege then null; end;
end $$;

-- finance can read but not raise transfers; other tenant sees nothing
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  assert (select count(*) from egg_transfer where ref like 'TRF-T_') = 3, 'finance reads transfers';
  begin insert into egg_transfer (ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty)
    values ('TRF-F', current_setting('t.fl')::uuid, '72c46a7d-d72c-5676-bc8a-70c996df7088', '2026-10-20', '2026-10-21', '2026-10-22', 1); assert false, 'finance raised transfer';
  exception when insufficient_privilege then null; end;
end $$;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from egg_transfer) = 0 and (select count(*) from setting_trace) = 0 and (select count(*) from tenant_rule) = 0, 'cross-tenant read';
end $$;
rollback;
\echo trace_approvals_test OK
