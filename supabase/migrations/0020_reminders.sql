-- 0020: payment reminders sent to customers (WhatsApp click-to-chat now; Business API later).
-- An append-only log: who reminded which customer, about which invoices, for how much, in which language.
-- Money roles write it; nobody edits or deletes it (platform staff excepted); a suspended tenant can't add to it.
create table reminder_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  customer_id uuid not null references customer(id) on delete cascade,
  invoice_ids uuid[] not null check (cardinality(invoice_ids) between 1 and 50),
  amount numeric(14,2) not null check (amount > 0),
  channel text not null check (channel in ('wa_link', 'wa_api')),
  lang text not null check (lang in ('en', 'te', 'hi', 'ta', 'kn')),
  sent_by uuid not null default auth.uid() references app_user(id),
  sent_at timestamptz not null default now()
);
create index reminder_log_customer on reminder_log (tenant_id, customer_id, sent_at desc);

alter table reminder_log enable row level security;
create policy reminder_log_tenant_isolation on reminder_log
  using (auth_is_platform() or tenant_id = auth_tenant_id())
  with check (auth_is_platform() or tenant_id = auth_tenant_id());

-- writers: owner / manager / finance (lib/auth/permissions.ts ACT_ROLES.remind), as themselves, about their own
-- customer's invoices (customer + invoice reads are tenant-RLS'd, so foreign ids simply don't qualify)
create policy reminder_log_roles_ins on reminder_log as restrictive for insert with check (
  auth_has_role('tenant_owner', 'farm_manager', 'finance')
  and (auth_is_platform() or sent_by = auth.uid())
  and exists (select 1 from customer c where c.id = reminder_log.customer_id)
  and not exists (
    select 1 from unnest(reminder_log.invoice_ids) as x(id)
    where not exists (select 1 from invoice v where v.id = x.id and v.customer_id = reminder_log.customer_id)
  )
);
create policy reminder_log_no_upd on reminder_log as restrictive for update using (auth_is_platform());
create policy reminder_log_no_del on reminder_log as restrictive for delete using (auth_is_platform());

-- same suspension lock as every other tenant table (0017)
create policy reminder_log_active_ins on reminder_log as restrictive for insert to authenticated with check ((select auth_tenant_active()));
create policy reminder_log_active_upd on reminder_log as restrictive for update to authenticated using ((select auth_tenant_active())) with check ((select auth_tenant_active()));
create policy reminder_log_active_del on reminder_log as restrictive for delete to authenticated using ((select auth_tenant_active()));
