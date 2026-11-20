-- 0045: ERP WP 1.13–1.14 — chick allocation (sales proposes, Hatchery Manager approves; no auto-approval under
-- shortage; partial allocation), vehicles, dispatch (loading gates: approved allocation, chick age, required
-- vaccines, payment/credit), dispatch confirmation by Hatchery Ops Manager -> invoices at dispatch (C1 invoice
-- milestone; tax rate is a rule until the GST treatment is confirmed), delivery / POD, DOA claims, and the one-click
-- delivery trace (Hatchery spec §12).

-- ---------------------------------------------------------------- allocation
create table order_allocation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  order_id uuid not null references sales_order(id),
  batch_id uuid not null references batch(id),
  qty int not null check (qty > 0),
  note text check (length(note) <= 300),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','released')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (order_id, batch_id)
);

alter table invoice add column dispatch_line_id uuid unique;   -- FK added below, once dispatch_line exists

-- chicks committed per setting: open/approved allocations + direct (non-dispatch) DOC invoices
create function chicks_committed(p_batch uuid, p_except uuid) returns int language sql stable as $$
  select (coalesce((select sum(qty) from order_allocation where batch_id = p_batch and status in ('submitted','approved') and id <> coalesce(p_except, '00000000-0000-0000-0000-000000000000')), 0)
        + coalesce((select sum(qty) from invoice where batch_id = p_batch and product = 'doc' and dispatch_line_id is null), 0))::int
$$;

create function order_allocation_check() returns trigger language plpgsql as $$
declare o record; s record; used int; ordered int;
begin
  select * into o from sales_order where id = new.order_id;
  if not found or o.tenant_id <> new.tenant_id then raise exception 'unknown order'; end if;
  select * into s from chick_stock where batch_id = new.batch_id;
  if not found or s.tenant_id <> new.tenant_id then raise exception 'setting has no recorded hatch'; end if;
  if (select chick_product_id from batch where id = new.batch_id) is distinct from o.product_id then raise exception 'setting hatches a different product'; end if;
  if new.status in ('submitted', 'approved', 'draft') then
    if o.status not in ('confirmed', 'allocated') then raise exception 'order must be confirmed by sales first'; end if;
    perform pg_advisory_xact_lock(hashtextextended(new.batch_id::text, 5));
    perform pg_advisory_xact_lock(hashtextextended(new.order_id::text, 5));
    used := chicks_committed(new.batch_id, new.id);
    if used + new.qty > s.saleable then
      raise exception 'only % chicks left in % (over-allocation blocked)', s.saleable - used, s.code;
    end if;
    select coalesce(sum(qty), 0) into ordered from order_allocation where order_id = new.order_id and status in ('submitted','approved') and id <> new.id;
    if ordered + new.qty > o.qty then raise exception 'order needs only % more chicks', o.qty - ordered; end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') and not s.quality_ok then
    raise exception 'chick quality for % is not approved for dispatch', s.code;
  end if;
  return new;
end $$;
create trigger order_allocation_check before insert or update on order_allocation for each row execute function order_allocation_check();
-- C1: Sales & Coordination proposes, Hatchery Manager gives the final approval; an approved allocation can only be released
create trigger order_allocation_lock before insert or update or delete on order_allocation for each row
  execute function guard_locked('tenant_owner,hatchery_manager', '', 'approved>released');
select apply_std_policies('order_allocation', '{tenant_owner,sales_officer,hatchery_manager}', '{tenant_owner,sales_officer,hatchery_manager}', '{tenant_owner,sales_officer,hatchery_manager}');

-- shortage helper: who should get chicks first (tier, then booking time) — a recommendation; approval stays manual
create view allocation_queue with (security_invoker = true) as
select o.tenant_id, o.id as order_id, o.order_no, o.customer_id, c.name as customer, c.tier, o.product_id, o.hatch_date, o.qty,
       coalesce((select sum(qty) from order_allocation a where a.order_id = o.id and a.status in ('submitted','approved')), 0) as allocated,
       o.qty - coalesce((select sum(qty) from order_allocation a where a.order_id = o.id and a.status in ('submitted','approved')), 0) as open_qty,
       row_number() over (partition by o.tenant_id, o.product_id, date_trunc('week', o.hatch_date)
                          order by case c.tier when 'platinum' then 1 when 'gold' then 2 else 3 end, o.created_at) as priority
from sales_order o join customer c on c.id = o.customer_id
where o.status in ('confirmed', 'allocated');

