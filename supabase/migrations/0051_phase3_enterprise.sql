-- 0051: ERP Phase 3 (plan §5 Phase 3 + B4) — purchase requisitions + PO approval threshold, stock counts with
-- approved adjustments, store-to-store transfers in transit, supplier KPIs, receivables ageing, approval delegation,
-- tenant API keys (hash only), accounting export log. C1 approval structure: PR -> department/store manager,
-- PO -> procurement manager / authorised approver, stock adjustment -> store manager (+ owner above a value).

-- ---------------------------------------------------------------- security review of 0050: tenant_modules(p_tenant)
-- was callable for any tenant (plan disclosure). It is internal now; auth_has_module (definer) answers for the
-- caller's own tenant only. Unknown plans get core only; enterprise is explicit.
create or replace function tenant_modules(p_tenant uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(s.features -> 'modules')) from subscription s
      where s.tenant_id = p_tenant and s.features ? 'modules' order by s.created_at desc limit 1),
    case (select plan from tenant where id = p_tenant)
      when 'starter' then '{core}'::text[]
      when 'growth' then '{core,breeder,hatchery}'::text[]
      when 'pro' then '{core,breeder,hatchery,sales,dispatch,dashboards}'::text[]
      when 'enterprise' then '{core,breeder,hatchery,sales,dispatch,dashboards,portal,branches,api}'::text[]
      else '{core}'::text[] end)
$$;
revoke all on function tenant_modules(uuid) from public, anon, authenticated;
create or replace function auth_has_module(p_module text) returns boolean language sql stable security definer set search_path = public as $$
  select auth_is_platform() or auth.uid() is null or p_module = any (tenant_modules(auth_tenant_id()))
$$;

-- ---------------------------------------------------------------- approval delegation
-- a user may hand their approver roles to a colleague for a period (leave cover); guard_locked + role checks that
-- go through effective_roles() honour it.
create table approval_delegation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  from_user uuid not null default auth.uid() references app_user(id),
  to_user uuid not null references app_user(id),
  roles text[] not null check (cardinality(roles) between 1 and 6),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  reason text not null check (length(reason) between 3 and 200),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '60 days'),
  check (from_user <> to_user)
);
create function delegation_check() returns trigger language plpgsql as $$
begin
  -- you can only delegate roles you hold yourself, inside your own tenant
  if auth.uid() is not null and (new.from_user <> auth.uid() or not (new.roles <@ auth_roles())) then
    raise exception 'you can only delegate your own roles';
  end if;
  if not exists (select 1 from app_user where id = new.to_user and tenant_id = new.tenant_id) then raise exception 'unknown colleague'; end if;
  if 'tenant_owner' = any (new.roles) then raise exception 'ownership can''t be delegated'; end if;
  return new;
end $$;
create trigger delegation_check before insert or update on approval_delegation for each row execute function delegation_check();
select apply_std_policies('approval_delegation', '{tenant_owner,farm_manager,hatchery_manager,hatchery_ops_manager,finance,procurement_officer,store_keeper}',
  '{tenant_owner,farm_manager,hatchery_manager,hatchery_ops_manager,finance,procurement_officer,store_keeper}', '{}');

create function effective_roles() returns text[] language sql stable security definer set search_path = public as $$
  select auth_roles() || coalesce((select array_agg(distinct r) from approval_delegation d, unnest(d.roles) r
                                    where d.to_user = auth.uid() and d.tenant_id = auth_tenant_id() and d.revoked_at is null
                                      and now() between d.starts_at and d.ends_at), '{}')
$$;

