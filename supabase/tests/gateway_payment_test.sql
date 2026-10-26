-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/gateway_payment_test.sql
-- 0026 apply_gateway_payment: a Razorpay payment is applied once (retries are no-ops); app users can't call it.
begin;
select set_config('t.inv', (select i.id::text from invoice i join tenant t on t.id = i.tenant_id
  where t.name = 'VKR Poultry Farms' and i.status <> 'paid' and i.total - i.paid > 100 limit 1), true);
select set_config('t.paid0', (select paid::text from invoice where id = current_setting('t.inv')::uuid), true);

set local role service_role;
do $$
declare i uuid := current_setting('t.inv')::uuid;
begin
  assert apply_gateway_payment('invoice', i, 100, 'upi', '2026-10-19', 'pay_TEST1') = 'applied', 'first delivery applied';
  assert apply_gateway_payment('invoice', i, 100, 'upi', '2026-10-19', 'pay_TEST1') = 'duplicate', 'retry ignored';
  assert (select count(*) from payment where gateway_ref = 'pay_TEST1') = 1, 'one payment row';
  assert (select paid from invoice where id = i) = current_setting('t.paid0')::numeric + 100, 'paid incremented once';
  assert (select tenant_id from payment where gateway_ref = 'pay_TEST1') = (select tenant_id from invoice where id = i), 'tenant from the invoice';
  assert apply_gateway_payment('invoice', gen_random_uuid(), 100, 'upi', '2026-10-19', 'pay_TEST2') = 'unknown_ref', 'unknown doc';
end $$;

-- a signed-in farm user can't call it (would let them mark their own invoices paid)
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  begin perform apply_gateway_payment('invoice', current_setting('t.inv')::uuid, 1, 'upi', '2026-10-19', 'pay_TEST3'); assert false, 'app user called gateway fn';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
\echo gateway_payment_test OK
