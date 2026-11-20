-- 0041: ERP WP 1.6–1.8 — setters/hatchers, setter loading, candling D10/D18 with approval, setter->hatcher transfer,
-- hatcher release checklist, machine environment alerts + compliance. Spec: Hatchery §3–7; plan C1 (machine status
-- derived, never typed in; hatcher EMPTY only after the release checklist; Hatchery Ops Manager approves candling
-- and transfers; 30-min readings manual or sensor, missing readings reported, never counted compliant).
-- Also (security review of 0039): the farm egg store can't go negative through reviving a rejected transfer or
-- editing/rejecting/deleting a collection whose eggs are already committed.

-- ---------------------------------------------------------------- machines = assets with a machine kind
alter table asset add column machine_kind text check (machine_kind in ('setter','hatcher','combined')),
                  add column machine_no text check (length(machine_no) <= 20),
                  add column capacity_eggs int check (capacity_eggs > 0),
                  add column stage text check (stage in ('single','multi')),
                  add constraint asset_machine_cols check (machine_kind is null or (capacity_eggs is not null and stage is not null));
alter table batch add column setter_id uuid references asset(id);

-- ---------------------------------------------------------------- candling (stage 1 = day 10, stage 2 = day 18)
create table candling (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,
  stage smallint not null check (stage in (1, 2)),
  candled_on date not null,
  eggs_candled int not null check (eggs_candled >= 0),
  infertile int check (infertile >= 0),
  early_dead int check (early_dead >= 0),
  dirty int check (dirty >= 0),                   -- contaminated / exploders: tracked apart, not embryo mortality (C1)
  mid_dead int check (mid_dead >= 0),
  late_dead int check (late_dead >= 0),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (batch_id, stage),
  check (stage = 1 and infertile is not null and early_dead is not null and dirty is not null and mid_dead is null and late_dead is null
      or stage = 2 and mid_dead is not null and late_dead is not null and infertile is null and early_dead is null and dirty is null)
);

-- eggs set -> live after D10 -> transfer eggs after D18, per setting (both candlings optional until done)
create view setting_progress with (security_invoker = true) as
select b.tenant_id, b.id as batch_id, b.code, b.placed_on as set_on, b.doc_count as eggs_set, b.setter_id,
       b.placed_on + rule_num(b.tenant_id, 'incubation_days', 21)::int as expected_hatch_on,
       c1.infertile, c1.early_dead, c1.dirty, c1.status as candling1_status,
       b.doc_count - c1.infertile as fertile,
       b.doc_count - c1.infertile - c1.early_dead - c1.dirty as live_d10,
       c2.mid_dead, c2.late_dead, c2.status as candling2_status,
       b.doc_count - c1.infertile - c1.early_dead - c1.dirty - c2.mid_dead - c2.late_dead as transfer_eggs
from batch b
left join candling c1 on c1.batch_id = b.id and c1.stage = 1
left join candling c2 on c2.batch_id = b.id and c2.stage = 2
where b.farm_type = 'hatchery';

-- ---------------------------------------------------------------- setter -> hatcher (day 18)
create table hatcher_transfer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null unique references batch(id) on delete cascade,
  hatcher_id uuid not null references asset(id),
  moved_on date not null,
  eggs int not null check (eggs > 0),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

-- hatcher released after hatch: chicks out + reconciled, waste recorded, cleaned + disinfected, checked (C1)
create table machine_release (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null unique references batch(id) on delete cascade,
  hatcher_id uuid not null references asset(id),
  chicks_removed boolean not null check (chicks_removed),
  waste_recorded boolean not null check (waste_recorded),
  cleaned boolean not null check (cleaned),
  disinfected boolean not null check (disinfected),
  inspected boolean not null check (inspected),
  disinfectant text check (length(disinfectant) <= 80),
  notes text check (length(notes) <= 500),
  released_by uuid default auth.uid() references app_user(id),
  released_at timestamptz not null default now()
);

