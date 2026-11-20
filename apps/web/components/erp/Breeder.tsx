// Breeder flock page (farm_type 'breeder'): daily F/M record + approval, body weight vs standard, hatching-egg collection,
// egg KPIs + farm egg store, production calendar, medication, biosecurity, house readings (0038/0039). Server components.
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Card, Decide, Status, Tbl, nz, pct, type Row } from './bits';

export async function BreederPanel({ batchId }: { batchId: string }) {
  const [sb, t, locale] = [await createClient(), await getTranslations(), await getLocale()];
  const { data: fl } = await sb.from('batch').select('shed_id,farm_id').eq('id', batchId).maybeSingle();
  if (!fl) return null;
  const [shedId, farmId] = [fl.shed_id, fl.farm_id];
  const dmy = dateFmt(locale);
  const lim = (q: Row, n: number) => q.limit(n);
  const [daily, flockDay, bw, coll, eggDay, store, cal, meds, bio, env] = await Promise.all([
    lim(sb.from('breeder_daily').select('id,log_date,female_mort,male_mort,status,reject_reason').eq('batch_id', batchId).order('log_date', { ascending: false }), 14),
    lim(sb.from('breeder_flock_day').select('log_date,females_left,males_left,female_mort_pct,male_mort_pct,feed_g_per_female,feed_g_per_male,water_ml_per_bird').eq('batch_id', batchId).order('log_date', { ascending: false }), 14),
    lim(sb.from('body_weight_vs_standard').select('id,weighed_on,sex,sample_size,avg_g,std_g,diff_g,uniformity_pct,cv_pct,fleshing_score,age_week,sample_ok').eq('batch_id', batchId).order('weighed_on', { ascending: false }), 12),
    lim(sb.from('hatching_egg_collection').select('id,collected_on,collection_no,nest,floor,total,settable,status,reject_reason').eq('batch_id', batchId).order('collected_on', { ascending: false }).order('collection_no', { ascending: false }), 14),
    lim(sb.from('flock_egg_day').select('collected_on,total,settable,floor,hen_day_pct,settable_pct,floor_pct').eq('batch_id', batchId).order('collected_on', { ascending: false }), 7),
    sb.from('flock_egg_store').select('collected,committed,in_store,oldest_collected_on').eq('batch_id', batchId).maybeSingle(),
    sb.from('breeder_calendar').select('placed_on,light_stimulation_on,first_egg_on,peak_on,depletion_on,age_weeks').eq('batch_id', batchId).maybeSingle(),
    lim(sb.from('medication_record').select('id,given_on,medicine,dosage,duration_days,reason,withdrawal_days').eq('batch_id', batchId).order('given_on', { ascending: false }), 5),
    lim(sb.from('biosecurity_incident').select('id,occurred_on,nature,birds_affected,follow_up_on,closed_on').eq('farm_id', farmId).order('occurred_on', { ascending: false }), 5),
    lim(sb.from('env_reading').select('id,read_at,temp_c,rh_pct,nh3_ppm,litter,ventilation').eq('shed_id', shedId).order('read_at', { ascending: false }), 5),
  ]);
  const pctOf = new Map<string, Row>((flockDay.data ?? []).map((r: Row) => [r.log_date, r]));
  const ctx = { batch: batchId, shed: shedId };
  const eb = (act: string, label: string) => <ActBtn act={act} ctx={ctx} className="btn small">{label}</ActBtn>;
  const c = cal.data, s = store.data;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale + '-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  return (
    <>
      <Card title={t('erp.b.daily')} testid="breeder-daily" action={eb('breederDaily', t('erp.b.addDaily'))}>
        <Tbl empty={t('erp.b.noDaily')}
          head={['-' + t('batch.colDate'), t('erp.b.fDead'), t('erp.b.mDead'), t('erp.b.fLeft'), t('erp.b.mLeft'), t('erp.b.feedF'), t('erp.b.feedM'), '-' + t('erp.b.status')]}
          rows={(daily.data ?? []).map((d: Row) => {
            const v = pctOf.get(d.log_date) ?? {};
            return {
              key: d.id,
              cells: [dmy(d.log_date), `${d.female_mort} (${pct(v.female_mort_pct, 2)})`, `${d.male_mort} (${pct(v.male_mort_pct, 2)})`, nz(v.females_left), nz(v.males_left),
                nz(v.feed_g_per_female), nz(v.feed_g_per_male),
                <span key="s"><Status status={d.status} t={t} /> {d.status === 'rejected' && d.reject_reason && <span className="s">{t('trace.reason', { r: d.reject_reason })} </span>}<Decide act="decideDaily" id={d.id} status={d.status} t={t} /></span>],
            };
          })} />
      </Card>

      <Card title={t('erp.b.weights')} testid="breeder-weights" action={eb('bodyWeight', t('erp.b.addWeight'))}>
        <Tbl empty={t('erp.b.noWeights')}
          head={['-' + t('erp.b.week'), '-' + t('erp.f.sex'), t('erp.f.sample'), t('erp.f.avgG'), t('erp.b.std'), t('erp.b.diff'), t('erp.f.uniformity'), t('erp.f.cv'), t('erp.f.fleshing')]}
          rows={(bw.data ?? []).map((w: Row) => ({
            key: w.id,
            cells: [`${w.age_week} · ${dmy(w.weighed_on)}`, w.sex === 'F' ? t('erp.f.female') : t('erp.f.male'),
              <span key="n">{w.sample_size} {!w.sample_ok && <span className="pill warn" data-testid="sample-small">{t('erp.b.sampleSmall')}</span>}</span>,
              nz(w.avg_g), nz(w.std_g), w.diff_g == null ? '—' : `${w.diff_g > 0 ? '+' : ''}${w.diff_g}`, pct(w.uniformity_pct), pct(w.cv_pct), w.fleshing_score ?? '—'],
          }))} />
      </Card>

      <Card title={t('erp.b.eggs')} testid="breeder-eggs" action={eb('eggCollection', t('erp.b.addEggs'))}>
        <div className="kv" data-testid="egg-store" style={{ marginBottom: 8 }}>
          <div>{t('erp.b.inStore')}</div><div><b>{fmtN(s?.in_store ?? 0)}</b> · {t('erp.b.storeLine', { c: fmtN(s?.collected ?? 0), s: fmtN(s?.committed ?? 0) })}</div>
          {s?.oldest_collected_on && <><div>{t('erp.b.oldest')}</div><div>{dmy(s.oldest_collected_on)}</div></>}
        </div>
        <Tbl empty={t('erp.b.noEggDays')}
          head={['-' + t('batch.colDate'), t('erp.b.total'), t('erp.b.settable'), t('erp.b.floorEggs'), t('erp.b.henDay'), t('erp.b.settablePct'), t('erp.b.floorPct')]}
          rows={(eggDay.data ?? []).map((d: Row) => ({
            key: d.collected_on, cells: [dmy(d.collected_on), nz(d.total), nz(d.settable), nz(d.floor), pct(d.hen_day_pct), pct(d.settable_pct), pct(d.floor_pct)],
          }))} />
        <div className="eyebrow" style={{ margin: '10px 0 4px' }}>{t('erp.b.collections')}</div>
        <Tbl empty={t('erp.b.noColl')}
          head={['-' + t('batch.colDate'), '-#', t('erp.egg.nest'), t('erp.egg.floor'), t('erp.b.settable'), '-' + t('erp.b.status')]}
          rows={(coll.data ?? []).map((x: Row) => ({
            key: x.id,
            cells: [dmy(x.collected_on), x.collection_no, nz(x.nest), nz(x.floor), nz(x.settable),
              <span key="s"><Status status={x.status} t={t} /> {x.status === 'rejected' && x.reject_reason && <span className="s">{t('trace.reason', { r: x.reject_reason })} </span>}<Decide act="decideEggs" id={x.id} status={x.status} t={t} /></span>],
          }))} />
      </Card>

      {c && (
        <Card title={t('erp.b.calendar')} testid="breeder-calendar">
          <div className="kv">
            <div>{t('erp.b.age')}</div><div>{t('common.week', { n: c.age_weeks })} · {t('erp.b.placedOn', { d: dmy(c.placed_on) })}</div>
            <div>{t('erp.b.light')}</div><div>{dmy(c.light_stimulation_on)}</div>
            <div>{t('erp.b.firstEgg')}</div><div>{dmy(c.first_egg_on)}</div>
            <div>{t('erp.b.peak')}</div><div>{dmy(c.peak_on)}</div>
            <div>{t('erp.b.depletion')}</div><div>{dmy(c.depletion_on)}</div>
          </div>
        </Card>
      )}

      <Card title={t('erp.b.health')} testid="breeder-health" action={<>{eb('medication', t('erp.b.addMed'))}<ActBtn act="biosecurity" ctx={ctx} className="btn small secondary">{t('erp.b.addBio')}</ActBtn></>}>
        <div className="list">
          {(meds.data ?? []).map((m: Row) => (
            <div className="item" key={m.id}><div>
              <div className="t">{m.medicine} · {m.dosage} · {t('erp.b.forDays', { n: m.duration_days })}</div>
              <div className="s">{dmy(m.given_on)} · {m.reason}{m.withdrawal_days != null ? ` · ${t('erp.b.withdrawal', { n: m.withdrawal_days })}` : ''}</div>
            </div></div>
          ))}
          {(bio.data ?? []).map((x: Row) => (
            <div className="item" key={x.id}><div>
              <div className="t">{x.nature} {x.closed_on ? <span className="pill good">{t('common.done')}</span> : <span className="pill warn">{t('erp.b.open')}</span>}</div>
              <div className="s">{dmy(x.occurred_on)}{x.birds_affected != null ? ` · ${t('common.birds', { n: fmtN(x.birds_affected) })}` : ''}{x.follow_up_on ? ` · ${t('erp.b.followUp', { d: dmy(x.follow_up_on) })}` : ''}</div>
            </div></div>
          ))}
          {!meds.data?.length && !bio.data?.length && <div className="s">{t('erp.b.noHealth')}</div>}
        </div>
      </Card>

      <Card title={t('erp.b.house')} testid="breeder-house" action={eb('houseReading', t('erp.b.addReading'))}>
        <Tbl empty={t('erp.b.noReadings')}
          head={['-' + t('erp.b.at'), t('erp.f.temp'), t('erp.f.rh'), t('erp.f.nh3'), '-' + t('erp.f.litter')]}
          rows={(env.data ?? []).map((r: Row) => ({
            key: r.id, cells: [`${dmy(new Date(r.read_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }))} ${time(r.read_at)}`, nz(r.temp_c, 1), nz(r.rh_pct, 1), nz(r.nh3_ppm, 1), r.litter ? t(`erp.litter.${r.litter}`) : '—'],
          }))} />
      </Card>
    </>
  );
}
