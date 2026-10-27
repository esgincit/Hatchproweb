-- 0034: the chick dispatch guard (0033) printed the chicks left as a decimal ("only 0.00 chicks left", found by the
-- P2 hatchery e2e) because invoice.qty is numeric. Chicks are whole birds: cast the figure. Same rule, same errcode.
create or replace function chick_dispatch_guard() returns trigger language plpgsql as $$
declare h record; sold numeric;
begin
  if new.product <> 'doc' or new.batch_id is null then return new; end if;
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role') then return new; end if;
  select b.farm_type, r.chicks_a, r.chicks_b into h from batch b left join hatch_record r on r.batch_id = b.id where b.id = new.batch_id;
  if h.farm_type <> 'hatchery' then return new; end if;
  select coalesce(sum(qty), 0) into sold from invoice where batch_id = new.batch_id and product = 'doc' and id <> new.id;
  if h.chicks_a is null then raise exception 'record the hatch results before dispatching chicks' using errcode = 'HP466'; end if;
  if sold + new.qty > h.chicks_a + coalesce(h.chicks_b, 0) then
    raise exception 'only % chicks left in stock for this setting', (h.chicks_a + coalesce(h.chicks_b, 0) - sold)::bigint using errcode = 'HP466';
  end if;
  return new;
end $$;
