-- 0036: ERP WP 1.1/1.2 — tenant rules, one shared approval lock, and the many-to-many traceability spine
-- breeder flock (or bought-in eggs) -> egg_transfer -> setting_lot -> hatchery setting (batch) -> hatch_record.
-- Plan Part C1: one source flock per setting is preferred but mixing is allowed; per-flock hatch feedback for a
-- mixed setting is a proportional ESTIMATE and is flagged as such.

-- ---------------------------------------------------------------- tenant rules (configurable thresholds)
create table tenant_rule (
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  updated_by uuid default auth.uid() references app_user(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);
alter table tenant_rule enable row level security;
create policy tenant_rule_tenant on tenant_rule
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());
create policy tenant_rule_ins on tenant_rule as restrictive for insert with check (auth_has_role('tenant_owner'));
create policy tenant_rule_upd on tenant_rule as restrictive for update using (auth_has_role('tenant_owner')) with check (auth_has_role('tenant_owner'));
create policy tenant_rule_del on tenant_rule as restrictive for delete using (auth_has_role('tenant_owner'));
create policy tenant_rule_active_ins on tenant_rule as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy tenant_rule_active_upd on tenant_rule as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy tenant_rule_active_del on tenant_rule as restrictive for delete to authenticated using ((select auth_tenant_active()));

-- rule value for a tenant, or the default (defaults live with the code that reads them)
create function tenant_rule_value(p_tenant uuid, p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from tenant_rule where tenant_id = p_tenant and key = p_key), p_default)
$$;
revoke execute on function tenant_rule_value(uuid, text, jsonb) from public, anon;
grant execute on function tenant_rule_value(uuid, text, jsonb) to authenticated, service_role;

-- audit rows from triggers (0031 blocks direct inserts by tenant users)
create function audit_add(p_tenant uuid, p_action text, p_entity text, p_id uuid, p_before jsonb, p_after jsonb) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (tenant_id, user_id, action, entity_type, entity_id, before, after)
  values (p_tenant, auth.uid(), p_action, p_entity, p_id, p_before, p_after)
$$;
revoke execute on function audit_add(uuid, text, text, uuid, jsonb, jsonb) from public, anon;

-- ---------------------------------------------------------------- shared approval lock
-- Attach to any table with: id, tenant_id, status, submitted_by, approved_by, approved_at, reject_reason.
--   status draft | submitted | rejected = editable; anything else (approved, received, ...) = locked.
--   tg_argv[0] = roles allowed to approve/reject (csv); tg_argv[1] = columns that may still change once locked (csv).
-- Approve/reject stamps approved_by/at, is audit-logged, and respects rule allow_self_approval (default true, C1).
create function guard_locked() returns trigger language plpgsql as $$
declare
  approvers text[] := string_to_array(tg_argv[0], ',');
  free text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}') || '{status,updated_at}'::text[];
  open_states text[] := '{draft,submitted,rejected}';
  o jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then raise exception '% must start as draft or submitted', tg_table_name; end if;
    return jsonb_populate_record(new, jsonb_build_object('approved_by', null, 'approved_at', null));
  end if;
  if tg_op = 'DELETE' then
    if not (old.status = any (open_states)) then raise exception '% is approved and locked', tg_table_name; end if;
    return old;
  end if;

  o := to_jsonb(old);
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if old.status not in ('draft', 'submitted') then raise exception '% is not awaiting approval', tg_table_name; end if;
    if auth.uid() is not null and not (auth_roles() && approvers) then
      raise exception 'only % can approve %', array_to_string(approvers, ' / '), tg_table_name;
    end if;
    if new.status = 'approved' and auth.uid() = old.submitted_by
       and not (tenant_rule_value(old.tenant_id, 'allow_self_approval', 'true'))::boolean then
      raise exception 'the person who submitted % cannot approve it', tg_table_name;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then
      raise exception 'a reason is required to reject';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('approved_by', auth.uid(), 'approved_at', now()));
    perform audit_add(old.tenant_id, new.status, tg_table_name, old.id, o, to_jsonb(new));
    return new;
  end if;

  if not (old.status = any (open_states)) then
    if new.status = any (open_states) or (to_jsonb(new) - free) <> (o - free) then
      raise exception '% is approved and locked', tg_table_name;
    end if;
    return new;
  end if;

  -- still open: editable, but nobody forges the decision stamp or skips to a locked state
  if new.status is distinct from old.status and not (new.status = any (open_states)) then
    raise exception '% must be approved before it can be %', tg_table_name, new.status;
  end if;
  return jsonb_populate_record(new, jsonb_build_object('approved_by', o->'approved_by', 'approved_at', o->'approved_at'));
