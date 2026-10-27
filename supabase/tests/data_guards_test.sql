-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/data_guards_test.sql
-- 0033: daily-log sanity (closed batch, before placement, future, deaths > birds, min > max temp) and hatchery chick stock.
begin;
select set_config('t.open', (select id::text from batch where code = 'VKR-B-2026-14'), true);
select set_config('t.closed', (select id::text from batch where code = 'VKR-B-2026-13'), true);
select set_config('t.placed', (select placed_on::text from batch where code = 'VKR-B-2026-14'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$
declare o uuid := current_setting('t.open')::uuid; c uuid := current_setting('t.closed')::uuid;
  today date := (now() at time zone 'Asia/Kolkata')::date; placed date := current_setting('t.placed')::date;
begin
  -- allowed: a normal log and a normal mortality entry on an open batch
  perform save_daily_log(o, today - 1, '{"mortality":3,"culls":1,"feed_kg":100,"tmin":24,"tmax":31,"rh":60}');
  perform record_mortality(o, today - 1, 2);
  begin perform save_daily_log(c, today - 1, '{"mortality":1}'); assert false, 'log on closed batch';
  exception when sqlstate 'HP461' then null; end;
  begin perform record_mortality(c, today - 1, 1); assert false, 'mortality on closed batch';
  exception when sqlstate 'HP461' then null; end;
  begin perform save_daily_log(o, placed - 1, '{"mortality":1}'); assert false, 'log before placement';
  exception when sqlstate 'HP462' then null; end;
  begin perform save_daily_log(o, today + 1, '{"mortality":1}'); assert false, 'future log';
  exception when sqlstate 'HP463' then null; end;
  begin perform save_daily_log(o, today - 1, '{"mortality":999999}'); assert false, 'more deaths than birds';
  exception when sqlstate 'HP464' then null; end;
  begin perform record_mortality(o, today - 1, 999999); assert false, 'mortality event beyond birds';
  exception when sqlstate 'HP464' then null; end;
  begin perform save_daily_log(o, today - 1, '{"mortality":1,"tmin":35,"tmax":20}'); assert false, 'min > max temp';
  exception when sqlstate 'HP465' then null; end;
  begin perform save_daily_log(o, today - 1, '{"mortality":1,"rh":140}'); assert false, 'humidity > 100';
  exception when sqlstate 'HP465' then null; end;
end $$;

-- hatchery: dispatch only what hatched
reset role;
select set_config('t.h', (select id::text from batch where code = 'KS-H-2026-37'), true);
select set_config('t.cust', (select c.id::text from customer c join tenant t on t.id = c.tenant_id where t.name = 'KS Farms' limit 1), true);
delete from hatch_record where batch_id = current_setting('t.h')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$
declare h uuid := current_setting('t.h')::uuid; cu uuid := current_setting('t.cust')::uuid;
begin
  begin perform create_sale(cu, 'doc', 100, 'chick', 30, '2026-10-26', h); assert false, 'dispatch before hatch';
  exception when sqlstate 'HP466' then null; end;
  insert into hatch_record (batch_id, candled_on, clears, dead_germ, hatched_on, chicks_a, chicks_b, culls) values (h, '2026-10-11', 4600, 900, '2026-10-25', 48000, 1500, 600);
  perform create_sale(cu, 'doc', 49000, 'chick', 30, '2026-10-26', h);           -- ok
  begin perform create_sale(cu, 'doc', 501, 'chick', 30, '2026-10-26', h); assert false, 'oversold';  -- 500 left
  exception when sqlstate 'HP466' then assert sqlerrm = 'only 500 chicks left in stock for this setting', 'whole-number message: ' || sqlerrm; end;  -- 0034
  perform create_sale(cu, 'doc', 500, 'chick', 30, '2026-10-26', h);             -- exactly the rest: ok
end $$;
rollback;
\echo data_guards_test OK
