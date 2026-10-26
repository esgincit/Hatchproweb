-- 0032: vendor marketplace (roadmap Phase 12 — "whoever pays advertises").
-- advertiser = a vendor login (auth user with role 'vendor', created by the platform marketing team via invite-vendor).
-- A listing is shown to farmers only when the platform approved it AND its advertiser has a paid, unexpired plan.
-- Plans are paid through Razorpay (ad-checkout → razorpay-webhook → apply_ad_payment, idempotent per payment id).
create table advertiser (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null check (length(business_name) between 2 and 120),
  phone text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  category text not null check (category in ('feed', 'medicine', 'vaccine', 'equipment', 'chicks', 'transport', 'services', 'other')),
  district text, state text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table ad_plan (
  id text primary key,
  name text not null,
  price_month numeric(10,2) not null check (price_month > 0),
  max_listings int not null check (max_listings > 0),
  featured boolean not null default false,
  active boolean not null default true
);
insert into ad_plan (id, name, price_month, max_listings, featured) values
  ('basic', 'Basic', 999, 5, false), ('featured', 'Featured', 2999, 20, true);

create table ad_subscription (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertiser(id) on delete cascade,
  plan_id text not null references ad_plan(id),
  amount numeric(10,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'active')),
  starts_on date, ends_on date,
  gateway_order text unique, gateway_ref text unique,
  created_at timestamptz not null default now()
);

create table product_listing (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertiser(id) on delete cascade,
  title text not null check (length(title) between 3 and 120),
  category text not null check (category in ('feed', 'medicine', 'vaccine', 'equipment', 'chicks', 'transport', 'services', 'other')),
  description text check (length(description) <= 1000),
  price_text text check (length(price_text) <= 60),
  area text check (length(area) <= 120),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table listing_lead (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references product_listing(id) on delete cascade,
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  contact_name text, contact_phone text,
  message text check (length(message) <= 500),
  created_at timestamptz not null default now()
);

create function my_advertiser() returns uuid language sql stable security definer set search_path = public as $$
  select id from advertiser where user_id = auth.uid() and status = 'active'
$$;
-- an advertiser with a paid plan covering today
create function advertiser_paid(p_adv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ad_subscription s where s.advertiser_id = p_adv and s.status = 'active' and current_date between s.starts_on and s.ends_on)
$$;

-- vendors can't approve their own listings: content edits go back to review; status changes need the marketing team
create function listing_guard() returns trigger language plpgsql as $$
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role')
     or (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}') then
    new.updated_at := now(); return new;
  end if;
  new.status := 'pending'; new.review_note := null; new.updated_at := now();
  if tg_op = 'INSERT' and (select count(*) from product_listing where advertiser_id = new.advertiser_id)
       >= coalesce((select max(p.max_listings) from ad_subscription s join ad_plan p on p.id = s.plan_id
                    where s.advertiser_id = new.advertiser_id and s.status = 'active' and current_date between s.starts_on and s.ends_on), 5) then
    raise exception 'listing limit for your plan reached' using errcode = 'HP451';
  end if;
  return new;
end $$;
create trigger listing_guard before insert or update on product_listing for each row execute function listing_guard();

-- Razorpay (razorpay-webhook) → activate/extend 30 days, once per payment id; amount must cover the plan
create function apply_ad_payment(p_subscription uuid, p_amount numeric, p_gateway_ref text)
returns text language plpgsql security definer set search_path = public as $$
declare s record; base date;
begin
  select s2.*, p.price_month into s from ad_subscription s2 join ad_plan p on p.id = s2.plan_id where s2.id = p_subscription for update of s2;
  if not found then return 'unknown_ref'; end if;
  if exists (select 1 from ad_subscription where gateway_ref = p_gateway_ref) then return 'duplicate'; end if;
  if s.status = 'active' then return 'duplicate'; end if;
  if p_amount + 0.005 < s.price_month then return 'short_payment'; end if;
  base := greatest(current_date, coalesce((select max(ends_on) + 1 from ad_subscription where advertiser_id = s.advertiser_id and status = 'active'), current_date));
  update ad_subscription set status = 'active', gateway_ref = p_gateway_ref, starts_on = base, ends_on = base + 29 where id = p_subscription;
  return 'applied';
end $$;
revoke all on function apply_ad_payment(uuid, numeric, text) from public, anon, authenticated;
grant execute on function apply_ad_payment(uuid, numeric, text) to service_role;

alter table advertiser enable row level security;
alter table ad_plan enable row level security;
alter table ad_subscription enable row level security;
alter table product_listing enable row level security;
alter table listing_lead enable row level security;
-- marketing = platform admin / marketing team (lib/auth/permissions.ts TEAM.marketing)
create policy advertiser_read on advertiser for select to authenticated using (
  user_id = auth.uid() or (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}')
  or (auth_tenant_id() is not null and status = 'active'));
create policy advertiser_marketing on advertiser for all to authenticated
  using (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}')
  with check (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}');
create policy ad_plan_read on ad_plan for select to authenticated using (true);
create policy ad_sub_read on ad_subscription for select to authenticated using (
  advertiser_id = my_advertiser() or (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing,platform_finance}'));
-- vendors open a pending order for themselves; only apply_ad_payment (service role) can activate it
create policy ad_sub_insert on ad_subscription for insert to authenticated with check (advertiser_id = my_advertiser() and status = 'pending' and gateway_ref is null);
create policy listing_vendor on product_listing for all to authenticated
  using (advertiser_id = my_advertiser()) with check (advertiser_id = my_advertiser());
create policy listing_marketing on product_listing for all to authenticated
  using (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}')
  with check (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}');
create policy listing_farmers on product_listing for select to authenticated using (
  auth_tenant_id() is not null and status = 'approved' and advertiser_paid(advertiser_id));
create policy lead_farmer_insert on listing_lead for insert to authenticated with check (
  tenant_id = auth_tenant_id() and user_id = auth.uid() and (select auth_tenant_active())
  and exists (select 1 from product_listing l where l.id = listing_lead.listing_id));
create policy lead_read on listing_lead for select to authenticated using (
  tenant_id = auth_tenant_id()
  or exists (select 1 from product_listing l where l.id = listing_lead.listing_id and l.advertiser_id = my_advertiser())
  or (auth_is_platform() and auth_roles() && '{platform_admin,platform_marketing}'));
