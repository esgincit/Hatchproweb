// Hatchery (0041/0042/0044): machine register + status, the per-setting flow (setter -> D10 -> D18 -> hatcher -> hatch ->
// release -> quality -> vaccination, each approval step with its own approver), hatch KPIs and chick stock. Server components.
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { dateFmt, fmtN } from '@/lib/format';
import { ActBtn } from '@/components/ui/ActBtn';
import { Card, Decide, Status, one, nz, pct, type Row, type T } from './bits';

const STATE_PILL: Record<string, string> = { available: 'good', in_use: 'warn', cleaning: 'neutral', breakdown: 'crit' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Settings created under the full flow (0044) use the D10/D18/transfer screens; the owner rule simple_hatch_flow or a legacy setting keeps the single form. */
export async function isFullFlow(batchId: string): Promise<boolean> {
  const sb = await createClient();
  const [{ data: b }, { data: r }] = await Promise.all([
    sb.from('batch').select('full_hatch_flow').eq('id', batchId).maybeSingle(),
    sb.from('tenant_rule').select('value').eq('key', 'simple_hatch_flow').maybeSingle(),
  ]);
  return !!b?.full_hatch_flow && r?.value !== true;
}

/** Machine register: state (derived, never typed in), what is loaded, and today's reading compliance. */
export async function MachineList() {
  const [sb, t] = [await createClient(), await getTranslations()];
  const [{ data: ms }, { data: env }] = await Promise.all([
    sb.from('machine_status').select('asset_id,name,machine_no,machine_kind,stage,capacity_eggs,eggs_in_setter,settings,state').order('name'),
    sb.from('machine_env_day').select('asset_id,readings,expected,temp_compliance_pct,rh_compliance_pct,alarms').eq('day', today()),
  ]);
  const day = new Map<string, Row>((env ?? []).map((e: Row) => [e.asset_id, e]));
  return (
    <Card title={t('erp.machine.title')} testid="machines" action={<ActBtn act="addMachine" className="btn small">{t('erp.machine.add')}</ActBtn>}>
      <div className="list">
        {(ms ?? []).map((m: Row) => {
          const d = day.get(m.asset_id);
          return (
            <div className="item" key={m.asset_id} data-testid="machine-row" data-name={m.name}>
              <div style={{ minWidth: 0 }}>
                <div className="t">{m.name}{m.machine_no ? ` · ${m.machine_no}` : ''} <span className={`pill ${STATE_PILL[m.state]}`} data-testid="machine-state">{t(`erp.state.${m.state}`)}</span></div>
                <div className="s">{t(`erp.kind.${m.machine_kind}`)} · {t(`erp.stage.${m.stage}`)} · {t('erp.machine.capLine', { n: fmtN(m.capacity_eggs), used: fmtN(m.eggs_in_setter) })}</div>
                <div className="s" data-testid="machine-compliance">{d
                  ? t('erp.machine.today', { r: d.readings, e: d.expected, temp: pct(d.temp_compliance_pct), rh: pct(d.rh_compliance_pct) }) + (d.alarms ? ` · ${t('erp.machine.alarms', { n: d.alarms })}` : '')
                  : t('erp.machine.noReadings')}</div>
              </div>
              <div className="r"><ActBtn act="machineReading" ctx={{ asset: m.asset_id, name: m.name }} className="btn small secondary">{t('erp.machine.read')}</ActBtn></div>
            </div>
          );
        })}
        {!ms?.length && <div className="s">{t('erp.machine.none')}</div>}
      </div>
    </Card>
  );
}

function Step({ title, detail, right, testid }: { title: string; detail?: React.ReactNode; right: React.ReactNode; testid: string }) {
  return (
    <div className="item" data-testid={testid}>
      <div style={{ minWidth: 0 }}><div className="t">{title}</div>{detail && <div className="s">{detail}</div>}</div>
      <div className="r row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

export async function HatchFlow({ batchId, eggsSet }: { batchId: string; eggsSet: number }) {
  const [sb, t, locale] = [await createClient(), await getTranslations(), await getLocale()];
  const dmy = dateFmt(locale);
  const [{ data: b }, { data: p }, { data: cs }, { data: x }, { data: h }, { data: rel }, { data: q }, { data: vs }] = await Promise.all([
    sb.from('batch').select('setter_id').eq('id', batchId).maybeSingle(),
    sb.from('setting_progress').select('live_d10,transfer_eggs,expected_hatch_on').eq('batch_id', batchId).maybeSingle(),
    sb.from('candling').select('id,stage,candled_on,eggs_candled,infertile,early_dead,dirty,mid_dead,late_dead,status,reject_reason').eq('batch_id', batchId),
    sb.from('hatcher_transfer').select('id,moved_on,eggs,status,reject_reason,asset(name,machine_no)').eq('batch_id', batchId).maybeSingle(),
    sb.from('hatch_record').select('id,hatched_on,chicks_a,chicks_b,culls,dead_in_hatcher,unhatched,status,reject_reason').eq('batch_id', batchId).maybeSingle(),
    sb.from('machine_release').select('released_at').eq('batch_id', batchId).maybeSingle(),
    sb.from('chick_quality_inspection').select('id,inspected_on,sample_size,dispatch_eligible,status,reject_reason').eq('batch_id', batchId).maybeSingle(),
    sb.from('chick_vaccination').select('id,vaccine_lot,expiry,qty,expired,vaccine_master(name)').eq('batch_id', batchId).order('created_at'),
  ]);
  const setter = b?.setter_id ? (await sb.from('asset').select('name,machine_no').eq('id', b.setter_id).maybeSingle()).data : null;
  const c1 = cs?.find((c: Row) => c.stage === 1), c2 = cs?.find((c: Row) => c.stage === 2);
  const hatched = h?.hatched_on ? h : null;
  const redo = (s?: string) => !s || s === 'rejected'; // nothing yet, or sent back: the form can (re)submit
  const why = (x?: Row | null) => (x?.status === 'rejected' && x.reject_reason ? ` · ${t('trace.reason', { r: x.reject_reason })}` : '');
  const sat = (s?: string) => (s ? <Status status={s} t={t} /> : <span className="pill neutral">{t('erp.flow.todo')}</span>);
  const ctx = { batch: batchId };
  const btn = (act: string, label: string, extra: Record<string, string> = {}, secondary = false) =>
    <ActBtn act={act} ctx={{ ...ctx, ...extra }} className={`btn small${secondary ? ' secondary' : ''}`}>{label}</ActBtn>;

  return (
    <Card title={t('erp.flow.title')} testid="hatch-flow">
      <div className="list">
        <Step testid="flow-setter" title={t('erp.flow.setter')}
          detail={setter ? `${setter.name}${setter.machine_no ? ` · ${setter.machine_no}` : ''}` : t('erp.flow.noSetter', { n: fmtN(eggsSet) })}
          right={setter ? <span className="pill good">{t('erp.flow.loaded')}</span> : btn('loadSetter', t('erp.flow.load'), { eggs: fmtN(eggsSet) })} />

        <Step testid="flow-d10" title={t('erp.flow.d10')}
          detail={c1 ? <>{dmy(c1.candled_on)} · {t('erp.flow.d10Line', { i: fmtN(c1.infertile), e: fmtN(c1.early_dead), d: fmtN(c1.dirty) })}{why(c1)}</> : p?.expected_hatch_on ? t('erp.flow.expected', { d: dmy(p.expected_hatch_on) }) : undefined}
          right={<>{sat(c1?.status)}{redo(c1?.status) && btn('candling', t('erp.flow.record'), { stage: '1', eggs: String(eggsSet) })}{c1 && <Decide act="decideCandling" id={c1.id} status={c1.status} t={t} />}</>} />

        {c1?.status === 'approved' && (
          <Step testid="flow-d18" title={t('erp.flow.d18')}
            detail={c2 ? <>{dmy(c2.candled_on)} · {t('erp.flow.d18Line', { m: fmtN(c2.mid_dead), l: fmtN(c2.late_dead) })}{why(c2)}</> : undefined}
            right={<>{sat(c2?.status)}{redo(c2?.status) && btn('candling', t('erp.flow.record'), { stage: '2', eggs: String(p?.live_d10 ?? '') })}{c2 && <Decide act="decideCandling" id={c2.id} status={c2.status} t={t} />}</>} />
        )}

        {c2?.status === 'approved' && (
          <Step testid="flow-xfer" title={t('erp.flow.xfer')}
            detail={x ? <>{dmy(x.moved_on)} · {t('erp.flow.xferLine', { n: fmtN(x.eggs), m: one(x.asset)?.name ?? '' })}{why(x)}</> : t('erp.flow.xferEggs', { n: fmtN(p?.transfer_eggs ?? 0) })}
            right={<>{sat(x?.status)}{redo(x?.status) && btn('hatcherTransfer', t('erp.flow.record'), { eggs: String(p?.transfer_eggs ?? '') })}{x && <Decide act="decideXfer" id={x.id} status={x.status} t={t} />}</>} />
        )}

        {x?.status === 'approved' && (
          <Step testid="flow-hatch" title={t('erp.flow.hatch')}
            detail={hatched ? <>{dmy(hatched.hatched_on)} · {t('erp.flow.hatchLine', { a: fmtN(hatched.chicks_a), b: fmtN(hatched.chicks_b), c: fmtN(hatched.culls) })}{why(hatched)}</> : undefined}
            right={<>{sat(hatched?.status)}{(!hatched || hatched.status === 'rejected') && btn('hatchFull', t('erp.flow.record'))}{hatched && <Decide act="decideHatch" id={hatched.id} status={hatched.status} t={t} />}</>} />
        )}

        {hatched && (
          <>
            <Step testid="flow-release" title={t('erp.flow.release')} detail={rel ? dmy(rel.released_at.slice(0, 10)) : t('erp.flow.releaseHint')}
              right={rel ? <span className="pill good">{t('erp.flow.released')}</span> : btn('releaseHatcher', t('erp.flow.releaseBtn'))} />
            <Step testid="flow-quality" title={t('erp.flow.quality')}
              detail={q ? <>{dmy(q.inspected_on)} · {t('erp.flow.qualityLine', { n: fmtN(q.sample_size), ok: q.dispatch_eligible ? t('erp.yes') : t('erp.no') })}{why(q)}</> : undefined}
              right={<>{sat(q?.status)}{redo(q?.status) && btn('chickQuality', t('erp.flow.record'))}{q && <Decide act="decideQuality" id={q.id} status={q.status} t={t} />}</>} />
            <Step testid="flow-vacc" title={t('erp.flow.vacc')}
              detail={vs?.length ? vs.map((v: Row) => (
                <span key={v.id} data-testid="vacc-row" style={{ display: 'block' }}>
                  {one(v.vaccine_master)?.name} · {t('erp.flow.vaccLine', { lot: v.vaccine_lot, n: fmtN(v.qty), d: dmy(v.expiry) })} {v.expired && <span className="pill crit">{t('erp.flow.expired')}</span>}
                </span>
              )) : undefined}
              right={btn('chickVaccine', t('erp.flow.vaccBtn'), { qty: String((hatched.chicks_a ?? 0) + (hatched.chicks_b ?? 0)) }, true)} />
          </>
        )}
      </div>
    </Card>
  );
}

export async function HatchKpi({ batchId }: { batchId: string }) {
  const [sb, t] = [await createClient(), await getTranslations()];
  const [{ data: k }, { data: s }] = await Promise.all([
    sb.from('hatch_kpi').select('*').eq('batch_id', batchId).maybeSingle(),
    sb.from('chick_stock').select('saleable,sold,available,quality_ok,vaccinated_all,age_hours').eq('batch_id', batchId).maybeSingle(),
  ]);
  if (!k) return null;
  const rows: [string, unknown][] = [
    ['fertility', k.fertility_pct], ['hes', k.hes_pct], ['hof', k.hof_pct], ['hot', k.hatch_of_transfer_pct], ['early', k.early_mortality_pct], ['mid', k.mid_mortality_pct],
    ['late', k.late_mortality_pct], ['embryo', k.embryo_mortality_pct], ['cull', k.cull_pct], ['dih', k.dead_in_hatcher_pct], ['waste', k.hatch_waste_pct], ['e2c', k.egg_to_chick_pct],
  ];
  return (
    <>
      <Card title={t('erp.kpi.title')} testid="hatch-kpi">
        <div className="kv">{rows.map(([key, v]) => <KV key={key} k={key} v={v} t={t} />)}</div>
      </Card>
      {s && (
        <Card title={t('erp.stock.title')} testid="chick-stock">
          <div className="kv">
            <div>{t('erp.stock.saleable')}</div><div data-testid="stock-saleable">{fmtN(s.saleable)}</div>
            <div>{t('erp.stock.sold')}</div><div>{fmtN(s.sold)}</div>
            <div>{t('erp.stock.available')}</div><div><b>{fmtN(s.available)}</b></div>
            <div>{t('erp.stock.age')}</div><div>{nz(s.age_hours, 0)} h</div>
            <div>{t('erp.stock.quality')}</div><div><span className={`pill ${s.quality_ok ? 'good' : 'warn'}`}>{s.quality_ok ? t('erp.stock.cleared') : t('erp.stock.pending')}</span></div>
            <div>{t('erp.stock.vaccinated')}</div><div><span className={`pill ${s.vaccinated_all ? 'good' : 'warn'}`}>{s.vaccinated_all ? t('erp.yes') : t('erp.no')}</span></div>
          </div>
        </Card>
      )}
    </>
  );
}
function KV({ k, v, t }: { k: string; v: unknown; t: T }) {
  return <><div>{t(`erp.kpi.${k}`)}</div><div data-testid={`kpi-${k}`}>{pct(v, 2)}</div></>;
}
