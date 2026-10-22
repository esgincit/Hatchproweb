-- 0015: on bills over ₹50,000 non-owners can't touch any money/ownership field (incl. status) or delete the bill.
create or replace function bill_gate() returns trigger language plpgsql as $$
begin
  if auth_is_owner() or current_user in ('postgres', 'service_role') then return coalesce(new, old); end if; -- server-side jobs are trusted
  if tg_op = 'INSERT' then
    if new.total > 50000 and (new.paid <> 0 or new.status <> 'unpaid') then raise exception 'new bills over 50000 start unpaid'; end if;
  elsif tg_op = 'DELETE' then
    if old.total > 50000 then raise exception 'only the owner can delete bills over 50000'; end if;
  elsif greatest(old.total, new.total) > 50000
     and (new.paid, new.total, new.vendor_id, new.status, new.farm_id, new.tenant_id)
         is distinct from (old.paid, old.total, old.vendor_id, old.status, old.farm_id, old.tenant_id) then
    raise exception 'only the owner can change payment, amount, status or vendor on bills over 50000';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists bill_gate on bill;
create trigger bill_gate before insert or update or delete on bill for each row execute function bill_gate();
