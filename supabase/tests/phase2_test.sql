-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/phase2_test.sql
-- 0050: plan modules, PM due alerts, credit note owner threshold, period lock, support grants, customer portal.
begin;
delete from tenant_rule where tenant_id = 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; -- test runs on rule defaults (rolled back)
delete from subscription where tenant_id in ('b146bf5d-6213-556e-8e71-8d4c156ad36d', '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c'); -- plan defaults (rolled back)
do $$
declare ks uuid := 'b146bf5d-6213-556e-8e71-8d4c156ad36d'; hat uuid := '72c46a7d-d72c-5676-bc8a-70c996df7088'; a uuid; p uuid; c uuid; pu uuid := gen_random_uuid();
begin
  insert into asset (tenant_id, farm_id, name, category) values (ks, hat, 'Generator 1', 'generator') returning id into a;
  insert into chick_product (tenant_id, name, category, price) values (ks, 'Portal DOC', 'broiler', 40) returning id into p;
  insert into customer (tenant_id, name) values (ks, 'Portal Buyer') returning id into c;
  insert into sales_order (tenant_id, order_no, customer_id, product_id, qty, hatch_date, price) values (ks, 'SO-P1', c, p, 1000, current_date + 30, 0);
  insert into auth.users (id, email, aud, role) values (pu, 'portal-test@example.invalid', 'authenticated', 'authenticated');
  insert into customer_portal_user (user_id, tenant_id, customer_id) values (pu, ks, c);
  perform set_config('t.a', a::text, true), set_config('t.pu', pu::text, true), set_config('t.inv', (select id::text from invoice where tenant_id = ks order by invoice_date limit 1), true),
          set_config('t.cust', (select customer_id::text from invoice where tenant_id = ks order by invoice_date limit 1), true);
  delete from notification where tenant_id = ks;
end $$;
set local role authenticated;

-- entitlements: VKR is on 'growth' (no sales module)
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  begin insert into chick_product (name, category) values ('VKR DOC', 'broiler'); assert false, 'growth plan used sales';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into subscription (tenant_id, plan, status, features) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'growth', 'active', '{"modules":["core","sales"]}');
set local role authenticated;
insert into chick_product (name, category) values ('VKR DOC', 'broiler');                -- add-on module granted

-- KS owner: PM schedule, rules
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
insert into pm_schedule (asset_id, task, every_days, last_done_on) values (current_setting('t.a')::uuid, 'Oil + filter change', 30, current_date - 40);
do $$ begin assert (select due from pm_due where asset_id = current_setting('t.a')::uuid), 'pm due'; end $$;
reset role;
do $$ begin
  assert pm_due_alerts() >= 1, 'pm alert';
end $$;
do $$ begin
  assert pm_due_alerts() = 0, 'pm alert once a day';
end $$;
set local role authenticated;

-- finance: credit notes within threshold; above it only the owner
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ declare inv uuid := current_setting('t.inv')::uuid; cu uuid := current_setting('t.cust')::uuid;
begin
  insert into credit_note (customer_id, invoice_id, issued_on, amount, reason) values (cu, inv, current_date, 100, 'rate correction');
  update credit_note set status = 'approved' where amount = 100 and customer_id = cu;
  insert into refund (customer_id, amount, mode, paid_on) values (cu, 60000, 'neft', current_date);
  begin update refund set status = 'approved' where customer_id = cu; assert false, 'finance approved above threshold';
  exception when raise_exception then null; end;
  assert (select credits from customer_balance where customer_id = cu) = 100, 'balance nets credit';
end $$;

