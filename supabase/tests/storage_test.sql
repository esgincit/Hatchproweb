-- Run: docker exec -i supabase_db_poultryos psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/storage_test.sql
-- 0027 evidence bucket: field roles add photos only under <own tenant>/<own batch>/; other tenants can't read them.
begin;
select set_config('t.vkr', '4c593c59-b79c-5b92-8601-fd7c0d7a3b4c', true);
select set_config('t.b', (select id::text from batch where code = 'VKR-B-2026-14'), true);
select set_config('t.ksb', (select id::text from batch where code = 'KS-H-2026-37'), true);
set local role authenticated;

-- VKR supervisor
set local request.jwt.claims = '{"sub":"2ec95adf-6bfe-5044-acae-7684c5813715","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["shed_supervisor"]}}';
do $$
declare ok text := current_setting('t.vkr') || '/' || current_setting('t.b') || '/2026-10-19/a.jpg';
begin
  insert into storage.objects (bucket_id, name) values ('evidence', ok);
  assert (select count(*) from storage.objects where name = ok) = 1, 'supervisor reads own photo';
  begin insert into storage.objects (bucket_id, name) values ('evidence', current_setting('t.vkr') || '/not-a-batch/x.jpg'); assert false, 'non-batch folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('evidence', current_setting('t.vkr') || '/' || current_setting('t.ksb') || '/x.jpg'); assert false, 'other tenant batch';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('evidence', 'b146bf5d-6213-556e-8e71-8d4c156ad36d/' || current_setting('t.ksb') || '/x.jpg'); assert false, 'other tenant folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('documents', current_setting('t.vkr') || '/x.pdf'); assert false, 'documents bucket';
  exception when insufficient_privilege then null; end;
end $$;

-- VKR finance: not a field role
set local request.jwt.claims = '{"sub":"8817e673-99a9-53c8-9f77-28599a17f0f5","app_metadata":{"tenant_id":"4c593c59-b79c-5b92-8601-fd7c0d7a3b4c","roles":["finance"]}}';
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('evidence', current_setting('t.vkr') || '/' || current_setting('t.b') || '/2026-10-19/f.jpg'); assert false, 'finance uploaded evidence';
  exception when insufficient_privilege then null; end;
end $$;

-- KS owner: can't see VKR's photos
set local request.jwt.claims = '{"sub":"436f615f-c815-5957-8623-ca639dcdb5e4","app_metadata":{"tenant_id":"b146bf5d-6213-556e-8e71-8d4c156ad36d","roles":["tenant_owner"]}}';
do $$ begin assert (select count(*) from storage.objects where bucket_id = 'evidence') = 0, 'cross-tenant read'; end $$;
rollback;
\echo storage_test OK
