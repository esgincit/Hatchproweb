-- 0049: security review of 0046/0047.
-- 1. deposit_waived_by could be forged by the client (a non-null value kept a fake waiver). It is never taken from
--    the client now: only an owner waiving stamps it, and an old waiver survives only while the deposit hasn't grown.
-- 2. the credit check ran on INSERT only and trusted a client-sent paid. It now also runs when total or customer
--    changes, and ignores paid on insert (payments flows set paid).

create or replace function sales_order_guard() returns trigger language plpgsql as $$
declare p record; roles text[] := auth_roles(); staff boolean := auth.uid() is not null and current_user in ('authenticated', 'anon');
        prior_waiver uuid := case when tg_op = 'UPDATE' then old.deposit_waived_by end;
begin
  new.deposit_waived_by := null;                                                   -- never from the client
  select * into p from chick_product where id = new.product_id;
  new.deposit_pct := deposit_pct_for(new.tenant_id, new.qty);
  new.deposit_due := round(new.qty * new.price * new.deposit_pct / 100, 2);
  if staff and new.price < coalesce(p.price, 0) and (tg_op = 'INSERT' or new.price <> old.price)
     and not (roles && '{tenant_owner,hatchery_manager}') then
    raise exception 'price below the list price of % needs the owner or hatchery manager', p.price;
  end if;
  if new.deposit_due = 0 then
    if new.payment_status = 'pending' then new.payment_status := 'waived'; end if;
  elsif new.payment_status = 'waived' then
    if prior_waiver is not null and old.payment_status = 'waived' and new.deposit_due <= old.deposit_due then
      new.deposit_waived_by := prior_waiver;                                       -- the owner's waiver stands
    elsif staff and 'tenant_owner' = any (roles) then
      new.deposit_waived_by := auth.uid();
    elsif not staff then
      new.deposit_waived_by := prior_waiver;                                       -- internal / service code
    elsif tg_op = 'UPDATE' and old.payment_status = 'waived' then
      new.payment_status := 'pending';                                             -- deposit grew past the waiver
    else
      raise exception 'only the owner can waive a deposit';
    end if;
  end if;
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

create or replace function invoice_credit_check() returns trigger language plpgsql as $$
declare c record; owed numeric; policy text; due numeric;
begin
  if new.dispatch_line_id is not null then return new; end if;                 -- chick orders: checked at confirmation
  select * into c from customer where id = new.customer_id;
  if coalesce(c.credit_limit, 0) <= 0 then return new; end if;
  select coalesce(sum(total - paid), 0) into owed from invoice where customer_id = c.id and status <> 'paid' and id <> new.id;
  due := new.total - case when tg_op = 'INSERT' then 0 else least(new.paid, old.paid) end;   -- paid moves only via payments
  if owed + due <= c.credit_limit then return new; end if;
  policy := tenant_rule_value(new.tenant_id, 'credit_limit_policy', '"warn"') #>> '{}';
  if policy = 'block' and auth.uid() is not null and not (auth_roles() && '{tenant_owner}') then
    raise exception '% would owe % — over the credit limit of %', c.name, owed + due, c.credit_limit;
  end if;
  if auth.uid() is not null then
    perform raise_alert(new.tenant_id, 'warning', 'Over credit limit · ' || c.name,
      format('owes %s after invoice %s (limit %s)', owed + due, new.invoice_no, c.credit_limit), 'customer', c.id);
  end if;
  return new;
end $$;
drop trigger invoice_credit_check on invoice;
create trigger invoice_credit_check before insert or update of total, customer_id on invoice for each row execute function invoice_credit_check();