end $$;

-- ---------------------------------------------------------------- egg transfer (farm -> hatchery)
create table egg_transfer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  ref text not null,                                   -- Transfer Reference, shared key farm <-> hatchery
  flock_id uuid references batch(id),                  -- own breeder flock, or
  source_vendor_id uuid references vendor(id),         -- bought-in hatching eggs
  to_farm_id uuid not null references farm(id),        -- receiving hatchery
  laid_from date not null,
  laid_to date not null,
  sent_on date not null,
  trays int check (trays >= 0),
  qty int not null check (qty > 0),                    -- settable eggs sent
  received_qty int check (received_qty >= 0),          -- counted on arrival
  receipt_rejects int not null default 0 check (receipt_rejects >= 0),
  received_on date,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','received','cancelled')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (tenant_id, ref),
  check ((flock_id is null) <> (source_vendor_id is null)),
  check (laid_to >= laid_from and sent_on >= laid_to),
  check (receipt_rejects <= coalesce(received_qty, 0)),
  check ((status = 'received') = (received_qty is not null and received_on is not null)),
  check (received_on is null or received_on >= sent_on)
);
create index egg_transfer_flock on egg_transfer (flock_id);

create function egg_transfer_check() returns trigger language plpgsql as $$
begin
  if new.flock_id is not null and not exists (select 1 from batch where id = new.flock_id and tenant_id = new.tenant_id and farm_type = 'breeder') then
    raise exception 'source must be a breeder flock of this farm';
  end if;
  if new.source_vendor_id is not null and not exists (select 1 from vendor where id = new.source_vendor_id and tenant_id = new.tenant_id) then
    raise exception 'unknown egg supplier';
  end if;
  if not exists (select 1 from farm where id = new.to_farm_id and tenant_id = new.tenant_id and farm_type = 'hatchery') then
    raise exception 'eggs must go to a hatchery';
  end if;
  if tg_op = 'UPDATE' and new.status = 'received' and old.status not in ('approved', 'received') then
    raise exception 'only an approved transfer can be received';
  end if;
  if tg_op = 'UPDATE' and old.status = 'received'
     and (new.received_qty, new.receipt_rejects, new.received_on) is distinct from (old.received_qty, old.receipt_rejects, old.received_on) then
    raise exception 'receipt already confirmed';
  end if;
  return new;
end $$;
create trigger egg_transfer_check before insert or update on egg_transfer for each row execute function egg_transfer_check();
-- C1: Farm Manager is the final approver of egg transfers; receipt fields fill in after approval
create trigger egg_transfer_lock before insert or update or delete on egg_transfer for each row
  execute function guard_locked('tenant_owner,farm_manager', 'received_qty,receipt_rejects,received_on');

alter table egg_transfer enable row level security;
create policy egg_transfer_tenant on egg_transfer
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());
create policy egg_transfer_ins on egg_transfer as restrictive for insert with check (auth_has_role('tenant_owner','farm_manager','shed_supervisor'));
create policy egg_transfer_upd on egg_transfer as restrictive for update
  using (auth_has_role('tenant_owner','farm_manager','shed_supervisor','hatchery_technician','hatchery_ops_manager'))
  with check (auth_has_role('tenant_owner','farm_manager','shed_supervisor','hatchery_technician','hatchery_ops_manager'));
create policy egg_transfer_del on egg_transfer as restrictive for delete using (auth_has_role('tenant_owner','farm_manager'));
create policy egg_transfer_active_ins on egg_transfer as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy egg_transfer_active_upd on egg_transfer as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy egg_transfer_active_del on egg_transfer as restrictive for delete to authenticated using ((select auth_tenant_active()));

-- ---------------------------------------------------------------- setting lot (many transfers -> one setting)
create table setting_lot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,   -- hatchery setting
  transfer_id uuid not null references egg_transfer(id),
  qty int not null check (qty > 0),
  age_override_reason text,                                         -- required when eggs exceed max storage days
  created_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  unique (batch_id, transfer_id)
);
create index setting_lot_transfer on setting_lot (transfer_id);

