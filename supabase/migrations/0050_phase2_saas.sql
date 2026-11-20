-- 0050: ERP Phase 2 (plan §5 Phase 2 + B4) — module entitlements per plan, branches, preventive-maintenance
-- schedules, credit notes + refunds (C1 approval structure), accounting period lock, support-access grants, and the
-- customer portal (orders, invoices, availability, payment-proof upload) for customer users who are NOT tenant
-- members (no tenant claim => tenant RLS shows them nothing; they read only through the portal_* functions below).

-- ---------------------------------------------------------------- entitlements
-- plan -> modules (Vol 1 editions: starter = Starter, growth = Professional, pro = Enterprise, enterprise = Enterprise Plus).
-- subscription.features.modules (latest row) overrides the plan default when present.
create function tenant_modules(p_tenant uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(s.features -> 'modules')) from subscription s
      where s.tenant_id = p_tenant and s.features ? 'modules' order by s.created_at desc limit 1),
    case (select plan from tenant where id = p_tenant)
      when 'starter' then '{core}'::text[]
      when 'growth' then '{core,breeder,hatchery}'::text[]
      when 'pro' then '{core,breeder,hatchery,sales,dispatch,dashboards}'::text[]
      else '{core,breeder,hatchery,sales,dispatch,dashboards,portal,branches,api}'::text[] end)
$$;
create function auth_has_module(p_module text) returns boolean language sql stable as $$
  select auth_is_platform() or auth.uid() is null or p_module = any (tenant_modules(auth_tenant_id()))
$$;

do $$
declare t text; m text;
begin
  for t, m in select * from (values
    ('breeder_daily','breeder'), ('body_weight_record','breeder'), ('hatching_egg_collection','breeder'),
    ('egg_transfer','hatchery'), ('setting_lot','hatchery'), ('candling','hatchery'), ('hatcher_transfer','hatchery'),
    ('machine_release','hatchery'), ('chick_quality_inspection','hatchery'), ('chick_vaccination','hatchery'),
    ('chick_product','sales'), ('sales_order','sales'), ('order_allocation','sales'), ('doa_claim','sales'),
    ('vehicle','dispatch'), ('dispatch','dispatch'), ('dispatch_line','dispatch')) v(t, m) loop
    execute format('create policy %1$s_module on %1$s as restrictive for insert to authenticated with check (auth_has_module(%2$L))', t, m);
  end loop;
end $$;

-- ---------------------------------------------------------------- branches (optional level, C1)
create table branch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  code text check (length(code) <= 20),
  state text, district text,
  gstin text check (gstin ~ '^[0-9A-Z]{15}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
select apply_std_policies('branch', '{tenant_owner}', '{tenant_owner}', '{tenant_owner}');
create policy branch_module on branch as restrictive for insert to authenticated with check (auth_has_module('branches'));
alter table farm add column branch_id uuid references branch(id);
create trigger farm_branch_tenant before insert or update of branch_id on farm for each row execute function check_same_tenant('branch_id=branch');

-- ---------------------------------------------------------------- preventive maintenance (days and/or setter batches)
create table pm_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  asset_id uuid not null references asset(id) on delete cascade,
  task text not null check (length(task) between 3 and 200),
  every_days int check (every_days > 0),
  every_batches int check (every_batches > 0),
  last_done_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (every_days is not null or every_batches is not null)
);
create trigger pm_schedule_tenant before insert or update on pm_schedule for each row execute function check_same_tenant('asset_id=asset');
select apply_std_policies('pm_schedule', '{tenant_owner,farm_manager,store_keeper,hatchery_ops_manager}', '{tenant_owner,farm_manager,store_keeper,hatchery_ops_manager}', '{tenant_owner,farm_manager}');

