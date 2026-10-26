-- 0027: private storage buckets + access rules. config.toml only creates buckets locally, and no policy existed,
-- so phone/web photo uploads (mortality evidence, feed) failed and hosted projects had no buckets at all.
-- Layout: evidence/<tenant_id>/<batch_id>/<date>/<uuid>.jpg — a signed-in user reads and adds only under their
-- own tenant folder; evidence is never edited or deleted from the app (insurance / AI-triage audit trail).
-- `documents` (onboarding uploads) is written only by the service role (apply flow), so it gets no user policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
       ('documents', 'documents', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false;

create policy evidence_tenant_read on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_tenant_id()::text);
create policy evidence_tenant_add on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth_tenant_id()::text and (select auth_tenant_active()));
