-- 0043: ERP WP 1.11–1.12 — chick product master, customer tiers, sales orders with temporary reservation, waiting
-- list, deposit slabs, payment verification, price lock, cancellation, and the 12-week availability forecast.
-- Spec: Chick Sales §1–6; plan C1. Every number is a tenant rule (defaults = spec values) — management decisions
-- (deposit, expiry, credit, cancellation) are still pending, so nothing is hard-coded.
--
-- Order states: reserved (temporary hold, expires) | waitlisted -> confirmed (sales review; production reservation;
-- price locked) -> allocated -> dispatched -> delivered -> completed; or expired | cancelled. Never deleted.
-- Payment status: pending | submitted | verified | partial | rejected | waived (no deposit due).

-- ---------------------------------------------------------------- product master (C1)
create table chick_product (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  category text not null check (category in ('broiler','layer','breeder','other')),
  breed_id uuid references breed(id),
  sex text not null default 'mixed' check (sex in ('male','female','mixed','na')),
  grade text check (length(grade) <= 20),
  required_vaccines uuid[] not null default '{}',     -- vaccine_master ids that must cover every chick before dispatch
  price numeric(10,2) check (price >= 0),             -- INR per chick, current list price
  max_dispatch_age_hours int check (max_dispatch_age_hours > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
select apply_std_policies('chick_product', '{tenant_owner,farm_manager,hatchery_manager}', '{tenant_owner,farm_manager,hatchery_manager}', '{tenant_owner}');

alter table batch add column chick_product_id uuid references chick_product(id);
alter table customer add column tier text not null default 'standard' check (tier in ('platinum','gold','standard')),
                     add column delivery_address text check (length(delivery_address) <= 300);

-- ---------------------------------------------------------------- supply: expected/actual saleable chicks per setting
-- planning hatch rate = rule planning_hes_pct, else this tenant's last 10 approved hatches, else 80 %; culls likewise.
create view chick_supply with (security_invoker = true) as
with hist as (
  select tenant_id, avg(hes_pct) as hes, avg(cull_pct) as cull
  from (select k.*, row_number() over (partition by tenant_id order by hatched_on desc) as rn from hatch_kpi k where k.hatch_status = 'approved') x
  where rn <= 10 group by tenant_id
)
select p.tenant_id, p.batch_id, p.code, b.chick_product_id as product_id, p.expected_hatch_on,
       coalesce(k.hatched_on, p.expected_hatch_on) as hatch_on,
       k.hatched_on is not null as hatched,
       case when k.hatched_on is not null then k.saleable
            else floor(p.eggs_set * coalesce(rule_num(p.tenant_id, 'planning_hes_pct', null), h.hes, 80) / 100
                       * (1 - coalesce(rule_num(p.tenant_id, 'planning_cull_pct', null), h.cull, 2) / 100))::int end as saleable
from setting_progress p
join batch b on b.id = p.batch_id
left join hatch_kpi k on k.batch_id = p.batch_id
left join hist h on h.tenant_id = p.tenant_id
where b.closed_on is null and b.chick_product_id is not null;

-- ---------------------------------------------------------------- sales orders
create table sales_order (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  order_no text not null,
  customer_id uuid not null references customer(id),
  product_id uuid not null references chick_product(id),
  qty int not null check (qty > 0),
  hatch_date date not null,                           -- requested hatch / pick-up date
  original_hatch_date date not null,
  suggested_hatch_date date,                          -- waitlisted: next date with space
  price numeric(10,2) not null check (price >= 0),
  price_locked_at timestamptz,
  price_change_reason text check (length(price_change_reason) <= 300),
  deposit_pct numeric(5,2) not null default 0,
  deposit_due numeric(14,2) not null default 0,
  deposit_paid numeric(14,2) not null default 0 check (deposit_paid >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','submitted','verified','partial','rejected','waived')),
  payment_ref text check (length(payment_ref) <= 60),
  payment_proof_path text check (length(payment_proof_path) <= 200),
  payment_verified_by uuid references app_user(id),
  payment_verified_at timestamptz,
  status text not null default 'reserved' check (status in ('reserved','waitlisted','confirmed','allocated','dispatched','delivered','completed','expired','cancelled')),
  reserve_expires_at timestamptz,
  credit_override_reason text check (length(credit_override_reason) <= 300),
  cancel_reason text check (length(cancel_reason) <= 300),
  cancelled_at timestamptz,
  refund_status text not null default 'none' check (refund_status in ('none','pending','refunded','forfeited')),
  notes text check (length(notes) <= 500),
  created_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, order_no)
);
create index sales_order_open on sales_order (tenant_id, product_id, hatch_date) where status in ('reserved','confirmed','allocated');

-- deposit % for an order size: rule deposit_slabs = [{"upto":499,"pct":0},{"upto":5000,"pct":50},{"pct":100}]
create function deposit_pct_for(p_tenant uuid, p_qty int) returns numeric language sql stable as $$
  select coalesce((select (s->>'pct')::numeric from jsonb_array_elements(
      tenant_rule_value(p_tenant, 'deposit_slabs', '[{"upto":499,"pct":0},{"upto":5000,"pct":50},{"pct":100}]')) with ordinality as e(s, i)
    where s->>'upto' is null or p_qty <= (s->>'upto')::int order by i limit 1), 0)
$$;

-- weekly availability per product (12-week view = rows for the next 12 weeks; C1 formula)
create view chick_availability with (security_invoker = true) as
with supply as (
  select tenant_id, product_id, date_trunc('week', hatch_on)::date as week, sum(saleable) as saleable
  from chick_supply group by 1, 2, 3
), demand as (
  select o.tenant_id, o.product_id, date_trunc('week', o.hatch_date)::date as week,
         sum(o.qty) filter (where o.status = 'reserved') as temp_reserved,
         sum(o.qty) filter (where o.status <> 'reserved') as confirmed
  from sales_order o
  where o.status in ('confirmed','allocated','dispatched','delivered','completed') or (o.status = 'reserved' and o.reserve_expires_at > now())
  group by 1, 2, 3
)
select coalesce(s.tenant_id, d.tenant_id) as tenant_id, coalesce(s.product_id, d.product_id) as product_id, coalesce(s.week, d.week) as week,
       coalesce(s.saleable, 0) as expected_saleable, coalesce(d.temp_reserved, 0) as temp_reserved, coalesce(d.confirmed, 0) as confirmed,
       coalesce(s.saleable, 0) - coalesce(d.temp_reserved, 0) - coalesce(d.confirmed, 0) as available
from supply s full join demand d on d.tenant_id = s.tenant_id and d.product_id = s.product_id and d.week = s.week;

create function week_available(p_tenant uuid, p_product uuid, p_day date, p_except uuid) returns int language sql stable as $$
  select (coalesce((select sum(saleable) from chick_supply where tenant_id = p_tenant and product_id = p_product
                     and date_trunc('week', hatch_on) = date_trunc('week', p_day)), 0)
        - coalesce((select sum(qty) from sales_order where tenant_id = p_tenant and product_id = p_product and id <> coalesce(p_except, '00000000-0000-0000-0000-000000000000')
                     and date_trunc('week', hatch_date) = date_trunc('week', p_day)
                     and (status in ('confirmed','allocated','dispatched','delivered','completed') or (status = 'reserved' and reserve_expires_at > now()))), 0))::int
$$;

create function sales_order_check() returns trigger language plpgsql as $$
declare p record; c record; avail int; d date; i int; roles text[] := auth_roles();
        staff boolean := auth.uid() is not null; internal boolean := current_user not in ('authenticated', 'anon');
begin
  select * into p from chick_product where id = new.product_id;
  if not found or p.tenant_id <> new.tenant_id then raise exception 'unknown chick product'; end if;
  select * into c from customer where id = new.customer_id;
  if not found or c.tenant_id <> new.tenant_id then raise exception 'unknown customer'; end if;

  if tg_op = 'INSERT' then
    if not p.active then raise exception 'product % is not on sale', p.name; end if;
    if new.hatch_date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'hatch date is in the past'; end if;
    new.original_hatch_date := new.hatch_date;
    new.price := coalesce(nullif(new.price, 0), p.price, 0);
    new.deposit_pct := deposit_pct_for(new.tenant_id, new.qty);
    new.deposit_due := round(new.qty * new.price * new.deposit_pct / 100, 2);
    new.payment_status := case when new.deposit_due = 0 then 'waived' else 'pending' end;
    new.deposit_paid := 0; new.payment_verified_by := null; new.payment_verified_at := null; new.price_locked_at := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.product_id::text, 4));
    avail := week_available(new.tenant_id, new.product_id, new.hatch_date, new.id);
    if new.qty <= avail then
      new.status := 'reserved';
      new.reserve_expires_at := now() + make_interval(hours => rule_num(new.tenant_id, 'temp_reservation_hours', 24)::int);
    else
      new.status := 'waitlisted'; new.reserve_expires_at := null;
      for i in 1..12 loop
        d := new.hatch_date + 7 * i;
        if week_available(new.tenant_id, new.product_id, d, new.id) >= new.qty then new.suggested_hatch_date := d; exit; end if;
      end loop;
    end if;
    return new;
  end if;

  -- ---- updates
  if (new.customer_id, new.product_id, new.original_hatch_date, new.order_no, new.created_by, new.created_at)
     is distinct from (old.customer_id, old.product_id, old.original_hatch_date, old.order_no, old.created_by, old.created_at) then
    raise exception 'order identity can''t change';
  end if;
  if new.qty <> old.qty and old.status not in ('reserved', 'waitlisted') then raise exception 'quantity is fixed once confirmed'; end if;
  if new.qty <> old.qty then
    new.deposit_pct := deposit_pct_for(new.tenant_id, new.qty);
    new.deposit_due := round(new.qty * new.price * new.deposit_pct / 100, 2);
  end if;

  -- price lock (C1): after confirmation only the owner may change the price, with a reason (audit-logged)
  if new.price <> old.price then
    if old.price_locked_at is not null then
      if staff and not ('tenant_owner' = any (roles)) then raise exception 'price is locked — only the owner can amend it'; end if;
      if coalesce(btrim(new.price_change_reason), '') = '' then raise exception 'give a reason for the price change'; end if;
      perform audit_add(new.tenant_id, 'price_change', 'sales_order', new.id, jsonb_build_object('price', old.price), jsonb_build_object('price', new.price, 'reason', new.price_change_reason));
    end if;
    new.deposit_due := round(new.qty * new.price * new.deposit_pct / 100, 2);
  end if;
  if new.price_locked_at is distinct from old.price_locked_at and not internal then
    new.price_locked_at := old.price_locked_at;
  end if;

  -- payment verification: finance / owner only (segregation from sales)
  if (new.payment_status, new.deposit_paid) is distinct from (old.payment_status, old.deposit_paid) then
    if new.payment_status in ('verified', 'partial', 'rejected') and new.payment_status is distinct from old.payment_status
       or new.deposit_paid <> old.deposit_paid then
      if staff and not (roles && '{tenant_owner,finance}') then raise exception 'only finance or the owner verify payments'; end if;
      new.payment_verified_by := auth.uid(); new.payment_verified_at := now();
    end if;
    if new.payment_status = 'verified' and new.deposit_paid < new.deposit_due then raise exception 'deposit paid is below the % due', new.deposit_due; end if;
    if new.payment_status = 'waived' and old.payment_status <> 'waived' and new.deposit_due > 0 then
      if staff and not ('tenant_owner' = any (roles)) then raise exception 'only the owner can waive a deposit'; end if;
    end if;
  else
    new.payment_verified_by := old.payment_verified_by; new.payment_verified_at := old.payment_verified_at;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'reserved' and old.status = 'waitlisted' then        -- space freed or date moved
      perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.product_id::text, 4));
      if week_available(new.tenant_id, new.product_id, new.hatch_date, new.id) < new.qty then raise exception 'still no space in that week'; end if;
      new.reserve_expires_at := now() + make_interval(hours => rule_num(new.tenant_id, 'temp_reservation_hours', 24)::int);
    elsif new.status = 'confirmed' and old.status = 'reserved' then     -- sales review
      if staff and not (roles && '{tenant_owner,sales_officer,hatchery_manager}') then raise exception 'only sales can confirm orders'; end if;
      if old.reserve_expires_at <= now() then raise exception 'reservation expired'; end if;
      if new.payment_status not in ('verified', 'waived') then
        if c.credit_limit > 0 then
          if (select coalesce(sum(total - paid), 0) from invoice where customer_id = c.id and status <> 'paid') + new.qty * new.price > c.credit_limit
             and coalesce(btrim(new.credit_override_reason), '') = '' then
            raise exception 'over the customer''s credit limit of % — verify payment or give an override reason', c.credit_limit;
          end if;
          if coalesce(btrim(new.credit_override_reason), '') <> '' and staff and not (roles && '{tenant_owner,hatchery_manager}') then
            raise exception 'only the owner or hatchery manager can override credit';
          end if;
        else
          raise exception 'deposit not verified';
        end if;
      end if;
      new.price_locked_at := now();
    elsif new.status = 'expired' and old.status = 'reserved' then
      if old.reserve_expires_at > now() then raise exception 'reservation has not expired'; end if;
    elsif new.status = 'cancelled' and old.status in ('reserved','waitlisted','confirmed','allocated') then
      if coalesce(btrim(new.cancel_reason), '') = '' then raise exception 'give a cancellation reason'; end if;
      if old.status = 'allocated' and staff and not (roles && '{tenant_owner,hatchery_manager}') then
        raise exception 'only the owner or hatchery manager can cancel an allocated order';
      end if;
      if exists (select 1 from order_allocation where order_id = new.id and status = 'approved') then
        raise exception 'release the chick allocation first';
      end if;
      new.cancelled_at := now();
      new.refund_status := case when old.deposit_paid > 0 then 'pending' else 'none' end;
    elsif new.status in ('confirmed','allocated','dispatched','delivered','completed') and internal then
      null;                                                              -- synced by allocation / dispatch triggers (definer code)
    else
      raise exception 'order can''t go from % to %', old.status, new.status;
    end if;
    -- space freed -> tell sales which waitlisted orders could now move in (waiting list, spec §2)
    if new.status in ('expired', 'cancelled') and exists (select 1 from sales_order w where w.tenant_id = new.tenant_id and w.product_id = new.product_id
                                                         and w.status = 'waitlisted' and date_trunc('week', w.hatch_date) = date_trunc('week', new.hatch_date)) then
      perform raise_alert(new.tenant_id, 'info', 'Space freed · ' || p.name,
        format('%s chicks freed for week of %s — waiting-list orders can be offered', new.qty, date_trunc('week', new.hatch_date)::date), 'sales_order', new.id);
    end if;
  elsif new.hatch_date <> old.hatch_date then
    if old.status not in ('reserved', 'waitlisted', 'confirmed') then raise exception 'date is fixed once allocated'; end if;
    if old.status <> 'waitlisted' then
      perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || new.product_id::text, 4));
      if week_available(new.tenant_id, new.product_id, new.hatch_date, new.id) < new.qty then raise exception 'no space in that week'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger sales_order_check before insert or update on sales_order for each row execute function sales_order_check();
