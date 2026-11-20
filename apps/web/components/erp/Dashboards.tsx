// Dashboards (module `dashboards`, 0048/0052): tables over the security_invoker views, so RLS scopes every row to the tenant and the
// user's role. One weekly line chart (hatch of eggs set); the rest is plain tables. The anomaly views stay empty until enough history exists.
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, monthFmt } from '@/lib/format';
import { Chips, Header } from '@/components/ui/bits';
import { LineChart } from '@/components/charts/LineChart';
import { Card, Tbl, nz, pct, type Row, type T } from './bits';

export const DASH_TABS = ['hatchery', 'farms', 'sales', 'alerts'] as const;
type Fmt = { dmy: (s: string) => string; mon: (s: string) => string };

export async function DashboardsArea({ tab: q }: { tab?: string }) {
  const [t, locale] = [await getTranslations(), await getLocale()];
  const tab = (DASH_TABS as readonly string[]).includes(q ?? '') ? q! : 'hatchery';
  const f: Fmt = { dmy: dateFmt(locale), mon: monthFmt(locale, 'short') };
  return (
    <>
      <Header title={t('dash.title')} />
      <Chips active={tab} items={DASH_TABS.map((k): [string, string, string] => [k === 'hatchery' ? '/more/dashboards' : `/more/dashboards?tab=${k}`, k, t(`dash.tab.${k}`)])} />
      {tab === 'hatchery' && <Hatchery t={t} f={f} />}
      {tab === 'farms' && <Farms t={t} />}
      {tab === 'sales' && <SalesDash t={t} f={f} />}
      {tab === 'alerts' && <Alerts t={t} f={f} />}
    </>
  );
}

async function Hatchery({ t, f }: { t: T; f: Fmt }) {
  const sb = await createClient();
  const [{ data: wk }, { data: day }, { data: mo }, { data: vac }] = await Promise.all([
    sb.from('hatchery_week').select('week,hatches,eggs_set,fertility_pct,hes_pct,hof_pct,cull_pct,embryo_mortality_pct,env_compliance_pct').order('week', { ascending: false }).limit(12),
    sb.from('hatchery_day').select('day,eggs_received,eggs_set,chicks_hatched,vaccine_doses,chicks_dispatched').order('day', { ascending: false }).limit(14),
    sb.from('hatchery_month').select('month,eggs_received,eggs_set,chicks_produced,chicks_sold,overall_efficiency_pct,machine_downtime_hours').order('month', { ascending: false }).limit(12),
    sb.from('vaccine_consumption_month').select('month,vaccine,doses,settings,expired_uses').order('month', { ascending: false }).limit(24),
  ]);
  const trend = [...(wk ?? [])].reverse().filter((w: Row) => w.hes_pct != null);
  return (
    <>
      {trend.length > 1 && (
        <Card title={t('dash.hesTrend')} testid="dash-hes-chart">
          <LineChart fmt="pct" series={[{ name: 'HES', data: trend.map((w: Row) => Number(w.hes_pct)), color: 'var(--accent)' }]}
            xlabels={[[0, f.dmy(trend[0].week)], [trend.length - 1, f.dmy(trend[trend.length - 1].week)]]} vals={trend.map((w: Row) => `${pct(w.hes_pct)} · ${f.dmy(w.week)}`)} />
        </Card>
      )}
      <Card title={t('dash.week')} testid="dash-week">
        <Tbl head={[`-${t('dash.weekOf')}`, t('dash.hatches'), t('dash.eggsSet'), t('dash.fertility'), 'HES', 'HOF', t('dash.cull'), t('dash.embryo'), t('dash.env')]} empty={t('dash.none')}
          rows={(wk ?? []).map((w: Row) => ({ key: w.week, cells: [f.dmy(w.week), nz(w.hatches), nz(w.eggs_set), pct(w.fertility_pct), pct(w.hes_pct), pct(w.hof_pct), pct(w.cull_pct), pct(w.embryo_mortality_pct), pct(w.env_compliance_pct)] }))} />
      </Card>
      <Card title={t('dash.day')} testid="dash-day">
        <Tbl head={[`-${t('dash.date')}`, t('dash.received'), t('dash.eggsSet'), t('dash.hatched'), t('dash.doses'), t('dash.dispatched')]} empty={t('dash.none')}
          rows={(day ?? []).map((d: Row) => ({ key: d.day, cells: [f.dmy(d.day), nz(d.eggs_received), nz(d.eggs_set), nz(d.chicks_hatched), nz(d.vaccine_doses), nz(d.chicks_dispatched)] }))} />
      </Card>
      <Card title={t('dash.month')} testid="dash-month">
        <Tbl head={[`-${t('dash.monthCol')}`, t('dash.received'), t('dash.eggsSet'), t('dash.produced'), t('dash.sold'), t('dash.efficiency'), t('dash.downtime')]} empty={t('dash.none')}
          rows={(mo ?? []).map((m: Row) => ({ key: m.month, cells: [f.mon(m.month), nz(m.eggs_received), nz(m.eggs_set), nz(m.chicks_produced), nz(m.chicks_sold), pct(m.overall_efficiency_pct), nz(m.machine_downtime_hours, 1)] }))} />
      </Card>
      <Card title={t('dash.vaccines')} testid="dash-vaccines">
        <Tbl head={[`-${t('dash.monthCol')}`, `-${t('dash.vaccine')}`, t('dash.doses'), t('dash.settings'), t('dash.expiredUses')]} empty={t('dash.none')}
          rows={(vac ?? []).map((v: Row) => ({ key: `${v.month}${v.vaccine}`, cells: [f.mon(v.month), v.vaccine, nz(v.doses), nz(v.settings), nz(v.expired_uses)] }))} />
      </Card>
    </>
  );
}

