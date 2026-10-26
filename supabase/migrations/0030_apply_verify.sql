-- 0030: onboarding hardening (roadmap Phase 6): the applicant proves the mobile number (OTP from the apply-otp edge
-- function, which is gated by a Turnstile captcha against SMS pumping) and can attach licence/ID documents.
-- apply_phone_check is service-role only (no policies). An application insert must name a check that is verified,
-- for the same phone, unused and recent; it is consumed by the insert. Documents must sit in that check's folder
-- (documents/applications/<check id>/…, written via signed upload URLs the function hands out).
create table apply_phone_check (
  id uuid primary key default gen_random_uuid(),
  phone text not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  used_at timestamptz
);
create index apply_phone_check_phone on apply_phone_check (phone, created_at desc);
alter table apply_phone_check enable row level security; -- no policies: only the service role (apply-otp) touches it

-- one guess = one atomic increment (parallel verify calls can't all slip under the 5-attempt cap); returns the stored
-- hash only while the check is still guessable
create function apply_check_attempt(p_id uuid) returns text language sql security definer set search_path = public as $$
  update apply_phone_check set attempts = attempts + 1
  where id = p_id and attempts < 5 and used_at is null and verified_at is null and expires_at > now()
  returning code_hash
$$;
revoke all on function apply_check_attempt(uuid) from public, anon, authenticated;
grant execute on function apply_check_attempt(uuid) to service_role;

alter table onboarding_application
  add column phone_check_id uuid references apply_phone_check(id),
  add column phone_verified boolean not null default false,
  add column documents jsonb not null default '[]' check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) <= 10);

-- the public form may fill these two (0011 grants column-level insert); phone_verified is set only by the trigger
grant insert (phone_check_id, documents) on onboarding_application to anon, authenticated;

create function onboarding_require_verified_phone() returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  -- seeds / platform tooling are exempt. Not current_user: inside this SECURITY DEFINER function that is always the
  -- owner (postgres), which would exempt everyone. The 'role' setting still shows the caller's role (anon via PostgREST).
  if coalesce(nullif(current_setting('role', true), 'none'), session_user) in ('postgres', 'service_role') then return new; end if;
  select * into c from apply_phone_check where id = new.phone_check_id for update;
  if not found or c.phone <> new.phone or c.verified_at is null or c.used_at is not null or c.verified_at < now() - interval '30 minutes' then
    raise exception 'mobile number not verified' using errcode = 'HP401';
  end if;
  if exists (select 1 from jsonb_array_elements(new.documents) d
             where coalesce(d->>'path', '') not like 'applications/' || c.id || '/%' or (d->>'path') like '%..%') then
    raise exception 'document not uploaded through this application' using errcode = 'HP402';
  end if;
  update apply_phone_check set used_at = now() where id = c.id;
  new.phone_verified := true;
  return new;
end $$;
create trigger onboarding_require_verified_phone before insert on onboarding_application
  for each row execute function onboarding_require_verified_phone();

-- the platform applications teams (0016 TEAM.applications) read the attached documents for review
create policy documents_platform_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'applications'
         and auth_is_platform() and (select auth_roles()) && '{platform_admin,platform_sales,platform_ops}');
