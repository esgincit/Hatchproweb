-- 0029: contract (integrator) broiler farming — roadmap Phase 7. Terms per integrator; a broiler batch links to one;
-- at harvest the farm records what the integrator lifted and the growing charge (lib/settlement.ts) is invoiced to
-- the integrator in the same transaction. One settlement per batch; settlements are never edited (audit).
create table contract (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  customer_id uuid not null references customer(id),
  name text not null check (length(name) between 1 and 120),
  base_rate numeric(8,2) not null check (base_rate > 0),
  std_fcr numeric(5,3) not null check (std_fcr between 1 and 4),
  fcr_bonus numeric(6,2) not null default 0 check (fcr_bonus >= 0),
  fcr_penalty numeric(6,2) not null default 0 check (fcr_penalty >= 0),
  min_rate numeric(8,2) not null default 0 check (min_rate >= 0),
  allowed_mort_pct numeric(5,2) not null default 5 check (allowed_mort_pct between 0 and 100),
  mort_penalty numeric(8,2) not null default 0 check (mort_penalty >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table batch add column contract_id uuid references contract(id);

create table contract_settlement (
  batch_id uuid primary key references batch(id) on delete cascade,
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  contract_id uuid not null references contract(id),
  settled_on date not null,
  lifted_birds int not null check (lifted_birds > 0),
  lifted_kg numeric(12,2) not null check (lifted_kg > 0),
  feed_kg numeric(12,2) not null check (feed_kg >= 0),
  dead int not null check (dead >= 0),
  fcr numeric(6,3) not null,
  rate numeric(8,2) not null,
  mort_charge numeric(12,2) not null,
  net numeric(14,2) not null check (net >= 0),
  invoice_no text,
  created_by uuid default auth.uid() references app_user(id),
  created_at timestamptz not null default now()
);

-- settlement + growing-charge invoice together (create_sale enforces invoice RLS = money roles)
create function record_settlement(p_batch uuid, p_date date, p_lifted_birds int, p_lifted_kg numeric, p_feed_kg numeric,
  p_dead int, p_fcr numeric, p_rate numeric, p_mort_charge numeric, p_net numeric)
returns text language plpgsql security invoker as $$
declare b record; no text;
begin
  select id, contract_id, farm_type into b from batch where id = p_batch for update;
  if not found or b.farm_type <> 'broiler' then raise exception 'not a broiler batch'; end if;
  if b.contract_id is null then raise exception 'batch has no contract'; end if;
  if exists (select 1 from contract_settlement where batch_id = p_batch) then raise exception 'batch already settled'; end if;
  if p_net <= 0 then raise exception 'nothing to invoice'; end if;
  no := create_sale((select customer_id from contract where id = b.contract_id), 'gc', 1, 'statement', p_net, p_date, p_batch);
  insert into contract_settlement (batch_id, contract_id, settled_on, lifted_birds, lifted_kg, feed_kg, dead, fcr, rate, mort_charge, net, invoice_no)
    values (p_batch, b.contract_id, p_date, p_lifted_birds, p_lifted_kg, p_feed_kg, p_dead, p_fcr, p_rate, p_mort_charge, p_net, no);
  return no;
end $$;

alter table contract enable row level security;
alter table contract_settlement enable row level security;
create policy contract_tenant_isolation on contract using (auth_is_platform() or tenant_id = auth_tenant_id()) with check (auth_is_platform() or tenant_id = auth_tenant_id());
create policy contract_settlement_tenant_isolation on contract_settlement using (auth_is_platform() or tenant_id = auth_tenant_id()) with check (auth_is_platform() or tenant_id = auth_tenant_id());
-- writers: owner / manager / finance (ACT_ROLES.addContract / settleContract); the integrator must be the tenant's customer
create policy contract_roles_ins on contract as restrictive for insert with check ((select auth_roles()) && '{tenant_owner,farm_manager,finance}'
  and exists (select 1 from customer c where c.id = contract.customer_id and c.tenant_id = contract.tenant_id));
create policy contract_roles_upd on contract as restrictive for update using ((select auth_roles()) && '{tenant_owner,farm_manager,finance}');
create policy contract_roles_del on contract as restrictive for delete using ((select auth_roles()) && '{tenant_owner}');
-- batch and contract must both be this tenant's (else a guessed foreign batch id could block that tenant's settlement)
create policy contract_settlement_roles_ins on contract_settlement as restrictive for insert with check ((select auth_roles()) && '{tenant_owner,farm_manager,finance}'
  and exists (select 1 from batch b where b.id = contract_settlement.batch_id and b.tenant_id = auth_tenant_id())
  and exists (select 1 from contract c where c.id = contract_settlement.contract_id and c.tenant_id = auth_tenant_id()));

-- a batch may only point at a contract of its own tenant
create function batch_contract_same_tenant() returns trigger language plpgsql as $$
begin
  if new.contract_id is not null and not exists (select 1 from contract c where c.id = new.contract_id and c.tenant_id = new.tenant_id) then
    raise exception 'contract belongs to another farm';
  end if;
  return new;
end $$;
create trigger batch_contract_same_tenant before insert or update of contract_id on batch for each row execute function batch_contract_same_tenant();
create policy contract_settlement_no_upd on contract_settlement as restrictive for update using (auth_is_platform());
create policy contract_settlement_no_del on contract_settlement as restrictive for delete using (auth_is_platform());
create policy contract_active_ins on contract as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy contract_active_upd on contract as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy contract_active_del on contract as restrictive for delete to authenticated using ((select auth_tenant_active()));
create policy contract_settlement_active_ins on contract_settlement as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy contract_settlement_active_upd on contract_settlement as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy contract_settlement_active_del on contract_settlement as restrictive for delete to authenticated using ((select auth_tenant_active()));