-- guard_locked: approver check uses effective_roles() (delegation); everything else as 0040
create or replace function guard_locked() returns trigger language plpgsql security definer set search_path = public as $$
declare
  approvers text[] := string_to_array(tg_argv[0], ',');
  gen text[] := array(select attname::text from pg_attribute where attrelid = tg_relid and attgenerated <> '' and attnum > 0);
  free text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}') || '{status,updated_at}'::text[] || gen;
  moves text[] := coalesce(string_to_array(nullif(tg_argv[2], ''), ','), '{}');
  open_states text[] := '{draft,submitted,rejected}';
  stamps text[] := '{submitted_by,approved_by,approved_at,reject_reason}';
  o jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then raise exception '% must start as draft or submitted', tg_table_name; end if;
    return jsonb_populate_record(new, jsonb_build_object('approved_by', null, 'approved_at', null)
      || case when auth.uid() is not null then jsonb_build_object('submitted_by', auth.uid()) else '{}' end);
  end if;
  if tg_op = 'DELETE' then
    if not (old.status = any (open_states)) then raise exception '% is approved and locked', tg_table_name; end if;
    return old;
  end if;

  o := to_jsonb(old);
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if old.status not in ('draft', 'submitted') then raise exception '% is not awaiting approval', tg_table_name; end if;
    if (to_jsonb(new) - free - stamps) <> (o - free - stamps) then
      raise exception 'save changes before approving %', tg_table_name;
    end if;
    if auth.uid() is not null and not (effective_roles() && approvers) then
      raise exception 'only % can approve %', array_to_string(approvers, ' / '), tg_table_name;
    end if;
    if new.status = 'approved' and auth.uid() = old.submitted_by
       and not (tenant_rule_value(old.tenant_id, 'allow_self_approval', 'true'))::boolean then
      raise exception 'the person who submitted % cannot approve it', tg_table_name;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then
      raise exception 'a reason is required to reject';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('approved_by', auth.uid(), 'approved_at', now(), 'submitted_by', o->'submitted_by'));
    perform audit_add(old.tenant_id, new.status, tg_table_name, old.id, o, to_jsonb(new));
    return new;
  end if;

  if not (old.status = any (open_states)) then
    if (to_jsonb(new) - free) <> (o - free)
       or (new.status is distinct from old.status and not (old.status || '>' || new.status = any (moves))) then
      raise exception '% is approved and locked', tg_table_name;
    end if;
    if new.status is distinct from old.status then
      perform audit_add(old.tenant_id, new.status, tg_table_name, old.id, o, to_jsonb(new));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and not (new.status = any (open_states)) then
    raise exception '% must be approved before it can be %', tg_table_name, new.status;
  end if;
  return jsonb_populate_record(new, jsonb_build_object('approved_by', o->'approved_by', 'approved_at', o->'approved_at',
    'submitted_by', case when auth.uid() is not null
                          and ((to_jsonb(new) - free - stamps) <> (o - free - stamps) or (new.status = 'submitted' and old.status <> 'submitted'))
                         then to_jsonb(auth.uid()) else o->'submitted_by' end));
end $$;
revoke all on function guard_locked() from public, anon, authenticated;

