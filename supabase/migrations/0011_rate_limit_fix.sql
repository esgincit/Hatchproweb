-- 0011: the per-phone rate limit must not trust client values, and must not race.
-- * server stamps id/created_at/status (a back-dated created_at bypassed the 1-day window)
-- * an advisory lock per phone serialises concurrent submits so two can't both pass the count
-- * the public may only write the form's columns
create or replace function onboarding_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id := gen_random_uuid();
  new.created_at := now();
  new.status := 'submitted';
  perform pg_advisory_xact_lock(hashtext('onboarding:' || new.phone));
  if (select count(*) from onboarding_application where phone = new.phone and created_at > now() - interval '1 day') >= 3 then
    raise exception 'too many applications for this number today' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke insert on onboarding_application from anon, authenticated;
grant insert (business_name, legal_name, entity_type, pan, gstin, udyam, fssai, pcb_ref, trade_licence,
              owner_name, phone, alt_phone, email, whatsapp, language, farm_types, state, district,
              sites, operations, labour, consent)
  on onboarding_application to anon, authenticated;
