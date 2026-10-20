// Port of demo/index.html farmScreen (:336-341).
import Link from 'next/link';
import { loadView } from '@/lib/view/load';
import { currentMode } from '@/lib/view/mode';
import { batchKpi } from '@/lib/kpi';
import { fmtN } from '@/lib/format';
import { Header, RagPill, stateLabel } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';

export default async function Farm() {
  const { t } = await loadView(await currentMode());
  return (
    <>
      <Header title="Farms & sheds" action={<ActBtn act="addFarm" className="btn small">+ Farm</ActBtn>} />
      {t.farms.length ? (
        t.farms.map((f) => (
          <div className="card" key={f.id}>
            <div className="row between">
              <div>
                <div className="t" style={{ fontWeight: 700 }}>{f.name}</div>
                <div className="s">{f.farm_type} · {f.district} · capacity {fmtN(f.capacity)}</div>
              </div>
              <ActBtn act="addShed" className="btn small secondary">+ Shed</ActBtn>
            </div>
            <div className="list" style={{ marginTop: 6 }}>
              {f.sheds.length ? (
                f.sheds.map((s) => {
                  const b = t.batches.find((x) => x.shed_name === s.name && x.farm_name === f.name && x.state !== 'closed');
                  const k = b ? batchKpi(b) : null;
                  const body = (
                    <>
                      <div>
                        <div className="t">{s.name} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>· {fmtN(s.capacity)} cap</span></div>
                        <div className="s">
                          {b && k
                            ? `${b.code} · ${b.ft === 'hatchery' ? 'Setter load' : stateLabel(b.state)} · day ${b.age} · ${fmtN(k.alive)} birds (${Math.round((100 * k.alive) / s.capacity)}%)`
                            : 'Empty · tap to place a batch'}
                        </div>
                      </div>
                      <div className="r">{k ? <RagPill rag={k.rag} /> : <span className="pill neutral">Empty</span>}</div>
                    </>
                  );
                  return b ? (
                    <Link key={s.id} className="item" href={`/farm/batch/${b.code}`}>{body}</Link>
                  ) : (
                    <ActBtn key={s.id} act="addBatch" className="item">{body}</ActBtn>
                  );
                })
              ) : (
                <div className="s">No sheds yet — tap + Shed.</div>
              )}
            </div>
          </div>
        ))
      ) : (
        <div className="card"><div className="t">No farms yet.</div><div className="s">Add your first farm, then sheds, then place a batch.</div></div>
      )}
    </>
  );
}
