-- 0048: ERP WP 1.15 — dashboard / report views (all security_invoker, so RLS scopes every row to the tenant).
-- Hatchery spec §14 (daily / weekly / monthly), PS spec §10 (farm comparison + 4-week trend), Sales spec §8
-- (sales performance per field user). Maintenance tickets gain root cause + downtime for the downtime report.

alter table maintenance_ticket add column root_cause text check (length(root_cause) <= 500),
                               add column downtime_hours numeric(6,1) check (downtime_hours >= 0);
alter table customer add column created_by uuid default auth.uid() references app_user(id),
                     add column created_at timestamptz default now();

-- daily hatchery operations (one row per tenant-day with any activity)
create view hatchery_day with (security_invoker = true) as
select tenant_id, day,
       sum(eggs_received) as eggs_received, sum(settable_received) as settable_received, sum(eggs_set) as eggs_set,
       sum(eggs_transferred) as eggs_transferred, sum(chicks_hatched) as chicks_hatched, sum(vaccine_doses) as vaccine_doses,
       sum(chicks_dispatched) as chicks_dispatched
from (
  select tenant_id, received_on as day, received_qty as eggs_received, received_qty - receipt_rejects as settable_received,
         0 as eggs_set, 0 as eggs_transferred, 0 as chicks_hatched, 0 as vaccine_doses, 0 as chicks_dispatched
    from egg_transfer where status = 'received'
  union all select tenant_id, placed_on, 0, 0, doc_count, 0, 0, 0, 0 from batch where farm_type = 'hatchery'
  union all select tenant_id, moved_on, 0, 0, 0, eggs, 0, 0, 0 from hatcher_transfer where status = 'approved'
  union all select tenant_id, hatched_on, 0, 0, 0, 0, chicks_a + chicks_b + culls, 0, 0 from hatch_record where hatched_on is not null
  union all select tenant_id, (given_at at time zone 'Asia/Kolkata')::date, 0, 0, 0, 0, 0, qty, 0 from chick_vaccination
  union all select l.tenant_id, (d.dispatched_at at time zone 'Asia/Kolkata')::date, 0, 0, 0, 0, 0, 0, l.qty_loaded
    from dispatch_line l join dispatch d on d.id = l.dispatch_id where d.dispatched_at is not null
) e group by tenant_id, day;

-- weekly performance KPIs, weighted by eggs (hatched week)
create view hatchery_week with (security_invoker = true) as
select k.tenant_id, k.wk as week, count(*) as hatches, sum(k.eggs_set) as eggs_set,
       round(100.0 * sum(k.fertile) / nullif(sum(k.eggs_set), 0), 2) as fertility_pct,
       round(100.0 * sum(k.chicks_hatched) / nullif(sum(k.eggs_set), 0), 2) as hes_pct,
       round(100.0 * sum(k.chicks_hatched) / nullif(sum(k.fertile), 0), 2) as hof_pct,
       round(100.0 * sum(k.culls) / nullif(sum(k.chicks_hatched), 0), 2) as cull_pct,
       round(100.0 * sum(coalesce(k.early_dead, 0) + coalesce(k.mid_dead, 0) + coalesce(k.late_dead, 0)) / nullif(sum(k.eggs_set), 0), 2) as embryo_mortality_pct,
       (select round(avg(m.temp_compliance_pct), 1) from machine_env_day m
         where m.tenant_id = k.tenant_id and date_trunc('week', m.day)::date = k.wk) as env_compliance_pct
from (select h.*, date_trunc('week', h.hatched_on)::date as wk from hatch_kpi h where h.hatched_on is not null) k
group by k.tenant_id, k.wk;

-- monthly management summary
create view hatchery_month with (security_invoker = true) as
select d.tenant_id, d.mo as month,
       sum(d.eggs_received) as eggs_received, sum(d.eggs_set) as eggs_set, sum(d.chicks_hatched) as chicks_produced,
       sum(d.chicks_dispatched) + coalesce((select sum(i.qty) from invoice i where i.tenant_id = d.tenant_id and i.product = 'doc' and i.dispatch_line_id is null
                                             and date_trunc('month', i.invoice_date)::date = d.mo), 0) as chicks_sold,
       round(100.0 * sum(d.chicks_hatched) / nullif(sum(d.eggs_set), 0), 2) as overall_efficiency_pct,
       (select coalesce(sum(t.downtime_hours), 0) from maintenance_ticket t where t.tenant_id = d.tenant_id
          and date_trunc('month', t.opened_on)::date = d.mo) as machine_downtime_hours
from (select h.*, date_trunc('month', h.day)::date as mo from hatchery_day h) d group by d.tenant_id, d.mo;

