-- 0038: ERP WP 1.3 — breeder (parent stock) flock. Spec: NCGR Parent Stock §1–9; plan C1/C2.
-- Thresholds come from tenant_rule (defaults in code below = spec values) so management can change them.

-- ---------------------------------------------------------------- shared: standard RLS for tenant tables
-- tenant isolation + role lists per command + suspended-tenant lock, same shape as every table since 0017.
create function apply_std_policies(tbl regclass, ins text[], upd text[], del text[]) returns void language plpgsql as $$
declare t text := tbl::text;
begin
  execute format('alter table %s enable row level security', t);
  execute format('create policy %1$s_tenant on %1$s using (auth_is_platform() or tenant_id = auth_tenant_id()) with check (auth_is_platform() or tenant_id = auth_tenant_id())', t);
  execute format('create policy %1$s_ins on %1$s as restrictive for insert with check ((select auth_roles()) && %2$L::text[])', t, ins);
  execute format('create policy %1$s_upd on %1$s as restrictive for update using ((select auth_roles()) && %2$L::text[]) with check ((select auth_roles()) && %2$L::text[])', t, upd);
  execute format('create policy %1$s_del on %1$s as restrictive for delete using ((select auth_roles()) && %2$L::text[])', t, del);
  execute format('create policy %1$s_active_ins on %1$s as restrictive for insert to authenticated with check ((select auth_tenant_active()))', t);
  execute format('create policy %1$s_active_upd on %1$s as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()))', t);
  execute format('create policy %1$s_active_del on %1$s as restrictive for delete to authenticated using ((select auth_tenant_active()))', t);
end $$;
revoke all on function apply_std_policies(regclass, text[], text[], text[]) from public, anon, authenticated;

-- security review of 0037: editing someone else's open record and then approving it dodged the self-approval rule.
-- Any content edit to an open record now makes the editor its submitter.
create or replace function guard_locked() returns trigger language plpgsql security definer set search_path = public as $$
declare
  approvers text[] := string_to_array(tg_argv[0], ',');
  free text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}') || '{status,updated_at}'::text[];
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
      raise exception 'save changes before approving %', tg_table_name;  -- no edit-and-approve in one statement
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

  -- still open: editable, but nobody forges the stamps or skips to a locked state; whoever edits or submits owns it
  if new.status is distinct from old.status and not (new.status = any (open_states)) then
    raise exception '% must be approved before it can be %', tg_table_name, new.status;
  end if;
  return jsonb_populate_record(new, jsonb_build_object('approved_by', o->'approved_by', 'approved_at', o->'approved_at',
    'submitted_by', case when auth.uid() is not null
                          and ((to_jsonb(new) - free - stamps) <> (o - free - stamps) or (new.status = 'submitted' and old.status <> 'submitted'))
                         then to_jsonb(auth.uid()) else o->'submitted_by' end));
end $$;
revoke all on function guard_locked() from public, anon, authenticated;

-- numeric rule with default
create function rule_num(p_tenant uuid, p_key text, p_default numeric) returns numeric language sql stable as $$
  select (tenant_rule_value(p_tenant, p_key, to_jsonb(p_default)))::text::numeric
$$;

-- tenant-wide alert (notification is readable by the tenant; push/realtime pick it up — 0023). Called from invoker
-- triggers, so signed-in users can execute it — but only for their own tenant (they can already insert notifications).
create or replace function raise_alert(p_tenant uuid, p_severity text, p_title text, p_body text, p_entity text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not auth_is_platform() and p_tenant is distinct from auth_tenant_id() then
    raise exception 'alert for another tenant';
  end if;
  insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id)
  values (p_tenant, 'alert', p_severity, p_title, p_body, p_entity, p_id);
end $$;
revoke all on function raise_alert(uuid, text, text, text, text, uuid) from public, anon;

