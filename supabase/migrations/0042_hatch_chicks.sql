-- 0042: ERP WP 1.9–1.10 — full hatch result + Hatchery Manager approval, chick quality inspection, chick vaccination
-- (expired vaccine: warn by default, tenant rule can block with an authorised override — C1), chick stock, hatchery
-- KPIs per C1 (HES, HOF, hatch of transfer, embryo mortality early/mid/late/total, cull %, DIH %, waste %,
-- egg-to-chick), and per-flock feedback (proportional + flagged when a setting mixed sources).
-- Chicks hatched = grade A + grade B + culls; saleable = A + B.

alter table hatch_record add column id uuid not null default gen_random_uuid() unique,
                         add column dead_in_hatcher int check (dead_in_hatcher >= 0),
                         add column unhatched int check (unhatched >= 0),
                         add column status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
                         add column submitted_by uuid references app_user(id),
                         add column approved_by uuid references app_user(id),
                         add column approved_at timestamptz,
                         add column reject_reason text;
create function hatch_approve_check() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and new.hatched_on is null then raise exception 'record the hatch before approving'; end if;
  return new;
end $$;
create trigger hatch_approve_check before update on hatch_record for each row execute function hatch_approve_check();
create trigger hatch_record_lock before insert or update or delete on hatch_record for each row
  execute function guard_locked('tenant_owner,hatchery_manager', '', '');
-- hatchery staff record hatches too (0025 allowed owner/manager/supervisor)
drop policy hatch_record_roles_ins on hatch_record;
drop policy hatch_record_roles_upd on hatch_record;
create policy hatch_record_roles_ins on hatch_record as restrictive for insert
  with check ((select auth_roles()) && '{tenant_owner,farm_manager,shed_supervisor,hatchery_technician,hatchery_ops_manager,hatchery_manager}');
create policy hatch_record_roles_upd on hatch_record as restrictive for update
  using ((select auth_roles()) && '{tenant_owner,farm_manager,shed_supervisor,hatchery_technician,hatchery_ops_manager,hatchery_manager}');

-- ---------------------------------------------------------------- chick quality (Vet Lead / Hatchery Manager approve)
create table chick_quality_inspection (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null unique references batch(id) on delete cascade,
  inspected_on date not null,
  sample_size int not null check (sample_size > 0),
  avg_weight_g numeric(5,1) check (avg_weight_g > 0),
  uniformity_pct numeric(5,2) check (uniformity_pct between 0 and 100),
  navel_defects int not null default 0 check (navel_defects >= 0),
  leg_defects int not null default 0 check (leg_defects >= 0),
  other_defects int not null default 0 check (other_defects >= 0),
  dispatch_eligible boolean not null,
  remarks text check (length(remarks) <= 500),
  status text not null default 'submitted' check (status in ('draft','submitted','approved','rejected')),
  submitted_by uuid default auth.uid() references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  check (navel_defects + leg_defects + other_defects <= sample_size)
);
create function chick_quality_check() returns trigger language plpgsql as $$
declare h record;
begin
  select r.*, b.tenant_id as b_tenant into h from hatch_record r join batch b on b.id = r.batch_id where r.batch_id = new.batch_id;
  if not found or h.b_tenant <> new.tenant_id or h.hatched_on is null then raise exception 'record the hatch first'; end if;
  if new.inspected_on < h.hatched_on then raise exception 'inspection before hatch'; end if;
  if new.sample_size > h.chicks_a + h.chicks_b then raise exception 'sample larger than saleable chicks'; end if;
  return new;
end $$;
create trigger chick_quality_check before insert or update on chick_quality_inspection for each row execute function chick_quality_check();
create trigger chick_quality_lock before insert or update or delete on chick_quality_inspection for each row
  execute function guard_locked('tenant_owner,veterinarian,hatchery_manager', '', '');
select apply_std_policies('chick_quality_inspection', '{tenant_owner,veterinarian,hatchery_manager,hatchery_ops_manager}',
  '{tenant_owner,veterinarian,hatchery_manager,hatchery_ops_manager}', '{tenant_owner,hatchery_manager}');