create function setting_lot_check() returns trigger language plpgsql as $$
declare b record; t record; used int; loaded int; max_days int;
begin
  if tg_op <> 'INSERT' and exists (select 1 from hatch_record where batch_id = old.batch_id) then
    raise exception 'setting already candled — its egg sources are locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if exists (select 1 from hatch_record where batch_id = new.batch_id) then
    raise exception 'setting already candled — its egg sources are locked';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.batch_id::text, 0)); -- serialise loads of one setting (FOR UPDATE on batch needs batch-update rights technicians lack)
  select * into b from batch where id = new.batch_id;
  if not found or b.farm_type <> 'hatchery' or b.tenant_id <> new.tenant_id then raise exception 'not a hatchery setting'; end if;
  select * into t from egg_transfer where id = new.transfer_id for update;
  if not found or t.tenant_id <> new.tenant_id then raise exception 'unknown egg transfer'; end if;
  if t.status <> 'received' then raise exception 'eggs must be received at the hatchery before setting'; end if;
  if b.placed_on < t.received_on then raise exception 'setting date is before the eggs were received'; end if;

  select coalesce(sum(qty), 0) into used from setting_lot where transfer_id = new.transfer_id and id <> new.id;
  if used + new.qty > t.received_qty - t.receipt_rejects then
    raise exception 'only % settable eggs left on transfer %', t.received_qty - t.receipt_rejects - used, t.ref;
  end if;
  select coalesce(sum(qty), 0) into loaded from setting_lot where batch_id = new.batch_id and id <> new.id;
  if loaded + new.qty > b.doc_count then
    raise exception 'sources (%) exceed eggs set (%)', loaded + new.qty, b.doc_count;
  end if;

  max_days := (tenant_rule_value(new.tenant_id, 'egg_max_storage_days', '7'))::int;
  if b.placed_on - t.laid_from > max_days then
    if coalesce(btrim(new.age_override_reason), '') = '' then
      raise exception 'oldest egg is % days old (limit %) — give an override reason', b.placed_on - t.laid_from, max_days;
    end if;
    if auth.uid() is not null and not (auth_roles() && '{tenant_owner,hatchery_ops_manager}') then
      raise exception 'only the owner or hatchery operations manager can set over-age eggs';
    end if;
  end if;
  return new;
end $$;
create trigger setting_lot_check before insert or update or delete on setting_lot for each row execute function setting_lot_check();

alter table setting_lot enable row level security;
create policy setting_lot_tenant on setting_lot
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());
create policy setting_lot_ins on setting_lot as restrictive for insert
  with check (auth_has_role('tenant_owner','farm_manager','shed_supervisor','hatchery_technician','hatchery_ops_manager'));
create policy setting_lot_upd on setting_lot as restrictive for update
  using (auth_has_role('tenant_owner','farm_manager','hatchery_ops_manager'))
  with check (auth_has_role('tenant_owner','farm_manager','hatchery_ops_manager'));
create policy setting_lot_del on setting_lot as restrictive for delete using (auth_has_role('tenant_owner','farm_manager','hatchery_ops_manager'));
create policy setting_lot_active_ins on setting_lot as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy setting_lot_active_upd on setting_lot as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy setting_lot_active_del on setting_lot as restrictive for delete to authenticated using ((select auth_tenant_active()));

-- ---------------------------------------------------------------- trace + feedback (RLS applies: security_invoker)
-- One row per source lot of a setting with that lot's share of the hatch result. estimated = the setting mixed
-- sources, so per-source numbers are proportional (C1), not measured.
create view setting_trace with (security_invoker = true) as
select l.tenant_id, l.batch_id, s.code as setting_code, s.placed_on as set_on,
       t.id as transfer_id, t.ref as transfer_ref, t.flock_id, f.code as flock_code, t.source_vendor_id,
       t.laid_from, t.laid_to, l.qty as eggs_set,
       l.qty::numeric / sum(l.qty) over (partition by l.batch_id) as share,
       count(*) over (partition by l.batch_id) > 1 as estimated,
       h.clears * l.qty::numeric / s.doc_count as infertile,
       h.dead_germ * l.qty::numeric / s.doc_count as dead_germ,
       (h.chicks_a + h.chicks_b) * l.qty::numeric / s.doc_count as chicks,
       h.culls * l.qty::numeric / s.doc_count as culls,
       h.hatched_on
from setting_lot l
join batch s on s.id = l.batch_id
join egg_transfer t on t.id = l.transfer_id
left join batch f on f.id = t.flock_id
left join hatch_record h on h.batch_id = l.batch_id;