-- ---------------------------------------------------------------- flock placement by sex
alter table batch add column females_placed int check (females_placed >= 0),
                  add column males_placed int check (males_placed >= 0),
                  add constraint batch_sex_split check (females_placed is null or males_placed is null or females_placed + males_placed = doc_count);
alter table breed_standard_curve add column std_male_weight_g int;

-- ---------------------------------------------------------------- daily breeder record (technician -> farm manager approves)
create table breeder_daily (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,
  log_date date not null,
  female_mort int not null default 0 check (female_mort >= 0),
  male_mort int not null default 0 check (male_mort >= 0),
  female_culls int not null default 0 check (female_culls >= 0),
  male_culls int not null default 0 check (male_culls >= 0),
  feed_f_kg numeric(10,2) check (feed_f_kg >= 0),
  feed_m_kg numeric(10,2) check (feed_m_kg >= 0),
  diet_stage text check (diet_stage in ('starter','grower','pre_breeder','breeder_1','breeder_2')),
  cleanup_hours numeric(4,1) check (cleanup_hours between 0 and 24),
  water_l numeric(10,1) check (water_l >= 0),
  water_treatment text check (water_treatment in ('none','chlorine','sanitizer','medication')),
  water_quality text check (water_quality in ('normal','cloudy','discolored','odor')),
  light_hours numeric(4,1) check (light_hours between 0 and 24),
  remarks text check (length(remarks) <= 500),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (batch_id, log_date)
);

create function breeder_daily_check() returns trigger language plpgsql as $$
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
  if tg_op = 'INSERT' then
    lim := rule_num(new.tenant_id, 'breeder_mortality_alert_pct', 0.5);
    if f_open > 0 and new.female_mort * 100.0 / f_open > lim or m_open > 0 and new.male_mort * 100.0 / m_open > lim then
      perform raise_alert(new.tenant_id, 'critical', 'High mortality · ' || b.code,
        format('%s F / %s M dead on %s (limit %s%%/day)', new.female_mort, new.male_mort, new.log_date, lim), 'batch', b.id);
    end if;
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
create trigger breeder_daily_check before insert or update on breeder_daily for each row execute function breeder_daily_check();
create trigger breeder_daily_lock before insert or update or delete on breeder_daily for each row
  execute function guard_locked('tenant_owner,farm_manager', '', '');
select apply_std_policies('breeder_daily', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager}');

-- per day: birds alive, mortality %, feed and water per bird (spec §2, §4, §5)
create view breeder_flock_day with (security_invoker = true) as
select d.tenant_id, d.batch_id, d.log_date, d.status,
       b.females_placed - coalesce(sum(d.female_mort + d.female_culls) over w_prev, 0) as females_open,
       b.males_placed - coalesce(sum(d.male_mort + d.male_culls) over w_prev, 0) as males_open,
       b.females_placed - sum(d.female_mort + d.female_culls) over w_upto as females_left,
       b.males_placed - sum(d.male_mort + d.male_culls) over w_upto as males_left,
       round(d.female_mort * 100.0 / nullif(b.females_placed - coalesce(sum(d.female_mort + d.female_culls) over w_prev, 0), 0), 3) as female_mort_pct,
       round(d.male_mort * 100.0 / nullif(b.males_placed - coalesce(sum(d.male_mort + d.male_culls) over w_prev, 0), 0), 3) as male_mort_pct,
       round(sum(d.female_mort + d.male_mort) over w_upto * 100.0 / nullif(b.doc_count, 0), 2) as cum_mort_pct,
       round(d.feed_f_kg * 1000 / nullif(b.females_placed - coalesce(sum(d.female_mort + d.female_culls) over w_prev, 0), 0)) as feed_g_per_female,
       round(d.feed_m_kg * 1000 / nullif(b.males_placed - coalesce(sum(d.male_mort + d.male_culls) over w_prev, 0), 0)) as feed_g_per_male,
       round(d.water_l * 1000 / nullif(b.doc_count - coalesce(sum(d.female_mort + d.female_culls + d.male_mort + d.male_culls) over w_prev, 0), 0)) as water_ml_per_bird,
       round(d.water_l / nullif(coalesce(d.feed_f_kg, 0) + coalesce(d.feed_m_kg, 0), 0), 2) as water_feed_ratio,
       d.diet_stage, d.cleanup_hours, d.light_hours