-- ---------------------------------------------------------------- chick vaccination at the hatchery (spec §9)
create table chick_vaccination (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  batch_id uuid not null references batch(id) on delete cascade,
  vaccine_id uuid not null references vaccine_master(id),
  vaccine_lot text not null check (length(vaccine_lot) between 1 and 40),
  expiry date not null,
  qty int not null check (qty > 0),
  given_at timestamptz not null default now(),
  operator uuid default auth.uid() references app_user(id),
  expired boolean not null default false,                       -- set by trigger: used past expiry
  expired_override_reason text check (length(expired_override_reason) <= 300),
  created_at timestamptz not null default now()
);
create index chick_vaccination_batch on chick_vaccination (batch_id);
create function chick_vaccination_check() returns trigger language plpgsql as $$
declare h record; used int; policy text;
begin
  select r.*, b.tenant_id as b_tenant into h from hatch_record r join batch b on b.id = r.batch_id where r.batch_id = new.batch_id;
  if not found or h.b_tenant <> new.tenant_id or h.hatched_on is null then raise exception 'record the hatch first'; end if;
  if not exists (select 1 from vaccine_master where id = new.vaccine_id and (tenant_id is null or tenant_id = new.tenant_id)) then
    raise exception 'unknown vaccine';
  end if;
  if (new.given_at at time zone 'Asia/Kolkata')::date < h.hatched_on then raise exception 'vaccinated before hatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.batch_id::text, 3));
  select coalesce(sum(qty), 0) into used from chick_vaccination where batch_id = new.batch_id and vaccine_id = new.vaccine_id and id <> new.id;
  if used + new.qty > h.chicks_a + h.chicks_b then
    raise exception 'only % saleable chicks; % already vaccinated with this vaccine', h.chicks_a + h.chicks_b, used;
  end if;
  new.expired := new.expiry < (new.given_at at time zone 'Asia/Kolkata')::date;
  new.operator := coalesce(auth.uid(), new.operator);
  if new.expired and (tg_op = 'INSERT' or not old.expired) then
    policy := tenant_rule_value(new.tenant_id, 'expired_vaccine_policy', '"warn"') #>> '{}';
    if policy = 'block' then
      if coalesce(btrim(new.expired_override_reason), '') = '' then raise exception 'vaccine lot % expired on % — not allowed', new.vaccine_lot, new.expiry; end if;
      if auth.uid() is not null and not (auth_roles() && '{tenant_owner,hatchery_manager}') then
        raise exception 'only the owner or hatchery manager can override an expired vaccine';
      end if;
    end if;
    perform raise_alert(new.tenant_id, 'critical', 'Expired vaccine used · lot ' || new.vaccine_lot,
      format('expired %s, given %s%s', new.expiry, (new.given_at at time zone 'Asia/Kolkata')::date,
             coalesce(' — override: ' || new.expired_override_reason, '')), 'batch', new.batch_id);
  end if;
  return new;
end $$;
create trigger chick_vaccination_check before insert or update on chick_vaccination for each row execute function chick_vaccination_check();
select apply_std_policies('chick_vaccination', '{tenant_owner,veterinarian,hatchery_manager,hatchery_technician}',
  '{tenant_owner,veterinarian,hatchery_manager}', '{tenant_owner,hatchery_manager}');

-- ---------------------------------------------------------------- KPIs per setting (C1 dictionary)
create view hatch_kpi with (security_invoker = true) as
select p.tenant_id, p.batch_id, p.code, p.set_on, p.eggs_set,
       coalesce(p.infertile, h.clears) as infertile,
       p.eggs_set - coalesce(p.infertile, h.clears) as fertile,
       p.early_dead, p.mid_dead, p.late_dead, p.dirty,
       coalesce(t.eggs, p.transfer_eggs) as transfer_eggs,
       h.hatched_on, h.chicks_a, h.chicks_b, h.culls, h.dead_in_hatcher, h.unhatched, h.status as hatch_status,
       h.chicks_a + h.chicks_b + h.culls as chicks_hatched,
       h.chicks_a + h.chicks_b as saleable,
       round(100.0 * (p.eggs_set - coalesce(p.infertile, h.clears)) / nullif(p.eggs_set, 0), 2) as fertility_pct,
       round(100.0 * (h.chicks_a + h.chicks_b + h.culls) / nullif(p.eggs_set, 0), 2) as hes_pct,
       round(100.0 * (h.chicks_a + h.chicks_b + h.culls) / nullif(p.eggs_set - coalesce(p.infertile, h.clears), 0), 2) as hof_pct,
       round(100.0 * (h.chicks_a + h.chicks_b + h.culls) / nullif(coalesce(t.eggs, p.transfer_eggs), 0), 2) as hatch_of_transfer_pct,
       round(100.0 * p.early_dead / nullif(p.eggs_set, 0), 2) as early_mortality_pct,
       round(100.0 * p.mid_dead / nullif(p.eggs_set, 0), 2) as mid_mortality_pct,
       round(100.0 * p.late_dead / nullif(p.eggs_set, 0), 2) as late_mortality_pct,
       round(100.0 * (p.early_dead + p.mid_dead + p.late_dead) / nullif(p.eggs_set, 0), 2) as embryo_mortality_pct,
       round(100.0 * h.culls / nullif(h.chicks_a + h.chicks_b + h.culls, 0), 2) as cull_pct,
       round(100.0 * h.dead_in_hatcher / nullif(coalesce(t.eggs, p.transfer_eggs), 0), 2) as dead_in_hatcher_pct,
       round(100.0 * h.unhatched / nullif(coalesce(t.eggs, p.transfer_eggs), 0), 2) as hatch_waste_pct,
       round(100.0 * (h.chicks_a + h.chicks_b) / nullif(p.eggs_set, 0), 2) as egg_to_chick_pct