-- one row per machine: what is in it now. breakdown = open high-priority ticket.
create view machine_status with (security_invoker = true) as
select a.tenant_id, a.id as asset_id, a.farm_id, a.name, a.machine_no, a.machine_kind, a.stage, a.capacity_eggs,
       coalesce(s.eggs, 0) as eggs_in_setter, coalesce(s.settings, 0) as settings,
       h.batch_id as hatcher_batch_id,
       case when exists (select 1 from maintenance_ticket m where m.asset_id = a.id and m.status <> 'closed' and m.priority = 'high') then 'breakdown'
            when h.batch_id is not null and h.hatched then 'cleaning'
            when h.batch_id is not null or s.eggs > 0 then 'in_use'
            else 'available' end as state
from asset a
left join lateral (select sum(b.doc_count) as eggs, count(*) as settings from batch b
                   where b.setter_id = a.id and b.closed_on is null
                     and not exists (select 1 from hatcher_transfer t where t.batch_id = b.id)) s on true
left join lateral (select t.batch_id, exists (select 1 from hatch_record r where r.batch_id = t.batch_id and r.hatched_on is not null) as hatched
                   from hatcher_transfer t where t.hatcher_id = a.id
                     and not exists (select 1 from machine_release r where r.batch_id = t.batch_id) limit 1) h on true
where a.machine_kind is not null;

-- load a setting into a setter (batch updates are owner/manager-only, so hatchery staff go through this)
create function load_setter(p_batch uuid, p_setter uuid) returns void language plpgsql security definer set search_path = public as $$
declare b record; m record;
begin
  if not (auth_roles() && '{tenant_owner,farm_manager,hatchery_technician,hatchery_ops_manager}') or not auth_tenant_active() then
    raise exception 'not allowed';
  end if;
  select * into b from batch where id = p_batch and tenant_id = auth_tenant_id() and farm_type = 'hatchery';
  if not found then raise exception 'not a hatchery setting'; end if;
  if b.setter_id is not null then raise exception 'setting already loaded'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_setter::text, 2));
  select * into m from machine_status where asset_id = p_setter and tenant_id = auth_tenant_id() and machine_kind in ('setter','combined');
  if not found then raise exception 'not a setter'; end if;
  if m.state = 'breakdown' then raise exception 'setter % is under breakdown repair', coalesce(m.machine_no, m.name); end if;
  if m.stage = 'single' and m.eggs_in_setter > 0 then raise exception 'single-stage setter % is in use', coalesce(m.machine_no, m.name); end if;
  if m.eggs_in_setter + b.doc_count > m.capacity_eggs then
    raise exception 'setter holds % eggs; % free', m.capacity_eggs, m.capacity_eggs - m.eggs_in_setter;
  end if;
  update batch set setter_id = p_setter where id = p_batch;
end $$;
revoke all on function load_setter(uuid, uuid) from public, anon;
grant execute on function load_setter(uuid, uuid) to authenticated;

create function candling_check() returns trigger language plpgsql as $$
declare b record; c1 record; live int;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'hatchery' then raise exception 'not a hatchery setting'; end if;
  if new.candled_on < b.placed_on or new.candled_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'candling date outside the setting'; end if;
  if new.stage = 1 then
    if new.eggs_candled > b.doc_count then raise exception 'candled % but only % set', new.eggs_candled, b.doc_count; end if;
    if new.infertile + new.early_dead + new.dirty > b.doc_count then
      raise exception 'removed eggs (%) exceed eggs set (%)', new.infertile + new.early_dead + new.dirty, b.doc_count;
    end if;
  else
    select * into c1 from candling where batch_id = new.batch_id and stage = 1;
    if not found or c1.status <> 'approved' then raise exception 'first candling must be approved first'; end if;
    if new.candled_on <= c1.candled_on then raise exception 'second candling must come after the first'; end if;
    live := b.doc_count - c1.infertile - c1.early_dead - c1.dirty;
    if new.mid_dead + new.late_dead > live then raise exception 'dead embryos (%) exceed live eggs (%)', new.mid_dead + new.late_dead, live; end if;
  end if;
  if exists (select 1 from hatcher_transfer where batch_id = new.batch_id) then raise exception 'eggs already moved to the hatcher'; end if;
  return new;
