-- 0005: the rest of the demo's actions — batch lifecycle, equipment, stock/PO/GRN, documents, advances.
-- Same rules as 0004: one SQL function per multi-row change, SECURITY INVOKER so RLS applies.

-- Brief §6: Compliance needs tenant_document; People › Wages needs worker_advance.
create table if not exists tenant_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  name text not null,
  ref_no text,
  expires_on date,
  media_id uuid references media(id),
  created_at timestamptz not null default now()
);
create table if not exists worker_advance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth_tenant_id() references tenant(id) on delete cascade,
  worker_id uuid not null references worker(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  given_on date not null,
  reason text,
  created_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['tenant_document','worker_advance'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy %I_tenant_isolation on %I
      using (auth_is_platform() or tenant_id = auth_tenant_id())
      with check (auth_is_platform() or tenant_id = auth_tenant_id())$p$, t, t);
  end loop;
end $$;
-- farms add their own local rates (source = 'tenant'); policy rate_write already scopes them
alter table market_rate alter column tenant_id set default auth_tenant_id();

-- Change stage (brooding → growing → laying …) with history.
create or replace function set_batch_state(p_batch uuid, p_state batch_state, p_date date)
returns void language plpgsql security invoker as $$
begin
  if p_state = 'closed' then raise exception 'use close_batch to close'; end if;
  update batch set state = p_state where id = p_batch and state <> 'closed';
  if not found then raise exception 'batch not found or already closed'; end if;
  insert into batch_state_history (batch_id, state, changed_on, changed_by) values (p_batch, p_state, p_date, auth.uid());
end $$;

-- Close a batch (lifting / cull). With a buyer + rate it raises the sale invoice too
-- (broiler → live birds per kg, layer → spent hens per kg). Returns the invoice no or null.
create or replace function close_batch(p_batch uuid, p_date date, p_customer uuid default null, p_weight_kg numeric default null, p_rate numeric default null)
returns text language plpgsql security invoker as $$
declare b record; no text;
begin
  select id, farm_type, state into b from batch where id = p_batch for update;
  if not found then raise exception 'batch not found'; end if;
  if b.state = 'closed' then raise exception 'batch already closed'; end if;
  update batch set state = 'closed', closed_on = p_date where id = p_batch;
  insert into batch_state_history (batch_id, state, changed_on, changed_by) values (p_batch, 'closed', p_date, auth.uid());
  if p_customer is not null and coalesce(p_weight_kg, 0) > 0 and coalesce(p_rate, 0) > 0 then
    no := create_sale(p_customer, case when b.farm_type = 'layer' then 'spent_hen' else 'bird' end, p_weight_kg, 'kg', p_rate, p_date, p_batch);
  end if;
  return no;
end $$;

-- Equipment: an issue opens a ticket; high priority also raises a critical notification.
create or replace function report_issue(p_asset uuid, p_issue text, p_priority text, p_date date)
returns uuid language plpgsql security invoker as $$
declare a record; tk uuid;
begin
  if p_priority not in ('low','medium','high') then raise exception 'priority must be low, medium or high'; end if;
  select id, name into a from asset where id = p_asset;
  if not found then raise exception 'asset not found'; end if;
  insert into maintenance_ticket (asset_id, opened_on, issue, priority, status) values (p_asset, p_date, p_issue, p_priority, 'open') returning id into tk;
  update asset set status = 'fault' where id = p_asset;
  if p_priority = 'high' then
    insert into notification (kind, severity, title, body, entity_type, entity_id)
      values ('alert', 'critical', 'Equipment fault · ' || a.name, p_issue, 'maintenance_ticket', tk);
  end if;
  return tk;
end $$;

-- Close a ticket; a cost paid to a vendor books an equipment bill.
create or replace function close_ticket(p_ticket uuid, p_date date, p_cost numeric default null, p_vendor uuid default null)
returns void language plpgsql security invoker as $$
declare tk record;
begin
  select t.id, t.asset_id, t.status into tk from maintenance_ticket t where t.id = p_ticket for update;
  if not found then raise exception 'ticket not found'; end if;
  if tk.status <> 'open' then raise exception 'ticket already closed'; end if;
  update maintenance_ticket set status = 'closed', closed_on = p_date, cost = p_cost, sync_version = sync_version + 1 where id = p_ticket;
  if not exists (select 1 from maintenance_ticket where asset_id = tk.asset_id and status = 'open') then
    update asset set status = 'ok' where id = tk.asset_id;
  end if;
  if p_vendor is not null and coalesce(p_cost, 0) > 0 then
    perform create_bill(p_vendor, 'equipment', p_cost, p_date);
  end if;
end $$;

-- New asset; a purchase cost with a vendor books an equipment bill.
create or replace function add_asset(p_farm uuid, p_name text, p_category text, p_cost numeric, p_next_service date, p_date date, p_vendor uuid default null)
returns uuid language plpgsql security invoker as $$
declare a uuid;
begin
  insert into asset (farm_id, name, category, purchased_on, cost, next_service_on, status)
    values (p_farm, p_name, p_category, p_date, p_cost, p_next_service, 'ok') returning id into a;
  if p_vendor is not null and coalesce(p_cost, 0) > 0 then
    perform create_bill(p_vendor, 'equipment', p_cost, p_date);
  end if;
  return a;
end $$;

-- Purchase order (one item per PO, as the demo raises them).
create or replace function raise_po(p_vendor uuid, p_item uuid, p_qty numeric, p_rate numeric, p_expected date, p_date date)
returns text language plpgsql security invoker as $$
declare f uuid; po uuid; no text; n bigint; gst numeric;
begin
  if p_qty <= 0 or p_rate <= 0 then raise exception 'quantity and rate must be positive'; end if;
  f := (select id from farm order by created_at limit 1);
  if f is null then raise exception 'add a farm first'; end if;
  select coalesce(max(nullif(regexp_replace(po_no, '\D', '', 'g'), '')::bigint), 2600) + 1 into n from purchase_order;
  no := 'PO-' || n;
  select gst_pct into gst from item where id = p_item;
  if not found then raise exception 'item not found'; end if;
  insert into purchase_order (farm_id, vendor_id, po_no, po_date, expected_on, status, total)
    values (f, p_vendor, no, p_date, p_expected, 'approved', round(p_qty * p_rate * (1 + coalesce(gst, 0) / 100), 2)) returning id into po;
  insert into po_line (po_id, item_id, qty, rate, gst_pct) values (po, p_item, p_qty, p_rate, coalesce(gst, 0));
  return no;
end $$;

-- Goods receipt against a PO: stock in, bill booked, PO closed. Returns the 3-way-match variance
-- (bill vs PO value for the received qty, in %) so the screen can flag a mismatch.
create or replace function receive_grn(p_po uuid, p_qty numeric, p_bill_amount numeric, p_date date, p_lot text default null, p_expiry date default null)
returns numeric language plpgsql security invoker as $$
declare po record; ln record; st uuid; expected numeric; variance numeric;
begin
  select id, farm_id, vendor_id, status into po from purchase_order where id = p_po for update;
  if not found then raise exception 'purchase order not found'; end if;
  if po.status in ('closed','cancelled') then raise exception 'purchase order already received'; end if;
  if p_qty <= 0 or p_bill_amount <= 0 then raise exception 'quantity and bill amount must be positive'; end if;
  select item_id, qty, rate, gst_pct into ln from po_line where po_id = p_po limit 1;
  st := (select id from store where farm_id = po.farm_id order by name limit 1);
  if st is null then insert into store (farm_id, name) values (po.farm_id, 'Main store') returning id into st; end if;
  insert into stock_movement (store_id, item_id, move_type, qty, rate, ref_type, ref_id, lot_no, expiry_on, moved_on, created_by)
    values (st, ln.item_id, 'grn', p_qty, ln.rate, 'purchase_order', p_po, nullif(p_lot, ''), p_expiry, p_date, auth.uid());
  update purchase_order set status = case when p_qty < ln.qty then 'partial'::doc_status else 'closed'::doc_status end where id = p_po;
  insert into bill (farm_id, vendor_id, po_id, bill_no, bill_date, due_date, category, total)
    values (po.farm_id, po.vendor_id, p_po, next_doc_no('bill'), p_date,
            p_date + coalesce((select payment_terms_days from vendor where id = po.vendor_id), 15),
            coalesce((select case i.category when 'feed' then 'feed' when 'feed_ingredient' then 'feed' when 'medicine' then 'medicine'
                                              when 'vaccine' then 'vaccine' when 'equipment' then 'equipment' when 'spare' then 'equipment'
                                              when 'fuel' then 'fuel' else 'other' end from item i where i.id = ln.item_id), 'other'),
            p_bill_amount);
  expected := p_qty * ln.rate * (1 + coalesce(ln.gst_pct, 0) / 100);
  variance := round(100 * (p_bill_amount - expected) / nullif(expected, 0), 2);
  return variance;
end $$;
