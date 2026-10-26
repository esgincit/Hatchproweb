-- 0023: alerts + web push (roadmap Phase 10).
-- 1. notification.dedupe_key: daily-alerts upserts on (tenant_id, dedupe_key), so a re-run the same day adds nothing.
-- 2. notification joins supabase_realtime: the app pops new alerts as toasts while open (RLS still scopes events).
-- 3. push_subscription: one row per browser/phone that allowed notifications. A user sees and manages only their
--    own; daily-alerts (service role) reads them to send Web Push.
alter table notification add column dedupe_key text;
create unique index notification_dedupe on notification (tenant_id, dedupe_key);
-- Only the alert job (service role) may set the key: any tenant member can insert notifications, and a planted
-- key for tomorrow (e.g. 'spike:<batch>:<date>') would silently suppress that real alert.
create function notification_dedupe_guard() returns trigger language plpgsql as $$
begin
  if current_user not in ('postgres', 'service_role') then
    if tg_op = 'INSERT' then new.dedupe_key := null; else new.dedupe_key := old.dedupe_key; end if;
  end if;
  return new;
end $$;
create trigger notification_dedupe_guard before insert or update on notification
  for each row execute function notification_dedupe_guard();

alter publication supabase_realtime add table notification;

create table push_subscription (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  user_id uuid not null default auth.uid() references app_user(id) on delete cascade,
  -- browser push services only: daily-alerts POSTs to this URL, so an arbitrary host would be SSRF
  -- (same allowlist re-checked in supabase/functions/daily-alerts before every send)
  endpoint text not null unique check (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscription_tenant on push_subscription (tenant_id);

alter table push_subscription enable row level security;
create policy push_subscription_own on push_subscription
  using (user_id = auth.uid() and tenant_id = auth_tenant_id())
  with check (user_id = auth.uid() and tenant_id = auth_tenant_id());

-- same suspension lock as every other tenant table (0017)
create policy push_subscription_active_ins on push_subscription as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy push_subscription_active_upd on push_subscription as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy push_subscription_active_del on push_subscription as restrictive for delete to authenticated using ((select auth_tenant_active()));
