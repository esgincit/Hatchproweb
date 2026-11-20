-- 0060: review of 0059.
-- 1. created_by is stamped by the database on insert (a client could otherwise name someone else as the raiser and
--    then approve the PO itself). Rows from before 0059 / service code keep NULL = raiser unknown.
-- 2. Once approved, a PO's vendor, farm and total are frozen (only receipts move its status). Before, the vendor
--    could be swapped or the total raised under the approval limit after someone else approved it.
create or replace function po_threshold() returns trigger language plpgsql as $$
declare lim numeric := (tenant_rule_value(new.tenant_id, 'po_approval_above', 'null') #>> '{}')::numeric;
        self_ok boolean := (tenant_rule_value(new.tenant_id, 'allow_self_approval', 'true'))::boolean;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
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
  if old.status in ('approved', 'partial', 'closed')
     and (new.vendor_id is distinct from old.vendor_id or new.farm_id is distinct from old.farm_id or new.total is distinct from old.total) then
    raise exception 'an approved purchase order can''t change vendor, farm or amount — cancel it and raise a new one';
  end if;
  return new;
end $$;
