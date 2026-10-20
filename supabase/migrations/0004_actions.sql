-- 0004: write paths behind the app's forms. Every multi-row change is one SQL function (one transaction),
-- SECURITY INVOKER so RLS still decides what the caller may touch.

-- tenant_id defaults to the caller's tenant: inserts don't pass it, RLS still checks it.
do $$
declare t text;
begin
  for t in select unnest(array[
    'farm','shed','batch','daily_shed_log','egg_production','mortality_event','vaccination_schedule','vet_visit','disease_case',
    'vendor','item','store','purchase_order','stock_movement','customer','invoice','bill','payment','worker','attendance','asset',
    'maintenance_ticket','media','notification','audit_log'])
  loop
    execute format('alter table %I alter column tenant_id set default auth_tenant_id()', t);
  end loop;
end $$;

-- Next readable document number per tenant (B0042, INV0108).
-- ponytail: max()+1 can race under concurrent inserts; invoice has a unique (tenant, no) guard — add a counter table if it bites.
create or replace function next_doc_no(kind text) returns text
language plpgsql stable as $$
declare n bigint;
begin
  if kind = 'bill' then
    select coalesce(max(nullif(regexp_replace(bill_no, '\D', '', 'g'), '')::bigint), 0) + 1 into n from bill;
    return 'B' || lpad(n::text, 4, '0');
  elsif kind = 'invoice' then
    select coalesce(max(nullif(regexp_replace(invoice_no, '\D', '', 'g'), '')::bigint), 0) + 1 into n from invoice;
    return 'INV' || lpad(n::text, 4, '0');
  end if;
  raise exception 'unknown document kind %', kind;
end $$;

-- Birds at the start of a day: yesterday's opening − deaths − culls, or the chicks placed.
create or replace function opening_birds(p_batch uuid, p_date date) returns int
language sql stable as $$
  select coalesce(
    (select birds_opening - mortality - culls from daily_shed_log where batch_id = p_batch and log_date < p_date order by log_date desc limit 1),
    (select doc_count from batch where id = p_batch))
$$;

-- Place a batch: batch + state history + vaccination schedule from vaccine_master + chick (DOC) bill.
create or replace function place_batch(p_shed uuid, p_code text, p_breed uuid, p_placed date, p_doc int, p_doc_rate numeric, p_vendor uuid default null)
returns uuid language plpgsql security invoker as $$
declare s record; b uuid;
begin
  select sh.id, sh.farm_id, f.farm_type into s from shed sh join farm f on f.id = sh.farm_id where sh.id = p_shed;
  if not found then raise exception 'shed not found'; end if;
  if p_doc <= 0 then raise exception 'chick count must be positive'; end if;
  if exists (select 1 from batch where shed_id = p_shed and state <> 'closed') then raise exception 'shed already has an active batch'; end if;
  insert into batch (farm_id, shed_id, code, farm_type, breed_id, source_vendor_id, placed_on, doc_count, doc_rate, state)
    values (s.farm_id, p_shed, p_code, s.farm_type, p_breed, p_vendor, p_placed, p_doc, p_doc_rate, 'placed') returning id into b;
  insert into batch_state_history (batch_id, state, changed_on, changed_by) values (b, 'placed', p_placed, auth.uid());
  insert into vaccination_schedule (batch_id, vaccine_id, due_date)
    select b, v.id, p_placed + (v.age_day - 1) from vaccine_master v
    where v.farm_type = s.farm_type and (v.tenant_id is null or v.tenant_id = auth_tenant_id());
  if p_vendor is not null and coalesce(p_doc_rate, 0) > 0 then
    insert into bill (farm_id, vendor_id, bill_no, bill_date, due_date, category, total, batch_id)
      values (s.farm_id, p_vendor, next_doc_no('bill'), p_placed,
              p_placed + coalesce((select payment_terms_days from vendor where id = p_vendor), 15), 'chick', p_doc * p_doc_rate, b);
  end if;
  return b;
end $$;

-- Mortality: event row + today's daily log count (creates the log if the shed has none yet today).
create or replace function record_mortality(p_batch uuid, p_date date, p_count int, p_cause text default null, p_notes text default null)
returns void language plpgsql security invoker as $$
declare b record;
begin
  if p_count <= 0 then raise exception 'count must be positive'; end if;
  select id, shed_id into b from batch where id = p_batch;
  if not found then raise exception 'batch not found'; end if;
  insert into mortality_event (batch_id, event_date, count, cause_code, notes, created_by)
    values (p_batch, p_date, p_count, nullif(p_cause, ''), nullif(p_notes, ''), auth.uid());
  update daily_shed_log set mortality = mortality + p_count, sync_version = sync_version + 1 where batch_id = p_batch and log_date = p_date;
  if not found then
    insert into daily_shed_log (batch_id, shed_id, log_date, birds_opening, mortality, created_by)
      values (p_batch, b.shed_id, p_date, opening_birds(p_batch, p_date), p_count, auth.uid());
  end if;
end $$;

