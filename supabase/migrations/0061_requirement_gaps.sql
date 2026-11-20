-- 0061: requirement gaps found in the final audit against the plan (Part C / WP list).
--  1. Alert lifecycle open → acknowledged → actioned → resolved + escalation of unacknowledged alerts (WP 1.7, B4).
--  2. Waiting list: notify when space frees up in an order's hatch week (C2 Sales).
--  3. Payment proof upload by staff and by portal customers (WP 1.12, C2 portal).
--  4. Approved requisition → purchase order (Phase 3 PR → PO chain).
--  5. Feed store days-remaining alert for breeder farms, < 3 days by default (C2 parent stock).

-- ---------------------------------------------------------------- 1. alert lifecycle
alter table notification
  add column acknowledged_at timestamptz, add column acknowledged_by uuid,
  add column actioned_at timestamptz, add column actioned_by uuid,
  add column action_note text check (length(action_note) <= 500),
  add column resolved_at timestamptz, add column resolved_by uuid,
  add column escalated_at timestamptz;

-- any active member of the farm works an alert; action and resolve need a note; every step is audit-logged
create function alert_step(p_id bigint, p_step text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare n notification; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not auth_tenant_active() then raise exception 'not allowed'; end if;
  select * into n from notification where id = p_id and tenant_id = auth_tenant_id() and kind = 'alert' for update;
  if not found then raise exception 'alert not found'; end if;
  if n.resolved_at is not null then raise exception 'this alert is already resolved'; end if;
  if p_step = 'ack' then
    if n.acknowledged_at is not null then raise exception 'already acknowledged'; end if;
    update notification set acknowledged_at = now(), acknowledged_by = auth.uid(), read_at = coalesce(read_at, now()) where id = p_id;
  elsif p_step in ('action', 'resolve') then
    if note is null and (p_step = 'action' or n.actioned_at is null) then raise exception 'describe the action taken'; end if;
    update notification set
      acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()),
      read_at = coalesce(read_at, now()),
      actioned_at = coalesce(actioned_at, now()), actioned_by = coalesce(actioned_by, auth.uid()),
      action_note = coalesce(left(note, 500), action_note),
      resolved_at = case when p_step = 'resolve' then now() end,
      resolved_by = case when p_step = 'resolve' then auth.uid() end
    where id = p_id;
  else
    raise exception 'unknown step';
  end if;
  perform audit_add(n.tenant_id, 'alert_' || p_step, 'notification', null, null, jsonb_build_object('notification_id', p_id, 'note', note));
end $$;
revoke all on function alert_step(bigint, text, text) from public, anon;
grant execute on function alert_step(bigint, text, text) to authenticated;

-- run by erp-cron: warning/critical alerts nobody acknowledged within rule alert_escalation_minutes (default 60)
-- raise one critical "not acknowledged" alert each (the owner sees all alerts). Returns how many were escalated.
create function alert_escalate() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from notification
           where kind = 'alert' and severity in ('warning', 'critical') and acknowledged_at is null and resolved_at is null
             and escalated_at is null and entity_type is distinct from 'escalation'
             and created_at < now() - make_interval(mins => coalesce((tenant_rule_value(tenant_id, 'alert_escalation_minutes', '60') #>> '{}')::int, 60))
  loop
    update notification set escalated_at = now() where id = r.id;
    insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id, dedupe_key)
    values (r.tenant_id, 'alert', 'critical', left('Not acknowledged: ' || r.title, 200), left(coalesce(r.body, ''), 1000),
            'escalation', null, 'escalate:' || r.id)  -- links back to the original alert by id
    on conflict (tenant_id, dedupe_key) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function alert_escalate() from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. waiting list: space freed
-- when an order stops holding chicks (cancelled / expired / smaller / moved), every waitlisted order of that product
-- whose week now has room raises one alert, so sales can offer the slot (Move in).
create function waitlist_space_check() returns trigger language plpgsql security definer set search_path = public as $$
declare w record;
begin
  for w in select o.id, o.order_no, o.qty, o.hatch_date from sales_order o
           where o.tenant_id = new.tenant_id and o.product_id = new.product_id and o.status = 'waitlisted' and o.id <> new.id
  loop
    if exists (select 1 from chick_availability a
               where a.tenant_id = new.tenant_id and a.product_id = new.product_id
                 and a.week = date_trunc('week', w.hatch_date)::date and a.available >= w.qty) then
      insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id, dedupe_key)
      values (new.tenant_id, 'alert', 'info', left('Space free for waiting order ' || w.order_no, 200),
              'Week of ' || to_char(date_trunc('week', w.hatch_date), 'DD Mon') || ' now has room for ' || w.qty || ' chicks.',
              'sales_order', w.id, 'waitlist:' || w.id || ':' || new.id || ':' || new.status)
      on conflict (tenant_id, dedupe_key) do nothing;
    end if;
  end loop;
  return null;
end $$;
create trigger sales_order_waitlist_space after update of status, qty, hatch_date on sales_order for each row
  when (old.status in ('reserved', 'confirmed', 'allocated')
        and (new.status in ('cancelled', 'expired') or new.qty < old.qty or new.hatch_date is distinct from old.hatch_date))
  execute function waitlist_space_check();

-- ---------------------------------------------------------------- 3. payment proof
-- layout evidence/<tenant>/payment/<order id>/<file>. Screenshots or a PDF receipt.
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] where id = 'evidence';

