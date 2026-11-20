-- 0040: fixes from tests + security review of 0038.
-- 1. guard_locked compared generated columns (NULL inside BEFORE triggers) -> "save changes before approving" on
--    tables with generated columns. Generated columns are now ignored.
-- 2. raise_alert: refuse suspended tenants, known severities only.
-- 3. same-tenant checks for foreign keys on medication_record / biosecurity_incident (shed must sit on the farm).
-- 4. alerts fire again when an UPDATE changes the measured values (insert-low-then-edit no longer hides them).

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

create or replace function raise_alert(p_tenant uuid, p_severity text, p_title text, p_body text, p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not auth_is_platform() and (p_tenant is distinct from auth_tenant_id() or not auth_tenant_active()) then
    raise exception 'alert for another or suspended tenant';
  end if;
  if p_severity not in ('info', 'warning', 'critical') then raise exception 'unknown severity %', p_severity; end if;
  insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id)
  values (p_tenant, 'alert', p_severity, left(p_title, 200), left(p_body, 1000), p_entity, p_id);
end $$;

-- generic: tg_argv = 'column=table' pairs; each non-null referenced row must belong to the row's tenant
create function check_same_tenant() returns trigger language plpgsql as $$
declare a text; col text; tbl text; ref uuid; ok boolean;
begin
  foreach a in array tg_argv loop
    col := split_part(a, '=', 1); tbl := split_part(a, '=', 2);
    ref := (to_jsonb(new) ->> col)::uuid;
    if ref is not null then
      execute format('select exists (select 1 from %I where id = $1 and tenant_id = $2)', tbl) into ok using ref, new.tenant_id;
      if not ok then raise exception 'unknown %', replace(col, '_id', ''); end if;
    end if;
  end loop;
  return new;
end $$;
create trigger medication_record_tenant before insert or update on medication_record for each row
  execute function check_same_tenant('batch_id=batch', 'item_id=item');
create trigger biosecurity_incident_tenant before insert or update on biosecurity_incident for each row
  execute function check_same_tenant('farm_id=farm', 'shed_id=shed');
create function biosecurity_shed_on_farm() returns trigger language plpgsql as $$
begin
  if new.shed_id is not null and not exists (select 1 from shed where id = new.shed_id and farm_id = new.farm_id) then
    raise exception 'house is not on this farm';
  end if;
  return new;
end $$;
create trigger biosecurity_shed_on_farm before insert or update on biosecurity_incident for each row execute function biosecurity_shed_on_farm();

-- ---------------------------------------------------------------- alerts on value-changing updates too
create or replace function breeder_daily_check() returns trigger language plpgsql as $$
declare b record; prev record; f_open int; m_open int; avg_water numeric; lim numeric;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'breeder' then raise exception 'not a breeder flock'; end if;
  if b.females_placed is null or b.males_placed is null then raise exception 'set females and males placed for this flock first'; end if;
  if new.log_date < b.placed_on or new.log_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'date outside the flock''s life'; end if;
  select coalesce(sum(female_mort + female_culls), 0) as f, coalesce(sum(male_mort + male_culls), 0) as m into prev
    from breeder_daily where batch_id = new.batch_id and log_date < new.log_date and id <> new.id;
  f_open := b.females_placed - prev.f;  m_open := b.males_placed - prev.m;
  if new.female_mort + new.female_culls > f_open or new.male_mort + new.male_culls > m_open then
    raise exception 'losses exceed birds alive (% F, % M)', f_open, m_open;
  end if;
  if tg_op = 'INSERT' or (new.female_mort, new.male_mort) is distinct from (old.female_mort, old.male_mort) then
    lim := rule_num(new.tenant_id, 'breeder_mortality_alert_pct', 0.5);
    if f_open > 0 and new.female_mort * 100.0 / f_open > lim or m_open > 0 and new.male_mort * 100.0 / m_open > lim then
      perform raise_alert(new.tenant_id, 'critical', 'High mortality · ' || b.code,
        format('%s F / %s M dead on %s (limit %s%%/day)', new.female_mort, new.male_mort, new.log_date, lim), 'batch', b.id);
    end if;
  end if;
  if tg_op = 'INSERT' or new.water_l is distinct from old.water_l then
    select avg(water_l) into avg_water from (select water_l from breeder_daily
      where batch_id = new.batch_id and log_date < new.log_date and water_l is not null order by log_date desc limit 3) w;
    if new.water_l is not null and avg_water > 0 and (new.water_l < avg_water * (1 - rule_num(new.tenant_id, 'water_drop_alert_pct', 20) / 100)
                                                   or new.water_l > avg_water * (1 + rule_num(new.tenant_id, 'water_rise_alert_pct', 30) / 100)) then
      perform raise_alert(new.tenant_id, 'warning', 'Water use changed · ' || b.code,
        format('%s L vs %s L recent average — check health, drinkers, heat', new.water_l, round(avg_water)), 'batch', b.id);
    end if;
  end if;
  return new;