-- Daily log: upsert the day's row and replace its egg grades. p = {mortality, culls, feed_kg, water, tmin, tmax, rh, avg_w, remarks, eggs:{grade:count}}
create or replace function save_daily_log(p_batch uuid, p_date date, p jsonb)
returns uuid language plpgsql security invoker as $$
declare b record; lid uuid;
begin
  select id, shed_id into b from batch where id = p_batch;
  if not found then raise exception 'batch not found'; end if;
  insert into daily_shed_log as d (batch_id, shed_id, log_date, birds_opening, mortality, culls, feed_kg, water_litres,
                                   temp_min_c, temp_max_c, humidity_pct, avg_weight_g, remarks, created_by)
    values (p_batch, b.shed_id, p_date, opening_birds(p_batch, p_date),
            coalesce((p->>'mortality')::int, 0), coalesce((p->>'culls')::int, 0), coalesce((p->>'feed_kg')::numeric, 0),
            (p->>'water')::numeric, (p->>'tmin')::numeric, (p->>'tmax')::numeric, (p->>'rh')::numeric, (p->>'avg_w')::int,
            nullif(p->>'remarks', ''), auth.uid())
  on conflict (batch_id, log_date) do update set
    mortality = excluded.mortality, culls = excluded.culls, feed_kg = excluded.feed_kg, water_litres = excluded.water_litres,
    temp_min_c = excluded.temp_min_c, temp_max_c = excluded.temp_max_c, humidity_pct = excluded.humidity_pct,
    avg_weight_g = excluded.avg_weight_g, remarks = excluded.remarks, sync_version = d.sync_version + 1
  returning id into lid;
  if p ? 'eggs' then
    delete from egg_production where daily_log_id = lid;
    insert into egg_production (daily_log_id, grade, count)
      select lid, e.k::egg_grade, e.v::int from jsonb_each_text(p->'eggs') as e(k, v) where e.v::int > 0;
  end if;
  return lid;
end $$;

-- Payment against a bill (out) or invoice (in); updates paid/status. Never more than what is outstanding.
create or replace function record_payment(p_kind text, p_id uuid, p_amount numeric, p_mode text, p_date date, p_utr text default null)
returns void language plpgsql security invoker as $$
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
  insert into payment (direction, party_type, party_id, ref_type, ref_id, amount, mode, paid_on, utr)
    values (case when p_kind = 'bill' then 'out' else 'in' end, case when p_kind = 'bill' then 'vendor' else 'customer' end,
            r.party, p_kind, p_id, p_amount, p_mode, p_date, nullif(p_utr, ''));
  st := case when r.paid + p_amount >= r.total - 0.005 then 'paid' else 'partial' end;
  if p_kind = 'bill' then update bill set paid = paid + p_amount, status = st where id = p_id;
  else update invoice set paid = paid + p_amount, status = st where id = p_id; end if;
end $$;

-- Sale on credit: invoice due after the customer's credit days. GST: eggs / live birds exempt, manure 5%.
create or replace function create_sale(p_customer uuid, p_product text, p_qty numeric, p_unit text, p_rate numeric, p_date date, p_batch uuid default null)
returns text language plpgsql security invoker as $$
declare c record; f uuid; gst numeric; no text;
begin
  if p_qty <= 0 or p_rate <= 0 then raise exception 'quantity and rate must be positive'; end if;
  select id, credit_days into c from customer where id = p_customer;
  if not found then raise exception 'customer not found'; end if;
  f := coalesce((select farm_id from batch where id = p_batch), (select id from farm order by created_at limit 1));
  if f is null then raise exception 'add a farm first'; end if;
  gst := case p_product when 'manure' then 5 else 0 end;
  no := next_doc_no('invoice');
  insert into invoice (farm_id, customer_id, invoice_no, invoice_date, due_date, product, qty, unit, rate, gst_pct, total, batch_id)
    values (f, p_customer, no, p_date, p_date + coalesce(c.credit_days, 0), p_product, p_qty, p_unit, p_rate, gst,
            round(p_qty * p_rate * (1 + gst / 100), 2), p_batch);
  return no;
end $$;

-- Bill / expense from a vendor.
create or replace function create_bill(p_vendor uuid, p_category text, p_total numeric, p_date date, p_batch uuid default null, p_bill_no text default null)
returns text language plpgsql security invoker as $$
declare v record; f uuid; no text;
begin
  if p_total <= 0 then raise exception 'amount must be positive'; end if;
  select id, payment_terms_days into v from vendor where id = p_vendor;
  if not found then raise exception 'vendor not found'; end if;
  f := coalesce((select farm_id from batch where id = p_batch), (select id from farm order by created_at limit 1));
  if f is null then raise exception 'add a farm first'; end if;
  no := coalesce(nullif(p_bill_no, ''), next_doc_no('bill'));
  insert into bill (farm_id, vendor_id, bill_no, bill_date, due_date, category, total, batch_id)
    values (f, p_vendor, no, p_date, p_date + coalesce(v.payment_terms_days, 15), p_category, p_total, p_batch);
  return no;
end $$;