from breeder_daily d join batch b on b.id = d.batch_id
window w_prev as (partition by d.batch_id order by d.log_date rows between unbounded preceding and 1 preceding),
       w_upto as (partition by d.batch_id order by d.log_date rows between unbounded preceding and current row);

-- production calendar (spec §1): light stimulation placement+21 wk, first egg +25 wk; peak/depletion are rules
create view breeder_calendar with (security_invoker = true) as
select b.tenant_id, b.id as batch_id, b.code, b.placed_on,
       b.placed_on + 7 * 21 as light_stimulation_on,
       b.placed_on + 7 * 25 as first_egg_on,
       b.placed_on + 7 * rule_num(b.tenant_id, 'breeder_peak_week', 30)::int as peak_on,
       b.placed_on + 7 * rule_num(b.tenant_id, 'breeder_depletion_week', 64)::int as depletion_on,
       ((now() at time zone 'Asia/Kolkata')::date - b.placed_on) / 7 as age_weeks
from batch b where b.farm_type = 'breeder';

-- ---------------------------------------------------------------- weekly body weight per sex (spec §3)
create table body_weight_record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,
  weighed_on date not null,
  sex char(1) not null check (sex in ('F','M')),
  sample_size int not null check (sample_size > 0),
  avg_g int not null check (avg_g > 0),
  uniformity_pct numeric(5,2) check (uniformity_pct between 0 and 100),
  cv_pct numeric(5,2) check (cv_pct between 0 and 100),
  fleshing_score smallint check (fleshing_score between 1 and 5),   -- males: 1 sunken V … 5 dimpled U
  entered_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  unique (batch_id, weighed_on, sex),
  check (sex = 'M' or fleshing_score is null)
);
create function body_weight_check() returns trigger language plpgsql as $$
declare b record; std int; lim numeric;
begin
  select * into b from batch where id = new.batch_id;
  if not found or b.tenant_id <> new.tenant_id or b.farm_type <> 'breeder' then raise exception 'not a breeder flock'; end if;
  if new.weighed_on < b.placed_on then raise exception 'weighed before placement'; end if;
  select case when new.sex = 'F' then c.std_weight_g else c.std_male_weight_g end into std
    from breed_standard_curve c where c.breed_id = b.breed_id and c.age_week = (new.weighed_on - b.placed_on) / 7;
  lim := rule_num(new.tenant_id, 'body_weight_alert_pct', 10);
  if tg_op = 'INSERT' and std > 0 and abs(new.avg_g - std) * 100.0 / std > lim then
    perform raise_alert(new.tenant_id, 'warning', 'Body weight off standard · ' || b.code,
      format('%s %s g vs standard %s g — review feed allocation', case new.sex when 'F' then 'Females' else 'Males' end, new.avg_g, std), 'batch', b.id);
  end if;
  return new;
end $$;
create trigger body_weight_check before insert or update on body_weight_record for each row execute function body_weight_check();
select apply_std_policies('body_weight_record', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager,shed_supervisor}', '{tenant_owner,farm_manager}');

create view body_weight_vs_standard with (security_invoker = true) as
select w.*, (w.weighed_on - b.placed_on) / 7 as age_week,
       case when w.sex = 'F' then c.std_weight_g else c.std_male_weight_g end as std_g,
       w.avg_g - case when w.sex = 'F' then c.std_weight_g else c.std_male_weight_g end as diff_g,
       w.sample_size >= least(case when w.sex = 'F' then 50 else 15 end,
                              ceil((case when w.sex = 'F' then b.females_placed else b.males_placed end) * case when w.sex = 'F' then 0.02 else 0.10 end)) as sample_ok