end $$;

create function hatcher_transfer_check() returns trigger language plpgsql as $$
declare p record; m record;
begin
  select * into p from setting_progress where batch_id = new.batch_id;
  if not found or p.tenant_id <> new.tenant_id then raise exception 'not a hatchery setting'; end if;
  if p.candling2_status is distinct from 'approved' then raise exception 'second candling must be approved before transfer'; end if;
  if new.eggs > p.transfer_eggs then raise exception 'only % live eggs to transfer', p.transfer_eggs; end if;
  if new.moved_on < p.set_on then raise exception 'transfer before setting'; end if;
  if tg_op = 'INSERT' or new.hatcher_id <> old.hatcher_id then
    perform pg_advisory_xact_lock(hashtextextended(new.hatcher_id::text, 2));
    select * into m from machine_status where asset_id = new.hatcher_id and tenant_id = new.tenant_id and machine_kind in ('hatcher','combined');
    if not found then raise exception 'not a hatcher'; end if;
    if m.state <> 'available' and m.hatcher_batch_id is distinct from new.batch_id then raise exception 'hatcher % is %', coalesce(m.machine_no, m.name), m.state; end if;
    if new.eggs > m.capacity_eggs then raise exception 'hatcher holds % eggs', m.capacity_eggs; end if;
  end if;
  return new;
end $$;

create function machine_release_check() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from hatcher_transfer where batch_id = new.batch_id and hatcher_id = new.hatcher_id and tenant_id = new.tenant_id) then
    raise exception 'this setting was not in that hatcher';
  end if;
  if not exists (select 1 from hatch_record where batch_id = new.batch_id and hatched_on is not null) then
    raise exception 'record the hatch results before releasing the hatcher';
  end if;
  return new;
end $$;

-- the hatch can't be recorded beyond the eggs actually transferred (when the D18 flow was used)
create function hatch_vs_transfer() returns trigger language plpgsql as $$
declare t int;
begin
  select eggs into t from hatcher_transfer where batch_id = new.batch_id;
  if t is not null and coalesce(new.chicks_a, 0) + coalesce(new.chicks_b, 0) + coalesce(new.culls, 0) > t then
    raise exception 'chicks + culls exceed the % eggs moved to the hatcher', t;
  end if;
  if new.hatched_on is not null and exists (select 1 from batch where id = new.batch_id and setter_id is not null)
     and not exists (select 1 from hatcher_transfer where batch_id = new.batch_id and status = 'approved') then
    raise exception 'approve the setter-to-hatcher transfer before recording the hatch';
  end if;
  return new;
end $$;
create trigger hatch_vs_transfer before insert or update on hatch_record for each row execute function hatch_vs_transfer();

create trigger candling_check before insert or update on candling for each row execute function candling_check();
create trigger candling_lock before insert or update or delete on candling for each row
  execute function guard_locked('tenant_owner,hatchery_ops_manager', '', '');
select apply_std_policies('candling', '{tenant_owner,farm_manager,shed_supervisor,hatchery_technician,hatchery_ops_manager}',
  '{tenant_owner,farm_manager,shed_supervisor,hatchery_technician,hatchery_ops_manager}', '{tenant_owner,hatchery_ops_manager}');

create trigger hatcher_transfer_check before insert or update on hatcher_transfer for each row execute function hatcher_transfer_check();
create trigger hatcher_transfer_lock before insert or update or delete on hatcher_transfer for each row
  execute function guard_locked('tenant_owner,hatchery_ops_manager', '', '');
select apply_std_policies('hatcher_transfer', '{tenant_owner,farm_manager,hatchery_technician,hatchery_ops_manager}',
  '{tenant_owner,farm_manager,hatchery_technician,hatchery_ops_manager}', '{tenant_owner,hatchery_ops_manager}');

