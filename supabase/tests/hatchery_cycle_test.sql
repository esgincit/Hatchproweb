-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/hatchery_cycle_test.sql
-- 0041/0042: setter loading (capacity, single-stage), candling D10/D18 + approvals, hatcher transfer, hatch approval,
-- hatcher release, machine status, machine env alerts, vaccination (expired policy), quality, KPIs, flock feedback.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; hs uuid := '3cc7357e-09d6-5972-a12d-5f5aa2949a3c';
        bf uuid; bs uuid; fl uuid; st uuid; st2 uuid; tr uuid; s1 uuid; h1 uuid;
begin
  insert into farm (tenant_id, name, farm_type) values (ks, 'KS Breeder – Test', 'breeder') returning id into bf;
  insert into shed (tenant_id, farm_id, name, capacity_birds) values (ks, bf, 'BR House 1', 6000) returning id into bs;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count) values (ks, bf, bs, 'KS-BR-C1', 'breeder', '2026-03-01', 5000) returning id into fl;
  insert into hatching_egg_collection (tenant_id, batch_id, collected_on, collection_no, nest) values (ks, fl, '2026-10-15', 1, 1500);
  insert into egg_transfer (tenant_id, ref, flock_id, to_farm_id, laid_from, laid_to, sent_on, qty, status)
    values (ks, 'TRF-C1', fl, hat, '2026-10-15', '2026-10-15', '2026-10-16', 1000, 'submitted') returning id into tr;
  update egg_transfer set status = 'approved' where id = tr;
  update egg_transfer set status = 'received', received_qty = 1000, received_on = '2026-10-17' where id = tr;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count, full_hatch_flow) values (ks, hat, hs, 'KS-H-C1', 'hatchery', '2026-10-20', 1000, true) returning id into st;
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, placed_on, doc_count) values (ks, hat, hs, 'KS-H-C2', 'hatchery', '2026-10-20', 300) returning id into st2;
  insert into setting_lot (tenant_id, batch_id, transfer_id, qty) values (ks, st, tr, 1000);
  insert into asset (tenant_id, farm_id, name, category, machine_kind, machine_no, capacity_eggs, stage)
    values (ks, hat, 'Setter 1', 'incubator', 'setter', 'S1', 1200, 'single') returning id into s1;
  insert into asset (tenant_id, farm_id, name, category, machine_kind, machine_no, capacity_eggs, stage)
    values (ks, hat, 'Hatcher 1', 'incubator', 'hatcher', 'H1', 1200, 'single') returning id into h1;
  perform set_config('t.st', st::text, true), set_config('t.st2', st2::text, true), set_config('t.tr', tr::text, true),
          set_config('t.s1', s1::text, true), set_config('t.h1', h1::text, true), set_config('t.fl', fl::text, true),
          set_config('t.v1', (select id::text from vaccine_master where tenant_id is null order by name limit 1), true),
          set_config('t.v2', (select id::text from vaccine_master where tenant_id is null order by name offset 1 limit 1), true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;

-- hatchery technician: load, candle; can't approve
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; s1 uuid := current_setting('t.s1')::uuid;
begin
  perform load_setter(st, s1);
  begin perform load_setter(current_setting('t.st2')::uuid, s1); assert false, 'second setting in single-stage setter';
  exception when raise_exception then null; end;
  assert (select state from machine_status where asset_id = s1) = 'in_use' and (select eggs_in_setter from machine_status where asset_id = s1) = 1000, 'setter in use';
  begin insert into candling (batch_id, stage, candled_on, eggs_candled, mid_dead, late_dead) values (st, 2, '2026-11-07', 900, 1, 1); assert false, 'D18 before D10';
  exception when raise_exception then null; end;
  insert into candling (batch_id, stage, candled_on, eggs_candled, infertile, early_dead, dirty) values (st, 1, '2026-10-30', 1000, 80, 20, 5);
  begin update candling set status = 'approved' where batch_id = st; assert false, 'technician approved candling';
  exception when raise_exception then null; end;
  begin insert into setting_lot (batch_id, transfer_id, qty) values (st, current_setting('t.tr')::uuid, 1); assert false, 'sources changed after candling';
  exception when raise_exception then null; end;
  -- machine readings: one out of range, one fine
  insert into env_reading (asset_id, read_at, temp_c, rh_pct, fan_rpm) values (s1, '2026-10-21 10:00+05:30', 38.4, 55, 900);
  insert into env_reading (asset_id, read_at, temp_c, rh_pct, fan_rpm) values (s1, '2026-10-21 10:30+05:30', 37.5, 55, 900);
  assert (select body from notification where title = 'Machine · S1') = 'temperature 38.4 °C high', 'machine alert';
  assert (select temp_compliance_pct from machine_env_day where asset_id = s1) = 50.0 and (select expected from machine_env_day where asset_id = s1) = 48, 'compliance';
end $$;

set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_ops_manager"]}}';
update candling set status = 'approved' where batch_id = current_setting('t.st')::uuid and stage = 1;

set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; h1 uuid := current_setting('t.h1')::uuid;
begin
  insert into candling (batch_id, stage, candled_on, eggs_candled, mid_dead, late_dead) values (st, 2, '2026-11-07', 895, 10, 15);
  begin insert into hatcher_transfer (batch_id, hatcher_id, moved_on, eggs) values (st, h1, '2026-11-07', 870); assert false, 'moved before D18 approval';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_ops_manager"]}}';
update candling set status = 'approved' where batch_id = current_setting('t.st')::uuid and stage = 2;

set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; h1 uuid := current_setting('t.h1')::uuid;
begin
  assert (select transfer_eggs from setting_progress where batch_id = st) = 870, 'transfer eggs';
  begin insert into hatcher_transfer (batch_id, hatcher_id, moved_on, eggs) values (st, h1, '2026-11-07', 871); assert false, 'moved more than live';
  exception when raise_exception then null; end;
  begin insert into hatcher_transfer (batch_id, hatcher_id, moved_on, eggs) values (st, current_setting('t.s1')::uuid, '2026-11-07', 870); assert false, 'setter as hatcher';
  exception when raise_exception then null; end;
  insert into hatcher_transfer (batch_id, hatcher_id, moved_on, eggs) values (st, h1, '2026-11-07', 870);
  assert (select state from machine_status where asset_id = current_setting('t.s1')::uuid) = 'available', 'setter freed';
  assert (select state from machine_status where asset_id = h1) = 'in_use', 'hatcher in use';
  begin insert into hatch_record (batch_id, hatched_on, chicks_a, chicks_b, culls) values (st, '2026-11-10', 780, 30, 20); assert false, 'hatch before transfer approved';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_ops_manager"]}}';
update hatcher_transfer set status = 'approved' where batch_id = current_setting('t.st')::uuid;

set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_technician"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid;
begin
  begin insert into hatch_record (batch_id, hatched_on, chicks_a, chicks_b, culls) values (st, '2026-11-10', 800, 50, 21); assert false, 'more than transferred';
  exception when raise_exception then null; end;
  insert into hatch_record (batch_id, hatched_on, chicks_a, chicks_b, culls, dead_in_hatcher, unhatched) values (st, '2026-11-10', 780, 30, 20, 25, 15);
  assert (select state from machine_status where asset_id = current_setting('t.h1')::uuid) = 'cleaning', 'hatcher cleaning';
  begin update hatch_record set status = 'approved' where batch_id = st; assert false, 'technician approved hatch';
  exception when raise_exception then null; end;
  begin insert into machine_release (batch_id, hatcher_id, chicks_removed, waste_recorded, cleaned, disinfected, inspected)
    values (st, current_setting('t.h1')::uuid, true, true, true, true, true); assert false, 'technician released hatcher';
  exception when insufficient_privilege then null; end;
end $$;

-- hatchery manager approves; KPIs (C1 formulas)
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["hatchery_manager"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; k record;
begin
  update hatch_record set status = 'approved' where batch_id = st;
  begin update hatch_record set culls = 10 where batch_id = st; assert false, 'edited approved hatch';
  exception when raise_exception then null; end;
  select * into k from hatch_kpi where batch_id = st;
  assert k.chicks_hatched = 830 and k.saleable = 810 and k.fertility_pct = 92.00 and k.hes_pct = 83.00 and k.hof_pct = 90.22
     and k.hatch_of_transfer_pct = 95.40 and k.embryo_mortality_pct = 4.50 and k.early_mortality_pct = 2.00 and k.cull_pct = 2.41
     and k.dead_in_hatcher_pct = 2.87 and k.hatch_waste_pct = 1.72 and k.egg_to_chick_pct = 81.00, format('kpi %s', to_jsonb(k));
  begin insert into machine_release (batch_id, hatcher_id, chicks_removed, waste_recorded, cleaned, disinfected, inspected)
    values (st, current_setting('t.h1')::uuid, true, true, false, true, true); assert false, 'released without cleaning';
  exception when check_violation then null; end;
  insert into machine_release (batch_id, hatcher_id, chicks_removed, waste_recorded, cleaned, disinfected, inspected, disinfectant)
    values (st, current_setting('t.h1')::uuid, true, true, true, true, true, 'Virkon S');
  assert (select state from machine_status where asset_id = current_setting('t.h1')::uuid) = 'available', 'hatcher released';
  assert (select hes_pct from flock_hatch_feedback where flock_id = current_setting('t.fl')::uuid) = 83.00
     and not (select estimated from flock_hatch_feedback where flock_id = current_setting('t.fl')::uuid), 'single-source feedback, measured';
end $$;

-- vet: vaccinate (expired = warn by default), quality inspection
set local request.jwt.claims = '{"sub":"6cb2dade-5f3d-57c1-b062-f3b65a76db16","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["veterinarian"]}}';
do $$ declare st uuid := current_setting('t.st')::uuid; v1 uuid := current_setting('t.v1')::uuid; v2 uuid := current_setting('t.v2')::uuid; c record;
begin
  insert into chick_vaccination (batch_id, vaccine_id, vaccine_lot, expiry, qty, given_at) values (st, v1, 'MD-2291', '2027-03-31', 810, '2026-11-10 09:00+05:30');
  begin insert into chick_vaccination (batch_id, vaccine_id, vaccine_lot, expiry, qty, given_at) values (st, v1, 'MD-2291', '2027-03-31', 1, '2026-11-10 09:00+05:30');
    assert false, 'vaccinated more chicks than saleable'; exception when raise_exception then null; end;
  insert into chick_vaccination (batch_id, vaccine_id, vaccine_lot, expiry, qty, given_at) values (st, v2, 'ND-17', '2026-11-01', 100, '2026-11-10 09:30+05:30');
  assert (select expired from chick_vaccination where vaccine_lot = 'ND-17') and (select count(*) from notification where title = 'Expired vaccine used · lot ND-17') = 1, 'expired warns';
  insert into chick_quality_inspection (batch_id, inspected_on, sample_size, avg_weight_g, navel_defects, dispatch_eligible) values (st, '2026-11-10', 100, 41.5, 2, true);
  update chick_quality_inspection set status = 'approved' where batch_id = st;
  select * into c from chick_stock where batch_id = st;
  assert c.saleable = 810 and c.quality_ok and not c.vaccinated_all and c.min_vaccinated = 100 and c.available = 810, format('stock %s', to_jsonb(c));
end $$;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
insert into tenant_rule (key, value) values ('expired_vaccine_policy', '"block"');
set local request.jwt.claims = '{"sub":"6cb2dade-5f3d-57c1-b062-f3b65a76db16","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["veterinarian"]}}';
do $$ begin
  begin insert into chick_vaccination (batch_id, vaccine_id, vaccine_lot, expiry, qty, given_at)
    values (current_setting('t.st')::uuid, current_setting('t.v2')::uuid, 'ND-17', '2026-11-01', 10, '2026-11-10 10:00+05:30'); assert false, 'expired allowed under block';
  exception when raise_exception then null; end;
  begin insert into chick_vaccination (batch_id, vaccine_id, vaccine_lot, expiry, qty, given_at, expired_override_reason)
    values (current_setting('t.st')::uuid, current_setting('t.v2')::uuid, 'ND-17', '2026-11-01', 10, '2026-11-10 10:00+05:30', 'only stock'); assert false, 'vet overrode';
  exception when raise_exception then null; end;
end $$;

set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from candling) + (select count(*) from hatcher_transfer) + (select count(*) from machine_release) + (select count(*) from chick_vaccination)
       + (select count(*) from chick_quality_inspection) + (select count(*) from hatch_kpi where code like 'KS-%') + (select count(*) from machine_status) = 0, 'cross-tenant read';
  begin perform load_setter(current_setting('t.st2')::uuid, current_setting('t.s1')::uuid); assert false, 'other tenant loaded setter';
  exception when raise_exception then null; end;
end $$;
rollback;
\echo hatchery_cycle_test OK
