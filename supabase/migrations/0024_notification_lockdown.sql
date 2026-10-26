-- 0024: notifications are written by the system. Signed-in users may still ADD rows (report_issue and ai-triage
-- run as the user), but may only mark them read — no editing titles/severity, no deleting alerts.
-- (Inserts stay tenant-scoped by notification_tenant_isolation; dedupe_key is system-only, 0023 trigger.)
revoke update on notification from authenticated, anon;
grant update (read_at) on notification to authenticated;
create policy notification_no_del on notification as restrictive for delete using (auth_is_platform());
