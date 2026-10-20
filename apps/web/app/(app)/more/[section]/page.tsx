// Port of demo/index.html moreScreen sections (:423-464), peopleScreen (:441-459), equipmentScreen (:460-467), healthScreen (:468-476).
import { notFound } from 'next/navigation';
import { loadView } from '@/lib/view/load';
import { createClient } from '@/lib/supabase/server';
import { ATT_CODES, attGet, attMonth } from '@/lib/kpi';
import { daysBetween, dmy, fmtINR, fmtL, fmtN } from '@/lib/format';
import { Back, Chips, Header, Live, sevStripe } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import type { View } from '@/lib/view/types';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VENDOR_CAT: Record<string, string> = {
  doc_hatchery: 'Day-old chicks', feed: 'Compound feed', feed_ingredient: 'Feed ingredients · maize, soya, DORB, grit', medicine: 'Medicines',
  vaccine: 'Vaccines', equipment: 'Equipment', transport: 'Transport', labour_contractor: 'Labour contractors', packaging: 'Packaging', fuel: 'Fuel',
};
const REPORTS: [string, string][] = [
  ['Daily farm summary', 'PDF · WhatsApp 7 PM'], ['Weekly batch report', 'PDF · Monday'], ['Monthly P&L', 'Excel · 1st'], ['Vaccination compliance', 'PDF'],
  ['Vendor statements', 'PDF'], ['Trader statements', 'PDF'], ['Attendance & wage register', 'Excel'], ['Mortality register (insurance)', 'PDF + photos'],
];

