-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/hatchery_test.sql
-- 0025 hatch_record: candling + hatch counts can't exceed eggs set; hatchery batches only; roles; tenant isolation.
begin;
select set_config('t.h', (select id::text from batch where code = 'KS-H-2026-37'), true);            -- 57,600 eggs set 2026-10-04
select set_config('t.br', (select b.id::text from batch b join tenant t on t.id = b.tenant_id where t.name = 'KS Farms' and b.farm_type <> 'hatchery' limit 1), true);
delete from hatch_record where batch_id = current_setting('t.h')::uuid;
set local role authenticated;

-- KS owner
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$
declare h uuid := current_setting('t.h')::uuid; br uuid := current_setting('t.br')::uuid;
begin
  insert into hatch_record (batch_id, candled_on, clears, dead_germ) values (h, '2026-10-11', 4600, 900);
  begin update hatch_record set clears = 57000 where batch_id = h; assert false, 'clears beyond eggs set';
  exception when raise_exception then null; end;
  begin update hatch_record set candled_on = '2026-10-01' where batch_id = h; assert false, 'candled before set';
  exception when raise_exception then null; end;
  begin update hatch_record set hatched_on = '2026-10-25', chicks_a = 48000 where batch_id = h; assert false, 'partial hatch row';
  exception when check_violation then null; end;
  update hatch_record set hatched_on = '2026-10-25', chicks_a = 48000, chicks_b = 1500, culls = 600 where batch_id = h; -- 50,100 ≤ 52,100 fertile
  begin update hatch_record set chicks_a = 52000 where batch_id = h; assert false, 'more chicks than fertile eggs';
  exception when raise_exception then null; end;
  begin insert into hatch_record (batch_id, candled_on, clears, dead_germ) values (br, '2026-10-11', 1, 1); assert false, 'non-hatchery batch';
  exception when raise_exception then null; end;
  assert (select chicks_a + chicks_b from hatch_record where batch_id = h) = 49500, 'hatch saved';
end $$;

-- KS finance: reads, can't change counts
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  assert (select count(*) from hatch_record) = 1, 'finance reads hatch records';
  update hatch_record set culls = 0;
end $$;

-- VKR owner: other tenant
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin assert (select count(*) from hatch_record) = 0, 'cross-tenant read'; end $$;

reset role;
do $$ begin assert (select culls from hatch_record where batch_id = current_setting('t.h')::uuid) = 600, 'finance changed counts'; end $$;
rollback;
\echo hatchery_test OK
