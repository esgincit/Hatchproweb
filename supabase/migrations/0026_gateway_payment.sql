-- 0026: online (Razorpay) payments, applied exactly once.
-- razorpay-webhook used to insert a payment row and then read-modify-write invoice/bill.paid: a Razorpay retry
-- double-counted, two concurrent webhooks could lose one, and the tenant came from client-supplied notes.
-- Now: one service-role-only function; the gateway payment id is unique; the document row is locked and its own
-- tenant is used.
alter table payment add column gateway_ref text;
create unique index payment_gateway_ref on payment (gateway_ref) where gateway_ref is not null;

create function apply_gateway_payment(p_ref_type text, p_ref_id uuid, p_amount numeric, p_mode text, p_paid_on date, p_gateway_ref text)
returns text language plpgsql security definer set search_path = public as $$
declare r record; st pay_status; n int;
begin
  if coalesce(p_gateway_ref, '') = '' or p_amount is null or p_amount <= 0 then raise exception 'bad gateway payment'; end if;
  if p_ref_type = 'bill' then
    select id, tenant_id, vendor_id as party, total, paid into r from bill where id = p_ref_id for update;
  elsif p_ref_type = 'invoice' then
    select id, tenant_id, customer_id as party, total, paid into r from invoice where id = p_ref_id for update;
  else
    return 'bad_ref_type';
  end if;
  if not found then return 'unknown_ref'; end if;
  insert into payment (tenant_id, direction, party_type, party_id, ref_type, ref_id, amount, mode, paid_on, utr, gateway_ref)
    values (r.tenant_id, case when p_ref_type = 'bill' then 'out' else 'in' end, case when p_ref_type = 'bill' then 'vendor' else 'customer' end,
            r.party, p_ref_type, p_ref_id, p_amount, p_mode, p_paid_on, p_gateway_ref, p_gateway_ref)
    on conflict (gateway_ref) where gateway_ref is not null do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if; -- Razorpay retried an event we already applied
  -- money already received at the gateway: record it even if it exceeds what was outstanding
  st := case when r.paid + p_amount >= r.total - 0.005 then 'paid' else 'partial' end;
  if p_ref_type = 'bill' then update bill set paid = paid + p_amount, status = st where id = p_ref_id;
  else update invoice set paid = paid + p_amount, status = st where id = p_ref_id; end if;
  return 'applied';
end $$;
revoke all on function apply_gateway_payment(text, uuid, numeric, text, date, text) from public, anon, authenticated;
grant execute on function apply_gateway_payment(text, uuid, numeric, text, date, text) to service_role;
