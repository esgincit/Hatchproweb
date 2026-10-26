-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/marketplace_test.sql
-- 0032 marketplace: listings start pending; farmers see only approved listings of paid advertisers; payment applies
-- once and must cover the plan; content edits go back to review; leads reach only the listing's vendor.
begin;
insert into auth.users (id, phone) values ('cccccccc-0000-4000-8000-000000000001', '919999000201'), ('cccccccc-0000-4000-8000-000000000002', '919999000202');
insert into advertiser (id, user_id, business_name, phone, category) values
  ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001', 'Test Feeds', '+919999000201', 'feed'),
  ('dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000002', 'Other Vendor', '+919999000202', 'medicine');
set local role authenticated;

-- vendor 1 lists a product (tries to self-approve)
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","app_metadata":{"roles":["vendor"]}}';
insert into product_listing (id, advertiser_id, title, category, status) values ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'Broiler starter crumbs', 'feed', 'approved');
do $$ begin
  assert (select status from product_listing where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'pending', 'vendor self-approved';
  begin insert into product_listing (advertiser_id, title, category) values ('dddddddd-0000-4000-8000-000000000002', 'Not mine', 'feed'); assert false, 'listed for another vendor';
  exception when insufficient_privilege then null; end;
  insert into ad_subscription (id, advertiser_id, plan_id, amount) values ('ffffffff-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'basic', 999);
  update ad_subscription set status = 'active', starts_on = current_date, ends_on = current_date + 30; -- no update policy: no-op
  assert (select status from ad_subscription where id = 'ffffffff-0000-4000-8000-000000000001') = 'pending', 'vendor activated itself';
  begin perform apply_ad_payment('ffffffff-0000-4000-8000-000000000001', 999, 'pay_x'); assert false, 'vendor called payment fn';
  exception when insufficient_privilege then null; end;
end $$;

-- marketing approves
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","app_metadata":{"roles":["platform_marketing"],"platform":true}}';
update product_listing set status = 'approved' where id = 'eeeeeeee-0000-4000-8000-000000000001';

-- farmer (VKR owner): approved but unpaid → hidden
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin assert (select count(*) from product_listing) = 0, 'unpaid listing visible'; end $$;

-- payment (service role, as razorpay-webhook)
set local role service_role;
do $$ begin
  assert apply_ad_payment('ffffffff-0000-4000-8000-000000000001', 999, 'pay_TESTAD1') = 'applied', 'paid';
  assert apply_ad_payment('ffffffff-0000-4000-8000-000000000001', 999, 'pay_TESTAD1') = 'duplicate', 'retry';
  insert into ad_subscription (id, advertiser_id, plan_id, amount) values ('ffffffff-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002', 'featured', 2999);
  assert apply_ad_payment('ffffffff-0000-4000-8000-000000000002', 100, 'pay_TESTAD2') = 'short_payment', 'underpaid';
end $$;
set local role authenticated;

-- farmer now sees it and sends a lead
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert (select count(*) from product_listing) = 1, 'paid+approved listing visible';
  insert into listing_lead (listing_id, contact_name, message) values ('eeeeeeee-0000-4000-8000-000000000001', 'VKR', 'need 50 bags');
end $$;

-- other vendor can't see the lead; vendor 1 can, and an edit sends the listing back to review
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000002","app_metadata":{"roles":["vendor"]}}';
do $$ begin assert (select count(*) from listing_lead) = 0, 'lead leaked to another vendor'; end $$;
set local request.jwt.claims = '{"sub":"cccccccc-0000-4000-8000-000000000001","app_metadata":{"roles":["vendor"]}}';
do $$ begin
  assert (select count(*) from listing_lead) = 1, 'vendor sees its lead';
  update product_listing set title = 'Broiler starter crumbs 50 kg' where id = 'eeeeeeee-0000-4000-8000-000000000001';
  assert (select status from product_listing where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'pending', 'edit kept approval';
end $$;
rollback;
\echo marketplace_test OK
