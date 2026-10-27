-- 0033: data sanity guards found by the end-to-end test plan (docs/test-plan.md LOG-13/15/28, HAT-09).
-- One trigger on daily_shed_log covers every writer (save_daily_log, record_mortality, add_shift_log, sync-apply):
-- no logs on closed batches, none before placement or in the future (IST), deaths+culls can't exceed the birds the
-- day opened with, min temp <= max temp. Chick sales tied to a hatchery setting can't exceed the chicks in stock.
-- Seeds / service-role tooling are exempt (they load history as it happened).
create function daily_log_guard() returns trigger language plpgsql as $$
declare b record; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role') then return new; end if;
  select state, placed_on into b from batch where id = new.batch_id;
  if b.state = 'closed' then raise exception 'this batch is closed — logs can no longer be added' using errcode = 'HP461'; end if;
  if new.log_date < b.placed_on then raise exception 'date is before the batch was placed (%)', b.placed_on using errcode = 'HP462'; end if;
  if new.log_date > today then raise exception 'date is in the future' using errcode = 'HP463'; end if;
  if coalesce(new.mortality, 0) + coalesce(new.culls, 0) > coalesce(new.birds_opening, 0) then
    raise exception 'deaths and culls (%) are more than the birds in the shed (%)', coalesce(new.mortality, 0) + coalesce(new.culls, 0), new.birds_opening using errcode = 'HP464';
  end if;
  if new.temp_min_c is not null and new.temp_max_c is not null and new.temp_min_c > new.temp_max_c then
    raise exception 'minimum temperature is above the maximum' using errcode = 'HP465';
  end if;
  if new.humidity_pct is not null and (new.humidity_pct < 0 or new.humidity_pct > 100) then raise exception 'humidity must be 0–100%%' using errcode = 'HP465'; end if;
  if coalesce(new.feed_kg, 0) < 0 or coalesce(new.water_litres, 0) < 0 or coalesce(new.mortality, 0) < 0 or coalesce(new.culls, 0) < 0 then
    raise exception 'numbers cannot be negative' using errcode = 'HP465';
  end if;
  return new;
end $$;
create trigger daily_log_guard before insert or update on daily_shed_log for each row execute function daily_log_guard();

create function chick_dispatch_guard() returns trigger language plpgsql as $$
declare h record; sold numeric;
begin
  if new.product <> 'doc' or new.batch_id is null then return new; end if;
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role') then return new; end if;
  select b.farm_type, r.chicks_a, r.chicks_b into h from batch b left join hatch_record r on r.batch_id = b.id where b.id = new.batch_id;
  if h.farm_type <> 'hatchery' then return new; end if;
  select coalesce(sum(qty), 0) into sold from invoice where batch_id = new.batch_id and product = 'doc' and id <> new.id;
  if h.chicks_a is null then raise exception 'record the hatch results before dispatching chicks' using errcode = 'HP466'; end if;
  if sold + new.qty > h.chicks_a + coalesce(h.chicks_b, 0) then
    raise exception 'only % chicks left in stock for this setting', h.chicks_a + coalesce(h.chicks_b, 0) - sold using errcode = 'HP466';
  end if;
  return new;
end $$;
create trigger chick_dispatch_guard before insert or update on invoice for each row execute function chick_dispatch_guard();
