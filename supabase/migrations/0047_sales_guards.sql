-- 0047: security review of 0043–0045.
-- 1. deposit_pct/deposit_due could be sent by the client on update, then 'waived' passed the owner check against
--    the client's 0. A last-word trigger now recomputes the deposit server-side on every write; a waiver of a real
--    deposit needs the owner (stamped in deposit_waived_by); a price below the product's list price needs the
--    owner or hatchery manager, locked or not.
-- 2. full_hatch_flow was client-settable: forced true on insert; only the owner may turn it off.
-- 3. approved allocations could be released by sales even after chicks were loaded: release = owner / hatchery
--    manager only, and never once dispatch lines exist.
-- 4. credit_override_reason could be set by anyone before confirmation, opening the dispatch payment gate: any
--    change needs the owner or hatchery manager and is stamped in credit_override_by.

alter table sales_order add column deposit_waived_by uuid references app_user(id),
                        add column credit_override_by uuid references app_user(id);

-- runs after sales_order_check (trigger names fire alphabetically), so it has the last word
create function sales_order_guard() returns trigger language plpgsql as $$
declare p record; roles text[] := auth_roles(); staff boolean := auth.uid() is not null and current_user in ('authenticated', 'anon');
begin
  select * into p from chick_product where id = new.product_id;
  new.deposit_pct := deposit_pct_for(new.tenant_id, new.qty);
  new.deposit_due := round(new.qty * new.price * new.deposit_pct / 100, 2);
  if staff and new.price < coalesce(p.price, 0) and (tg_op = 'INSERT' or new.price <> old.price)
     and not (roles && '{tenant_owner,hatchery_manager}') then
    raise exception 'price below the list price of % needs the owner or hatchery manager', p.price;
  end if;
  -- deposit waiver
  if new.deposit_due = 0 then
    if new.payment_status = 'pending' then new.payment_status := 'waived'; end if;
  elsif new.payment_status = 'waived' then
    if tg_op = 'UPDATE' and old.payment_status = 'waived' and old.deposit_waived_by is not null then
      new.deposit_waived_by := old.deposit_waived_by;                              -- an owner's waiver stands
    elsif staff and 'tenant_owner' = any (roles) then
      new.deposit_waived_by := auth.uid();
    elsif tg_op = 'UPDATE' and old.payment_status = 'waived' then
      new.payment_status := 'pending';                                             -- grew past the no-deposit slab
    elsif staff then
      raise exception 'only the owner can waive a deposit';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.deposit_waived_by is distinct from old.deposit_waived_by and new.payment_status <> 'waived' then
    new.deposit_waived_by := null;
  end if;
  -- credit override
  if (tg_op = 'INSERT' and new.credit_override_reason is not null)
     or (tg_op = 'UPDATE' and new.credit_override_reason is distinct from old.credit_override_reason) then
    if staff and not (roles && '{tenant_owner,hatchery_manager}') then raise exception 'only the owner or hatchery manager can override credit'; end if;
    new.credit_override_by := case when coalesce(btrim(new.credit_override_reason), '') = '' then null else auth.uid() end;
  elsif tg_op = 'UPDATE' then
    new.credit_override_by := old.credit_override_by;
  else
    new.credit_override_by := null;
  end if;
  return new;
end $$;
create trigger sales_order_guard before insert or update on sales_order for each row execute function sales_order_guard();

create function batch_flow_guard() returns trigger language plpgsql as $$
begin
  if auth.uid() is null or current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.full_hatch_flow := true;
  elsif new.full_hatch_flow is distinct from old.full_hatch_flow and not (auth_roles() && '{tenant_owner}') then
    raise exception 'only the owner can change the hatch flow of a setting';
  end if;
  return new;
end $$;
create trigger batch_flow_guard before insert or update on batch for each row execute function batch_flow_guard();

create function order_allocation_release() returns trigger language plpgsql as $$
begin
  if old.status = 'approved' and new.status = 'released' then
    if auth.uid() is not null and not (auth_roles() && '{tenant_owner,hatchery_manager}') then
      raise exception 'only the owner or hatchery manager can release an allocation';
    end if;
    if exists (select 1 from dispatch_line where allocation_id = new.id) then raise exception 'chicks of this allocation are already on a dispatch'; end if;
  end if;
  return new;
end $$;
create trigger order_allocation_release before update on order_allocation for each row execute function order_allocation_release();