create policy evidence_payment_staff_add on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_tenant_id()::text and (select auth_tenant_active())
    and (storage.foldername(name))[2] = 'payment'
    and (select auth_roles()) && '{tenant_owner,farm_manager,finance,sales_officer}'
    and exists (select 1 from sales_order o where o.id::text = (storage.foldername(name))[3] and o.tenant_id = auth_tenant_id()));

-- portal customers (no tenant claim): only into their own orders' folders, and read back only those
create function portal_owns_order_folder(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from customer_portal_user u join sales_order o on o.customer_id = u.customer_id and o.tenant_id = u.tenant_id
                 where u.user_id = auth.uid()
                   and u.tenant_id::text = (storage.foldername(p_name))[1]
                   and (storage.foldername(p_name))[2] = 'payment'
                   and o.id::text = (storage.foldername(p_name))[3])
$$;
revoke all on function portal_owns_order_folder(text) from public, anon;
grant execute on function portal_owns_order_folder(text) to authenticated;
create policy evidence_payment_portal_add on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and portal_owns_order_folder(name));
create policy evidence_payment_portal_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and portal_owns_order_folder(name));

-- a proof path must point into that order's own folder (no pointing at other files)
create function sales_order_proof_path() returns trigger language plpgsql as $$
begin
  if new.payment_proof_path is not null and new.payment_proof_path is distinct from old.payment_proof_path
     and new.payment_proof_path not like new.tenant_id || '/payment/' || new.id || '/%' then
    raise exception 'payment proof must be uploaded to this order';
  end if;
  return new;
end $$;
create trigger sales_order_proof_path before update of payment_proof_path on sales_order for each row execute function sales_order_proof_path();

create or replace function portal_submit_payment(p_order_no text, p_ref text, p_proof_path text) returns void
language plpgsql security definer set search_path = public as $$
declare u record; o record;
begin
  select * into u from customer_portal_user where user_id = auth.uid();
  if not found then raise exception 'not a customer portal user'; end if;
  if not ('portal' = any (tenant_modules(u.tenant_id))) then raise exception 'portal is not enabled'; end if;
  if length(coalesce(p_ref, '')) not between 4 and 60 then raise exception 'enter the payment reference'; end if;
  select * into o from sales_order where order_no = p_order_no and customer_id = u.customer_id and tenant_id = u.tenant_id
     and payment_status in ('pending', 'rejected', 'partial');
  if not found then raise exception 'order not found or payment already verified'; end if;
  if p_proof_path is not null and p_proof_path not like u.tenant_id || '/payment/' || o.id || '/%' then
    raise exception 'payment proof must be uploaded to this order';
  end if;
  update sales_order set payment_status = 'submitted', payment_ref = p_ref, payment_proof_path = coalesce(left(p_proof_path, 200), payment_proof_path)
   where id = o.id;
  perform raise_alert_internal(u.tenant_id, 'Payment proof · ' || p_order_no, 'ref ' || p_ref, 'sales_order');
end $$;

