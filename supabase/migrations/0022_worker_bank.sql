-- 0022: workers' bank details for the salary bulk-payment file (More → People → Wages → Bank file).
-- Kept out of `worker` on purpose: every farm role reads workers (attendance), but only the money roles
-- may see account numbers. One row per worker; tenant-isolated; locked while suspended (0017).
create table worker_bank (
  worker_id uuid primary key references worker(id) on delete cascade,
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  account_no text not null check (account_no ~ '^[0-9]{9,18}$'),
  ifsc text not null check (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  updated_by uuid default auth.uid() references app_user(id),
  updated_at timestamptz not null default now()
);

alter table worker_bank enable row level security;
create policy worker_bank_tenant_isolation on worker_bank
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());

-- owner / manager / finance only (ACT_ROLES.setBank). Not auth_has_role(): that lets every platform staff
-- member through, and no platform team needs farm workers' account numbers.
create policy worker_bank_roles_sel on worker_bank as restrictive for select using ((select auth_roles()) && '{tenant_owner,farm_manager,finance}');
create policy worker_bank_roles_ins on worker_bank as restrictive for insert with check (
  (select auth_roles()) && '{tenant_owner,farm_manager,finance}'
  and exists (select 1 from worker w where w.id = worker_bank.worker_id and w.tenant_id = worker_bank.tenant_id)
);
create policy worker_bank_roles_upd on worker_bank as restrictive for update using ((select auth_roles()) && '{tenant_owner,farm_manager,finance}')
  with check (exists (select 1 from worker w where w.id = worker_bank.worker_id and w.tenant_id = worker_bank.tenant_id));
create policy worker_bank_roles_del on worker_bank as restrictive for delete using ((select auth_roles()) && '{tenant_owner,farm_manager,finance}');

create policy worker_bank_active_ins on worker_bank as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy worker_bank_active_upd on worker_bank as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy worker_bank_active_del on worker_bank as restrictive for delete to authenticated using ((select auth_tenant_active()));
