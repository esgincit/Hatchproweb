-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/apply_verify_test.sql
-- 0030: a public application needs a verified, unused, same-phone check (consumed on insert); documents must come
-- from that check's folder; the public can't read checks.
begin;
-- checks the apply-otp function would have created (service role)
insert into apply_phone_check (id, phone, code_hash, expires_at, verified_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '+919999000101', 'x', now() + interval '10 minutes', now()),
  ('aaaaaaaa-0000-4000-8000-000000000002', '+919999000102', 'x', now() + interval '10 minutes', null),          -- never verified
  ('aaaaaaaa-0000-4000-8000-000000000003', '+919999000103', 'x', now() + interval '10 minutes', now() - interval '2 hours'); -- stale

set local role anon;
do $$
declare app jsonb := '[{"name":"S","sheds":[{"name":"A","capacity":100}]}]';
begin
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent)
    values ('x', 'y', '+919999000101', '{broiler}', 'Telangana', app, true); assert false, 'no check';
  exception when sqlstate 'HP401' then null; end;
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id)
    values ('x', 'y', '+919999000199', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000001'); assert false, 'other phone';
  exception when sqlstate 'HP401' then null; end;
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id)
    values ('x', 'y', '+919999000102', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000002'); assert false, 'unverified';
  exception when sqlstate 'HP401' then null; end;
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id)
    values ('x', 'y', '+919999000103', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000003'); assert false, 'stale';
  exception when sqlstate 'HP401' then null; end;
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id, documents)
    values ('x', 'y', '+919999000101', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000001',
            '[{"path":"applications/other/x.pdf","name":"x"}]'); assert false, 'foreign document';
  exception when sqlstate 'HP402' then null; end;
  insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id, documents)
    values ('ok', 'y', '+919999000101', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000001',
            '[{"path":"applications/aaaaaaaa-0000-4000-8000-000000000001/a.pdf","name":"PAN"}]');
  begin insert into onboarding_application (business_name, owner_name, phone, farm_types, state, sites, consent, phone_check_id)
    values ('again', 'y', '+919999000101', '{broiler}', 'Telangana', app, true, 'aaaaaaaa-0000-4000-8000-000000000001'); assert false, 'check reused';
  exception when sqlstate 'HP401' or sqlstate 'P0001' then null; end;
  begin perform 1 from apply_phone_check; assert (select count(*) from apply_phone_check) = 0, 'anon reads checks';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert (select phone_verified from onboarding_application where business_name = 'ok' and phone = '+919999000101'), 'marked verified';
  assert (select used_at is not null from apply_phone_check where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'check consumed';
end $$;
rollback;
\echo apply_verify_test OK