create trigger machine_release_check before insert or update on machine_release for each row execute function machine_release_check();
select apply_std_policies('machine_release', '{tenant_owner,hatchery_ops_manager,hatchery_manager}', '{tenant_owner}', '{tenant_owner}');

-- sources lock once candling starts (0036 looked at hatch_record only)
create or replace function setting_lot_check() returns trigger language plpgsql as $$
declare b record; t record; used int; loaded int; max_days int;
begin
  if tg_op <> 'INSERT' and (exists (select 1 from hatch_record where batch_id = old.batch_id) or exists (select 1 from candling where batch_id = old.batch_id)) then
    raise exception 'setting already candled — its egg sources are locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if exists (select 1 from hatch_record where batch_id = new.batch_id) or exists (select 1 from candling where batch_id = new.batch_id) then
    raise exception 'setting already candled — its egg sources are locked';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.batch_id::text, 0));
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
  if loaded + new.qty > b.doc_count then raise exception 'sources (%) exceed eggs set (%)', loaded + new.qty, b.doc_count; end if;
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

-- ---------------------------------------------------------------- machine environment (spec §4)
create or replace function env_reading_check() returns trigger language plpgsql as $$
declare s record; m record; issues text[] := '{}'; changed boolean;
begin
  if new.read_at > now() + interval '5 minutes' then raise exception 'reading is in the future'; end if;
  changed := tg_op = 'INSERT' or (new.temp_c, new.rh_pct, new.nh3_ppm, new.litter, new.fan_rpm, new.alarm) is distinct from (old.temp_c, old.rh_pct, old.nh3_ppm, old.litter, old.fan_rpm, old.alarm);
  if new.shed_id is not null then
    select sh.name, sh.tenant_id into s from shed sh where sh.id = new.shed_id;
    if not found or s.tenant_id <> new.tenant_id then raise exception 'unknown house'; end if;
    if new.temp_c > rule_num(new.tenant_id, 'house_temp_max_c', 32.2) then issues := issues || format('temperature %s °C high', new.temp_c); end if;
    if new.temp_c < rule_num(new.tenant_id, 'house_temp_min_c', 15) then issues := issues || format('temperature %s °C low', new.temp_c); end if;
    if new.nh3_ppm > rule_num(new.tenant_id, 'house_nh3_max_ppm', 20) then issues := issues || format('ammonia %s ppm', new.nh3_ppm); end if;
    if new.litter in ('wet', 'caked') then issues := issues || ('litter ' || new.litter); end if;
    if cardinality(issues) > 0 and changed then
      perform raise_alert(new.tenant_id, 'warning', 'House conditions · ' || s.name, array_to_string(issues, ', '), 'shed', new.shed_id);
    end if;
  else
    select a.name, a.machine_no, a.tenant_id into m from asset a where a.id = new.asset_id;
    if not found or m.tenant_id <> new.tenant_id then raise exception 'unknown machine'; end if;
    if new.temp_c > rule_num(new.tenant_id, 'machine_temp_max_c', 37.8) then issues := issues || format('temperature %s °C high', new.temp_c); end if;
    if new.temp_c < rule_num(new.tenant_id, 'machine_temp_min_c', 37.2) then issues := issues || format('temperature %s °C low', new.temp_c); end if;
    if new.rh_pct > rule_num(new.tenant_id, 'machine_rh_max_pct', 65) then issues := issues || format('humidity %s %% high', new.rh_pct); end if;
    if new.rh_pct < rule_num(new.tenant_id, 'machine_rh_min_pct', 45) then issues := issues || format('humidity %s %% low', new.rh_pct); end if;
    if new.fan_rpm = 0 then issues := issues || 'fan stopped'::text; end if;
    if new.alarm then issues := issues || 'machine alarm'::text; end if;
    if cardinality(issues) > 0 and changed then
      perform raise_alert(new.tenant_id, 'critical', 'Machine · ' || coalesce(m.machine_no, m.name), array_to_string(issues, ', '), 'asset', new.asset_id);
    end if;
  end if;
  return new;