-- chick stock now nets allocations (same columns + allocated appended)
create or replace view chick_stock with (security_invoker = true) as
select k.tenant_id, k.batch_id, k.code, k.hatched_on, k.saleable,
       extract(epoch from (now() - (k.hatched_on::timestamp at time zone 'Asia/Kolkata'))) / 3600 as age_hours,
       q.status as quality_status, coalesce(q.dispatch_eligible and q.status = 'approved', false) as quality_ok,
       v.vaccines, v.min_vaccinated,
       coalesce(v.vaccines > 0 and v.min_vaccinated >= k.saleable, false) as vaccinated_all,
       coalesce(s.sold, 0) as sold,
       (k.saleable - chicks_committed(k.batch_id, null))::numeric as available,
       coalesce(a.allocated, 0) as allocated
from hatch_kpi k
left join chick_quality_inspection q on q.batch_id = k.batch_id
left join (select batch_id, count(*) as vaccines, min(n) as min_vaccinated
           from (select batch_id, vaccine_id, sum(qty) as n from chick_vaccination group by batch_id, vaccine_id) x group by batch_id) v on v.batch_id = k.batch_id
left join (select batch_id, sum(qty) as sold from invoice where product = 'doc' and batch_id is not null and dispatch_line_id is null group by batch_id) s on s.batch_id = k.batch_id
left join (select batch_id, sum(qty) as allocated from order_allocation where status in ('submitted','approved') group by batch_id) a on a.batch_id = k.batch_id
where k.hatched_on is not null;

-- direct DOC invoices (old one-step sale) respect allocations too
create or replace function chick_dispatch_guard() returns trigger language plpgsql as $$
declare h record; used int;
begin
  if new.product <> 'doc' or new.batch_id is null or new.dispatch_line_id is not null then return new; end if;
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role') then return new; end if;
  select b.farm_type, r.chicks_a, r.chicks_b into h from batch b left join hatch_record r on r.batch_id = b.id where b.id = new.batch_id;
  if h.farm_type <> 'hatchery' then return new; end if;
  if h.chicks_a is null then raise exception 'record the hatch results before dispatching chicks' using errcode = 'HP466'; end if;
  used := chicks_committed(new.batch_id, null) - coalesce((select qty from invoice where id = new.id and dispatch_line_id is null), 0)::int;
  if used + new.qty > h.chicks_a + coalesce(h.chicks_b, 0) then
    raise exception 'only % chicks left in stock for this setting', (h.chicks_a + coalesce(h.chicks_b, 0) - used)::bigint using errcode = 'HP466';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- fleet
create table vehicle (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  reg_no text not null check (length(reg_no) between 4 and 20),
  ownership text not null default 'own' check (ownership in ('own','hired')),
  capacity_boxes int check (capacity_boxes > 0),               -- chick boxes (~100 chicks each)
  temp_controlled boolean not null default false,
  fitness_expiry date, insurance_expiry date, permit_expiry date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, reg_no)
);
select apply_std_policies('vehicle', '{tenant_owner,farm_manager,dispatch_officer,hatchery_ops_manager}', '{tenant_owner,farm_manager,dispatch_officer,hatchery_ops_manager}', '{tenant_owner}');

-- ---------------------------------------------------------------- dispatch (trip) + lines
-- status: draft (planning/loading) -> submitted (loaded) -> approved (dispatch confirmed: stamped, invoiced)
--         -> delivered (POD) -> completed.
create table dispatch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  dispatch_no text not null,
  vehicle_id uuid not null references vehicle(id),
  driver_worker_id uuid references worker(id),
  driver_name text check (length(driver_name) <= 80),
  route text check (length(route) <= 200),
  planned_on date not null,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  receiver_name text check (length(receiver_name) <= 80),
  pod_path text check (length(pod_path) <= 200),                -- photo/signature in storage
  delivery_note text check (length(delivery_note) <= 500),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','delivered','completed')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, dispatch_no),
  check (driver_worker_id is not null or driver_name is not null)
);