from body_weight_record w join batch b on b.id = w.batch_id
left join breed_standard_curve c on c.breed_id = b.breed_id and c.age_week = (w.weighed_on - b.placed_on) / 7;

-- ---------------------------------------------------------------- environment readings: houses now, machines in WP 1.7
create table env_reading (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  shed_id uuid references shed(id) on delete cascade,
  asset_id uuid references asset(id) on delete cascade,
  read_at timestamptz not null,
  temp_c numeric(4,1) check (temp_c between -20 and 60),
  wet_bulb_c numeric(4,1) check (wet_bulb_c between -20 and 60),
  rh_pct numeric(4,1) check (rh_pct between 0 and 100),
  nh3_ppm numeric(5,1) check (nh3_ppm >= 0),
  co2_ppm int check (co2_ppm >= 0),
  lux numeric(6,1) check (lux >= 0),
  fan_rpm int check (fan_rpm >= 0),
  ventilation text check (ventilation in ('normal','reduced','off')),
  litter text check (litter in ('good','damp','wet','caked')),
  power text check (power in ('mains','generator','off')),
  alarm boolean,
  source text not null default 'manual' check (source in ('manual','sensor')),
  entered_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  check ((shed_id is null) <> (asset_id is null))
);
create unique index env_reading_shed_at on env_reading (shed_id, read_at) where shed_id is not null;
create unique index env_reading_asset_at on env_reading (asset_id, read_at) where asset_id is not null;

create function env_reading_check() returns trigger language plpgsql as $$
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
    if tg_op = 'INSERT' and cardinality(issues) > 0 then
      perform raise_alert(new.tenant_id, 'warning', 'House conditions · ' || s.name, array_to_string(issues, ', '), 'shed', new.shed_id);
    end if;
  elsif not exists (select 1 from asset where id = new.asset_id and tenant_id = new.tenant_id) then
    raise exception 'unknown machine';
  end if;
  return new;
end $$;
create trigger env_reading_check before insert or update on env_reading for each row execute function env_reading_check();
select apply_std_policies('env_reading',
  '{tenant_owner,farm_manager,shed_supervisor,hatchery_technician,hatchery_ops_manager}',
  '{tenant_owner,farm_manager,hatchery_ops_manager}', '{tenant_owner,farm_manager,hatchery_ops_manager}');

-- ---------------------------------------------------------------- health (spec §8): medication + biosecurity
create table medication_record (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,
  given_on date not null,
  medicine text not null check (length(medicine) between 1 and 120),
  item_id uuid references item(id),
  dosage text not null check (length(dosage) <= 60),          -- e.g. '0.5 g/L'
  duration_days int not null check (duration_days between 1 and 90),
  reason text not null check (length(reason) between 1 and 500),
  prescribed_by text check (length(prescribed_by) <= 120),
  withdrawal_days int check (withdrawal_days between 0 and 120),
  entered_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now()
);
select apply_std_policies('medication_record', '{tenant_owner,farm_manager,veterinarian}', '{tenant_owner,farm_manager,veterinarian}', '{tenant_owner,farm_manager}');

create table biosecurity_incident (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  farm_id uuid not null references farm(id) on delete cascade,
  shed_id uuid references shed(id),
  occurred_on date not null,
  nature text not null check (length(nature) between 3 and 500),
  birds_affected int check (birds_affected >= 0),
  action_taken text check (length(action_taken) <= 1000),
  responsible text check (length(responsible) <= 120),
  follow_up_on date,
  closed_on date,
  entered_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now(),
  check (follow_up_on is null or follow_up_on >= occurred_on),
  check (closed_on is null or closed_on >= occurred_on)
);
select apply_std_policies('biosecurity_incident',
  '{tenant_owner,farm_manager,shed_supervisor,veterinarian,hatchery_ops_manager}',
  '{tenant_owner,farm_manager,veterinarian,hatchery_ops_manager}', '{tenant_owner,farm_manager}');