export default async function Section({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { section } = await params;
  const { tab } = await searchParams;
  const v = await loadView();
  const B = <Back href="/more" />;
  switch (section) {
    case 'notifications': return <Notifications v={v} B={B} />;
    case 'people': return <People v={v} tab={tab ?? 'today'} />;
    case 'vendors': return <Vendors v={v} B={B} />;
    case 'customers': return <Customers v={v} B={B} />;
    case 'stock': return <Stock v={v} B={B} />;
    case 'equipment': return <Equipment v={v} B={B} />;
    case 'health': return <Health v={v} B={B} />;
    case 'users': return (
      <>{B}<Header title="Users & roles" action={<ActBtn act="inviteUser" className="btn small">+ Invite</ActBtn>} />
        <div className="card"><div className="list">
          {v.t.users.map((u) => (
            <div className="item" key={u.id}><div><div className="t">{u.name}</div><div className="s">{u.phone}</div></div>
              <div className="r"><span className="pill neutral">{u.role.replace(/_/g, ' ')}</span></div></div>
          ))}
        </div></div></>
    );
    case 'docs': return (
      <>{B}<Header title="Compliance & documents" action={<ActBtn act="addDoc" className="btn small">+ Document</ActBtn>} />
        <div className="card"><div className="list"><div className="s">No documents yet. Add PCB consent, FSSAI, fire NOC and insurance to get renewal reminders.</div></div></div></>
    );
    case 'reports': return (
      <>{B}<Header title="Reports" />
        <div className="card"><div className="list">
          {REPORTS.map(([a, b]) => (
            <div className="item" key={a}><div><div className="t">{a}</div><div className="s">{b}</div></div>
              <div className="r"><ActBtn act="report" className="btn small secondary">Generate</ActBtn></div></div>
          ))}
        </div></div></>
    );
    default: notFound();
  }
}

async function Notifications({ v, B }: { v: View; B: React.ReactNode }) {
  // demo marks everything read when the list opens
  if (v.t.notifications.some((n) => !n.read)) {
    const sb = await createClient();
    await sb.from('notification').update({ read_at: new Date().toISOString() }).is('read_at', null);
  }
  return (
    <>{B}<Header title="Notifications" action={<Live />} />
      <div className="card"><div className="list">
        {v.t.notifications.map((n) => (
          <div key={n.id} className={`item stripe ${sevStripe(n.severity)}`}><div>
            <div className="t">{n.title}</div><div className="s">{n.body}</div>
            <div className="s" style={{ color: 'var(--muted)' }}>{n.ago_h ? n.ago_h + 'h ago' : 'just now'}</div>
          </div></div>
        ))}
        {!v.t.notifications.length && <div className="s">No notifications.</div>}
      </div></div></>
  );
}

function People({ v, tab }: { v: View; tab: string }) {
  const { t, today } = v;
  const [y, m] = today.split('-');
  const days = new Date(+y, +m, 0).getDate();
  const chips = <Chips active={tab} items={[['/more/people', 'today', 'Today'], ['/more/people?tab=month', 'month', 'Monthly register'], ['/more/people?tab=wages', 'wages', 'Wages & advances']]} />;
  const add = <ActBtn act="addWorker" className="btn small">+ Worker</ActBtn>;
  if (!t.workers.length)
    return (<><Back href="/more" /><Header title="People" action={add} />{chips}
      <div className="card"><div className="t">No workers yet.</div><div className="s">Add workers to start attendance and wages.</div></div></>);

  if (tab === 'month')
    return (
      <><Back href="/more" /><Header title={`${MON[+m - 1]} ${y} register`} action={add} />{chips}
        <div className="s">Tap any day to cycle P → H → A → L. Sundays are off.</div>
        <div className="card" style={{ padding: 10 }}>
          <div className="tablewrap">
            <div className="att" style={{ gridTemplateColumns: `72px repeat(${days},20px)`, minWidth: 72 + days * 23 }}>
              <div />
              {Array.from({ length: days }, (_, i) => <div key={i} className="hd">{i + 1}</div>)}
              {t.workers.map((w) => [
                <div key={w.id} className="nm">{w.name}</div>,
                ...Array.from({ length: days }, (_, i) => {
                  const ds = `${y}-${m}-${String(i + 1).padStart(2, '0')}`;
                  const c = attGet(t, w.id, ds, today);
                  return (
                    <ActBtn key={w.id + ds} act="attCycle" className={`d ${c}`}>
                      <span aria-label={`${w.name} ${ds} ${ATT_CODES[c] ?? ''}`}>{c === 'S' ? '·' : c === '-' ? '' : c}</span>
                    </ActBtn>
                  );
                }),
              ])}
            </div>
          </div>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><span className="pill good">P</span> Present</span><span><span className="pill warn">H</span> Half</span>
            <span><span className="pill crit">A</span> Absent</span><span><span className="pill info">L</span> Leave</span>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Month to date · {+today.slice(8)} days</div>
          <div className="tablewrap"><table>
            <thead><tr><th>Worker</th><th className="n">P</th><th className="n">H</th><th className="n">A</th><th className="n">L</th><th className="n">Payable</th></tr></thead>
            <tbody>{t.workers.map((w) => { const a = attMonth(t, w.id, today); return (
              <tr key={w.id}><td>{w.name}</td><td className="n">{a.P}</td><td className="n">{a.H}</td><td className={`n ${a.A > 2 ? 'down' : ''}`}>{a.A}</td><td className="n">{a.L}</td><td className="n"><b>{a.payable}</b></td></tr>
            ); })}</tbody>
          </table></div>
        </div>
        <ActBtn act="report" className="btn secondary">Export register (Excel)</ActBtn>
      </>
    );

  if (tab === 'wages') {
    const rows = t.workers.map((w) => { const a = attMonth(t, w.id, today); const gross = Math.round((w.wage * a.payable) / a.days); return { w, a, adv: 0, gross, net: gross }; });
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    return (
      <><Back href="/more" /><Header title={'Wages · ' + MON[+m - 1]} action={<ActBtn act="addAdvance" className="btn small">+ Advance</ActBtn>} />{chips}
        <div className="card"><div className="tablewrap"><table>
          <thead><tr><th>Worker</th><th className="n">Days</th><th className="n">Gross</th><th className="n">Adv.</th><th className="n">Net</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.w.id}><td>{r.w.name}<div className="s" style={{ color: 'var(--muted)' }}>{r.w.role}</div></td>
                <td className="n">{r.a.payable}/{r.a.days}</td><td className="n">{fmtINR(r.gross)}</td><td className="n">{r.adv ? fmtINR(r.adv) : '—'}</td><td className="n"><b>{fmtINR(r.net)}</b></td></tr>
            ))}
            <tr><td><b>Total</b></td><td /><td className="n"><b>{fmtINR(sum((r) => r.gross))}</b></td><td className="n">{fmtINR(sum((r) => r.adv))}</td><td className="n"><b>{fmtINR(sum((r) => r.net))}</b></td></tr>
          </tbody>
        </table></div></div>
        <ActBtn act="payroll" className="btn">Run payroll · bank file + ledger posting</ActBtn>
      </>
    );
  }

  return (
    <><Back href="/more" /><Header title={`Attendance · ${dmy(today)}`} action={add} />{chips}
      <div className="card"><div className="list">
        {t.workers.map((w) => { const c = attGet(t, w.id, today, today); return (
          <div className="item" key={w.id} style={{ alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}><div className="t">{w.name}</div><div className="s">{w.role} · {attMonth(t, w.id, today).P} days present this month</div></div>
            <div className="r"><div className="segs" style={{ width: 150 }}>
              {(['P', 'H', 'A', 'L'] as const).map((k) => <ActBtn key={k} act="attSet" className={c === k ? 'on ' + k : ''}>{k}</ActBtn>)}
            </div></div>
          </div>
        ); })}
      </div></div>
      <ActBtn act="attSubmit" className="btn">Submit attendance ({t.workers.filter((w) => attGet(t, w.id, today, today) === 'P').length} present)</ActBtn>
    </>
  );
}

