-- 0056: gaps the sales/dispatch UI hit.
-- 1. Proof-of-delivery photos: the delivery is recorded by dispatch staff, but 0027 only lets farm roles write to the
--    evidence bucket. Same layout and checks (own tenant folder, 2nd folder = one of the tenant's batches).
create policy evidence_dispatch_add on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_tenant_id()::text and (select auth_tenant_active())
    and (select auth_roles()) && '{dispatch_officer,hatchery_ops_manager,hatchery_manager}'
    and exists (select 1 from batch b where b.id::text = (storage.foldername(name))[2] and b.tenant_id = auth_tenant_id()));

-- 2. Owner links a customer to the login the customer signed up with (by email). The app has no service-role key,
--    so the auth user is looked up here. Only a login with no farm (no app_user row) can become a portal user.
create function link_portal_user(p_customer uuid, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not auth_has_role('tenant_owner') then raise exception 'only the owner can give portal access'; end if;
  if not exists (select 1 from customer where id = p_customer and tenant_id = auth_tenant_id()) then raise exception 'customer not found'; end if;
  -- confirmed emails only: an unconfirmed sign-up with the customer's address must not inherit their orders
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null;
  -- one message for every refusal: distinct ones would let an owner probe which emails exist / are staff elsewhere
  if v_user is null or exists (select 1 from app_user where id = v_user)
     or exists (select 1 from customer_portal_user where user_id = v_user and tenant_id <> auth_tenant_id()) then
    raise exception 'cannot link that email: the customer must sign up first with this email';
  end if;
  insert into customer_portal_user (user_id, tenant_id, customer_id) values (v_user, auth_tenant_id(), p_customer)
  on conflict (user_id) do update set customer_id = excluded.customer_id;
  perform audit_add(auth_tenant_id(), 'portal_link', 'customer', p_customer, null, jsonb_build_object('user_id', v_user));
end $$;
revoke all on function link_portal_user(uuid, text) from public, anon;
grant execute on function link_portal_user(uuid, text) to authenticated;
