-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/shift_log_test.sql
-- 0028 add_shift_log: shifts add to the day (temps/weight kept); the same op id twice is applied once; labour can use it.
begin;
select set_config('t.b', (select id::text from batch where code = 'VKR-B-2026-14'), true);
delete from daily_shed_log where batch_id = current_setting('t.b')::uuid and log_date = '2026-10-20';
set local role authenticated;
-- a supervisor's full log for 2026-10-20 first
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["shed_supervisor"]}}';
select save_daily_log(current_setting('t.b')::uuid, '2026-10-20', '{"mortality":2,"culls":0,"feed_kg":500,"water":900,"tmax":31,"avg_w":1650}');

-- labour (same tenant): two shifts, one replayed
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["labour"]}}';
do $$
declare b uuid := current_setting('t.b')::uuid; r record;
begin
  assert add_shift_log('11111111-1111-4111-8111-111111111111', b, '2026-10-20', 'morning', '{"mortality":3,"culls":1,"feed_kg":250,"water":400}') = 'applied', 'morning applied';
  assert add_shift_log('11111111-1111-4111-8111-111111111111', b, '2026-10-20', 'morning', '{"mortality":3,"culls":1,"feed_kg":250,"water":400}') = 'duplicate', 'replay ignored';
  assert add_shift_log('22222222-2222-4222-8222-222222222222', b, '2026-10-20', 'evening', '{"mortality":1,"feed_kg":200}') = 'applied', 'evening applied';
  select * into r from daily_shed_log where batch_id = b and log_date = '2026-10-20';
  assert r.mortality = 6 and r.culls = 1 and r.feed_kg = 950 and r.water_litres = 1300, format('totals added: %s %s %s %s', r.mortality, r.culls, r.feed_kg, r.water_litres);
  assert r.temp_max_c = 31 and r.avg_weight_g = 1650, 'supervisor temps/weight kept';
  assert r.remarks like '%morning: +3 dead%' and r.remarks like '%evening: +1 dead%', 'shift notes';
  begin perform add_shift_log(gen_random_uuid(), b, '2026-10-20', 'lunch', '{}'); assert false, 'bad shift';
  exception when raise_exception then null; end;
  begin perform add_shift_log(gen_random_uuid(), b, '2026-10-20', 'night', '{"mortality":-5}'); assert false, 'negative';
  exception when raise_exception then null; end;
end $$;
rollback;
\echo shift_log_test OK