-- orders are never deleted (cancel instead): empty delete role list
select apply_std_policies('sales_order', '{tenant_owner,sales_officer,hatchery_manager}',
  '{tenant_owner,sales_officer,hatchery_manager,finance}', '{}');

-- run by cron (service role) — and harmless to run any time: reservations past their window expire
create function expire_reservations() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sales_order set status = 'expired' where status = 'reserved' and reserve_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function expire_reservations() from public, anon, authenticated;

-- order numbers: SO0001 per tenant
create or replace function next_doc_no(kind text) returns text
language plpgsql stable as $$
declare n bigint;
begin
  if kind = 'bill' then
    select coalesce(max(nullif(regexp_replace(bill_no, '\D', '', 'g'), '')::bigint), 0) + 1 into n from bill;
    return 'B' || lpad(n::text, 4, '0');
  elsif kind = 'invoice' then
    select coalesce(max(nullif(regexp_replace(invoice_no, '\D', '', 'g'), '')::bigint), 0) + 1 into n from invoice;
    return 'INV' || lpad(n::text, 4, '0');
  elsif kind = 'order' then
    select coalesce(max(nullif(regexp_replace(order_no, '\D', '', 'g'), '')::bigint), 0) + 1 into n from sales_order;
    return 'SO' || lpad(n::text, 4, '0');
  end if;
  raise exception 'unknown document kind %', kind;
end $$;
