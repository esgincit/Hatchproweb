-- 0052: ERP Phase 4 (intelligence) + Phase 5 (ecosystem) groundwork.
-- Phase 4 needs months of pilot data to be useful; these are transparent statistics over the tenant's OWN history
-- (no external model): anomaly z-scores, hatch rate by flock age, demand trend. They return nothing until enough
-- history exists. Phase 5: outbound webhooks (outbox written by triggers, delivered by the webhook-dispatch edge
-- function) — inbound sensor readings and the read API live in edge functions keyed by api_key (0051).

-- ---------------------------------------------------------------- security review of 0051
-- 1. PO status could jump draft/submitted -> partial/closed (skipping approval): explicit transition whitelist; every
--    GRN by a signed-in user must point at a purchase order.
-- 2. an approved PO's total / lines could grow past the approval threshold afterwards: refused.
-- 3. a delegation outlived the delegator losing the role: effective_roles() requires the delegator to still hold it.
create or replace function po_threshold() returns trigger language plpgsql as $$
declare lim numeric := (tenant_rule_value(new.tenant_id, 'po_approval_above', 'null') #>> '{}')::numeric;
begin
  if tg_op = 'INSERT' then
    if lim is not null and new.total > lim and new.status = 'approved' then new.status := 'submitted'; end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (old.status::text || '>' || new.status::text = any (
       '{draft>submitted,draft>cancelled,submitted>draft,submitted>approved,submitted>cancelled,approved>partial,approved>closed,approved>cancelled,partial>closed,partial>partial}'::text[])) then
    raise exception 'purchase order can''t go from % to %', old.status, new.status;
  end if;
  if old.status in ('draft', 'submitted') and new.status = 'approved'
     and auth.uid() is not null and not (effective_roles() && '{tenant_owner,procurement_officer}') then
    raise exception 'only the owner or procurement officer can approve purchase orders';
  end if;
  if old.status in ('approved', 'partial', 'closed') and new.total > old.total and lim is not null and new.total > lim then
    raise exception 'an approved purchase order can''t grow past % — raise a new one', lim;
  end if;
  return new;
end $$;

create function po_line_lock() returns trigger language plpgsql as $$
declare po record; lines numeric;
begin
  select * into po from purchase_order where id = coalesce(new.po_id, old.po_id);
  if po.status in ('partial', 'closed', 'cancelled') then raise exception 'purchase order lines are locked'; end if;
  if po.status = 'approved' then
    select coalesce(sum(qty * rate * (1 + gst_pct / 100)), 0) into lines from po_line where po_id = po.id and id <> coalesce(new.id, -1);
    if tg_op <> 'DELETE' and lines + new.qty * new.rate * (1 + new.gst_pct / 100) > po.total + 0.01 then
      raise exception 'lines would exceed the approved total of %', po.total;
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger po_line_lock before insert or update or delete on po_line for each row execute function po_line_lock();

create or replace function grn_needs_approved_po() returns trigger language plpgsql as $$
begin
  if new.move_type = 'grn' and current_user in ('authenticated', 'anon') and (new.ref_type is distinct from 'purchase_order' or new.ref_id is null) then
    raise exception 'goods receipts must reference a purchase order';
  end if;
  if new.move_type = 'grn' and new.ref_type = 'purchase_order'
     and not exists (select 1 from purchase_order where id = new.ref_id and status in ('approved', 'partial')) then
    raise exception 'purchase order is not approved';
  end if;
  return new;
end $$;

create or replace function effective_roles() returns text[] language sql stable security definer set search_path = public as $$
  select auth_roles() || coalesce((select array_agg(distinct r) from approval_delegation d, unnest(d.roles) r
                                    where d.to_user = auth.uid() and d.tenant_id = auth_tenant_id() and d.revoked_at is null
                                      and now() between d.starts_at and d.ends_at
                                      and exists (select 1 from user_role_assignment ura
                                                  where ura.user_id = d.from_user and ura.tenant_id = d.tenant_id and ura.role::text = r)), '{}')
$$;

-- ---------------------------------------------------------------- anomalies (z-score vs the batch's previous 14 days)
create view mortality_anomaly with (security_invoker = true) as
with d as (
  select tenant_id, batch_id, log_date, mortality::numeric as dead from daily_shed_log
  union all select tenant_id, batch_id, log_date, (female_mort + male_mort)::numeric from breeder_daily
), s as (
  select d.*, avg(dead) over w as mean14, stddev_samp(dead) over w as sd14, count(*) over w as n
  from d window w as (partition by batch_id order by log_date rows between 14 preceding and 1 preceding)
)
select tenant_id, batch_id, log_date, dead, round(mean14, 1) as mean14, round(sd14, 2) as sd14,
       round((dead - mean14) / nullif(sd14, 0), 2) as z_score
from s where n >= 7 and sd14 > 0 and (dead - mean14) / sd14 >= 3;

create view egg_drop_anomaly with (security_invoker = true) as
with s as (
  select e.*, avg(hen_day_pct) over w as mean7, count(*) over w as n
  from flock_egg_day e window w as (partition by batch_id order by collected_on rows between 7 preceding and 1 preceding)
)
select tenant_id, batch_id, collected_on, hen_day_pct, round(mean7, 2) as mean7, round(hen_day_pct - mean7, 2) as drop_points
from s where n >= 5 and hen_day_pct < mean7 - rule_num(tenant_id, 'egg_drop_alert_points', 5);

-- ---------------------------------------------------------------- hatch rate by source-flock age (planning aid)
create view flock_age_hes with (security_invoker = true) as
select fb.tenant_id, b.breed_id, ((fb.set_on - b.placed_on) / 7)::int as flock_age_week,
       count(*) as settings, sum(fb.eggs_set) as eggs_set,
       round(sum(fb.hes_pct * fb.eggs_set) / nullif(sum(fb.eggs_set), 0), 2) as hes_pct,
       round(sum(fb.fertility_pct * fb.eggs_set) / nullif(sum(fb.eggs_set), 0), 2) as fertility_pct
from flock_hatch_feedback fb join batch b on b.id = fb.flock_id
where fb.hatched_on is not null and not fb.estimated
group by fb.tenant_id, b.breed_id, ((fb.set_on - b.placed_on) / 7)::int;

-- ---------------------------------------------------------------- demand trend (orders per product per week + slope)
create view demand_trend with (security_invoker = true) as
with w as (
  select tenant_id, product_id, date_trunc('week', hatch_date)::date as week, sum(qty) as chicks
  from sales_order where status not in ('cancelled', 'expired') and hatch_date >= current_date - 84
  group by 1, 2, 3
)
select tenant_id, product_id, count(*) as weeks, round(avg(chicks)) as avg_weekly,
       round(regr_slope(chicks, extract(epoch from week) / 604800)::numeric, 1) as chicks_per_week_trend,
       round(avg(chicks) + regr_slope(chicks, extract(epoch from week) / 604800)::numeric * 4) as projected_4w
from w group by tenant_id, product_id having count(*) >= 4;

-- ---------------------------------------------------------------- outbound webhooks
create table webhook_subscription (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  url text not null check (url ~ '^https://[^\s/$.?#][^\s]*$' and length(url) <= 300),
  events text[] not null check (events <@ '{order.status,dispatch.status}'::text[] and cardinality(events) > 0),
  secret text not null check (length(secret) >= 32),             -- HMAC signing key: shown once, never selectable by clients
  active boolean not null default true,
  created_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now()
);
select apply_std_policies('webhook_subscription', '{tenant_owner}', '{tenant_owner}', '{tenant_owner}');
create policy webhook_subscription_module on webhook_subscription as restrictive for insert to authenticated with check (auth_has_module('api'));
revoke select, insert, update on webhook_subscription from anon, authenticated;
grant select (id, tenant_id, url, events, active, created_by, created_at) on webhook_subscription to authenticated;
grant update (active) on webhook_subscription to authenticated;

create function create_webhook(p_url text, p_events text[]) returns text language plpgsql security definer set search_path = public, extensions as $$
declare s text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not (auth_roles() && '{tenant_owner}') or not auth_tenant_active() or not auth_has_module('api') then raise exception 'not allowed'; end if;
  insert into webhook_subscription (tenant_id, url, events, secret, created_by) values (auth_tenant_id(), p_url, p_events, s, auth.uid());
  return s;
end $$;
revoke all on function create_webhook(text, text[]) from public, anon;
grant execute on function create_webhook(text, text[]) to authenticated;

create table webhook_outbox (
  id bigserial primary key,
  tenant_id uuid not null references tenant(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index webhook_outbox_pending on webhook_outbox (next_attempt_at) where delivered_at is null;
alter table webhook_outbox enable row level security;
create policy webhook_outbox_read on webhook_outbox for select using (tenant_id = auth_tenant_id() and auth_has_role('tenant_owner'));
revoke insert, update, delete on webhook_outbox from anon, authenticated;

create function webhook_enqueue() returns trigger language plpgsql security definer set search_path = public as $$
declare ev text; body jsonb;
begin
  if new.status is not distinct from old.status then return null; end if;
  ev := case tg_table_name when 'sales_order' then 'order.status' else 'dispatch.status' end;
  if not exists (select 1 from webhook_subscription s where s.tenant_id = new.tenant_id and s.active and ev = any (s.events)) then return null; end if;
  body := case tg_table_name
    when 'sales_order' then jsonb_build_object('order_no', to_jsonb(new) ->> 'order_no', 'qty', (to_jsonb(new) ->> 'qty')::int, 'hatch_date', to_jsonb(new) ->> 'hatch_date')
    else jsonb_build_object('dispatch_no', to_jsonb(new) ->> 'dispatch_no', 'dispatched_at', to_jsonb(new) ->> 'dispatched_at', 'delivered_at', to_jsonb(new) ->> 'delivered_at') end
    || jsonb_build_object('status', new.status, 'previous', old.status, 'at', now());
  insert into webhook_outbox (tenant_id, event, payload) values (new.tenant_id, ev, body);
  return null;
end $$;
create trigger sales_order_webhook after update of status on sales_order for each row execute function webhook_enqueue();
create trigger dispatch_webhook after update of status on dispatch for each row execute function webhook_enqueue();