async function Farms({ t }: { t: T }) {
  const sb = await createClient();
  const [{ data: fc }, { data: age }] = await Promise.all([
    sb.from('farm_comparison').select('flock_id,farm,flock_code,eggs_set,fertility_pct,hes_pct,hes_last_4w,hes_prev_4w,trend,includes_estimates').order('hes_pct', { ascending: false }),
    sb.from('flock_age_hes').select('breed_id,flock_age_week,settings,eggs_set,hes_pct,fertility_pct').order('flock_age_week'),
  ]);
  return (
    <>
      <Card title={t('dash.farmCmp')} testid="dash-farms">
        <Tbl head={[`-${t('dash.farm')}`, `-${t('dash.flock')}`, t('dash.eggsSet'), t('dash.fertility'), 'HES', t('dash.last4'), `-${t('dash.trend')}`]} empty={t('dash.none')}
          rows={(fc ?? []).map((r: Row) => ({
            key: r.flock_id,
            cells: [r.farm, `${r.flock_code}${r.includes_estimates ? ' *' : ''}`, nz(r.eggs_set), pct(r.fertility_pct), pct(r.hes_pct), pct(r.hes_last_4w),
              <span key="t" className={`pill ${r.trend === 'improving' ? 'good' : r.trend === 'declining' ? 'crit' : 'neutral'}`}>{t(`dash.trendv.${r.trend}`)}</span>],
          }))} />
        {(fc ?? []).some((r: Row) => r.includes_estimates) && <div className="s">{t('dash.estimates')}</div>}
      </Card>
      <Card title={t('dash.ageHes')} testid="dash-age">
        <Tbl head={[t('dash.ageWeek'), t('dash.settingsN'), t('dash.eggsSet'), t('dash.fertility'), 'HES']} empty={t('dash.none')}
          rows={(age ?? []).map((r: Row) => ({ key: `${r.breed_id}${r.flock_age_week}`, cells: [nz(r.flock_age_week), nz(r.settings), nz(r.eggs_set), pct(r.fertility_pct), pct(r.hes_pct)] }))} />
      </Card>
    </>
  );
}