function Vendors({ v, B }: { v: View; B: React.ReactNode }) {
  const { t } = v;
  const cats: Record<string, typeof t.vendors> = {};
  t.vendors.forEach((x) => (cats[x.category] ??= []).push(x));
  return (
    <>{B}<Header title="Vendors" action={<ActBtn act="addVendor" className="btn small">+ Vendor</ActBtn>} />
      <div className="s">{t.vendors.length} vendors · {t.vendors.filter((x) => x.gstin).length} GST-verified</div>
      {Object.entries(cats).map(([c, vs]) => (
        <div className="card" key={c}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{VENDOR_CAT[c] ?? c}</div>
          <div className="list">
            {vs.map((x) => {
              const out = t.bills.filter((b) => b.vendor === x.name && b.status !== 'paid').reduce((a, b) => a + b.total - b.paid, 0);
              return (
                <div className="item" key={x.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{x.name} {x.gstin && <span className="pill good" style={{ fontSize: 10 }}>GST ✓</span>}</div>
                    <div className="s">{x.contact} · {x.phone} · {x.terms}-day terms{x.rating != null ? ` · ★ ${x.rating}` : ''}</div>
                  </div>
                  <div className="r">{out > 0 && <div className="s" style={{ color: 'var(--crit)' }}>{fmtL(out)} due</div>}<ActBtn act="raisePO" className="btn small secondary">PO</ActBtn></div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!t.vendors.length && <div className="card s">No vendors yet.</div>}
    </>
  );
}

function Customers({ v, B }: { v: View; B: React.ReactNode }) {
  const { t } = v;
  return (
    <>{B}<Header title="Customers & traders" action={<ActBtn act="addCustomer" className="btn small">+ Customer</ActBtn>} />
      <div className="card"><div className="list">
        {t.customers.map((c) => {
          const out = t.invoices.filter((i) => i.customer === c.name && i.status !== 'paid').reduce((a, i) => a + i.total - i.paid, 0);
          return (
            <div className="item" key={c.id}>
              <div><div className="t">{c.name}</div><div className="s">{c.kind} · {c.phone} · credit {fmtL(c.credit_limit)} / {c.credit_days} d</div></div>
              <div className="r">{out ? (<><div className={`t ${out > c.credit_limit ? 'down' : ''}`}>{fmtL(out)}</div><div className="s">{out > c.credit_limit ? 'over limit' : 'outstanding'}</div></>) : <span className="pill good">Clear</span>}</div>
            </div>
          );
        })}
        {!t.customers.length && <div className="s">No customers yet.</div>}
      </div></div>
    </>
  );
}

function Stock({ v, B }: { v: View; B: React.ReactNode }) {
  const { t } = v;
  return (
    <>{B}
      <Header title="Stock" action={<span className="row"><ActBtn act="addItem" className="btn small secondary">+ Item</ActBtn><ActBtn act="grnOpen" className="btn small">Receive</ActBtn></span>} />
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>Item</th><th className="n">On hand</th><th className="n">Reorder</th><th /></tr></thead>
        <tbody>
          {t.stock.map((s) => {
            const low = s.qty <= s.reorder;
            const days = s.unit.startsWith('bag') && s.qty > 0 ? Math.round(s.qty / 38) : null;
            return (
              <tr key={s.item}>
                <td>{s.item}<div className="s" style={{ color: 'var(--muted)' }}>{s.unit}{days ? ' · ~' + days + ' days' : ''}</div></td>
                <td className="n">{fmtN(s.qty)}</td><td className="n">{fmtN(s.reorder)}</td>
                <td>{low ? <ActBtn act="raisePO" className="btn small">Reorder</ActBtn> : <span className="pill good">OK</span>}</td>
              </tr>
            );
          })}
          {!t.stock.length && <tr><td colSpan={4} className="s">No stock items yet.</td></tr>}
        </tbody>
      </table></div></div>
      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">Purchase orders</div><ActBtn act="raisePO" className="btn small">+ PO</ActBtn></div>
        <div className="list">
          {t.pos.map((p) => (
            <div className="item" key={p.id}>
              <div><div className="t">{p.no} · {p.vendor}</div><div className="s">{p.item} · {fmtN(p.qty)} @ ₹{p.rate} · expected {dmy(p.expected)}</div></div>
              <div className="r"><div className="t">{fmtL(p.total)}</div>{p.status === 'closed' ? <span className="pill good">Received</span> : <ActBtn act="grnOpen" className="btn small secondary">Receive</ActBtn>}</div>
            </div>
          ))}
          {!t.pos.length && <div className="s">No open POs.</div>}
        </div>
      </div>
    </>
  );
}

function Equipment({ v, B }: { v: View; B: React.ReactNode }) {
  const { t, today } = v;
  const open = t.tickets.filter((k) => k.status === 'open'), closed = t.tickets.filter((k) => k.status !== 'open');
  return (
    <>{B}<Header title="Equipment & maintenance" action={<ActBtn act="addAsset" className="btn small">+ Asset</ActBtn>} />
      <div className="grid3">
        <div className="tile"><div className="lbl">Assets</div><div className="val" style={{ fontSize: 18 }}>{t.assets.length}</div></div>
        <div className="tile"><div className="lbl">Open tickets</div><div className={`val ${open.length ? 'down' : ''}`} style={{ fontSize: 18 }}>{open.length}</div></div>
        <div className="tile"><div className="lbl">Service due</div><div className="val" style={{ fontSize: 18 }}>{t.assets.filter((a) => daysBetween(today, a.next_service) < 14).length}</div></div>
      </div>
      {open.length > 0 && (
        <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Open tickets</div><div className="list">
          {open.map((k) => (
            <div key={k.id} className={`item stripe ${k.priority === 'high' ? 'crit' : 'warn'}`}>
              <div style={{ minWidth: 0 }}><div className="t">{k.asset}</div><div className="s">{k.issue}</div><div className="s" style={{ color: 'var(--muted)' }}>opened {dmy(k.opened)} · {k.priority}</div></div>
              <div className="r"><ActBtn act="closeTicket" className="btn small">Close</ActBtn></div>
            </div>
          ))}
        </div></div>
      )}
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Asset register</div><div className="list">
        {t.assets.map((a) => {
          const dl = daysBetween(today, a.next_service);
          const hasOpen = open.some((k) => k.asset === a.name);
          return (
            <div key={a.id} className="item" style={{ flexDirection: 'column', gap: 6 }}>
              <div className="row between" style={{ width: '100%' }}>
                <div style={{ minWidth: 0 }}><div className="t">{a.name}</div>
                  <div className="s">{a.category} · next service {dmy(a.next_service)}{hasOpen && <> · <span style={{ color: 'var(--crit)' }}>ticket open</span></>}</div></div>
                {dl < 14 ? <span className="pill warn">Service due</span> : hasOpen ? <span className="pill crit">Fault</span> : <span className="pill good">OK</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <ActBtn act="reportIssue" className="btn small secondary">Report issue</ActBtn>
                <ActBtn act="serviceDone" className="btn small secondary">Service done</ActBtn>
              </div>
            </div>
          );
        })}
        {!t.assets.length && <div className="s">No equipment yet — tap + Asset.</div>}
      </div></div>
      {closed.length > 0 && (
        <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Closed · {closed.length}</div><div className="list">
          {closed.slice(0, 5).map((k) => (
            <div className="item" key={k.id}><div><div className="t">{k.asset}</div><div className="s">{k.issue}</div></div>
              <div className="r"><div className="s">{k.cost ? fmtINR(k.cost) : ''}</div><span className="pill good">Closed</span></div></div>
          ))}
        </div></div>
      )}
    </>
  );
}

function Health({ v, B }: { v: View; B: React.ReactNode }) {
  const { t, today } = v;
  const due = t.batches.filter((b) => b.state !== 'closed').flatMap((b) => b.vacc.filter((x) => !x.done).map((x) => ({ ...x, b }))).sort((a, b) => a.due.localeCompare(b.due));
  return (
    <>{B}<Header title="Health" action={<ActBtn act="addVisitPick" className="btn small">+ Vet visit</ActBtn>} />
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Vaccination calendar</div><div className="list">
        {due.slice(0, 10).map((x) => { const od = daysBetween(x.due, today) > 0; return (
          <div className="item" key={x.id}>
            <div><div className="t">{x.name}</div><div className="s">{x.b.code} · {x.b.shed_name} · due {dmy(x.due)}</div></div>
            <div className="r"><ActBtn act="vaccDone" className={`btn small ${od ? '' : 'secondary'}`}>{od ? 'Overdue · mark' : 'Mark done'}</ActBtn></div>
          </div>
        ); })}
        {!due.length && <div className="s">All vaccinations up to date.</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Disease cases</div><div className="list">
        {t.disease_cases.map((c) => (
          <div key={c.id} className={`item stripe ${c.status === 'open' ? 'crit' : 'good'}`}>
            <div><div className="t">{c.disease} · {c.batch}</div><div className="s">{Math.round(c.confidence * 100)}% · {c.vet_confirmed ? 'vet confirmed' : 'awaiting vet'} · {c.status}</div></div>
            {c.status === 'open' && <div className="r"><ActBtn act="closeCase" className="btn small secondary">Resolve</ActBtn></div>}
          </div>
        ))}
        {!t.disease_cases.length && <div className="s">No cases.</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Vet visits</div><div className="list">
        {t.vet_visits.map((x, i) => <div className="item" key={i}><div><div className="t">{x.vet} · {x.batch} · {dmy(x.date)}</div><div className="s">{x.findings}</div></div></div>)}
        {!t.vet_visits.length && <div className="s">None yet.</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>Disease cards (offline)</div><div className="list">
        {v.diseases.filter((d) => d.code !== 'NORMAL' && d.code !== 'OTHER').map((d) => (
          <div className="item" key={d.code}><div><div className="t">{d.name}</div><div className="s">{d.signs}</div></div></div>
        ))}
      </div></div>
    </>
  );
}