end $$;

-- per machine per day: readings taken vs expected (every 30 min), in-range share (C1 formula; missing != compliant)
create view machine_env_day with (security_invoker = true) as
select r.tenant_id, r.asset_id, (r.read_at at time zone 'Asia/Kolkata')::date as day,
       count(*) as readings,
       (24 * 60 / rule_num(r.tenant_id, 'machine_reading_minutes', 30))::int as expected,
       count(*) filter (where r.temp_c is not null) as temp_readings,
       count(*) filter (where r.temp_c between rule_num(r.tenant_id, 'machine_temp_min_c', 37.2) and rule_num(r.tenant_id, 'machine_temp_max_c', 37.8)) as temp_ok,
       count(*) filter (where r.rh_pct is not null) as rh_readings,
       count(*) filter (where r.rh_pct between rule_num(r.tenant_id, 'machine_rh_min_pct', 45) and rule_num(r.tenant_id, 'machine_rh_max_pct', 65)) as rh_ok,
       round(100.0 * count(*) filter (where r.temp_c between rule_num(r.tenant_id, 'machine_temp_min_c', 37.2) and rule_num(r.tenant_id, 'machine_temp_max_c', 37.8))
             / nullif(count(*) filter (where r.temp_c is not null), 0), 1) as temp_compliance_pct,
       round(100.0 * count(*) filter (where r.rh_pct between rule_num(r.tenant_id, 'machine_rh_min_pct', 45) and rule_num(r.tenant_id, 'machine_rh_max_pct', 65))
             / nullif(count(*) filter (where r.rh_pct is not null), 0), 1) as rh_compliance_pct,
       count(*) filter (where r.alarm or r.fan_rpm = 0) as alarms,
       count(*) filter (where r.source = 'sensor') as sensor_readings
from env_reading r where r.asset_id is not null
group by r.tenant_id, r.asset_id, (r.read_at at time zone 'Asia/Kolkata')::date;

-- run by cron (service role): machines in use with no reading for 2x the interval -> reading/sensor failure alert
create function machine_silence_check() returns int language plpgsql security definer set search_path = public as $$
declare m record; n int := 0;
begin
  for m in select s.tenant_id, s.asset_id, coalesce(s.machine_no, s.name) as label,
                  (select max(read_at) from env_reading r where r.asset_id = s.asset_id) as last_at
           from machine_status s where s.state = 'in_use' loop
    if m.last_at is null or m.last_at < now() - make_interval(mins => 2 * rule_num(m.tenant_id, 'machine_reading_minutes', 30)::int) then
      insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id)
      values (m.tenant_id, 'alert', 'critical', 'No machine reading · ' || m.label,
              coalesce('last reading ' || to_char(m.last_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), 'no readings yet'), 'asset', m.asset_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function machine_silence_check() from public, anon, authenticated;

-- ---------------------------------------------------------------- egg store can't go negative (review of 0039)
create or replace function flock_store_guard() returns trigger language plpgsql as $$
declare fl uuid; bal int;
begin
  fl := (coalesce(to_jsonb(new), to_jsonb(old)) ->> case tg_table_name when 'egg_transfer' then 'flock_id' else 'batch_id' end)::uuid;
  if fl is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(fl::text, 1));
  select coalesce((select sum(settable) from hatching_egg_collection where batch_id = fl and status in ('submitted','approved')), 0)
       - coalesce((select sum(qty) from egg_transfer where flock_id = fl and status not in ('rejected','cancelled')), 0) into bal;
  if bal < 0 then raise exception 'eggs already sent from this flock exceed its collections by %', -bal; end if;
  return null;
end $$;
create constraint trigger hatching_egg_store_guard after update or delete on hatching_egg_collection
  deferrable initially immediate for each row execute function flock_store_guard();
create constraint trigger egg_transfer_store_guard after insert or update on egg_transfer
  deferrable initially immediate for each row execute function flock_store_guard();