from setting_progress p
left join hatch_record h on h.batch_id = p.batch_id
left join hatcher_transfer t on t.batch_id = p.batch_id;

-- chicks available per setting: saleable - sold as invoices (allocation joins in WP 1.12); quality + vaccine status
create view chick_stock with (security_invoker = true) as
select k.tenant_id, k.batch_id, k.code, k.hatched_on, k.saleable,
       extract(epoch from (now() - (k.hatched_on::timestamp at time zone 'Asia/Kolkata'))) / 3600 as age_hours,
       q.status as quality_status, coalesce(q.dispatch_eligible and q.status = 'approved', false) as quality_ok,
       v.vaccines, v.min_vaccinated,
       coalesce(v.vaccines > 0 and v.min_vaccinated >= k.saleable, false) as vaccinated_all,
       coalesce(s.sold, 0) as sold,
       k.saleable - coalesce(s.sold, 0) as available
from hatch_kpi k
left join chick_quality_inspection q on q.batch_id = k.batch_id
left join (select batch_id, count(*) as vaccines, min(n) as min_vaccinated
           from (select batch_id, vaccine_id, sum(qty) as n from chick_vaccination group by batch_id, vaccine_id) x group by batch_id) v on v.batch_id = k.batch_id
left join (select batch_id, sum(qty) as sold from invoice where product = 'doc' and batch_id is not null group by batch_id) s on s.batch_id = k.batch_id
where k.hatched_on is not null;

-- per-source setting results back to the farm (PS "Hatchery Feedback"); estimated when the setting mixed sources
create or replace view setting_trace with (security_invoker = true) as
select l.tenant_id, l.batch_id, s.code as setting_code, s.placed_on as set_on,
       t.id as transfer_id, t.ref as transfer_ref, t.flock_id, f.code as flock_code, t.source_vendor_id,
       t.laid_from, t.laid_to, l.qty as eggs_set,
       l.qty::numeric / sum(l.qty) over (partition by l.batch_id) as share,
       count(*) over (partition by l.batch_id) > 1 as estimated,
       coalesce(k.infertile, h.clears) * l.qty::numeric / s.doc_count as infertile,
       coalesce(k.early_dead + k.mid_dead + k.late_dead, h.dead_germ) * l.qty::numeric / s.doc_count as dead_germ,
       (h.chicks_a + h.chicks_b) * l.qty::numeric / s.doc_count as chicks,
       h.culls * l.qty::numeric / s.doc_count as culls,
       h.hatched_on
from setting_lot l
join batch s on s.id = l.batch_id
join egg_transfer t on t.id = l.transfer_id
left join batch f on f.id = t.flock_id
left join hatch_record h on h.batch_id = l.batch_id
left join hatch_kpi k on k.batch_id = l.batch_id;

create view flock_hatch_feedback with (security_invoker = true) as
select tr.tenant_id, tr.flock_id, tr.flock_code, tr.batch_id, tr.setting_code, tr.set_on, tr.hatched_on, tr.estimated, tr.eggs_set,
       round(100.0 * (tr.eggs_set - tr.infertile) / nullif(tr.eggs_set, 0), 2) as fertility_pct,
       round(100.0 * (tr.chicks + tr.culls) / nullif(tr.eggs_set, 0), 2) as hes_pct,
       round(100.0 * (tr.chicks + tr.culls) / nullif(tr.eggs_set - tr.infertile, 0), 2) as hof_pct,
       round(100.0 * tr.dead_germ / nullif(tr.eggs_set, 0), 2) as embryo_mortality_pct,
       round(100.0 * tr.culls / nullif(tr.chicks + tr.culls, 0), 2) as cull_pct
from setting_trace tr where tr.flock_id is not null;
