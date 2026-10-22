-- 0010: the public application insert is reachable without the app (anon key), so the database enforces
-- the form's rules itself, and one phone number can no longer be "squatted" by a stranger's application.

-- 1) Shape checks mirroring lib/schemas.ts APPLY (the server re-validates too; this stops direct API inserts).
alter table onboarding_application
  add constraint app_phone_fmt check (phone ~ '^\+91[6-9][0-9]{9}$'),
  add constraint app_alt_phone_fmt check (alt_phone is null or alt_phone ~ '^\+91[6-9][0-9]{9}$'),
  add constraint app_whatsapp_fmt check (whatsapp is null or whatsapp ~ '^\+91[6-9][0-9]{9}$'),
  add constraint app_language check (language in ('en', 'te', 'hi', 'ta', 'kn')),
  add constraint app_farm_types check (farm_types <@ array['broiler', 'layer', 'hatchery', 'breeder']::text[]),
  add constraint app_entity check (entity_type is null or entity_type in ('proprietor', 'partnership', 'llp', 'pvt_ltd', 'fpo', 'cooperative')),
  add constraint app_pan check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  add constraint app_gstin check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  add constraint app_text_len check (
    length(business_name) between 1 and 120 and length(owner_name) between 1 and 120 and length(state) <= 60
    and coalesce(length(legal_name), 0) <= 120 and coalesce(length(email), 0) <= 120 and coalesce(length(district), 0) <= 60),
  add constraint app_sites check (jsonb_typeof(sites) = 'array' and jsonb_array_length(sites) between 1 and 5),
  add constraint app_sheds check (jsonb_typeof(sites -> 0 -> 'sheds') = 'array' and jsonb_array_length(sites -> 0 -> 'sheds') between 1 and 60),
  add constraint app_payload_size check (pg_column_size(sites) + pg_column_size(operations) + pg_column_size(labour) < 64000);

-- 2) No squatting: several open applications per phone are allowed (staff see and compare them),
--    but at most 3 per phone per day, to stop flooding. ponytail: add OTP-verified submit + CAPTCHA before launch.
drop index if exists onboarding_application_open_phone;
create index if not exists onboarding_application_phone on onboarding_application (phone, created_at desc);
create or replace function onboarding_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from onboarding_application where phone = new.phone and created_at > now() - interval '1 day') >= 3 then
    raise exception 'too many applications for this number today' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger onboarding_rate_limit before insert on onboarding_application for each row execute function onboarding_rate_limit();