end $$;

create or replace function body_weight_check() returns trigger language plpgsql as $$
declare b record; std int; lim numeric;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'breeder' then raise exception 'not a breeder flock'; end if;
  if new.weighed_on < b.placed_on then raise exception 'weighed before placement'; end if;
  select case when new.sex = 'F' then c.std_weight_g else c.std_male_weight_g end into std
    from breed_standard_curve c where c.breed_id = b.breed_id and c.age_week = (new.weighed_on - b.placed_on) / 7;
  lim := rule_num(new.tenant_id, 'body_weight_alert_pct', 10);
  if (tg_op = 'INSERT' or new.avg_g is distinct from old.avg_g) and std > 0 and abs(new.avg_g - std) * 100.0 / std > lim then
    perform raise_alert(new.tenant_id, 'warning', 'Body weight off standard · ' || b.code,
      format('%s %s g vs standard %s g — review feed allocation', case new.sex when 'F' then 'Females' else 'Males' end, new.avg_g, std), 'batch', b.id);
  end if;
  return new;
end $$;

create or replace function env_reading_check() returns trigger language plpgsql as $$
declare s record; issues text[] := '{}';
begin
  if new.read_at > now() + interval '5 minutes' then raise exception 'reading is in the future'; end if;
  if new.shed_id is not null then
    select sh.name, sh.tenant_id into s from shed sh where sh.id = new.shed_id;
    if not found or s.tenant_id <> new.tenant_id then raise exception 'unknown house'; end if;
    if new.temp_c > rule_num(new.tenant_id, 'house_temp_max_c', 32.2) then issues := issues || format('temperature %s °C high', new.temp_c); end if;
    if new.temp_c < rule_num(new.tenant_id, 'house_temp_min_c', 15) then issues := issues || format('temperature %s °C low', new.temp_c); end if;
    if new.nh3_ppm > rule_num(new.tenant_id, 'house_nh3_max_ppm', 20) then issues := issues || format('ammonia %s ppm', new.nh3_ppm); end if;
    if new.litter in ('wet', 'caked') then issues := issues || ('litter ' || new.litter); end if;
    if cardinality(issues) > 0 and (tg_op = 'INSERT' or (new.temp_c, new.nh3_ppm, new.litter) is distinct from (old.temp_c, old.nh3_ppm, old.litter)) then
      perform raise_alert(new.tenant_id, 'warning', 'House conditions · ' || s.name, array_to_string(issues, ', '), 'shed', new.shed_id);
    end if;
  elsif not exists (select 1 from asset where id = new.asset_id and tenant_id = new.tenant_id) then
    raise exception 'unknown machine';
  end if;
  return new;
end $$;

create or replace function hatching_egg_check() returns trigger language plpgsql as $$
declare b record; rejects int;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'breeder' then raise exception 'not a breeder flock'; end if;
  if new.collected_on < b.placed_on or new.collected_on > (now() at time zone 'Asia/Kolkata')::date then raise exception 'date outside the flock''s life'; end if;
  rejects := new.broken + new.cracked + new.dirty + new.misshapen + new.double_yolk + new.small + new.soft_shell;
  if rejects > new.nest then raise exception 'rejects (%) exceed nest eggs (%)', rejects, new.nest; end if;
  if new.dirty_treated > 0 and not (tenant_rule_value(new.tenant_id, 'allow_treated_dirty_eggs', 'false'))::boolean then
    raise exception 'setting treated dirty eggs is not allowed for this farm';
  end if;
  new.settable := new.nest - rejects + new.dirty_treated
                  + case when (tenant_rule_value(new.tenant_id, 'floor_eggs_settable', 'false'))::boolean then new.floor else 0 end;
  if (tg_op = 'INSERT' or (new.nest, new.floor) is distinct from (old.nest, old.floor))
     and new.floor * 100.0 / nullif(new.nest + new.floor, 0) > rule_num(new.tenant_id, 'floor_egg_alert_pct', 5) then
    perform raise_alert(new.tenant_id, 'warning', 'Floor eggs high · ' || b.code,
      format('%s of %s eggs (%s%%) on the floor — check nest boxes', new.floor, new.nest + new.floor, round(new.floor * 100.0 / (new.nest + new.floor), 1)), 'batch', b.id);
  end if;
  return new;
end $$;
