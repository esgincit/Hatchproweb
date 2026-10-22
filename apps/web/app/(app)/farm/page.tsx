// Port of demo/index.html farmScreen (:336-341): the live 3D viewer on top, then one card per farm with its sheds
// (status stripe + pill, occupancy bar; a busy shed opens its batch, an empty one places a batch).
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi } from '@/lib/kpi';
import { fmtN } from '@/lib/format';
import { Header, RagPill } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import Farm3DView from '@/components/farm3d/Farm3DView';
import { farmScene } from '@/lib/farm3d';

export default async function Farm() {
  const [{ t: tn, today }, t] = await Promise.all([currentMode().then(loadView), getTranslations()]);
  return (
    <>
      <Header title={t('farm.title')} action={<ActBtn act="addFarm" className="btn small">{t('farm.addFarm')}</ActBtn>} />
      {tn.farms.length > 0 && <Farm3DView farms={farmScene(tn, today)} />}
      {tn.farms.length ? (
        tn.farms.map((f) => {
          const rows = f.sheds.map((s) => {
            const b = tn.batches.find((x) => x.shed_name === s.name && x.farm_name === f.name && x.state !== 'closed');
            const k = b ? batchKpi(b) : null;
            return { s, b, k, alive: Math.max(0, k?.alive ?? 0) };
          });
          const alive = rows.reduce((a, r) => a + r.alive, 0), cap = f.sheds.reduce((a, s) => a + s.capacity, 0);
          return (
            <div className="card" key={f.id}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="t" style={{ fontWeight: 700 }}>{f.name}</div>
                  <div className="s">{t(`farmType.${f.farm_type}`)} · {f.district} · {t('farm.capacity', { n: fmtN(f.capacity) })}</div>
                </div>
                <ActBtn act="addShed" ctx={{ farm: f.id }} className="btn small secondary">{t('farm.addShed')}</ActBtn>
              </div>
              {rows.length > 0 && (
                <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                  <span className="pill neutral">{t('farm.sheds', { n: rows.length })}</span>
                  {f.farm_type !== 'hatchery' && <span className="pill neutral">{t('common.birds', { n: fmtN(alive) })}</span>}
                  {cap > 0 && <span className="pill neutral">{t('farm.full', { pct: Math.round((100 * alive) / cap) })}</span>}
                </div>
              )}
              <div className="list" style={{ marginTop: 6 }}>
                {rows.length ? (
                  rows.map(({ s, b, k, alive: n }) => {
                    const pct = Math.round((100 * n) / Math.max(1, s.capacity));
                    const body = (
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="t">{s.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {t('farm.cap', { n: fmtN(s.capacity) })}</span></div>
                          <div className="s">
                            {b && k
                              ? t('farm.occupancy', {
                                  code: b.code, state: b.ft === 'hatchery' ? t('farm.setterLoad') : t(`state.${b.state}`), day: b.age, birds: fmtN(n), pct,
                                })
                              : t('farm.emptyTap')}
                          </div>
                          {k && <div className="bar" style={{ marginTop: 7 }}><i style={{ width: `${Math.min(100, pct)}%`, background: `var(--${k.rag === 'neutral' ? 'muted' : k.rag})` }} /></div>}
                        </div>
                        <div className="r">{k ? <RagPill rag={k.rag} /> : <span className="pill neutral">{t('farm.empty')}</span>}</div>
                      </>
                    );
                    const cls = `item stripe${k && k.rag !== 'neutral' ? ` ${k.rag}` : ''}`;
                    const sep = { borderTopColor: 'var(--line)' }; // .stripe.<rag> recolours every side; keep the row divider neutral
                    return b ? (
                      <Link key={s.id} className={cls} style={sep} href={`/farm/batch/${b.code}`}>{body}</Link>
                    ) : (
                      <ActBtn key={s.id} act="addBatch" ctx={{ shed: s.id }} className={cls} style={sep}>{body}</ActBtn>
                    );
                  })
                ) : (
                  <div className="s">{t('farm.noSheds')}</div>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="card"><div className="t">{t('farm.noFarms')}</div><div className="s">{t('farm.noFarmsHint')}</div></div>
      )}
    </>
  );
}
