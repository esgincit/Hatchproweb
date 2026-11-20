-- 0037: security review of 0036.
-- 1. audit_add was executable by any signed-in user (Supabase default grants) -> forged audit rows in any tenant.
--    Now only definer code (guard_locked) can call it.
-- 2. tenant_rule_value(p_tenant) read any tenant's rules -> callers only get their own tenant (platform/service: any).
-- 3. submitted_by was client-settable, so the self-approval rule could be dodged -> stamped from auth.uid().
-- 4. locked rows could move to any locked status -> only transitions listed in tg_argv[2] ('from>to' csv).
revoke all on function audit_add(uuid, text, text, uuid, jsonb, jsonb) from public, anon, authenticated;

create or replace function tenant_rule_value(p_tenant uuid, p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or auth_is_platform() or p_tenant = auth_tenant_id()
    then coalesce((select value from tenant_rule where tenant_id = p_tenant and key = p_key), p_default)
    else p_default end
$$;

-- tg_argv: [0] approver roles csv, [1] columns still editable once locked csv, [2] allowed locked transitions 'from>to' csv
create or replace function guard_locked() returns trigger language plpgsql security definer set search_path = public as $$
declare
  approvers text[] := string_to_array(tg_argv[0], ',');
  free text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}') || '{status,updated_at}'::text[];
  moves text[] := coalesce(string_to_array(nullif(tg_argv[2], ''), ','), '{}');
  open_states text[] := '{draft,submitted,rejected}';
  o jsonb;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'submitted') then raise exception '% must start as draft or submitted', tg_table_name; end if;
    return jsonb_populate_record(new, jsonb_build_object('approved_by', null, 'approved_at', null)
      || case when auth.uid() is not null then jsonb_build_object('submitted_by', auth.uid()) else '{}' end);
  end if;
  if tg_op = 'DELETE' then
    if not (old.status = any (open_states)) then raise exception '% is approved and locked', tg_table_name; end if;
    return old;
  end if;

  o := to_jsonb(old);
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    if old.status not in ('draft', 'submitted') then raise exception '% is not awaiting approval', tg_table_name; end if;
    if auth.uid() is not null and not (auth_roles() && approvers) then
      raise exception 'only % can approve %', array_to_string(approvers, ' / '), tg_table_name;
    end if;
    if new.status = 'approved' and auth.uid() = old.submitted_by
       and not (tenant_rule_value(old.tenant_id, 'allow_self_approval', 'true'))::boolean then
      raise exception 'the person who submitted % cannot approve it', tg_table_name;
    end if;
    if new.status = 'rejected' and coalesce(btrim(new.reject_reason), '') = '' then
      raise exception 'a reason is required to reject';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('approved_by', auth.uid(), 'approved_at', now(), 'submitted_by', o->'submitted_by'));
    perform audit_add(old.tenant_id, new.status, tg_table_name, old.id, o, to_jsonb(new));
    return new;
  end if;

  if not (old.status = any (open_states)) then
    if (to_jsonb(new) - free) <> (o - free)
       or (new.status is distinct from old.status and not (old.status || '>' || new.status = any (moves))) then
      raise exception '% is approved and locked', tg_table_name;
    end if;
    if new.status is distinct from old.status then
      perform audit_add(old.tenant_id, new.status, tg_table_name, old.id, o, to_jsonb(new));
    end if;
    return new;
  end if;

  -- still open: editable, but nobody forges the stamps or skips to a locked state; (re)submitting re-stamps the submitter
  if new.status is distinct from old.status and not (new.status = any (open_states)) then
    raise exception '% must be approved before it can be %', tg_table_name, new.status;
  end if;
  return jsonb_populate_record(new, jsonb_build_object('approved_by', o->'approved_by', 'approved_at', o->'approved_at',
    'submitted_by', case when new.status = 'submitted' and old.status <> 'submitted' and auth.uid() is not null
                         then to_jsonb(auth.uid()) else o->'submitted_by' end));
end $$;
revoke all on function guard_locked() from public, anon, authenticated;

drop trigger egg_transfer_lock on egg_transfer;
create trigger egg_transfer_lock before insert or update or delete on egg_transfer for each row
  execute function guard_locked('tenant_owner,farm_manager', 'received_qty,receipt_rejects,received_on', 'approved>received,approved>cancelled');

create or replace function egg_transfer_check() returns trigger language plpgsql as $$
begin
  if new.flock_id is not null and not exists (select 1 from batch where id = new.flock_id and tenant_id = new.tenant_id and farm_type = 'breeder') then
    raise exception 'source must be a breeder flock of this farm';
  end if;
  if new.source_vendor_id is not null and not exists (select 1 from vendor where id = new.source_vendor_id and tenant_id = new.tenant_id) then
    raise exception 'unknown egg supplier';
  end if;
  if not exists (select 1 from farm where id = new.to_farm_id and tenant_id = new.tenant_id and farm_type = 'hatchery') then
    raise exception 'eggs must go to a hatchery';
  end if;
  if tg_op = 'UPDATE' and new.status = 'received' and old.status not in ('approved', 'received') then
    raise exception 'only an approved transfer can be received';
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
     and auth.uid() is not null and not (auth_roles() && '{tenant_owner,farm_manager}') then
    raise exception 'only the owner or farm manager can cancel a transfer';
  end if;
  if tg_op = 'UPDATE' and old.status = 'received'
     and (new.received_qty, new.receipt_rejects, new.received_on) is distinct from (old.received_qty, old.receipt_rejects, old.received_on) then
    raise exception 'receipt already confirmed';
  end if;
  return new;
end $$;