create table dispatch_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  dispatch_id uuid not null references dispatch(id) on delete cascade,
  allocation_id uuid not null references order_allocation(id),
  qty_loaded int not null check (qty_loaded > 0),
  boxes int check (boxes > 0),
  age_override_reason text check (length(age_override_reason) <= 300),
  qty_delivered int check (qty_delivered >= 0),
  qty_short int check (qty_short >= 0),
  qty_doa int check (qty_doa >= 0),                             -- dead on arrival, counted at delivery
  created_at timestamptz not null default now(),
  unique (dispatch_id, allocation_id),
  check (coalesce(qty_delivered, 0) + coalesce(qty_short, 0) <= qty_loaded),
  check (coalesce(qty_doa, 0) <= coalesce(qty_delivered, 0))
);
alter table invoice add constraint invoice_dispatch_line_fk foreign key (dispatch_line_id) references dispatch_line(id);

-- order status follows its allocations / dispatches (definer: sales_order_check lets internal code move status)
create function sync_order_status(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare o record; alloc int; loaded int; delivered int; open_lines int; not_done int; target text;
begin
  select * into o from sales_order where id = p_order;
  if o.status in ('cancelled', 'expired', 'completed') then return; end if;
  select coalesce(sum(qty), 0) into alloc from order_allocation where order_id = p_order and status = 'approved';
  select coalesce(sum(l.qty_loaded) filter (where d.status in ('approved','delivered','completed')), 0),
         coalesce(sum(l.qty_loaded) filter (where d.status in ('delivered','completed')), 0),
         count(*) filter (where d.status not in ('delivered','completed')),
         count(*) filter (where d.status <> 'completed')
    into loaded, delivered, open_lines, not_done
    from dispatch_line l join dispatch d on d.id = l.dispatch_id join order_allocation a on a.id = l.allocation_id where a.order_id = p_order;
  target := case when delivered > 0 and not_done = 0 and delivered >= alloc and alloc >= o.qty then 'completed'
                 when delivered > 0 and open_lines = 0 and delivered >= alloc and alloc >= o.qty then 'delivered'
                 when loaded > 0 then 'dispatched'
                 when alloc > 0 then 'allocated'
                 else 'confirmed' end;
  if target <> o.status and o.status in ('confirmed','allocated','dispatched','delivered') then
    update sales_order set status = target where id = p_order;
  end if;
end $$;
revoke all on function sync_order_status(uuid) from public, anon, authenticated;
create function order_allocation_sync() returns trigger language plpgsql security definer set search_path = public as $$
begin perform sync_order_status(coalesce(new.order_id, old.order_id)); return null; end $$;
create trigger order_allocation_sync after insert or update or delete on order_allocation for each row execute function order_allocation_sync();

create function dispatch_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from vehicle where id = new.vehicle_id and tenant_id = new.tenant_id and active) then raise exception 'unknown or inactive vehicle'; end if;
  if new.driver_worker_id is not null and not exists (select 1 from worker where id = new.driver_worker_id and tenant_id = new.tenant_id) then raise exception 'unknown driver'; end if;
  if tg_op = 'INSERT' then new.dispatch_no := coalesce(nullif(new.dispatch_no, ''), 'DSP' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDDHH24MISSMS')); end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'submitted' and not exists (select 1 from dispatch_line where dispatch_id = new.id) then raise exception 'load at least one order'; end if;
    if new.status = 'approved' then new.dispatched_at := now(); end if;
    if new.status = 'delivered' then
      if exists (select 1 from dispatch_line where dispatch_id = new.id and qty_delivered is null) then raise exception 'enter delivered quantities for every order'; end if;
      if coalesce(btrim(new.receiver_name), '') = '' then raise exception 'name the person who received the chicks'; end if;
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  end if;
  return new;
end $$;
create trigger dispatch_check before insert or update on dispatch for each row execute function dispatch_check();
-- C1: Dispatch Team prepares, Hatchery Ops Manager confirms the dispatch; POD fields fill in afterwards
create trigger dispatch_lock before insert or update or delete on dispatch for each row
  execute function guard_locked('tenant_owner,hatchery_ops_manager', 'delivered_at,receiver_name,pod_path,delivery_note,dispatched_at', 'approved>delivered,delivered>completed');
select apply_std_policies('dispatch', '{tenant_owner,dispatch_officer,hatchery_ops_manager}', '{tenant_owner,dispatch_officer,hatchery_ops_manager}', '{tenant_owner,dispatch_officer,hatchery_ops_manager}');

create function dispatch_line_check() returns trigger language plpgsql as $$
declare d record; a record; o record; c record; p record; s record; loaded int; max_h numeric; missing text;
begin
  select * into d from dispatch where id = coalesce(new.dispatch_id, old.dispatch_id);
  if tg_op = 'DELETE' then
    if d.status not in ('draft', 'submitted', 'rejected') then raise exception 'dispatch already confirmed'; end if;
    return old;
  end if;
  if d.tenant_id <> new.tenant_id then raise exception 'unknown dispatch'; end if;
  -- after confirmation only the delivery counts may be filled in (while the trip is out)
  if d.status not in ('draft', 'submitted', 'rejected') then
    if tg_op = 'INSERT' or (new.allocation_id, new.qty_loaded, new.boxes, new.age_override_reason) is distinct from (old.allocation_id, old.qty_loaded, old.boxes, old.age_override_reason) then
      raise exception 'dispatch already confirmed';
    end if;
    if d.status <> 'approved' and (new.qty_delivered, new.qty_short, new.qty_doa) is distinct from (old.qty_delivered, old.qty_short, old.qty_doa) then
      raise exception 'delivery already recorded';
    end if;
    return new;
  end if;
  if new.qty_delivered is not null or new.qty_short is not null or new.qty_doa is not null then raise exception 'record delivery after dispatch'; end if;
  select * into a from order_allocation where id = new.allocation_id;
  if not found or a.tenant_id <> new.tenant_id or a.status <> 'approved' then raise exception 'allocation is not approved'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id::text, 6));
  select coalesce(sum(qty_loaded), 0) into loaded from dispatch_line where allocation_id = a.id and id <> new.id;
  if loaded + new.qty_loaded > a.qty then raise exception 'only % chicks of this allocation left to load', a.qty - loaded; end if;
  select * into o from sales_order where id = a.order_id;
  select * into c from customer where id = o.customer_id;
  select * into p from chick_product where id = o.product_id;
  select * into s from chick_stock where batch_id = a.batch_id;
  -- payment gate (C1): verified/waived deposit, or a credit customer / approved credit override
  if o.payment_status not in ('verified', 'waived') and not (c.credit_limit > 0) and coalesce(btrim(o.credit_override_reason), '') = '' then
    raise exception 'payment for order % is not verified', o.order_no;
  end if;
  -- required vaccines cover every chick of the setting
  select string_agg(vm.name, ', ') into missing from unnest(p.required_vaccines) rv(id) join vaccine_master vm on vm.id = rv.id
   where coalesce((select sum(qty) from chick_vaccination v where v.batch_id = a.batch_id and v.vaccine_id = rv.id), 0) < s.saleable;
  if missing is not null then raise exception 'not every chick has: %', missing; end if;
  -- chick age at loading (C1: configurable per product; override needs a reason + owner / hatchery ops manager)
  max_h := coalesce(p.max_dispatch_age_hours, rule_num(new.tenant_id, 'max_dispatch_age_hours', 72));
  if s.age_hours > max_h then
    if coalesce(btrim(new.age_override_reason), '') = '' then raise exception 'chicks are % h old (limit % h) — give an override reason', round(s.age_hours), max_h; end if;
    if auth.uid() is not null and not (auth_roles() && '{tenant_owner,hatchery_ops_manager}') then
      raise exception 'only the owner or hatchery operations manager can dispatch over-age chicks';
    end if;
  end if;
  return new;
