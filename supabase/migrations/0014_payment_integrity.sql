-- 0014: non-owners can only write payment rows that match a real document (the shape record_payment writes).
-- Owners/platform are trusted with corrections. Ledger rows are append-only for everyone else.
create or replace function payment_gate() returns trigger language plpgsql as $$
declare d record;
begin
  if auth_is_owner() or current_user in ('postgres', 'service_role') then return coalesce(new, old); end if; -- server-side jobs are trusted
  if tg_op <> 'INSERT' then raise exception 'only the owner can edit or delete payments'; end if;
  if new.direction = 'out' and new.ref_type = 'bill' and new.party_type = 'vendor' then
    select vendor_id as party, total, paid into d from bill where id = new.ref_id;
    if not found or new.party_id is distinct from d.party then raise exception 'payment does not match the bill'; end if;
    if d.total > 50000 then raise exception 'payments on bills over 50000 need owner approval'; end if;
  elsif new.direction = 'in' and new.ref_type = 'invoice' and new.party_type = 'customer' then
    select customer_id as party, total, paid into d from invoice where id = new.ref_id;
    if not found or new.party_id is distinct from d.party then raise exception 'payment does not match the invoice'; end if;
  else
    raise exception 'payments must be against a bill (out) or an invoice (in)';
  end if;
  if new.amount <= 0 or new.amount > d.total - d.paid + 0.005 then raise exception 'amount exceeds outstanding'; end if;
  return new;
end $$;
drop trigger if exists payment_gate on payment;
create trigger payment_gate before insert or update or delete on payment for each row execute function payment_gate();

-- big bills: non-owners create them unpaid and can't move paid/total/vendor afterwards
create or replace function bill_gate() returns trigger language plpgsql as $$
begin
  if auth_is_owner() or current_user in ('postgres', 'service_role') then return new; end if;
  if tg_op = 'INSERT' then
    if new.total > 50000 and (new.paid <> 0 or new.status <> 'unpaid') then raise exception 'new bills over 50000 start unpaid'; end if;
  elsif greatest(old.total, new.total) > 50000
     and (new.paid is distinct from old.paid or new.total is distinct from old.total or new.vendor_id is distinct from old.vendor_id) then
    raise exception 'only the owner can change payment, amount or vendor on bills over 50000';
  end if;
  return new;
end $$;
drop trigger if exists bill_gate on bill;
create trigger bill_gate before insert or update on bill for each row execute function bill_gate();
