-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/breeder_test.sql
-- 0038: breeder daily record (sex split, alerts, approval, edit-then-approve), body weight vs standard, house
-- environment alerts, medication roles, calendar, tenant isolation.
begin;
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; bf uuid; bs uuid; br uuid; fl uuid;
begin
  insert into farm (tenant_id, name, farm_type) values (ks, 'KS Breeder – Test', 'breeder') returning id into bf;
  insert into shed (tenant_id, farm_id, name, capacity_birds) values (ks, bf, 'BR House 1', 6000) returning id into bs;
  insert into breed (tenant_id, name, farm_type) values (ks, 'Ross 308 PS', 'breeder') returning id into br;
  insert into breed_standard_curve (breed_id, age_week, std_weight_g, std_male_weight_g) values (br, 30, 3000, 3900);
  insert into batch (tenant_id, farm_id, shed_id, code, farm_type, breed_id, placed_on, doc_count, females_placed, males_placed)
    values (ks, bf, bs, 'KS-BR-T1', 'breeder', br, '2026-03-01', 5500, 5000, 500) returning id into fl;
  perform set_config('t.fl', fl::text, true), set_config('t.shed', bs::text, true), set_config('t.farm', bf::text, true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;

-- farm technician
set local request.jwt.claims = '{"sub":"3d86a04e-a887-52ea-bb3c-67ab5c414ce7","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$ declare fl uuid := current_setting('t.fl')::uuid; r record;
begin
  insert into breeder_daily (batch_id, log_date, female_mort, male_mort, feed_f_kg, feed_m_kg, water_l, diet_stage)
    values (fl, '2026-10-01', 30, 1, 800, 70, 1000, 'breeder_1');                 -- 0.6 % females -> alert
  insert into breeder_daily (batch_id, log_date, female_mort, feed_f_kg, water_l) values (fl, '2026-10-02', 5, 800, 1000);
  insert into breeder_daily (batch_id, log_date, female_mort, feed_f_kg, water_l) values (fl, '2026-10-03', 5, 800, 1000);
  insert into breeder_daily (batch_id, log_date, female_mort, feed_f_kg, water_l) values (fl, '2026-10-04', 5, 800, 700);  -- -30 % water -> alert
  begin insert into breeder_daily (batch_id, log_date, male_mort) values (fl, '2026-10-05', 600); assert false, 'more dead than alive';
  exception when raise_exception then null; end;
  begin insert into breeder_daily (batch_id, log_date) values (fl, '2099-01-01'); assert false, 'future date';
  exception when raise_exception then null; end;
  begin insert into breeder_daily (batch_id, log_date) values ((select id from batch where code = 'KS-H-2026-37'), '2026-10-05'); assert false, 'hatchery batch';
  exception when raise_exception then null; end;
  select * into r from breeder_flock_day where batch_id = fl and log_date = '2026-10-02';
  assert r.females_open = 4970 and r.females_left = 4965 and r.males_left = 499 and r.feed_g_per_female = 161, format('flock day %s', to_jsonb(r));
  assert (select cum_mort_pct from breeder_flock_day where batch_id = fl and log_date = '2026-10-04') = 0.84, 'cumulative mortality (46 / 5,500)';
  assert (select count(*) from notification where title like 'High mortality%') = 1, 'mortality alert';
  assert (select count(*) from notification where title like 'Water use changed%') = 1, 'water alert';
  begin update breeder_daily set status = 'approved' where log_date = '2026-10-01'; assert false, 'technician approved';
  exception when raise_exception then null; end;

  insert into body_weight_record (batch_id, weighed_on, sex, sample_size, avg_g, uniformity_pct, cv_pct) values (fl, '2026-09-30', 'F', 100, 2600, 82, 8.5);
  begin insert into body_weight_record (batch_id, weighed_on, sex, sample_size, avg_g, fleshing_score) values (fl, '2026-09-30', 'F', 100, 2600, 3); assert false, 'female fleshing';
  exception when check_violation or unique_violation then null; end;
  insert into body_weight_record (batch_id, weighed_on, sex, sample_size, avg_g, fleshing_score) values (fl, '2026-09-30', 'M', 10, 3900, 3);
  assert (select count(*) from notification where title like 'Body weight%') = 1, 'weight alert (females -13 %)';
  assert (select diff_g from body_weight_vs_standard where batch_id = fl and sex = 'F') = -400, 'weight diff';
  assert not (select sample_ok from body_weight_vs_standard where batch_id = fl and sex = 'M'), 'male sample 10 < 15';

  insert into env_reading (shed_id, read_at, temp_c, rh_pct, nh3_ppm, litter) values (current_setting('t.shed')::uuid, '2026-10-04 14:00+05:30', 34, 60, 25, 'wet');
  insert into env_reading (shed_id, read_at, temp_c, rh_pct) values (current_setting('t.shed')::uuid, '2026-10-04 08:00+05:30', 24, 60);
  assert (select body from notification where title like 'House conditions%') = 'temperature 34.0 °C high, ammonia 25.0 ppm, litter wet', 'house alert';
  assert (select count(*) from notification where title like 'House conditions%') = 1, 'normal reading raises nothing';
  begin insert into medication_record (batch_id, given_on, medicine, dosage, duration_days, reason) values (fl, '2026-10-04', 'Amoxicillin', '0.5 g/L', 5, 'CRD'); assert false, 'supervisor medicated';
  exception when insufficient_privilege then null; end;
  insert into biosecurity_incident (farm_id, occurred_on, nature, action_taken) values (current_setting('t.farm')::uuid, '2026-10-04', 'Visitor entered without foot dip', 'Retrained gate staff');
  assert (select first_egg_on from breeder_calendar where batch_id = fl) = '2026-08-23', 'first egg = placement + 25 weeks';
end $$;

-- vet medicates; manager approves day 1; approved locks
set local request.jwt.claims = '{"sub":"6cb2dade-5f3d-57c1-b062-f3b65a76db16","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["veterinarian"]}}';
insert into medication_record (batch_id, given_on, medicine, dosage, duration_days, reason, withdrawal_days)
  values (current_setting('t.fl')::uuid, '2026-10-04', 'Amoxicillin', '0.5 g/L', 5, 'CRD', 3);
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
do $$ begin
  update breeder_daily set status = 'approved' where log_date = '2026-10-01';
  begin update breeder_daily set female_mort = 1 where log_date = '2026-10-01'; assert false, 'edited approved day';
  exception when raise_exception then null; end;
  begin update breeder_daily set female_mort = 6, status = 'approved' where log_date = '2026-10-02'; assert false, 'edit and approve in one go';
  exception when raise_exception then null; end;
  -- manager corrects the technician's day 2: the manager is now its submitter
  update breeder_daily set female_mort = 6 where log_date = '2026-10-02';
  assert (select submitted_by from breeder_daily where log_date = '2026-10-02') = '9a7b4e00-d286-5aa1-9627-b38cdd6051a3', 'editor owns it';
end $$;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
insert into tenant_rule (key, value) values ('allow_self_approval', 'false');
set local request.jwt.claims = '{"sub":"9a7b4e00-d286-5aa1-9627-b38cdd6051a3","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["farm_manager"]}}';
do $$ begin
  begin update breeder_daily set status = 'approved' where log_date = '2026-10-02'; assert false, 'approved own correction';
  exception when raise_exception then null; end;
  update breeder_daily set status = 'approved' where log_date = '2026-10-03';   -- technician's untouched day: fine
end $$;

set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from breeder_daily) + (select count(*) from body_weight_record) + (select count(*) from env_reading)
       + (select count(*) from medication_record) + (select count(*) from biosecurity_incident) + (select count(*) from breeder_flock_day) = 0, 'cross-tenant read';
end $$;
rollback;
\echo breeder_test OK
