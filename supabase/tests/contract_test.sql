-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/contract_test.sql
-- 0029 contract farming: owner adds terms, links a batch, settles once (growing-charge invoice to the integrator);
-- settlements can't be repeated or edited; non-money roles can't settle; terms can't point at another tenant's customer.
begin;
select set_config('t.cust', (select id::text from customer where name = 'SKR Integrators Pvt. Ltd.'), true);
select set_config('t.vkrcust', (select c.id::text from customer c join tenant t on t.id = c.tenant_id where t.name = 'VKR Poultry Farms' limit 1), true);
select set_config('t.b', (select id::text from batch where code = 'KS-B-2026-21'), true);
set local role authenticated;

-- KS owner
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$
declare c uuid; b uuid := current_setting('t.b')::uuid; no text;
begin
  insert into contract (customer_id, name, base_rate, std_fcr, fcr_bonus, fcr_penalty, min_rate, allowed_mort_pct, mort_penalty)
    values (current_setting('t.cust')::uuid, 'test terms', 6.5, 1.7, 0.1, 0.1, 4, 5, 20) returning id into c;
  perform set_config('t.c', c::text, true);
  begin insert into contract (customer_id, name, base_rate, std_fcr) values (current_setting('t.vkrcust')::uuid, 'x', 6, 1.7); assert false, 'other tenant customer';
  exception when insufficient_privilege then null; end;
  begin perform record_settlement(b, '2026-10-19', 9400, 21620, 35700, 600, 1.651, 7, 2000, 149340); assert false, 'settled without contract';
  exception when raise_exception then null; end;
  update batch set contract_id = c where id = b;
  no := record_settlement(b, '2026-10-19', 9400, 21620, 35700, 600, 1.651, 7, 2000, 149340);
  assert (select total from invoice where invoice_no = no) = 149340, 'growing-charge invoice = net';
  assert (select customer_id from invoice where invoice_no = no) = current_setting('t.cust')::uuid, 'invoiced to the integrator';
  assert (select product from invoice where invoice_no = no) = 'gc', 'product gc';
  begin perform record_settlement(b, '2026-10-19', 1, 1, 1, 0, 1, 1, 0, 1); assert false, 'settled twice';
  exception when raise_exception then null; end;
  update contract_settlement set net = 1 where batch_id = b; -- refused silently by policy
  assert (select net from contract_settlement where batch_id = b) = 149340, 'settlement edited';
end $$;

-- KS supervisor: can't write settlements (no money role) — refused by row security before any key check
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["shed_supervisor"]}}';
do $$ begin
  begin insert into contract_settlement (batch_id, contract_id, settled_on, lifted_birds, lifted_kg, feed_kg, dead, fcr, rate, mort_charge, net)
    values (current_setting('t.b')::uuid, current_setting('t.c')::uuid, '2026-10-19', 1, 1, 1, 0, 1, 1, 0, 1); assert false, 'supervisor settled';
  exception when insufficient_privilege then null; end;
end $$;

-- VKR owner sees none of it
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin assert (select count(*) from contract) + (select count(*) from contract_settlement) = 0, 'cross-tenant read'; end $$;
rollback;
\echo contract_test OK
