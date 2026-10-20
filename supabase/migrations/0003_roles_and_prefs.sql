-- 0003: roles for the platform team (one platform login, different views per team),
-- a 'labour' role for shed workers with their own OTP login, per-user preferences,
-- and a fix for KPI views that bypassed RLS.
alter type app_role add value if not exists 'platform_finance';
alter type app_role add value if not exists 'platform_marketing';
alter type app_role add value if not exists 'platform_sales';
alter type app_role add value if not exists 'platform_ops';
alter type app_role add value if not exists 'labour';

alter table app_user
  add column if not exists email text,
  add column if not exists active_farm_type farm_type;   -- null = picker not done yet

comment on column app_user.active_farm_type is
  'Workflow the user last chose (broiler/layer/hatchery/breeder); picker shows when null and tenant runs >1 type';

-- Views default to the owner's rights, which skips RLS: a VKR user could read KS rows through
-- v_batch_kpi (verified: 9 rows instead of 5). Run them with the caller's rights instead.
alter view v_batch_kpi set (security_invoker = true);
alter view v_ap_ageing set (security_invoker = true);
alter view v_ar_ageing set (security_invoker = true);
alter view v_stock_balance set (security_invoker = true);
revoke select on v_batch_kpi, v_ap_ageing, v_ar_ageing, v_stock_balance from anon;
