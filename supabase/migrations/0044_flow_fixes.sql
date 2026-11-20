-- 0044: security review of 0041.
-- 1. flock_store_guard checked only the NEW flock: moving a collection/transfer to another flock could leave the old
--    flock's store negative. Both old and new keys are checked now.
-- 2. a hatch could skip the D10/D18/transfer approvals by never loading a setter. New hatchery settings are
--    full-flow: the hatch needs an approved setter->hatcher transfer, and hatch_record's legacy one-step candling
--    columns are refused. Tenant rule simple_hatch_flow = true (owner-only rule) keeps the old single-form flow for
--    small hatcheries; settings created before this migration keep it too.

create or replace function flock_store_guard() returns trigger language plpgsql as $$
declare k text := case tg_table_name when 'egg_transfer' then 'flock_id' else 'batch_id' end; fl uuid; bal int;
begin
  for fl in select distinct x from unnest(array[(to_jsonb(new) ->> k)::uuid, (to_jsonb(old) ->> k)::uuid]) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(fl::text, 1));
    select coalesce((select sum(settable) from hatching_egg_collection where batch_id = fl and status in ('submitted','approved')), 0)
         - coalesce((select sum(qty) from egg_transfer where flock_id = fl and status not in ('rejected','cancelled')), 0) into bal;
    if bal < 0 then raise exception 'eggs already sent from this flock exceed its collections by %', -bal; end if;
  end loop;
  return null;
end $$;

alter table batch add column full_hatch_flow boolean not null default true;
update batch set full_hatch_flow = false where farm_type = 'hatchery';

create or replace function hatch_vs_transfer() returns trigger language plpgsql as $$
declare t int; full_flow boolean;
begin
  select eggs into t from hatcher_transfer where batch_id = new.batch_id;
  if t is not null and coalesce(new.chicks_a, 0) + coalesce(new.chicks_b, 0) + coalesce(new.culls, 0) > t then
    raise exception 'chicks + culls exceed the % eggs moved to the hatcher', t;
  end if;
  select b.full_hatch_flow and not (tenant_rule_value(b.tenant_id, 'simple_hatch_flow', 'false'))::boolean into full_flow
    from batch b where b.id = new.batch_id;
  if full_flow then
    if new.clears is not null or new.dead_germ is not null then
      raise exception 'record candling on the day-10 and day-18 candling screens';
    end if;
    if new.hatched_on is not null and not exists (select 1 from hatcher_transfer where batch_id = new.batch_id and status = 'approved') then
      raise exception 'approve the setter-to-hatcher transfer before recording the hatch';
    end if;
  end if;
  return new;
end $$;
