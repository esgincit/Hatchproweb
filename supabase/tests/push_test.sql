-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/push_test.sql
-- 0023: push subscriptions are private to their user; notification dedupe key blocks same-day duplicates.
begin;
set local role authenticated;

-- VKR owner subscribes a phone
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
insert into push_subscription (endpoint, p256dh, auth) values ('https://fcm.googleapis.com/fcm/send/test-owner', 'k', 'a');
do $$ begin
  assert (select count(*) from push_subscription) = 1, 'owner sees own subscription';
  begin insert into push_subscription (endpoint, p256dh, auth, user_id) values ('https://fcm.googleapis.com/fcm/send/other', 'k', 'a', '8817e673-99a9-53c8-9f77-28599a17f0f5'); assert false, 'subscribed someone else';
  exception when insufficient_privilege then null; end;
  -- only real push services (the alert job POSTs to this URL — anything else would be SSRF)
  begin insert into push_subscription (endpoint, p256dh, auth) values ('http://fcm.googleapis.com/fcm/send/x', 'k', 'a'); assert false, 'non-https endpoint';
  exception when check_violation then null; end;
  begin insert into push_subscription (endpoint, p256dh, auth) values ('https://169.254.169.254/latest', 'k', 'a'); assert false, 'internal host';
  exception when check_violation then null; end;
  begin insert into push_subscription (endpoint, p256dh, auth) values ('https://fcm.googleapis.com.evil.test/x', 'k', 'a'); assert false, 'look-alike host';
  exception when check_violation then null; end;
  insert into push_subscription (endpoint, p256dh, auth) values ('https://web.push.apple.com/QGx', 'k', 'a'); -- Safari / iPhone
  delete from push_subscription where endpoint like 'https://web.push.apple.com/%';
end $$;

-- VKR finance (same tenant): cannot see or delete the owner's phone
set local request.jwt.claims = '{"sub":"8817e673-99a9-53c8-9f77-28599a17f0f5","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["finance"]}}';
do $$ begin
  assert (select count(*) from push_subscription) = 0, 'finance sees owner subscription';
  delete from push_subscription;
end $$;

-- a tenant member can't plant or move a dedupe key (would suppress the real alert job's row)
insert into notification (tenant_id, kind, severity, title, dedupe_key) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'info', 'info', 'planted', 'spike:x:2026-10-20');
update notification set dedupe_key = 'spike:y:2026-10-20' where title = 'planted';

reset role;
do $$ begin
  assert (select count(*) from push_subscription where endpoint like '%test-owner') = 1, 'finance delete removed nothing';
  assert (select dedupe_key from notification where title = 'planted') is null, 'client set a dedupe key';
end $$;

-- dedupe: same tenant + key twice → one row
insert into notification (tenant_id, kind, severity, title, dedupe_key) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'alert', 'warning', 't', 'test:x:2026-10-19') on conflict (tenant_id, dedupe_key) do nothing;
insert into notification (tenant_id, kind, severity, title, dedupe_key) values ('4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', 'alert', 'warning', 't', 'test:x:2026-10-19') on conflict (tenant_id, dedupe_key) do nothing;
do $$ begin assert (select count(*) from notification where dedupe_key = 'test:x:2026-10-19') = 1, 'duplicate alert'; end $$;
rollback;
\echo push_test OK