-- period lock: books closed to 31 Oct -> no back-dated sale
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
insert into tenant_rule (key, value) values ('books_locked_until', '"2026-10-31"');
do $$ begin
  begin perform create_sale(current_setting('t.cust')::uuid, 'egg', 10, 'egg', 5, '2026-10-15'); assert false, 'sale in closed period';
  exception when raise_exception then null; end;
  perform create_sale(current_setting('t.cust')::uuid, 'egg', 10, 'egg', 5, '2026-11-05');
  insert into support_access_grant (reason, expires_at) values ('help with GST report', now() + interval '1 day');
  begin insert into support_access_grant (reason, expires_at) values ('forever', now() + interval '30 days'); assert false, 'grant > 7 days';
  exception when check_violation then null; end;
end $$;

-- platform support: only tenants that granted access
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000aa01","app_metadata":{"platform":true,"roles":["platform_support"]}}';
do $$ begin
  assert support_access_open('b146bf5d-6213-556e-8e71-8d4c156ad36d') and not support_access_open('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c'), 'support grant';
end $$;

-- customer portal user: no tenant claim -> sees nothing directly, own orders via portal functions
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.pu'), 'app_metadata', json_build_object())::text, true);
do $$ begin
  assert (select count(*) from sales_order) = 0 and (select count(*) from invoice) = 0 and (select count(*) from customer) = 0, 'portal user sees no tables';
  assert (select count(*) from portal_orders()) = 1 and (select order_no from portal_orders()) = 'SO-P1', 'own orders';
  begin perform portal_submit_payment('SO-P1', 'UTR777', 'proof/p.jpg'); assert false, 'portal not on plan';
  exception when raise_exception then null; end;
end $$;
reset role;
insert into subscription (tenant_id, plan, status, features) values ('b146bf5d-6213-556e-8e71-8d4c156ad36d', 'pro', 'active',
  '{"modules":["core","breeder","hatchery","sales","dispatch","dashboards","portal"]}');
set local role authenticated;
do $$ begin
  perform portal_submit_payment('SO-P1', 'UTR777', 'proof/p.jpg');
  assert (select payment_status from portal_orders() where order_no = 'SO-P1') = 'submitted', 'proof submitted';
  begin perform portal_submit_payment('SO-OTHER', 'UTR777', 'x'); assert false, 'paid someone else''s order';
  exception when raise_exception then null; end;
end $$;

-- 0056: owner links a signed-up customer login by email; staff logins and other roles are refused
reset role;
insert into auth.users (id, email, aud, role, email_confirmed_at) values ('00000000-0000-0000-0000-0000000005a2', 'Portal-Two@example.invalid', 'authenticated', 'authenticated', now()),
  ('00000000-0000-0000-0000-0000000005a3', 'unconfirmed@example.invalid', 'authenticated', 'authenticated', null);
select set_config('t.staffmail', (select u.email from auth.users u join app_user a on a.id = u.id where u.email is not null limit 1), true);
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
set local role authenticated;
do $$ begin
  perform link_portal_user(current_setting('t.cust')::uuid, ' portal-two@example.invalid ');
  assert (select customer_id from customer_portal_user where user_id = '00000000-0000-0000-0000-0000000005a2') = current_setting('t.cust')::uuid, 'linked';
  begin perform link_portal_user(current_setting('t.cust')::uuid, current_setting('t.staffmail')); assert false, 'linked a staff login';
  exception when raise_exception then null; end;
  begin perform link_portal_user(current_setting('t.cust')::uuid, 'nobody@example.invalid'); assert false, 'linked unknown email';
  exception when raise_exception then null; end;
  begin perform link_portal_user(current_setting('t.cust')::uuid, 'unconfirmed@example.invalid'); assert false, 'linked unconfirmed email';
  exception when raise_exception then null; end;
end $$;
set local request.jwt.claims = '{"sub":"e6ba8ba8-f28f-568d-86d6-09dc87b5cb59","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["finance"]}}';
do $$ begin
  begin perform link_portal_user(current_setting('t.cust')::uuid, 'portal-two@example.invalid'); assert false, 'finance linked';
  exception when raise_exception then null; end;
end $$;
rollback;
\echo phase2_test OK