-- ---------------------------------------------------------------- 4. requisition → purchase order
-- an approved requisition becomes a PO for its own farm/item/qty (vendor + rate chosen now); the PO follows the
-- normal PO rules (threshold, self-approval) and the requisition moves to 'ordered' with the link kept.
create function requisition_to_po(p_req uuid, p_vendor uuid, p_rate numeric, p_expected date) returns text
language plpgsql security invoker as $$
declare r purchase_requisition; po uuid; no text; n bigint; gst numeric;
begin
  select * into r from purchase_requisition where id = p_req;
  if not found then raise exception 'requisition not found'; end if;
  if r.status <> 'approved' then raise exception 'only an approved requisition can become a purchase order'; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'rate must be positive'; end if;
  if not exists (select 1 from vendor where id = p_vendor) then raise exception 'vendor not found'; end if;
  perform pg_advisory_xact_lock(hashtext('po_no:' || r.tenant_id));
  select coalesce(max(nullif(regexp_replace(po_no, '\D', '', 'g'), '')::bigint), 2600) + 1 into n from purchase_order where tenant_id = r.tenant_id;
  no := 'PO-' || n;
  select gst_pct into gst from item where id = r.item_id;
  insert into purchase_order (farm_id, vendor_id, po_no, po_date, expected_on, status, total)
    values (r.farm_id, p_vendor, no, current_date, coalesce(p_expected, r.needed_by), 'approved',
            round(r.qty * p_rate * (1 + coalesce(gst, 0) / 100), 2)) returning id into po;
  insert into po_line (po_id, item_id, qty, rate, gst_pct) values (po, r.item_id, r.qty, p_rate, coalesce(gst, 0));
  update purchase_requisition set po_id = po, status = 'ordered' where id = r.id;
  return no;
end $$;
revoke all on function requisition_to_po(uuid, uuid, numeric, date) from public, anon;
grant execute on function requisition_to_po(uuid, uuid, numeric, date) to authenticated;

-- ---------------------------------------------------------------- 5. feed days remaining (breeder farms)
-- feed on hand in the farm's stores ÷ average daily breeder feed over the last 7 logged days.
create view feed_days_left with (security_invoker = true) as
with use7 as (
  select b.tenant_id, b.farm_id, sum(coalesce(d.feed_f_kg, 0) + coalesce(d.feed_m_kg, 0)) / greatest(count(distinct d.log_date), 1) as per_day
  from breeder_daily d join batch b on b.id = d.batch_id
  where d.log_date > current_date - 7
  group by b.tenant_id, b.farm_id
), stock as (
  select s.tenant_id, s.farm_id, sum(v.qty) as on_hand
  from v_stock_balance v join store s on s.id = v.store_id join item i on i.id = v.item_id
  where i.category = 'feed'
  group by s.tenant_id, s.farm_id
)
select u.tenant_id, u.farm_id, coalesce(st.on_hand, 0) as feed_on_hand_kg, round(u.per_day, 1) as feed_per_day_kg,
       case when u.per_day > 0 then round(coalesce(st.on_hand, 0) / u.per_day, 1) end as days_left
from use7 u left join stock st on st.tenant_id = u.tenant_id and st.farm_id = u.farm_id;

-- one alert per farm per day (definer: reads the farm's stock even when the logger can't see the store)
create function breeder_feed_days_alert() returns trigger language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from feed_days_left fd where fd.tenant_id = new.tenant_id and fd.farm_id = (select farm_id from batch where id = new.batch_id);
  if f.days_left is not null and f.days_left < rule_num(new.tenant_id, 'feed_days_alert', 3) then
    insert into notification (tenant_id, kind, severity, title, body, entity_type, entity_id, dedupe_key)
    values (new.tenant_id, 'alert', 'warning', 'Feed running low',
            'About ' || f.days_left || ' days of feed left at this farm (' || f.feed_on_hand_kg || ' kg on hand, using ' || f.feed_per_day_kg || ' kg/day).',
            'farm', f.farm_id, 'feed_days:' || f.farm_id || ':' || current_date)
    on conflict (tenant_id, dedupe_key) do nothing;
  end if;
  return null;
end $$;
create trigger breeder_daily_feed_days after insert or update of feed_f_kg, feed_m_kg on breeder_daily for each row
  execute function breeder_feed_days_alert();

-- portal orders now also return the order id + tenant id (the proof folder is <tenant>/payment/<order id>/)
drop function portal_orders();
create function portal_orders() returns table (id uuid, tenant_id uuid, order_no text, product text, qty int, hatch_date date, status text,
                                               payment_status text, deposit_due numeric, deposit_paid numeric, price numeric,
                                               suggested_hatch_date date, payment_proof_path text)
language sql stable security definer set search_path = public as $$
  select o.id, o.tenant_id, o.order_no, p.name, o.qty, o.hatch_date, o.status, o.payment_status, o.deposit_due, o.deposit_paid, o.price,
         o.suggested_hatch_date, o.payment_proof_path
  from sales_order o join chick_product p on p.id = o.product_id join customer_portal_user u on u.customer_id = o.customer_id and u.tenant_id = o.tenant_id
  where u.user_id = auth.uid() order by o.created_at desc
$$;
revoke all on function portal_orders() from public, anon;
grant execute on function portal_orders() to authenticated;
