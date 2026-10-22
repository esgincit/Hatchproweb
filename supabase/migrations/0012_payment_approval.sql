-- 0012: brief §6 — a vendor payment above ₹50,000 by anyone but the owner becomes an approval request.
create table if not exists payment_approval (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  bill_id uuid not null references bill(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null,
  paid_on date not null,
  utr text,
  requested_by uuid,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
alter table payment_approval enable row level security;
create policy payment_approval_tenant on payment_approval
  using (auth_is_platform() or tenant_id = auth_tenant_id()) with check (auth_is_platform() or tenant_id = auth_tenant_id());
-- money roles may request; only the owner decides
create policy payment_approval_ins on payment_approval as restrictive for insert with check (auth_has_role('tenant_owner', 'farm_manager', 'finance'));
create policy payment_approval_upd on payment_approval as restrictive for update using (auth_has_role('tenant_owner')) with check (auth_has_role('tenant_owner'));
create policy payment_approval_del on payment_approval as restrictive for delete using (auth_has_role('tenant_owner'));

-- record_payment now returns 'paid' or 'pending' (approval requested)
drop function if exists record_payment(text, uuid, numeric, text, date, text);
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
  if p_kind = 'bill' and p_amount > 50000 and not ('tenant_owner' = any(auth_roles())) and not auth_is_platform() then
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

-- owner approves (pays now, as the owner) or rejects a pending request
create or replace function decide_payment(p_id uuid, p_approve boolean)
returns text language plpgsql security invoker as $$
declare a record;
begin
  if not ('tenant_owner' = any(auth_roles())) and not auth_is_platform() then raise exception 'only the owner can approve payments'; end if;
  select * into a from payment_approval where id = p_id and status = 'pending' for update;
  if not found then raise exception 'request not found or already decided'; end if;
  update payment_approval set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now() where id = p_id;
  if p_approve then perform record_payment('bill', a.bill_id, a.amount, a.mode, a.paid_on, a.utr); end if;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;
