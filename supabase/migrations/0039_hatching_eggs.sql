-- 0039: ERP WP 1.4 + 1.5 — hatching-egg collection (spec PS §6), farm egg store, transfer limits and receipt
-- discrepancies (PS §7, Hatchery §2; plan C1: floor eggs not settable by default, dirty eggs only if treated under
-- an approved process — rule allow_treated_dirty_eggs, default false).

create table hatching_egg_collection (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,      -- breeder flock
  collected_on date not null,
  collection_no smallint not null check (collection_no between 1 and 6),
  nest int not null check (nest >= 0),
  floor int not null default 0 check (floor >= 0),
  broken int not null default 0 check (broken >= 0),
  cracked int not null default 0 check (cracked >= 0),
  dirty int not null default 0 check (dirty >= 0),
  dirty_treated int not null default 0 check (dirty_treated >= 0),     -- of the dirty eggs, cleaned/disinfected
  misshapen int not null default 0 check (misshapen >= 0),
  double_yolk int not null default 0 check (double_yolk >= 0),
  small int not null default 0 check (small >= 0),
  soft_shell int not null default 0 check (soft_shell >= 0),
  total int generated always as (nest + floor) stored,
  settable int not null default 0,                                      -- set by trigger
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (batch_id, collected_on, collection_no),
  check (dirty_treated <= dirty)
);

create function hatching_egg_check() returns trigger language plpgsql as $$
declare b record; rejects int;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'breeder' then raise exception 'not a breeder flock'; end if;
  if new.collected_on < b.placed_on or new.collected_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'date outside the flock''s life'; end if;
  -- rejects are sorted out of the nest eggs; floor eggs are counted apart and never settable by default
  rejects := new.broken + new.cracked + new.dirty + new.misshapen + new.double_yolk + new.small + new.soft_shell;
  if rejects > new.nest then raise exception 'rejects (%) exceed nest eggs (%)', rejects, new.nest; end if;
  if new.dirty_treated > 0 and not (tenant_rule_value(new.tenant_id, 'allow_treated_dirty_eggs', 'false'))::boolean then
    raise exception 'setting treated dirty eggs is not allowed for this farm';
  end if;
  new.settable := new.nest - rejects + new.dirty_treated
                  + case when (tenant_rule_value(new.tenant_id, 'floor_eggs_settable', 'false'))::boolean then new.floor else 0 end;
  if tg_op = 'INSERT' and new.floor * 100.0 / nullif(new.nest + new.floor, 0) > rule_num(new.tenant_id, 'floor_egg_alert_pct', 5) then
    perform raise_alert(new.tenant_id, 'warning', 'Floor eggs high · ' || b.code,
      format('%s of %s eggs (%s%%) on the floor — check nest boxes', new.floor, new.nest + new.floor, round(new.floor * 100.0 / (new.nest + new.floor), 1)), 'batch', b.id);
  end if;
  return new;
end $$;
create trigger hatching_egg_check before insert or update on hatching_egg_collection for each row execute function hatching_egg_check();
create trigger hatching_egg_lock before insert or update or delete on hatching_egg_collection for each row
  execute function guard_locked('tenant_owner,farm_manager', '', '');
select apply_std_policies('hatching_egg_collection', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager}');

-- per flock per day: hen-day %, settable %, floor % (PS §6). Females from the breeder daily record of that day.
create view flock_egg_day with (security_invoker = true) as
select c.tenant_id, c.batch_id, c.collected_on,
       sum(c.total) as total, sum(c.settable) as settable, sum(c.floor) as floor,
       sum(c.broken + c.cracked + c.dirty - c.dirty_treated + c.misshapen + c.double_yolk + c.small + c.soft_shell) as rejects,
       max(d.females_left) as females,
       round(sum(c.total) * 100.0 / nullif(max(d.females_left), 0), 2) as hen_day_pct,
       round(sum(c.settable) * 100.0 / nullif(sum(c.total), 0), 2) as settable_pct,
       round(sum(c.floor) * 100.0 / nullif(sum(c.total), 0), 2) as floor_pct,
       bool_and(c.status = 'approved') as approved