-- ---------------------------------------------------------------- purchase requisitions -> PO
create table purchase_requisition (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  farm_id uuid not null references farm(id),
  item_id uuid not null references item(id),
  qty numeric(12,2) not null check (qty > 0),
  needed_by date,
  est_rate numeric(12,2) check (est_rate >= 0),
  purpose text check (length(purpose) <= 300),
  po_id uuid references purchase_order(id),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','ordered')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create trigger purchase_requisition_tenant before insert or update on purchase_requisition for each row
  execute function check_same_tenant('farm_id=farm', 'item_id=item', 'po_id=purchase_order');
create trigger purchase_requisition_lock before insert or update or delete on purchase_requisition for each row
  execute function guard_locked('tenant_owner,farm_manager,store_keeper,hatchery_ops_manager', 'po_id', 'approved>ordered');
select apply_std_policies('purchase_requisition', '{tenant_owner,farm_manager,store_keeper,shed_supervisor,hatchery_technician,hatchery_ops_manager,procurement_officer}',
  '{tenant_owner,farm_manager,store_keeper,hatchery_ops_manager,procurement_officer}', '{tenant_owner,farm_manager,store_keeper}');

-- POs above rule po_approval_above (off by default = current behaviour) start 'submitted' and need the owner or
-- procurement officer; goods can only be received against approved / partly received POs
create function po_threshold() returns trigger language plpgsql as $$
declare lim numeric := (tenant_rule_value(new.tenant_id, 'po_approval_above', 'null') #>> '{}')::numeric;
begin
  if tg_op = 'INSERT' and lim is not null and new.total > lim and new.status = 'approved' then new.status := 'submitted'; end if;
  if tg_op = 'UPDATE' and old.status in ('draft', 'submitted') and new.status = 'approved'
     and auth.uid() is not null and not (effective_roles() && '{tenant_owner,procurement_officer}') then
    raise exception 'only the owner or procurement officer can approve purchase orders';
  end if;
  return new;
end $$;
create trigger po_threshold before insert or update on purchase_order for each row execute function po_threshold();
create function grn_needs_approved_po() returns trigger language plpgsql as $$
begin
  if new.move_type = 'grn' and new.ref_type = 'purchase_order'
     and not exists (select 1 from purchase_order where id = new.ref_id and status in ('approved', 'partial')) then
    raise exception 'purchase order is not approved';
  end if;
  return new;
end $$;
create trigger grn_needs_approved_po before insert on stock_movement for each row execute function grn_needs_approved_po();

-- ---------------------------------------------------------------- stock count -> approved adjustments
create table stock_count (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  store_id uuid not null references store(id),
  counted_on date not null,
  note text check (length(note) <= 300),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create table stock_count_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  count_id uuid not null references stock_count(id) on delete cascade,
  item_id uuid not null references item(id),
  counted_qty numeric(12,2) not null check (counted_qty >= 0),
  system_qty numeric(12,2),                                      -- snapshot at submit
  unique (count_id, item_id)
);
create trigger stock_count_tenant before insert or update on stock_count for each row execute function check_same_tenant('store_id=store');
create trigger stock_count_lock before insert or update or delete on stock_count for each row
  execute function guard_locked('tenant_owner,farm_manager,store_keeper', '', '');
select apply_std_policies('stock_count', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}');
create function stock_count_line_check() returns trigger language plpgsql as $$
declare c record;
begin
  select * into c from stock_count where id = coalesce(new.count_id, old.count_id);
  if c.status not in ('draft', 'rejected') and current_user in ('authenticated', 'anon') then raise exception 'count already submitted'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if c.tenant_id <> new.tenant_id or not exists (select 1 from item where id = new.item_id and tenant_id = new.tenant_id) then raise exception 'unknown item'; end if;
  return new;
end $$;
create trigger stock_count_line_check before insert or update or delete on stock_count_line for each row execute function stock_count_line_check();
select apply_std_policies('stock_count_line', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}');

-- submit snapshots book stock; approval posts the differences as 'count' movements. Value above rule
-- stock_adjust_owner_above (default 25,000) needs the owner.
create function stock_count_flow() returns trigger language plpgsql security definer set search_path = public as $$
declare value numeric;
begin
  if new.status = 'submitted' and old.status <> 'submitted' then
    update stock_count_line l set system_qty = coalesce((select sum(qty) from stock_movement m where m.store_id = new.store_id and m.item_id = l.item_id), 0)
     where l.count_id = new.id;
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    select coalesce(sum(abs(l.counted_qty - l.system_qty) * coalesce((select avg(rate) from stock_movement m where m.item_id = l.item_id and m.move_type = 'grn'), 0)), 0)
      into value from stock_count_line l where l.count_id = new.id;
    if value > rule_num(new.tenant_id, 'stock_adjust_owner_above', 25000) and auth.uid() is not null and not (effective_roles() && '{tenant_owner}') then
      raise exception 'adjustment worth % needs the owner', round(value);
    end if;
    insert into stock_movement (tenant_id, store_id, item_id, move_type, qty, ref_type, ref_id, moved_on, created_by)
    select new.tenant_id, new.store_id, l.item_id, 'count', l.counted_qty - l.system_qty, 'stock_count', new.id, new.counted_on, auth.uid()
      from stock_count_line l where l.count_id = new.id and l.counted_qty <> l.system_qty;
  end if;
  return null;
end $$;
create trigger stock_count_flow after update on stock_count for each row execute function stock_count_flow();

-- ---------------------------------------------------------------- store-to-store transfer (in transit)
create table stock_transfer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  from_store uuid not null references store(id),
  to_store uuid not null references store(id),
  item_id uuid not null references item(id),
  qty numeric(12,2) not null check (qty > 0),
  sent_on date, received_on date, received_qty numeric(12,2) check (received_qty >= 0),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected','in_transit','received')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  check (from_store <> to_store)
);
create trigger stock_transfer_tenant before insert or update on stock_transfer for each row
  execute function check_same_tenant('from_store=store', 'to_store=store', 'item_id=item');
create trigger stock_transfer_lock before insert or update or delete on stock_transfer for each row
  execute function guard_locked('tenant_owner,farm_manager,store_keeper', 'sent_on,received_on,received_qty', 'approved>in_transit,in_transit>received');
select apply_std_policies('stock_transfer', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}', '{tenant_owner,farm_manager,store_keeper}');
create function stock_transfer_flow() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'in_transit' and old.status <> 'in_transit' then          -- leaves the source store (negative guard applies)
    insert into stock_movement (tenant_id, store_id, item_id, move_type, qty, ref_type, ref_id, moved_on, created_by)
    values (new.tenant_id, new.from_store, new.item_id, 'transfer', -new.qty, 'stock_transfer', new.id, coalesce(new.sent_on, current_date), auth.uid());
  elsif new.status = 'received' and old.status <> 'received' then
    if new.received_qty is null or new.received_qty > new.qty then raise exception 'enter the received quantity (at most %)', new.qty; end if;
    insert into stock_movement (tenant_id, store_id, item_id, move_type, qty, ref_type, ref_id, moved_on, created_by)
    values (new.tenant_id, new.to_store, new.item_id, 'transfer', new.received_qty, 'stock_transfer', new.id, coalesce(new.received_on, current_date), auth.uid());
  end if;
  return null;
end $$;
create trigger stock_transfer_flow after update on stock_transfer for each row execute function stock_transfer_flow();

-- ---------------------------------------------------------------- supplier KPIs + receivables ageing
create view supplier_kpi with (security_invoker = true) as
select v.tenant_id, v.id as vendor_id, v.name,
       count(distinct po.id) as purchase_orders,
       count(distinct m.ref_id) filter (where m.moved_on <= po.expected_on) as on_time_receipts,
       count(distinct m.ref_id) as receipts,
       round(100.0 * count(distinct m.ref_id) filter (where m.moved_on <= po.expected_on) / nullif(count(distinct m.ref_id), 0), 1) as on_time_pct,
       round(avg(b.total / nullif(po.total, 0) * 100 - 100), 2) as avg_bill_vs_po_pct
from vendor v
left join purchase_order po on po.vendor_id = v.id
left join stock_movement m on m.ref_type = 'purchase_order' and m.ref_id = po.id and m.move_type = 'grn'
left join bill b on b.po_id = po.id
group by v.tenant_id, v.id, v.name;

create view receivables_ageing with (security_invoker = true) as
select i.tenant_id, i.customer_id, c.name,
       sum(i.total - i.paid) filter (where current_date - i.due_date <= 0) as not_due,
       sum(i.total - i.paid) filter (where current_date - i.due_date between 1 and 30) as d1_30,
       sum(i.total - i.paid) filter (where current_date - i.due_date between 31 and 60) as d31_60,
       sum(i.total - i.paid) filter (where current_date - i.due_date between 61 and 90) as d61_90,
       sum(i.total - i.paid) filter (where current_date - i.due_date > 90) as d90_plus,
       sum(i.total - i.paid) as total_open
from invoice i join customer c on c.id = i.customer_id
where i.status <> 'paid'
group by i.tenant_id, i.customer_id, c.name;

-- ---------------------------------------------------------------- tenant API keys (only the SHA-256 hash is stored)
create table api_key (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  prefix text not null check (length(prefix) = 8),                -- shown in lists so owners can tell keys apart
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (scopes <@ '{readings:write,orders:read,stock:read,trace:read}'::text[] and cardinality(scopes) > 0),
  created_by uuid default auth.uid() references app_user(id),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
select apply_std_policies('api_key', '{tenant_owner}', '{tenant_owner}', '{tenant_owner}');
create policy api_key_module on api_key as restrictive for insert to authenticated with check (auth_has_module('api'));
-- owners create keys through this: the plain key is returned once and never stored
create function create_api_key(p_name text, p_scopes text[]) returns text language plpgsql security definer set search_path = public, extensions as $$
declare k text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not (auth_roles() && '{tenant_owner}') or not auth_tenant_active() or not auth_has_module('api') then raise exception 'not allowed'; end if;
  insert into api_key (tenant_id, name, prefix, key_hash, scopes, created_by)
  values (auth_tenant_id(), p_name, left(k, 8), encode(extensions.digest(k, 'sha256'), 'hex'), p_scopes, auth.uid());
  return k;
end $$;
revoke all on function create_api_key(text, text[]) from public, anon;
grant execute on function create_api_key(text, text[]) to authenticated;
-- edge functions (service role) resolve a presented key
create function api_key_lookup(p_key text) returns table (key_id uuid, tenant_id uuid, scopes text[]) language sql security definer set search_path = public, extensions as $$
  update api_key set last_used_at = now()
   where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex') and revoked_at is null and (expires_at is null or expires_at > now())
  returning id, tenant_id, scopes
$$;
revoke all on function api_key_lookup(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- accounting export log (Tally / CSV handoffs)
create table accounting_export (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  target text not null check (target in ('tally','csv','gstr1')),
  period_from date not null, period_to date not null,
  documents int not null default 0,
  file_path text check (length(file_path) <= 200),
  status text not null default 'exported' check (status in ('exported','imported','failed')),
  note text check (length(note) <= 300),
  created_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  check (period_to >= period_from)
);
select apply_std_policies('accounting_export', '{tenant_owner,finance}', '{tenant_owner,finance}', '{tenant_owner}');
