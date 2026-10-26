-- 0025: hatchery workflow (roadmap Phase 4). A hatchery batch is one setting: batch.doc_count = eggs set,
-- batch.placed_on = set date, batch.source_vendor_id = breeder flock. hatch_record adds what happens next:
-- candling (clears = infertile, dead_germ = early/mid dead) and the hatch pull (grade A/B chicks, culls).
-- Chick dispatches are ordinary sales (invoice product 'doc', batch_id = the setting) — no table here.
create table hatch_record (
  batch_id uuid primary key references batch(id) on delete cascade,
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  candled_on date,
  clears int check (clears >= 0),
  dead_germ int check (dead_germ >= 0),
  hatched_on date,
  chicks_a int check (chicks_a >= 0),
  chicks_b int check (chicks_b >= 0),
  culls int check (culls >= 0),
  updated_by uuid default auth.uid() references app_user(id),
  updated_at timestamptz not null default now(),
  check ((candled_on is null) = (clears is null) and (clears is null) = (dead_germ is null)),
  check ((hatched_on is null) = (chicks_a is null) and (chicks_a is null) = (chicks_b is null) and (chicks_b is null) = (culls is null)),
  check (hatched_on is null or candled_on is null or hatched_on >= candled_on)
);

-- counts can't exceed the eggs set; only hatchery batches of the same tenant
create function hatch_record_check() returns trigger language plpgsql as $$
declare b record;
begin
  select farm_type, doc_count, placed_on, tenant_id into b from batch where id = new.batch_id;
  if not found or b.farm_type <> 'hatchery' or b.tenant_id <> new.tenant_id then raise exception 'not a hatchery setting'; end if;
  if least(coalesce(new.candled_on, b.placed_on), coalesce(new.hatched_on, b.placed_on)) < b.placed_on then
    raise exception 'date is before the eggs were set';
  end if;
  if coalesce(new.clears, 0) + coalesce(new.dead_germ, 0) > b.doc_count then
    raise exception 'clears + dead germ (%) exceed eggs set (%)', coalesce(new.clears, 0) + coalesce(new.dead_germ, 0), b.doc_count;
  end if;
  if coalesce(new.chicks_a, 0) + coalesce(new.chicks_b, 0) + coalesce(new.culls, 0) > b.doc_count - coalesce(new.clears, 0) - coalesce(new.dead_germ, 0) then
    raise exception 'chicks + culls exceed fertile eggs left after candling';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger hatch_record_check before insert or update on hatch_record for each row execute function hatch_record_check();

alter table hatch_record enable row level security;
create policy hatch_record_tenant_isolation on hatch_record
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());
-- writers: owner / manager / shed supervisor (lib/auth/permissions.ts ACT_ROLES.hatchCandle / hatchResult)
create policy hatch_record_roles_ins on hatch_record as restrictive for insert with check ((select auth_roles()) && '{tenant_owner,farm_manager,shed_supervisor}');
create policy hatch_record_roles_upd on hatch_record as restrictive for update using ((select auth_roles()) && '{tenant_owner,farm_manager,shed_supervisor}');
create policy hatch_record_roles_del on hatch_record as restrictive for delete using ((select auth_roles()) && '{tenant_owner,farm_manager}');

create policy hatch_record_active_ins on hatch_record as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy hatch_record_active_upd on hatch_record as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy hatch_record_active_del on hatch_record as restrictive for delete to authenticated using ((select auth_tenant_active()));