from hatching_egg_collection c
left join breeder_flock_day d on d.batch_id = c.batch_id and d.log_date = c.collected_on
where c.status <> 'rejected'
group by c.tenant_id, c.batch_id, c.collected_on;

-- farm egg store per flock: settable collected - sent (open/approved/received transfers)
create view flock_egg_store with (security_invoker = true) as
select b.tenant_id, b.id as batch_id, b.code,
       coalesce(c.settable, 0) as collected, coalesce(t.sent, 0) as committed,
       coalesce(c.settable, 0) - coalesce(t.sent, 0) as in_store,
       c.oldest as oldest_collected_on
from batch b
left join (select batch_id, sum(settable) as settable, min(collected_on) as oldest from hatching_egg_collection
           where status in ('submitted','approved') group by batch_id) c on c.batch_id = b.id
left join (select flock_id, sum(qty) as sent from egg_transfer where status not in ('rejected','cancelled') group by flock_id) t on t.flock_id = b.id
where b.farm_type = 'breeder';

-- ---------------------------------------------------------------- transfer: store limit, egg age, vehicle, receipt notes
alter table egg_transfer add column vehicle_no text check (length(vehicle_no) <= 20),
                         add column driver_name text check (length(driver_name) <= 80),
                         add column receipt_note text check (length(receipt_note) <= 500);

create or replace function egg_transfer_check() returns trigger language plpgsql as $$
declare avail int;
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
  -- own flock: can't send more settable eggs than collected and not yet committed (only when qty/source changes)
  if new.flock_id is not null and new.status not in ('rejected', 'cancelled')
     and (tg_op = 'INSERT' or (new.qty, new.flock_id) is distinct from (old.qty, old.flock_id)) then
    perform pg_advisory_xact_lock(hashtextextended(new.flock_id::text, 1));
    select coalesce((select sum(settable) from hatching_egg_collection where batch_id = new.flock_id and status in ('submitted','approved')), 0)
         - coalesce((select sum(qty) from egg_transfer where flock_id = new.flock_id and status not in ('rejected','cancelled') and id <> new.id), 0)
      into avail;
    if new.qty > avail then raise exception 'only % settable eggs in store for this flock', avail; end if;
  end if;
  if tg_op = 'INSERT' and new.sent_on - new.laid_from > rule_num(new.tenant_id, 'egg_max_storage_days', 7) then
    perform raise_alert(new.tenant_id, 'warning', 'Old eggs sent · ' || new.ref,
      format('oldest egg is %s days old at dispatch', new.sent_on - new.laid_from), 'egg_transfer', new.id);
  end if;
  if tg_op = 'UPDATE' and new.status = 'received' and old.status not in ('approved', 'received') then
    raise exception 'only an approved transfer can be received';
  end if;
  if tg_op = 'UPDATE' and new.status = 'received' and old.status = 'approved' then
    if new.received_qty <> new.qty and coalesce(btrim(new.receipt_note), '') = '' then
      raise exception 'received % but % were sent — note the discrepancy', new.received_qty, new.qty;
    end if;
    if new.received_qty <> new.qty then
      perform raise_alert(new.tenant_id, 'warning', 'Egg receipt short/over · ' || new.ref,
        format('sent %s, received %s: %s', new.qty, new.received_qty, new.receipt_note), 'egg_transfer', new.id);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
     and auth.uid() is not null and not (auth_roles() && '{tenant_owner,farm_manager}') then
    raise exception 'only the owner or farm manager can cancel a transfer';
  end if;
  if tg_op = 'UPDATE' and old.status = 'received'
     and (new.received_qty, new.receipt_rejects, new.received_on, new.receipt_note) is distinct from (old.received_qty, old.receipt_rejects, old.received_on, old.receipt_note) then
    raise exception 'receipt already confirmed';
  end if;
  return new;
end $$;

drop trigger egg_transfer_lock on egg_transfer;
create trigger egg_transfer_lock before insert or update or delete on egg_transfer for each row
  execute function guard_locked('tenant_owner,farm_manager', 'received_qty,receipt_rejects,received_on,receipt_note', 'approved>received,approved>cancelled');
