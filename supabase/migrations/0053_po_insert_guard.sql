-- 0053: security review of 0052 — a purchase order could be inserted already 'partial' / 'closed' / 'cancelled'.
-- New POs start draft, submitted or approved (approved only under the po_approval_above threshold; above it they are
-- moved to submitted as before).
create or replace function po_threshold() returns trigger language plpgsql as $$
declare lim numeric := (tenant_rule_value(new.tenant_id, 'po_approval_above', 'null') #>> '{}')::numeric;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted', 'approved') then raise exception 'a new purchase order starts as draft, submitted or approved'; end if;
    if lim is not null and new.total > lim and new.status = 'approved' then new.status := 'submitted'; end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (old.status::text || '>' || new.status::text = any (
       '{draft>submitted,draft>cancelled,submitted>draft,submitted>approved,submitted>cancelled,approved>partial,approved>closed,approved>cancelled,partial>closed,partial>partial}'::text[])) then
    raise exception 'purchase order can''t go from % to %', old.status, new.status;
  end if;
  if old.status in ('draft', 'submitted') and new.status = 'approved'
     and auth.uid() is not null and not (effective_roles() && '{tenant_owner,procurement_officer}') then
    raise exception 'only the owner or procurement officer can approve purchase orders';
  end if;
  if old.status in ('approved', 'partial', 'closed') and new.total > old.total and lim is not null and new.total > lim then
    raise exception 'an approved purchase order can''t grow past % — raise a new one', lim;
  end if;
  return new;
end $$;