create view pm_due with (security_invoker = true) as
select s.tenant_id, s.id as schedule_id, s.asset_id, a.name as asset, s.task, s.last_done_on,
       s.last_done_on + s.every_days as due_on,
       (select count(*) from batch b where b.setter_id = s.asset_id and b.placed_on > s.last_done_on) as batches_since,
       s.every_batches,
       (s.every_days is not null and s.last_done_on + s.every_days <= (now() at time zone 'Asia/Kolkata')::date)
        or (s.every_batches is not null and (select count(*) from batch b where b.setter_id = s.asset_id and b.placed_on > s.last_done_on) >= s.every_batches) as due
from pm_schedule s join asset a on a.id = s.asset_id where s.active;

-- cron (service role): one alert per due schedule per day
create function pm_due_alerts() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from pm_due where due loop
    if not exists (select 1 from notification where entity_type = 'pm_schedule' and entity_id = r.schedule_id
                   and created_at > (now() at time zone 'Asia/Kolkata')::date) then
      insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id)
      values (r.tenant_id, 'alert', 'warning', 'Maintenance due · ' || r.asset, r.task, 'pm_schedule', r.schedule_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function pm_due_alerts() from public, anon, authenticated;

-- ---------------------------------------------------------------- credit notes + refunds (C1: Finance Manager approves;
-- above rule finance_owner_above (default 50,000) only the owner)
create table credit_note (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  note_no text not null,
  customer_id uuid not null references customer(id),
  invoice_id uuid references invoice(id),
  sales_order_id uuid references sales_order(id),
  doa_claim_id uuid references doa_claim(id),
  issued_on date not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(reason) between 3 and 300),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, note_no)
);
create table refund (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  customer_id uuid not null references customer(id),
  sales_order_id uuid references sales_order(id),
  credit_note_id uuid references credit_note(id),
  amount numeric(14,2) not null check (amount > 0),
  mode text not null check (mode in ('upi','neft','cash','cheque')),
  utr text check (length(utr) <= 40),
  paid_on date,
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create function money_doc_check() returns trigger language plpgsql as $$
declare inv record; o record; total_credited numeric;
begin
  if not exists (select 1 from customer where id = new.customer_id and tenant_id = new.tenant_id) then raise exception 'unknown customer'; end if;
  if tg_table_name = 'credit_note' then
    if new.invoice_id is not null then
      select * into inv from invoice where id = new.invoice_id and tenant_id = new.tenant_id and customer_id = new.customer_id;
      if not found then raise exception 'invoice is not this customer''s'; end if;
      select coalesce(sum(amount), 0) into total_credited from credit_note where invoice_id = new.invoice_id and status <> 'rejected' and id <> new.id;
      if total_credited + new.amount > inv.total then raise exception 'credit notes exceed the invoice total of %', inv.total; end if;
    end if;
    if new.doa_claim_id is not null and not exists (select 1 from doa_claim where id = new.doa_claim_id and tenant_id = new.tenant_id and status = 'approved') then
      raise exception 'DOA claim is not approved';
    end if;
    if tg_op = 'INSERT' then new.note_no := coalesce(nullif(new.note_no, ''), 'CN' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDDHH24MISSMS')); end if;
  else
    if new.sales_order_id is not null then
      select * into o from sales_order where id = new.sales_order_id and tenant_id = new.tenant_id and customer_id = new.customer_id;
      if not found then raise exception 'order is not this customer''s'; end if;
      if new.amount > o.deposit_paid - coalesce((select sum(amount) from refund where sales_order_id = o.id and status <> 'rejected' and id <> new.id), 0) then
        raise exception 'refund exceeds the deposit paid';
      end if;
    end if;
    if new.credit_note_id is not null and not exists (select 1 from credit_note where id = new.credit_note_id and tenant_id = new.tenant_id and status = 'approved') then
      raise exception 'credit note is not approved';
    end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved')
     and new.amount > rule_num(new.tenant_id, 'finance_owner_above', 50000)
     and auth.uid() is not null and not (auth_roles() && '{tenant_owner}') then
    raise exception 'amounts above % need the owner''s approval', rule_num(new.tenant_id, 'finance_owner_above', 50000);
  end if;
  return new;
end $$;
create trigger credit_note_check before insert or update on credit_note for each row execute function money_doc_check();
create trigger credit_note_lock before insert or update or delete on credit_note for each row execute function guard_locked('tenant_owner,finance', '', '');
select apply_std_policies('credit_note', '{tenant_owner,finance,sales_officer,hatchery_manager}', '{tenant_owner,finance,sales_officer,hatchery_manager}', '{tenant_owner,finance}');
create trigger refund_check before insert or update on refund for each row execute function money_doc_check();
create trigger refund_lock before insert or update or delete on refund for each row execute function guard_locked('tenant_owner,finance', 'paid_on,utr', '');
select apply_std_policies('refund', '{tenant_owner,finance}', '{tenant_owner,finance}', '{tenant_owner,finance}');

-- an approved refund against an order marks the order refunded (definer: finance can't edit orders' refund flags directly)
create function refund_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status <> 'approved' and new.sales_order_id is not null then
    update sales_order set refund_status = 'refunded' where id = new.sales_order_id and refund_status = 'pending';
  end if;
  return null;
end $$;
create trigger refund_after after update on refund for each row execute function refund_after();

-- customer balance: open invoices minus approved credit notes
create view customer_balance with (security_invoker = true) as
select c.tenant_id, c.id as customer_id, c.name, c.credit_limit,
       coalesce((select sum(total - paid) from invoice i where i.customer_id = c.id and i.status <> 'paid'), 0) as invoices_open,
       coalesce((select sum(amount) from credit_note n where n.customer_id = c.id and n.status = 'approved'), 0) as credits,
       coalesce((select sum(total - paid) from invoice i where i.customer_id = c.id and i.status <> 'paid'), 0)
       - coalesce((select sum(amount) from credit_note n where n.customer_id = c.id and n.status = 'approved'), 0) as balance
from customer c;

-- ---------------------------------------------------------------- accounting period lock (rule books_locked_until = date)
create function period_lock() returns trigger language plpgsql as $$
declare col text := tg_argv[0]; lock date; d_new date; d_old date;
begin
  lock := (tenant_rule_value(coalesce(new.tenant_id, old.tenant_id), 'books_locked_until', 'null') #>> '{}')::date;
  if lock is null then return coalesce(new, old); end if;
  d_new := (to_jsonb(new) ->> col)::date; d_old := (to_jsonb(old) ->> col)::date;
  if d_new <= lock or d_old <= lock then raise exception 'books are closed up to %', lock; end if;
  return coalesce(new, old);
end $$;
do $$
declare t text; c text;
begin
  for t, c in select * from (values ('invoice','invoice_date'), ('bill','bill_date'), ('payment','paid_on'), ('stock_movement','moved_on'),
                                    ('credit_note','issued_on'), ('refund','paid_on')) v(t, c) loop
    execute format('create trigger %1$s_period_lock before insert or update or delete on %1$s for each row execute function period_lock(%2$L)', t, c);
  end loop;
end $$;

-- ---------------------------------------------------------------- support access grants (owner lets support in, with a reason and an end time)
create table support_access_grant (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  reason text not null check (length(reason) between 3 and 300),
  granted_by uuid default auth.uid() references app_user(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '7 days')
);
select apply_std_policies('support_access_grant', '{tenant_owner}', '{tenant_owner}', '{}');
-- the support console asks this before opening a tenant (app-level gate; every view is still audit-logged per 0031)
create function support_access_open(p_tenant uuid) returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform() and exists (select 1 from support_access_grant g where g.tenant_id = p_tenant and g.revoked_at is null and g.expires_at > now())
$$;
revoke all on function support_access_open(uuid) from public, anon;
grant execute on function support_access_open(uuid) to authenticated;

-- ---------------------------------------------------------------- customer portal (Sales §9)
create table customer_portal_user (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenant(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table customer_portal_user enable row level security;
create policy customer_portal_user_self on customer_portal_user for select using (user_id = auth.uid());
create policy customer_portal_user_owner on customer_portal_user
  using (tenant_id = auth_tenant_id() and auth_has_role('tenant_owner')) with check (tenant_id = auth_tenant_id() and auth_has_role('tenant_owner'));
create trigger customer_portal_user_tenant before insert or update on customer_portal_user for each row execute function check_same_tenant('customer_id=customer');

-- alert from definer code with no tenant claim (portal users)
create function raise_alert_internal(p_tenant uuid, p_title text, p_body text, p_entity text) returns void
language sql security definer set search_path = public as $$
  insert into notification (tenant_id, kind, severity, title, body, entity_type) values (p_tenant, 'alert', 'info', left(p_title, 200), left(p_body, 1000), p_entity)
$$;
revoke all on function raise_alert_internal(uuid, text, text, text) from public, anon, authenticated;

create function portal_me() returns setof customer_portal_user language sql stable security definer set search_path = public as $$
  select * from customer_portal_user where user_id = auth.uid()
$$;

create function portal_orders() returns table (order_no text, product text, qty int, hatch_date date, status text, payment_status text,
                                               deposit_due numeric, deposit_paid numeric, price numeric, suggested_hatch_date date)
language sql stable security definer set search_path = public as $$
  select o.order_no, p.name, o.qty, o.hatch_date, o.status, o.payment_status, o.deposit_due, o.deposit_paid, o.price, o.suggested_hatch_date
  from sales_order o join chick_product p on p.id = o.product_id join customer_portal_user u on u.customer_id = o.customer_id
  where u.user_id = auth.uid() order by o.created_at desc
$$;

create function portal_invoices() returns table (invoice_no text, invoice_date date, due_date date, total numeric, paid numeric, status text)
language sql stable security definer set search_path = public as $$
  select i.invoice_no, i.invoice_date, i.due_date, i.total, i.paid, i.status::text
  from invoice i join customer_portal_user u on u.customer_id = i.customer_id where u.user_id = auth.uid() order by i.invoice_date desc
$$;

-- upcoming hatch dates with space (no other customers' names, only totals)
create function portal_availability() returns table (product text, week date, available int)
language sql stable security definer set search_path = public as $$
  select p.name, a.week, greatest(a.available, 0)::int
  from chick_availability a join chick_product p on p.id = a.product_id join customer_portal_user u on u.tenant_id = a.tenant_id
  where u.user_id = auth.uid() and p.active and a.week >= date_trunc('week', now())::date and a.week < now() + interval '12 weeks'
  order by p.name, a.week
$$;

-- customer uploads payment proof (file already in storage) -> sales/finance see 'submitted'
create function portal_submit_payment(p_order_no text, p_ref text, p_proof_path text) returns void
language plpgsql security definer set search_path = public as $$
declare u record;
begin
  select * into u from customer_portal_user where user_id = auth.uid();
  if not found then raise exception 'not a customer portal user'; end if;
  if not ('portal' = any (tenant_modules(u.tenant_id))) then raise exception 'portal is not enabled'; end if;
  if length(coalesce(p_ref, '')) not between 4 and 60 then raise exception 'enter the payment reference'; end if;
  update sales_order set payment_status = 'submitted', payment_ref = p_ref, payment_proof_path = left(p_proof_path, 200)
   where order_no = p_order_no and customer_id = u.customer_id and tenant_id = u.tenant_id and payment_status in ('pending', 'rejected', 'partial');
  if not found then raise exception 'order not found or payment already verified'; end if;
  perform raise_alert_internal(u.tenant_id, 'Payment proof · ' || p_order_no, 'ref ' || p_ref, 'sales_order');
end $$;

revoke all on function portal_me(), portal_orders(), portal_invoices(), portal_availability(), portal_submit_payment(text, text, text) from public, anon;
grant execute on function portal_me(), portal_orders(), portal_invoices(), portal_availability(), portal_submit_payment(text, text, text) to authenticated;