end $$;
create trigger dispatch_line_check before insert or update or delete on dispatch_line for each row execute function dispatch_line_check();
select apply_std_policies('dispatch_line', '{tenant_owner,dispatch_officer,hatchery_ops_manager}', '{tenant_owner,dispatch_officer,hatchery_ops_manager}', '{tenant_owner,dispatch_officer,hatchery_ops_manager}');

-- dispatch confirmed -> one invoice per line (rate = locked order price; GST % = rule doc_gst_pct, default 0 pending
-- the tax advisor); order statuses follow. Definer: dispatch staff don't write invoices directly.
create function dispatch_after() returns trigger language plpgsql security definer set search_path = public as $$
declare l record; gst numeric; no text; o uuid;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    gst := rule_num(new.tenant_id, 'doc_gst_pct', 0);
    for l in select dl.id, dl.qty_loaded, a.batch_id, so.customer_id, so.price, b.farm_id, coalesce(cu.credit_days, 0) as credit_days
               from dispatch_line dl join order_allocation a on a.id = dl.allocation_id join sales_order so on so.id = a.order_id
               join batch b on b.id = a.batch_id join customer cu on cu.id = so.customer_id
              where dl.dispatch_id = new.id loop
      perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 7));
      select 'INV' || lpad((coalesce(max(nullif(regexp_replace(invoice_no, '\D', '', 'g'), '')::bigint), 0) + 1)::text, 4, '0') into no
        from invoice where tenant_id = new.tenant_id;
      insert into invoice (tenant_id, farm_id, customer_id, invoice_no, invoice_date, due_date, product, qty, unit, rate, gst_pct, total, batch_id, dispatch_line_id)
      values (new.tenant_id, l.farm_id, l.customer_id, no, (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date + l.credit_days,
              'doc', l.qty_loaded, 'chick', l.price, gst, round(l.qty_loaded * l.price * (1 + gst / 100), 2), l.batch_id, l.id);
    end loop;
  end if;
  if new.status is distinct from old.status then
    for o in select distinct a.order_id from dispatch_line dl join order_allocation a on a.id = dl.allocation_id where dl.dispatch_id = new.id loop
      perform sync_order_status(o);
    end loop;
  end if;
  return null;
end $$;
create trigger dispatch_after after update on dispatch for each row execute function dispatch_after();

-- ---------------------------------------------------------------- dead-on-arrival claims (C1; policy values pending)
create table doa_claim (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  dispatch_line_id uuid not null references dispatch_line(id),
  reported_on date not null,
  qty int not null check (qty > 0),
  evidence_path text check (length(evidence_path) <= 200),
  customer_note text check (length(customer_note) <= 500),
  resolution text check (resolution in ('replace','credit_note','none')),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create function doa_claim_check() returns trigger language plpgsql as $$
declare l record; d record; claimed int;
begin
  select * into l from dispatch_line where id = new.dispatch_line_id;
  if not found or l.tenant_id <> new.tenant_id then raise exception 'unknown delivery'; end if;
  select * into d from dispatch where id = l.dispatch_id;
  if d.status not in ('delivered', 'completed') then raise exception 'claims come after delivery'; end if;
  if new.reported_on > (d.delivered_at at time zone 'Asia/Kolkata')::date + rule_num(new.tenant_id, 'doa_claim_days', 2)::int then
    raise exception 'claim window (% days) has passed', rule_num(new.tenant_id, 'doa_claim_days', 2);
  end if;
  select coalesce(sum(qty), 0) into claimed from doa_claim where dispatch_line_id = new.dispatch_line_id and status <> 'rejected' and id <> new.id;
  if claimed + new.qty > l.qty_delivered then raise exception 'claims exceed the % chicks delivered', l.qty_delivered; end if;
  if new.status = 'approved' and new.resolution is null then raise exception 'choose a resolution'; end if;
  return new;
end $$;
create trigger doa_claim_check before insert or update on doa_claim for each row execute function doa_claim_check();
create trigger doa_claim_lock before insert or update or delete on doa_claim for each row
  execute function guard_locked('tenant_owner,hatchery_manager', 'resolution', '');
select apply_std_policies('doa_claim', '{tenant_owner,sales_officer,dispatch_officer,hatchery_manager}', '{tenant_owner,sales_officer,hatchery_manager}', '{tenant_owner,sales_officer,hatchery_manager}');

-- ---------------------------------------------------------------- one-click trace from a delivery back to the farm
create view delivery_trace with (security_invoker = true) as
select dl.tenant_id, d.id as dispatch_id, d.dispatch_no, d.dispatched_at, d.delivered_at, d.receiver_name, v.reg_no as vehicle,
       coalesce(w.name, d.driver_name) as driver, so.order_no, c.name as customer, dl.qty_loaded, dl.qty_delivered, dl.qty_doa,
       a.batch_id, k.code as setting_code, k.hatched_on, k.hes_pct, k.hatch_of_transfer_pct,
       (select string_agg(distinct vm.name || ' lot ' || cv.vaccine_lot || ' exp ' || cv.expiry, '; ')
          from chick_vaccination cv join vaccine_master vm on vm.id = cv.vaccine_id where cv.batch_id = a.batch_id) as vaccines,
       st.transfer_ref, st.flock_code, st.laid_from, st.laid_to, round(st.share * dl.qty_loaded) as chicks_from_source, st.estimated
from dispatch_line dl
join dispatch d on d.id = dl.dispatch_id
join vehicle v on v.id = d.vehicle_id
left join worker w on w.id = d.driver_worker_id
join order_allocation a on a.id = dl.allocation_id
join sales_order so on so.id = a.order_id
join customer c on c.id = so.customer_id
left join hatch_kpi k on k.batch_id = a.batch_id
left join setting_trace st on st.batch_id = a.batch_id;
