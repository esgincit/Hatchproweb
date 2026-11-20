-- 0054: link a worker (driver) to their login so the app can show a driver only their own trips.
-- One login per worker; same tenant only. The phone filters dispatch by driver_worker_id in my_worker_ids().
create function check_worker_user() returns trigger language plpgsql as $$
begin
  if new.user_id is not null and not exists (select 1 from app_user where id = new.user_id and tenant_id = new.tenant_id) then
    raise exception 'that login is not in this farm';
  end if;
  return new;
end $$;
alter table worker add column user_id uuid unique references app_user(id);
create trigger worker_user_tenant before insert or update of user_id on worker for each row execute function check_worker_user();

create function my_worker_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select id from worker where user_id = auth.uid() and tenant_id = auth_tenant_id()
$$;
revoke all on function my_worker_ids() from public, anon;
grant execute on function my_worker_ids() to authenticated;
