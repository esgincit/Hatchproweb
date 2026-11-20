-- 0059: security review of 0056/0057.
-- 1. Portal link: refuse marketplace vendor and platform-staff logins too, and never move a login that is already
--    linked to another customer (the owner removes the old link first). Still one generic message (no enumeration).
--    ponytail: owner-side link by confirmed email; a customer-accepted invite code is the upgrade if squatting shows up.
create or replace function link_portal_user(p_customer uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not auth_has_role('tenant_owner') then raise exception 'only the owner can give portal access'; end if;
  if not exists (select 1 from customer where id = p_customer and tenant_id = auth_tenant_id()) then raise exception 'customer not found'; end if;
  select id into v_user from auth.users
   where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null
     and coalesce(raw_app_meta_data ->> 'platform', 'false') <> 'true';
  if v_user is null or exists (select 1 from app_user where id = v_user)
     or exists (select 1 from advertiser where user_id = v_user)
     or exists (select 1 from customer_portal_user where user_id = v_user and (tenant_id <> auth_tenant_id() or customer_id <> p_customer)) then
    raise exception 'cannot link that email: the customer must sign up first with this email';
  end if;
  insert into customer_portal_user (user_id, tenant_id, customer_id) values (v_user, auth_tenant_id(), p_customer)
  on conflict (user_id) do nothing;
  perform audit_add(auth_tenant_id(), 'portal_link', 'customer', p_customer, null, jsonb_build_object('user_id', v_user));
end $$;

-- 2. POs: record who raised them, so rule allow_self_approval (owner sets it false for segregation of duties)
--    stops the same person raising and approving, exactly as guard_locked does for the other approval tables.
alter table purchase_order add column created_by uuid default auth.uid();

create or replace function po_threshold() returns trigger language plpgsql as $$
declare lim numeric := (tenant_rule_value(new.tenant_id, 'po_approval_above', 'null') #>> '{}')::numeric;
        self_ok boolean := (tenant_rule_value(new.tenant_id, 'allow_self_approval', 'true'))::boolean;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted', 'approved') then raise exception 'a new purchase order starts as draft, submitted or approved'; end if;
    if lim is not null and new.total > lim and new.status = 'approved' then new.status := 'submitted'; end if;
    if new.status = 'approved' and auth.uid() is not null and not self_ok then new.status := 'submitted'; end if; -- someone else approves
    return new;
  end if;
  if new.created_by is distinct from old.created_by then raise exception 'the creator of a purchase order cannot be changed'; end if;
  if new.status is distinct from old.status and not (old.status::text || '>' || new.status::text = any (
       '{draft>submitted,draft>cancelled,submitted>draft,submitted>approved,submitted>cancelled,approved>partial,approved>closed,approved>cancelled,partial>closed,partial>partial}'::text[])) then
    raise exception 'purchase order can''t go from % to %', old.status, new.status;
  end if;
  if old.status in ('draft', 'submitted') and new.status = 'approved' then
    if auth.uid() is not null and not (effective_roles() && '{tenant_owner,procurement_officer}') then
      raise exception 'only the owner or procurement officer can approve purchase orders';
    end if;
    if auth.uid() is not null and auth.uid() = old.created_by and not self_ok then
      raise exception 'the person who raised this purchase order cannot approve it';
    end if;
  end if;
  if old.status in ('approved', 'partial', 'closed') and new.total > old.total and lim is not null and new.total > lim then
    raise exception 'an approved purchase order can''t grow past % — raise a new one', lim;
  end if;
  return new;
end $$;

-- 3. PO lines: the procurement officer adds and edits lines but, like the PO itself, does not delete them.
--    Reads keep the same role restriction the single FOR ALL policy had.
drop policy po_line_roles on po_line;
create policy po_line_roles_sel on po_line as restrictive for select
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));
create policy po_line_roles_ins on po_line as restrictive for insert
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));
create policy po_line_roles_upd on po_line as restrictive for update
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'))
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));
create policy po_line_roles_del on po_line as restrictive for delete
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper'));
