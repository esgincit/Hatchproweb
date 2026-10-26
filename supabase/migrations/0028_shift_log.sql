-- 0028: labour shift entries (roadmap Phase 5 "labour mode"). Each shift ADDS its deaths, culls, feed and water to the
-- day's row — save_daily_log replaces the whole row and would wipe the supervisor's temperatures/weights.
-- Adding is not safe to replay, so every entry carries a client op id recorded in sync_outbox_receipt inside the
-- same transaction: an offline entry replayed twice is applied once ('duplicate' the second time).
create function add_shift_log(p_op uuid, p_batch uuid, p_date date, p_shift text, p jsonb)
returns text language plpgsql security invoker as $$
declare b record; n int;
  mort int := coalesce((p->>'mortality')::int, 0); culls int := coalesce((p->>'culls')::int, 0);
  feed numeric := coalesce((p->>'feed_kg')::numeric, 0); water numeric := (p->>'water')::numeric;
begin
  if p_shift not in ('morning', 'evening', 'night') then raise exception 'shift must be morning, evening or night'; end if;
  if mort < 0 or culls < 0 or feed < 0 or coalesce(water, 0) < 0 then raise exception 'numbers cannot be negative'; end if;
  select id, shed_id, state into b from batch where id = p_batch;
  if not found then raise exception 'batch not found'; end if;
  if b.state = 'closed' then raise exception 'batch is closed'; end if;
  insert into sync_outbox_receipt (client_op_id, tenant_id, device_id) values (p_op, auth_tenant_id(), 'shift') on conflict (client_op_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 'duplicate'; end if;
  insert into daily_shed_log as d (batch_id, shed_id, log_date, birds_opening, mortality, culls, feed_kg, water_litres, remarks, created_by)
    values (p_batch, b.shed_id, p_date, opening_birds(p_batch, p_date), mort, culls, feed, water,
            format('%s: +%s dead, +%s culls, +%s kg feed', p_shift, mort, culls, feed), auth.uid())
  on conflict (batch_id, log_date) do update set
    mortality = d.mortality + excluded.mortality, culls = d.culls + excluded.culls, feed_kg = d.feed_kg + excluded.feed_kg,
    water_litres = case when excluded.water_litres is null then d.water_litres else coalesce(d.water_litres, 0) + excluded.water_litres end,
    remarks = concat_ws(' · ', nullif(d.remarks, ''), excluded.remarks), sync_version = d.sync_version + 1;
  return 'applied';
end $$;
