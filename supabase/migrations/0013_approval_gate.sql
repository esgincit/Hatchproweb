-- 0013: the ₹50,000 owner-approval rule is enforced on the tables, not just in record_payment.
-- Gate on the BILL total (not the single payment) so splitting a big bill into small payments doesn't dodge it.
create or replace function auth_is_owner() returns boolean language sql stable as $$
  select 'tenant_owner' = any(auth_roles()) or auth_is_platform() $$;

-- payments against a bill over ₹50,000 can only be written by the owner (decide_payment runs as the owner)
create or replace function payment_gate() returns trigger language plpgsql as $$
begin
  if new.ref_type = 'bill' and not auth_is_owner()
     and exists (select 1 from bill where id = new.ref_id and total > 50000) then
    raise exception 'payments on bills over 50000 need owner approval';
  end if;
  return new;
end $$;
drop trigger if exists payment_gate on payment;
create trigger payment_gate before insert or update on payment for each row execute function payment_gate();

-- nobody but the owner moves paid/total on a big bill (no "lower the total, then pay" trick)
create or replace function bill_gate() returns trigger language plpgsql as $$
begin
  if not auth_is_owner() and greatest(old.total, new.total) > 50000
     and (new.paid is distinct from old.paid or new.total is distinct from old.total) then
    raise exception 'only the owner can change payment on bills over 50000';
  end if;
  return new;
end $$;
drop trigger if exists bill_gate on bill;
create trigger bill_gate before update on bill for each row execute function bill_gate();

-- requests are always born pending
drop policy if exists payment_approval_ins on payment_approval;
create policy payment_approval_ins on payment_approval as restrictive for insert
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance') and status = 'pending' and decided_by is null and decided_at is null
              and requested_by = auth.uid()
              and exists (select 1 from bill b where b.id = bill_id and b.tenant_id = auth_tenant_id()));

create or replace function record_payment(p_kind text, p_id uuid, p_amount numeric, p_mode text, p_date date, p_utr text default null)
returns text language plpgsql security invoker as $$
declare r record; st pay_status;
begin
  if p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_kind = 'bill' then
    select id, vendor_id as party, total, paid into r from bill where id = p_id for update;
  elsif p_kind = 'invoice' then
    select id, customer_id as party, total, paid into r from invoice where id = p_id for update;
  else
    raise exception 'kind must be bill or invoice';
  end if;
  if not found then raise exception 'document not found'; end if;
  if p_amount > r.total - r.paid + 0.005 then raise exception 'amount exceeds outstanding'; end if;
  if p_kind = 'bill' and r.total > 50000 and not auth_is_owner() then
    if exists (select 1 from payment_approval where bill_id = p_id and status = 'pending') then
      raise exception 'a payment on this bill is already waiting for owner approval';
    end if;
    insert into payment_approval (bill_id, amount, mode, paid_on, utr, requested_by)
      values (p_id, p_amount, p_mode, p_date, nullif(p_utr, ''), auth.uid());
    return 'pending';
  end if;
  insert into payment (direction, party_type, party_id, ref_type, ref_id, amount, mode, paid_on, utr)
    values (case when p_kind = 'bill' then 'out' else 'in' end, case when p_kind = 'bill' then 'vendor' else 'customer' end,
            r.party, p_kind, p_id, p_amount, p_mode, p_date, nullif(p_utr, ''));
  st := case when r.paid + p_amount >= r.total - 0.005 then 'paid' else 'partial' end;
  if p_kind = 'bill' then update bill set paid = paid + p_amount, status = st where id = p_id;
  else update invoice set paid = paid + p_amount, status = st where id = p_id; end if;
  return 'paid';
end $$;
