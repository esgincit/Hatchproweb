-- 0046: bugs in existing code found by the Vol 2 review (plan B4).
-- 1. receive_grn read only the first PO line and set 'partial' from this receipt alone (a second partial receipt
--    closed nothing / a short first receipt of a multi-line PO closed it). Now: pick the line (p_item; required when
--    the PO has several), status from the running received total of every line, over-receipt capped by rule
--    grn_over_receipt_pct (default 10 %).
-- 2. nothing stopped issuing more stock than a store holds -> stock_movement out-moves can't take a store/item
--    balance below zero.
-- 3. customer.credit_limit was stored but never used -> direct invoices over the limit raise an alert (rule
--    credit_limit_policy = 'warn', default) or are refused unless the owner raises them ('block'). Management's
--    credit policy is still pending (plan C3), hence warn by default. Chick orders already check credit (0043).

drop function receive_grn(uuid, numeric, numeric, date, text, date);
create function receive_grn(p_po uuid, p_qty numeric, p_bill_amount numeric, p_date date, p_lot text default null, p_expiry date default null, p_item uuid default null)
returns numeric language plpgsql security invoker as $$
declare po record; ln record; st uuid; expected numeric; variance numeric; got numeric; open_lines int;
begin
  select id, farm_id, vendor_id, status into po from purchase_order where id = p_po for update;
  if not found then raise exception 'purchase order not found'; end if;
  if po.status in ('closed','cancelled') then raise exception 'purchase order already received'; end if;
  if p_qty <= 0 or p_bill_amount <= 0 then raise exception 'quantity and bill amount must be positive'; end if;
  if p_item is null and (select count(distinct item_id) from po_line where po_id = p_po) > 1 then raise exception 'choose which item arrived'; end if;
  select item_id, sum(qty) as qty, max(rate) as rate, max(gst_pct) as gst_pct into ln from po_line
    where po_id = p_po and (p_item is null or item_id = p_item) group by item_id limit 1;
  if not found then raise exception 'item is not on this purchase order'; end if;
  select coalesce(sum(qty), 0) into got from stock_movement where ref_type = 'purchase_order' and ref_id = p_po and item_id = ln.item_id and move_type = 'grn';
  if got + p_qty > ln.qty * (1 + rule_num(auth_tenant_id(), 'grn_over_receipt_pct', 10) / 100) then
    raise exception 'ordered %, already received %: % is more than allowed', ln.qty, got, p_qty;
  end if;
  st := (select id from store where farm_id = po.farm_id order by name limit 1);
  if st is null then insert into store (farm_id, name) values (po.farm_id, 'Main store') returning id into st; end if;
  insert into stock_movement (store_id, item_id, move_type, qty, rate, ref_type, ref_id, lot_no, expiry_on, moved_on, created_by)
    values (st, ln.item_id, 'grn', p_qty, ln.rate, 'purchase_order', p_po, nullif(p_lot, ''), p_expiry, p_date, auth.uid());
  -- closed once every line has its ordered quantity in
  select count(*) into open_lines from (select l.item_id, sum(l.qty) as ordered from po_line l where l.po_id = p_po group by l.item_id) l
   where l.ordered > coalesce((select sum(m.qty) from stock_movement m where m.ref_type = 'purchase_order' and m.ref_id = p_po and m.item_id = l.item_id and m.move_type = 'grn'), 0);
  update purchase_order set status = case when open_lines > 0 then 'partial'::doc_status else 'closed'::doc_status end where id = p_po;
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

create function stock_no_negative() returns trigger language plpgsql as $$
declare bal numeric;
begin
  if new.qty >= 0 then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.store_id::text || new.item_id::text, 8));
  select coalesce(sum(qty), 0) into bal from stock_movement where store_id = new.store_id and item_id = new.item_id and id <> coalesce(new.id, -1);
  if bal + new.qty < 0 then
    raise exception 'only % in stock (% requested)', bal, -new.qty;
  end if;
  return new;
end $$;
create trigger stock_no_negative before insert or update on stock_movement for each row execute function stock_no_negative();

create function invoice_credit_check() returns trigger language plpgsql as $$
declare c record; owed numeric; policy text;
begin
  if new.dispatch_line_id is not null then return new; end if;                 -- chick orders: checked at confirmation
  select * into c from customer where id = new.customer_id;
  if coalesce(c.credit_limit, 0) <= 0 then return new; end if;
  select coalesce(sum(total - paid), 0) into owed from invoice where customer_id = c.id and status <> 'paid' and id <> new.id;
  if owed + new.total - new.paid <= c.credit_limit then return new; end if;
  policy := tenant_rule_value(new.tenant_id, 'credit_limit_policy', '"warn"') #>> '{}';
  if policy = 'block' and auth.uid() is not null and not (auth_roles() && '{tenant_owner}') then
    raise exception '% would owe % — over the credit limit of %', c.name, owed + new.total - new.paid, c.credit_limit;
  end if;
  if auth.uid() is not null then
    perform raise_alert(new.tenant_id, 'warning', 'Over credit limit · ' || c.name,
      format('owes %s after invoice %s (limit %s)', owed + new.total - new.paid, new.invoice_no, c.credit_limit), 'customer', c.id);
  end if;
  return new;
end $$;
create trigger invoice_credit_check before insert on invoice for each row execute function invoice_credit_check();
