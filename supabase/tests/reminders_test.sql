-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/reminders_test.sql
-- 0020 reminder_log: money roles log reminders as themselves, about their own customers' invoices; append-only;
-- tenant-isolated; locked while suspended.
begin;
-- ids looked up as postgres, handed to the role-switched blocks through transaction-local settings
select set_config('t.cust', (select c.id::text from customer c join tenant t on t.id = c.tenant_id
  where t.name = 'VKR Poultry Farms' and c.name like 'Hyderabad Egg Traders%'), true);
select set_config('t.inv', (select id::text from invoice where customer_id = current_setting('t.cust')::uuid limit 1), true);
select set_config('t.other_inv', (select i.id::text from invoice i join customer c on c.id = i.customer_id join tenant t on t.id = c.tenant_id
  where t.name = 'VKR Poultry Farms' and i.customer_id <> current_setting('t.cust')::uuid limit 1), true);
select set_config('t.ks_cust', (select c.id::text from customer c join tenant t on t.id = c.tenant_id where t.name = 'KS Farms' limit 1), true);
select set_config('t.ks_inv', (select id::text from invoice where customer_id = current_setting('t.ks_cust')::uuid limit 1), true);

set local role authenticated;

-- VKR finance: may log a reminder as themselves
set local request.jwt.claims = '{"sub":"8817e673-99a9-53c8-9f77-28599a17f0f5","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["finance"]}}';
do $$
declare c uuid := current_setting('t.cust')::uuid; i uuid := current_setting('t.inv')::uuid;
begin
  insert into reminder_log (customer_id, invoice_ids, amount, channel, lang) values (c, array[i], 1000, 'wa_link', 'te');
  assert (select sent_by from reminder_log where customer_id = c order by sent_at desc limit 1) = '8817e673-99a9-53c8-9f77-28599a17f0f5', 'sent_by defaults to the caller';
  begin -- can't sign as someone else
    insert into reminder_log (customer_id, invoice_ids, amount, channel, lang, sent_by) values (c, array[i], 1, 'wa_link', 'en', 'd847552a-9978-5cbf-aedf-2f20c382f6c6');
    assert false, 'logged as another user';
  exception when insufficient_privilege then null; end;
  begin -- invoice of a different customer
    insert into reminder_log (customer_id, invoice_ids, amount, channel, lang) values (c, array[current_setting('t.other_inv')::uuid], 1, 'wa_link', 'en');
    assert false, 'logged an invoice that is not this customer''s';
  exception when insufficient_privilege then null; end;
  begin -- another tenant's customer + invoice
    insert into reminder_log (customer_id, invoice_ids, amount, channel, lang) values (current_setting('t.ks_cust')::uuid, array[current_setting('t.ks_inv')::uuid], 1, 'wa_link', 'en');
    assert false, 'logged another tenant''s customer';
  exception when insufficient_privilege then null; end;
  -- append-only: edits and deletes silently match nothing
  update reminder_log set amount = 1 where customer_id = c;
  assert not exists (select 1 from reminder_log where amount = 1), 'reminder edited';
  delete from reminder_log where customer_id = c;
  assert exists (select 1 from reminder_log where customer_id = c), 'reminder deleted';
end $$;

-- VKR shed supervisor: not a money role
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["shed_supervisor"]}}';
do $$ begin
  insert into reminder_log (customer_id, invoice_ids, amount, channel, lang)
    values (current_setting('t.cust')::uuid, array[current_setting('t.inv')::uuid], 1000, 'wa_link', 'en');
  assert false, 'supervisor logged a reminder';
exception when insufficient_privilege then null; end $$;

-- KS owner: can't see VKR's reminders
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin
  assert not exists (select 1 from reminder_log where customer_id = current_setting('t.cust')::uuid), 'other tenant reads reminders';
end $$;

-- suspended VKR: read-only
reset role;
update tenant set status = 'suspended' where name = 'VKR Poultry Farms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d847552a-9978-5cbf-aedf-2f20c382f6c6","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["tenant_owner"]}}';
do $$ begin
  assert exists (select 1 from reminder_log), 'suspended tenant still reads its reminders';
  insert into reminder_log (customer_id, invoice_ids, amount, channel, lang)
    values (current_setting('t.cust')::uuid, array[current_setting('t.inv')::uuid], 1000, 'wa_link', 'en');
  assert false, 'logged while suspended';
exception when insufficient_privilege then
  raise notice 'reminders_test: all assertions passed';
end $$;
rollback;
