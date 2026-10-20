// Port of demo/index.html farmScreen (:336-341).
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi } from '@/lib/kpi';
import { fmtN } from '@/lib/format';
import { Header, RagPill } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';

export default async function Farm() {
  const [{ t: tn }, t] = await Promise.all([currentMode().then(loadView), getTranslations()]);
  return (
    <>
      <Header title={t('farm.title')} action={<ActBtn act="addFarm" className="btn small">{t('farm.addFarm')}</ActBtn>} />
      {tn.farms.length ? (
        tn.farms.map((f) => (
          <div className="card" key={f.id}>
            <div className="row between">
              <div>
                <div className="t" style={{ fontWeight: 700 }}>{f.name}</div>
                <div className="s">{t(`farmType.${f.farm_type}`)} · {f.district} · {t('farm.capacity', { n: fmtN(f.capacity) })}</div>
              </div>
              <ActBtn act="addShed" className="btn small secondary">{t('farm.addShed')}</ActBtn>
            </div>
            <div className="list" style={{ marginTop: 6 }}>
              {f.sheds.length ? (
                f.sheds.map((s) => {
                  const b = tn.batches.find((x) => x.shed_name === s.name && x.farm_name === f.name && x.state !== 'closed');
                  const k = b ? batchKpi(b) : null;
                  const body = (
                    <>
                      <div>
                        <div className="t">{s.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {t('farm.cap', { n: fmtN(s.capacity) })}</span></div>
                        <div className="s">
                          {b && k
                            ? t('farm.occupancy', {
                                code: b.code, state: b.ft === 'hatchery' ? t('farm.setterLoad') : t(`state.${b.state}`), day: b.age,
                                birds: fmtN(k.alive), pct: Math.round((100 * k.alive) / s.capacity),
                              })
                            : t('farm.emptyTap')}
                        </div>
                      </div>
                      <div className="r">{k ? <RagPill rag={k.rag} /> : <span className="pill neutral">{t('farm.empty')}</span>}</div>
                    </>
                  );
                  return b ? (
                    <Link key={s.id} className="item" href={`/farm/batch/${b.code}`}>{body}</Link>
                  ) : (
                    <ActBtn key={s.id} act="addBatch" className="item">{body}</ActBtn>
                  );
                })
              ) : (
                <div className="s">{t('farm.noSheds')}</div>
              )}
            </div>
          </div>
        ))
      ) : (
        <div className="card"><div className="t">{t('farm.noFarms')}</div><div className="s">{t('farm.noFarmsHint')}</div></div>
      )}
    </>
  );
}
