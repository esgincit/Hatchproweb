-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/tenant_billing_test.sql
begin;
insert into onboarding_application (business_name, owner_name, phone, farm_types, state, consent, sites)
  values ('Billing Test Farm', 'Test Owner', '+919999000099', '{broiler}', 'Telangana', true, '[{"name":"S","sheds":[{"name":"A","capacity":100}]}]');
set local role authenticated;
-- sales team sees tenants but cannot change plan/status
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","app_metadata":{"roles":["platform_sales"],"platform":true}}';
do $$ begin
  assert (select count(*) from tenant) >= 2, 'platform sees all tenants';
  update tenant set status = 'suspended';
  assert not exists (select 1 from tenant where status = 'suspended'), 'sales cannot suspend';
end $$;
-- finance can
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","app_metadata":{"roles":["platform_finance"],"platform":true}}';
do $$ begin
  update tenant set plan = 'pro' where name = 'VKR Poultry Farms';
  assert (select plan from tenant where name = 'VKR Poultry Farms') = 'pro', 'finance changes plan';
  update onboarding_application set review_note = 'x';
  assert (select count(*) from onboarding_application) >= 1, 'platform sees applications';
  assert not exists (select 1 from onboarding_application where review_note = 'x'), 'finance cannot review applications';
  raise notice 'tenant_billing_test: all assertions passed';
end $$;
rollback;