create view vaccine_consumption_month with (security_invoker = true) as
select v.tenant_id, date_trunc('month', v.given_at at time zone 'Asia/Kolkata')::date as month, vm.name as vaccine,
       sum(v.qty) as doses, count(distinct v.batch_id) as settings, count(*) filter (where v.expired) as expired_uses
from chick_vaccination v join vaccine_master vm on vm.id = v.vaccine_id
group by 1, 2, 3;

-- farm/flock comparison with a 4-week rolling trend on HES (PS §10): improving / declining = +/- 1 point
create view farm_comparison with (security_invoker = true) as
with f as (
  select fb.tenant_id, fb.flock_id, fb.flock_code, b.farm_id, fb.hatched_on, fb.eggs_set, fb.hes_pct, fb.fertility_pct, fb.estimated
  from flock_hatch_feedback fb join batch b on b.id = fb.flock_id where fb.hatched_on is not null
), g as (
  select f.tenant_id, f.farm_id, f.flock_id, f.flock_code,
         sum(f.eggs_set) as eggs_set,
         sum(f.fertility_pct * f.eggs_set) / nullif(sum(f.eggs_set), 0) as fertility_pct,
         sum(f.hes_pct * f.eggs_set) / nullif(sum(f.eggs_set), 0) as hes_pct,
         sum(f.hes_pct * f.eggs_set) filter (where f.hatched_on > current_date - 28)
           / nullif(sum(f.eggs_set) filter (where f.hatched_on > current_date - 28), 0) as hes_last_4w,
         sum(f.hes_pct * f.eggs_set) filter (where f.hatched_on <= current_date - 28 and f.hatched_on > current_date - 56)
           / nullif(sum(f.eggs_set) filter (where f.hatched_on <= current_date - 28 and f.hatched_on > current_date - 56), 0) as hes_prev_4w,
         bool_or(f.estimated) as includes_estimates
  from f group by f.tenant_id, f.farm_id, f.flock_id, f.flock_code
)
select g.tenant_id, g.farm_id, fa.name as farm, g.flock_id, g.flock_code, g.eggs_set,
       round(g.fertility_pct, 2) as fertility_pct, round(g.hes_pct, 2) as hes_pct,
       round(g.hes_last_4w, 2) as hes_last_4w, round(g.hes_prev_4w, 2) as hes_prev_4w,
       case when g.hes_last_4w is null or g.hes_prev_4w is null then 'insufficient'
            when g.hes_last_4w - g.hes_prev_4w > 1 then 'improving'
            when g.hes_last_4w - g.hes_prev_4w < -1 then 'declining'
            else 'stable' end as trend,
       g.includes_estimates
from g join farm fa on fa.id = g.farm_id;

-- sales performance per field user per month (Sales §8). Collection rate = invoices due in the month paid in
-- full by their due date; retention = customers who also ordered in the previous month.
create view sales_performance with (security_invoker = true) as
with o as (
  select so.tenant_id, so.created_by as user_id, date_trunc('month', so.created_at)::date as month,
         so.customer_id, so.qty, so.price, so.status, so.created_at
  from sales_order so where so.status <> 'expired'
), inv as (
  select so.tenant_id, so.created_by as user_id, i.id, i.total, i.due_date, i.status,
         (select max(p.paid_on) from payment p where p.ref_type = 'invoice' and p.ref_id = i.id) as last_paid_on
  from invoice i join dispatch_line l on l.id = i.dispatch_line_id join order_allocation a on a.id = l.allocation_id join sales_order so on so.id = a.order_id
)
select o.tenant_id, o.user_id, u.full_name as user_name, o.month,
       count(*) filter (where o.status <> 'cancelled') as orders,
       sum(o.qty) filter (where o.status <> 'cancelled') as chicks_booked,
       sum(o.qty * o.price) filter (where o.status <> 'cancelled') as value_booked,
       count(distinct o.customer_id) filter (where not exists (select 1 from sales_order e where e.customer_id = o.customer_id and e.created_at < o.month)) as new_customers,
       count(distinct o.customer_id) filter (where exists (select 1 from sales_order e where e.customer_id = o.customer_id
            and e.created_at >= o.month - interval '1 month' and e.created_at < o.month)) as retained_customers,
       (select coalesce(sum(total), 0) from inv where inv.user_id = o.user_id and inv.tenant_id = o.tenant_id and date_trunc('month', inv.due_date) = o.month) as revenue_due,
       (select round(100.0 * count(*) filter (where inv.status = 'paid' and inv.last_paid_on <= inv.due_date) / nullif(count(*), 0), 1)
          from inv where inv.user_id = o.user_id and inv.tenant_id = o.tenant_id and date_trunc('month', inv.due_date) = o.month) as collection_rate_pct
from o left join app_user u on u.id = o.user_id
group by o.tenant_id, o.user_id, u.full_name, o.month;