async function SalesDash({ t, f }: { t: T; f: Fmt }) {
  const sb = await createClient();
  const [{ data: perf }, { data: dem }, { data: ps }] = await Promise.all([
    sb.from('sales_performance').select('user_id,user_name,month,orders,chicks_booked,value_booked,new_customers,retained_customers,collection_rate_pct').order('month', { ascending: false }).limit(36),
    sb.from('demand_trend').select('product_id,weeks,avg_weekly,chicks_per_week_trend,projected_4w'),
    sb.from('chick_product').select('id,name'),
  ]);
  const name = new Map((ps ?? []).map((p: Row) => [p.id, p.name]));
  return (
    <>
      <Card title={t('dash.perf')} testid="dash-perf">
        <Tbl head={[`-${t('dash.person')}`, `-${t('dash.monthCol')}`, t('dash.orders'), t('dash.booked'), t('dash.value'), t('dash.newCust'), t('dash.retained'), t('dash.collection')]} empty={t('dash.none')}
          rows={(perf ?? []).map((r: Row) => ({ key: `${r.user_id}${r.month}`, cells: [r.user_name ?? '—', f.mon(r.month), nz(r.orders), nz(r.chicks_booked), nz(r.value_booked), nz(r.new_customers), nz(r.retained_customers), pct(r.collection_rate_pct)] }))} />
      </Card>
      <Card title={t('dash.demand')} testid="dash-demand">
        <Tbl head={[`-${t('dash.product')}`, t('dash.weeksN'), t('dash.avgWeekly'), t('dash.trendPerWeek'), t('dash.proj4')]} empty={t('dash.noDemand')}
          rows={(dem ?? []).map((r: Row) => ({ key: r.product_id, cells: [name.get(r.product_id) ?? '—', nz(r.weeks), nz(r.avg_weekly), nz(r.chicks_per_week_trend, 1), nz(r.projected_4w)] }))} />
      </Card>
    </>
  );
}

async function Alerts({ t, f }: { t: T; f: Fmt }) {
  const sb = await createClient();
  const [{ data: mort }, { data: egg }] = await Promise.all([
    sb.from('mortality_anomaly').select('batch_id,log_date,dead,mean14,z_score').order('log_date', { ascending: false }).limit(30),
    sb.from('egg_drop_anomaly').select('batch_id,collected_on,hen_day_pct,mean7,drop_points').order('collected_on', { ascending: false }).limit(30),
  ]);
  const ids = [...new Set([...(mort ?? []), ...(egg ?? [])].map((r: Row) => r.batch_id))];
  const { data: bs } = ids.length ? await sb.from('batch').select('id,code').in('id', ids) : { data: [] };
  const code = (id: string) => (bs ?? []).find((b: Row) => b.id === id)?.code ?? '—';
  return (
    <>
      <div className="s">{t('dash.anomalyHint')}</div>
      <Card title={t('dash.mortAnomaly')} testid="dash-mort">
        <Tbl head={[`-${t('dash.batch')}`, `-${t('dash.date')}`, t('dash.dead'), t('dash.mean14'), 'z']} empty={t('dash.noAnomalies')}
          rows={(mort ?? []).map((r: Row) => ({ key: `${r.batch_id}${r.log_date}`, cells: [code(r.batch_id), f.dmy(r.log_date), nz(r.dead), nz(r.mean14, 1), nz(r.z_score, 1)] }))} />
      </Card>
      <Card title={t('dash.eggAnomaly')} testid="dash-egg">
        <Tbl head={[`-${t('dash.batch')}`, `-${t('dash.date')}`, t('dash.henDay'), t('dash.mean7'), t('dash.dropPts')]} empty={t('dash.noAnomalies')}
          rows={(egg ?? []).map((r: Row) => ({ key: `${r.batch_id}${r.collected_on}`, cells: [code(r.batch_id), f.dmy(r.collected_on), pct(r.hen_day_pct), pct(r.mean7), nz(r.drop_points, 1)] }))} />
      </Card>
    </>
  );
}
