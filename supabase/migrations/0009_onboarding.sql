-- 0009: no self-signup — a farm applies, the platform team approves, then the account is created.
create table if not exists onboarding_application (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  -- business & KYC
  business_name text not null,
  legal_name text,
  entity_type text,              -- proprietor | partnership | llp | pvt_ltd | fpo | cooperative
  pan text,
  gstin text,
  udyam text,
  fssai text,
  pcb_ref text,                  -- Pollution Control Board CTE/CTO (mandatory above 5,000 birds)
  trade_licence text,
  -- contact
  owner_name text not null,
  phone text not null,           -- E.164, becomes the owner's OTP login
  alt_phone text,
  email text,
  whatsapp text,
  language text not null default 'te',
  -- farm
  farm_types text[] not null check (cardinality(farm_types) > 0),
  state text not null,
  district text,
  sites jsonb not null default '[]',      -- [{name,village,mandal,district,state,pin,lat,lng,land_acres,ownership,sheds:[{name,length_ft,width_ft,type,floor,capacity}]}]
  operations jsonb not null default '{}', -- {current_birds,breed,model,integrator,monthly_volume}
  labour jsonb not null default '{}',     -- {supervisor,worker,vaccinator,driver,technician}
  consent boolean not null check (consent),
  -- review
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  tenant_id uuid references tenant(id),
  created_at timestamptz not null default now()
);
-- one open application per phone number
create unique index if not exists onboarding_application_open_phone on onboarding_application (phone) where status = 'submitted';

alter table onboarding_application enable row level security;
-- anyone (no login) may submit; they cannot read anything back (insert with return=minimal)
create policy apply_submit on onboarding_application for insert to anon, authenticated
  with check (status = 'submitted' and tenant_id is null and reviewed_by is null and reviewed_at is null and review_note is null);
-- only platform staff see and decide applications
create policy apply_platform on onboarding_application for all to authenticated
  using (auth_is_platform()) with check (auth_is_platform());
grant insert on onboarding_application to anon;
