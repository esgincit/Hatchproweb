-- 0058: refuse internal webhook targets when the URL is saved, not only at delivery. Mirrors safeWebhookUrl() in
-- supabase/functions/erp-cron/url.ts: https, default port, no user:pass, no IP literal, a dotted public-looking name.
-- erp-cron still resolves DNS and refuses private addresses before every send (and never follows redirects).
alter table webhook_subscription add constraint webhook_url_public check (
  url ~* '^https://[a-z0-9.-]+([/?#]\S*)?$'
  and substring(lower(url) from '^https://([^/?#]+)') !~ '^[0-9.]+$'
  and substring(lower(url) from '^https://([^/?#]+)') ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'
  and substring(lower(url) from '^https://([^/?#]+)') !~ '\.(local|internal|localhost|lan|home|corp|arpa)$'
);
