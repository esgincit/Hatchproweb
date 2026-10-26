// Port of demo/index.html moreScreen sections (:423-464), peopleScreen (:441-459), equipmentScreen (:460-467), healthScreen (:468-476).
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { createClient } from '@/lib/supabase/server';
import { attGet, attMonth } from '@/lib/kpi';
import { dateFmt, daysBetween, fmtINR, fmtL, fmtN, monthFmt } from '@/lib/format';
import { Back, Chips, Header, Live, sevStripe } from '@/components/ui/bits';
import { ActBtn } from '@/components/ui/ActBtn';
import type { View } from '@/lib/view/types';

type T = Awaited<ReturnType<typeof getTranslations>>;
const ATT_STATUS = { P: 'present', H: 'half', A: 'absent', L: 'leave' } as const;
type Ctx = { v: View; t: T; dmy: (s: string) => string; locale: string };

export default async function Section({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { section } = await params;
  const { tab } = await searchParams;
  const [v, t, locale] = await Promise.all([loadView(), getTranslations(), getLocale()]);
  const c: Ctx = { v, t, dmy: dateFmt(locale), locale };
  const B = <Back href="/more" />;
  switch (section) {
    case 'notifications': return <Notifications c={c} B={B} />;
    case 'people': return <People c={c} tab={tab ?? 'today'} />;
    case 'vendors': return <Vendors c={c} B={B} />;
    case 'customers': return <Customers c={c} B={B} />;
    case 'stock': return <Stock c={c} B={B} />;
    case 'equipment': return <Equipment c={c} B={B} />;
    case 'health': return <Health c={c} B={B} />;
    case 'users': return (
      <>{B}<Header title={t('sections.usersTitle')} action={<ActBtn act="inviteUser" className="btn small">{t('sections.invite')}</ActBtn>} />
        <div className="card"><div className="list">
          {v.t.users.map((u) => (
            <div className="item" key={u.id}><div><div className="t">{u.name}</div><div className="s">{u.phone}</div></div>
              <div className="r"><span className="pill neutral">{t.has(`roles.${u.role}`) ? t(`roles.${u.role}`) : u.role.replace(/_/g, ' ')}</span></div></div>
          ))}
        </div></div></>
    );
    case 'docs': return (
      <>{B}<Header title={t('sections.docsTitle')} action={<ActBtn act="addDoc" className="btn small">{t('sections.addDoc')}</ActBtn>} />
        <div className="card"><div className="list">
          {v.t.docs.map((d) => {
            const dl = d.expires ? daysBetween(v.today, d.expires) : null;
            const pill = dl == null ? null : dl < 0 ? ['crit', t('sections.docExpired')] : dl < 45 ? ['warn', t('sections.docDays', { n: dl })] : ['good', t('sections.docValid')];
            return (
              <div className="item" key={d.id}>
                <div><div className="t">{d.name}</div><div className="s">{[d.ref_no, d.expires ? t('sections.docExpires', { date: c.dmy(d.expires) }) : null].filter(Boolean).join(' · ')}</div></div>
                {pill && <div className="r"><span className={`pill ${pill[0]}`}>{pill[1]}</span></div>}
              </div>
            );
          })}
          {!v.t.docs.length && <div className="s">{t('sections.noDocs')}</div>}
        </div></div></>
    );
    case 'reports': {
      const reports: [string, string][] = [
        ['rDaily', t('sections.rDailySub')], ['rWeekly', t('sections.rWeeklySub')], ['rPnl', 'CSV'], ['rVacc', 'PDF'],
        ['rVendor', 'CSV'], ['rTrader', 'CSV'], ['rAtt', 'CSV'], ['rMort', t('sections.rMortSub')],
      ];
      const EXPORT: Record<string, string> = { rPnl: 'pnl', rVendor: 'statements', rTrader: 'statements', rAtt: 'register' };
      const PAGE: Record<string, string> = { rDaily: 'daily', rWeekly: 'weekly', rVacc: 'vaccination', rMort: 'mortality' };
      return (
        <>{B}<Header title={t('sections.reportsTitle')} />
          <div className="card"><div className="list">
            {reports.map(([k, sub]) => (
              <div className="item" key={k}><div><div className="t">{t(`sections.${k}`)}</div><div className="s">{sub}</div></div>
                <div className="r"><ActBtn act="report" ctx={EXPORT[k] ? { kind: EXPORT[k] } : { page: PAGE[k] }} className="btn small secondary">{t('common.generate')}</ActBtn></div></div>
            ))}
          </div></div></>
      );
    }
    default: notFound();
  }
}

async function Notifications({ c: { v, t }, B }: { c: Ctx; B: React.ReactNode }) {
  // demo marks everything read when the list opens
  if (v.t.notifications.some((n) => !n.read)) {
    const sb = await createClient();
    await sb.from('notification').update({ read_at: new Date().toISOString() }).is('read_at', null);
  }
  return (
    <>{B}<Header title={t('sections.notifications')} action={<Live />} />
      <div className="card"><div className="list">
        {v.t.notifications.map((n) => (
          <div key={n.id} className={`item stripe ${sevStripe(n.severity)}`}><div>
            <div className="t">{n.title}</div><div className="s">{n.body}</div>
            <div className="s" style={{ color: 'var(--muted)' }}>{n.ago_h ? t('sections.hAgo', { n: n.ago_h }) : t('sections.justNow')}</div>
          </div></div>
        ))}
        {!v.t.notifications.length && <div className="s">{t('sections.noNotifs')}</div>}
      </div></div></>
  );
}

function People({ c: { v, t, dmy, locale }, tab }: { c: Ctx; tab: string }) {
  const { t: tn, today } = v;
  const [y, m] = today.split('-');
  const days = new Date(+y, +m, 0).getDate();
  const month = monthFmt(locale, 'short')(today);
  const chips = <Chips active={tab} items={[['/more/people', 'today', t('people.today')], ['/more/people?tab=month', 'month', t('people.month')], ['/more/people?tab=wages', 'wages', t('people.wages')]]} />;
  const add = <ActBtn act="addWorker" className="btn small">{t('people.addWorker')}</ActBtn>;
  if (!tn.workers.length)
    return (<><Back href="/more" /><Header title={t('people.title')} action={add} />{chips}
      <div className="card"><div className="t">{t('people.noWorkers')}</div><div className="s">{t('people.noWorkersHint')}</div></div></>);

  if (tab === 'month')
    return (
      <><Back href="/more" /><Header title={t('people.register', { month, year: y })} action={add} />{chips}
        <div className="s">{t('people.tapCycle')}</div>
        <div className="card" style={{ padding: 10 }}>
          <div className="tablewrap">
            <div className="att" style={{ gridTemplateColumns: `72px repeat(${days},20px)`, minWidth: 72 + days * 23 }}>
              <div />
              {Array.from({ length: days }, (_, i) => <div key={i} className="hd">{i + 1}</div>)}
              {tn.workers.map((w) => [
                <div key={w.id} className="nm">{w.name}</div>,
                ...Array.from({ length: days }, (_, i) => {
                  const ds = `${y}-${m}-${String(i + 1).padStart(2, '0')}`;
                  const code = attGet(tn, w.id, ds, today);
                  const label = code in { P: 1, H: 1, A: 1, L: 1 } ? t(`people.${code}`) : '';
                  return (
                    ds > today ? <div key={w.id + ds} className="d -" /> : (
                    <ActBtn key={w.id + ds} act="attCycle" ctx={{ worker_id: w.id, date: ds, code }} className={`d ${code}`}>
                      <span aria-label={`${w.name} ${ds} ${label}`}>{code === 'S' ? '·' : code === '-' ? '' : code}</span>
                    </ActBtn>)
                  );
                }),
              ])}
            </div>
          </div>
          <div className="legend" style={{ marginTop: 8 }}>
            <span><span className="pill good">P</span> {t('people.P')}</span><span><span className="pill warn">H</span> {t('people.H')}</span>
            <span><span className="pill crit">A</span> {t('people.A')}</span><span><span className="pill info">L</span> {t('people.L')}</span>
          </div>
        </div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t('people.mtd', { n: +today.slice(8) })}</div>
          <div className="tablewrap"><table>
            <thead><tr><th>{t('people.worker')}</th><th className="n">P</th><th className="n">H</th><th className="n">A</th><th className="n">L</th><th className="n">{t('people.payable')}</th></tr></thead>
            <tbody>{tn.workers.map((w) => { const a = attMonth(tn, w.id, today); return (
              <tr key={w.id}><td>{w.name}</td><td className="n">{a.P}</td><td className="n">{a.H}</td><td className={`n ${a.A > 2 ? 'down' : ''}`}>{a.A}</td><td className="n">{a.L}</td><td className="n"><b>{a.payable}</b></td></tr>
            ); })}</tbody>
          </table></div>
        </div>
        <ActBtn act="report" ctx={{ kind: 'register' }} className="btn secondary">{t('people.export')}</ActBtn>
      </>
    );

  if (tab === 'wages') {
    const rows = tn.workers.map((w) => {
      const a = attMonth(tn, w.id, today);
      const gross = Math.round((w.wage * a.payable) / a.days);
      const adv = tn.advances.filter((x) => x.worker_id === w.id).reduce((s, x) => s + x.amount, 0);
      return { w, a, adv, gross, net: gross - adv };
    });
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    return (
      <><Back href="/more" /><Header title={t('people.wagesTitle', { month })} action={<ActBtn act="addAdvance" className="btn small">{t('people.addAdvance')}</ActBtn>} />{chips}
        <div className="card"><div className="tablewrap"><table>
          <thead><tr><th>{t('people.worker')}</th><th className="n">{t('people.days')}</th><th className="n">{t('people.gross')}</th><th className="n">{t('people.adv')}</th><th className="n">{t('people.net')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.w.id}><td>{r.w.name}<div className="s" style={{ color: 'var(--muted)' }}>{r.w.role}</div></td>
                <td className="n">{r.a.payable}/{r.a.days}</td><td className="n">{fmtINR(r.gross)}</td><td className="n">{r.adv ? fmtINR(r.adv) : '—'}</td><td className="n"><b>{fmtINR(r.net)}</b></td></tr>
            ))}
            <tr><td><b>{t('people.total')}</b></td><td /><td className="n"><b>{fmtINR(sum((r) => r.gross))}</b></td><td className="n">{fmtINR(sum((r) => r.adv))}</td><td className="n"><b>{fmtINR(sum((r) => r.net))}</b></td></tr>
          </tbody>
        </table></div></div>
        {tn.advances.length > 0 && (
          <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('people.advancesMonth')}</div><div className="list">
            {tn.advances.map((x) => <div className="item" key={x.id}><div><div className="t">{x.worker}</div><div className="s">{dmy(x.date)}{x.reason ? ' · ' + x.reason : ''}</div></div><div className="r">{fmtINR(x.amount)}</div></div>)}
          </div></div>
        )}
        <ActBtn act="payroll" className="btn">{t('people.payroll')}</ActBtn>
      </>
    );
  }

  return (
    <><Back href="/more" /><Header title={t('people.attendance', { date: dmy(today) })} action={add} />{chips}
      <div className="card"><div className="list">
        {tn.workers.map((w) => { const code = attGet(tn, w.id, today, today); return (
          <div className="item" key={w.id} style={{ alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}><div className="t">{w.name}</div><div className="s">{t('people.presentMonth', { role: w.role, n: attMonth(tn, w.id, today).P })}</div></div>
            <div className="r"><div className="segs" style={{ width: 150 }}>
              {(['P', 'H', 'A', 'L'] as const).map((k) => <ActBtn key={k} act="attSet" ctx={{ worker_id: w.id, date: today, status: ATT_STATUS[k] }} className={code === k ? 'on ' + k : ''}>{k}</ActBtn>)}
            </div></div>
          </div>
        ); })}
      </div></div>
      <ActBtn act="attSubmit" className="btn">{t('people.submit', { n: tn.workers.filter((w) => attGet(tn, w.id, today, today) === 'P').length })}</ActBtn>
    </>
  );
}

function Vendors({ c: { v, t }, B }: { c: Ctx; B: React.ReactNode }) {
  const tn = v.t;
  const cats: Record<string, typeof tn.vendors> = {};
  tn.vendors.forEach((x) => (cats[x.category] ??= []).push(x));
  return (
    <>{B}<Header title={t('sections.vendorsTitle')} action={<ActBtn act="addVendor" className="btn small">{t('sections.addVendor')}</ActBtn>} />
      <div className="s">{t('sections.vendorCount', { n: tn.vendors.length, g: tn.vendors.filter((x) => x.gstin).length })}</div>
      {Object.entries(cats).map(([cat, vs]) => (
        <div className="card" key={cat}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t.has(`vendorCat.${cat}`) ? t(`vendorCat.${cat}`) : cat}</div>
          <div className="list">
            {vs.map((x) => {
              const out = tn.bills.filter((b) => b.vendor === x.name && b.status !== 'paid').reduce((a, b) => a + b.total - b.paid, 0);
              return (
                <div className="item" key={x.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{x.name} {x.gstin && <span className="pill good" style={{ fontSize: 10 }}>GST ✓</span>}</div>
                    <div className="s">{x.contact} · {x.phone} · {t('sections.termsDays', { n: x.terms })}{x.rating != null ? ` · ★ ${x.rating}` : ''}</div>
                  </div>
                  <div className="r">{out > 0 && <div className="s" style={{ color: 'var(--crit)' }}>{t('sections.dueAmt', { amt: fmtL(out) })}</div>}<ActBtn act="raisePO" ctx={{ vendor: x.id }} className="btn small secondary">{t('sections.po')}</ActBtn></div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!tn.vendors.length && <div className="card s">{t('sections.noVendors')}</div>}
    </>
  );
}

function Customers({ c: { v, t }, B }: { c: Ctx; B: React.ReactNode }) {
  const tn = v.t;
  return (
    <>{B}<Header title={t('sections.customersTitle')} action={<ActBtn act="addCustomer" className="btn small">{t('sections.addCustomer')}</ActBtn>} />
      <div className="card"><div className="list">
        {tn.customers.map((cu) => {
          const out = tn.invoices.filter((i) => i.customer === cu.name && i.status !== 'paid').reduce((a, i) => a + i.total - i.paid, 0);
          return (
            <div className="item" key={cu.id}>
              <div><div className="t">{cu.name}</div><div className="s">{cu.kind} · {cu.phone} · {t('sections.credit', { limit: fmtL(cu.credit_limit), days: cu.credit_days })}</div></div>
              <div className="r">{out ? (<><div className={`t ${out > cu.credit_limit ? 'down' : ''}`}>{fmtL(out)}</div><div className="s">{out > cu.credit_limit ? t('sections.overLimit') : t('sections.outstanding')}</div></>) : <span className="pill good">{t('sections.clear')}</span>}</div>
            </div>
          );
        })}
        {!tn.customers.length && <div className="s">{t('sections.noCustomers')}</div>}
      </div></div>
    </>
  );
}

function Stock({ c: { v, t, dmy }, B }: { c: Ctx; B: React.ReactNode }) {
  const tn = v.t;
  return (
    <>{B}
      <Header title={t('sections.stockTitle')} action={<span className="row"><ActBtn act="addItem" className="btn small secondary">{t('sections.addItem')}</ActBtn><ActBtn act="grnOpen" className="btn small">{t('sections.receive')}</ActBtn></span>} />
      <div className="card"><div className="tablewrap"><table>
        <thead><tr><th>{t('sections.item')}</th><th className="n">{t('sections.onHand')}</th><th className="n">{t('sections.reorder')}</th><th /></tr></thead>
        <tbody>
          {tn.stock.map((s) => {
            const low = s.qty <= s.reorder;
            const days = s.unit.startsWith('bag') && s.qty > 0 ? Math.round(s.qty / 38) : null;
            return (
              <tr key={s.item}>
                <td>{s.item}<div className="s" style={{ color: 'var(--muted)' }}>{s.unit}{days ? ' · ' + t('sections.daysLeft', { n: days }) : ''}</div></td>
                <td className="n">{fmtN(s.qty)}</td><td className="n">{fmtN(s.reorder)}</td>
                <td>{low ? <ActBtn act="raisePO" ctx={{ item: s.item_id }} className="btn small">{t('sections.reorder')}</ActBtn> : <span className="pill good">{t('common.ok')}</span>}</td>
              </tr>
            );
          })}
          {!tn.stock.length && <tr><td colSpan={4} className="s">{t('sections.noStock')}</td></tr>}
        </tbody>
      </table></div></div>
      <div className="card">
        <div className="row between" style={{ marginBottom: 6 }}><div className="eyebrow">{t('sections.pos')}</div><ActBtn act="raisePO" className="btn small">{t('sections.addPo')}</ActBtn></div>
        <div className="list">
          {tn.pos.map((p) => (
            <div className="item" key={p.id}>
              <div><div className="t">{p.no} · {p.vendor}</div><div className="s">{p.item} · {fmtN(p.qty)} @ ₹{p.rate} · {t('sections.expected', { date: dmy(p.expected) })}</div></div>
              <div className="r"><div className="t">{fmtL(p.total)}</div>{p.status === 'closed' ? <span className="pill good">{t('sections.received')}</span> : <ActBtn act="grnOpen" ctx={{ po: p.id }} className="btn small secondary">{t('sections.receive')}</ActBtn>}</div>
            </div>
          ))}
          {!tn.pos.length && <div className="s">{t('sections.noPos')}</div>}
        </div>
      </div>
    </>
  );
}

function Equipment({ c: { v, t, dmy }, B }: { c: Ctx; B: React.ReactNode }) {
  const { t: tn, today } = v;
  const open = tn.tickets.filter((k) => k.status === 'open'), closed = tn.tickets.filter((k) => k.status !== 'open');
  return (
    <>{B}<Header title={t('sections.equipTitle')} action={<ActBtn act="addAsset" className="btn small">{t('sections.addAsset')}</ActBtn>} />
      <div className="grid3">
        <div className="tile"><div className="lbl">{t('sections.assets')}</div><div className="val" style={{ fontSize: 18 }}>{tn.assets.length}</div></div>
        <div className="tile"><div className="lbl">{t('sections.openTickets')}</div><div className={`val ${open.length ? 'down' : ''}`} style={{ fontSize: 18 }}>{open.length}</div></div>
        <div className="tile"><div className="lbl">{t('sections.serviceDue')}</div><div className="val" style={{ fontSize: 18 }}>{tn.assets.filter((a) => daysBetween(today, a.next_service) < 14).length}</div></div>
      </div>
      {open.length > 0 && (
        <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.openTickets')}</div><div className="list">
          {open.map((k) => (
            <div key={k.id} className={`item stripe ${k.priority === 'high' ? 'crit' : 'warn'}`}>
              <div style={{ minWidth: 0 }}><div className="t">{k.asset}</div><div className="s">{k.issue}</div><div className="s" style={{ color: 'var(--muted)' }}>{t('sections.opened', { date: dmy(k.opened), priority: k.priority })}</div></div>
              <div className="r"><ActBtn act="closeTicket" ctx={{ ticket: k.id, name: k.asset }} className="btn small">{t('common.close')}</ActBtn></div>
            </div>
          ))}
        </div></div>
      )}
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.assetRegister')}</div><div className="list">
        {tn.assets.map((a) => {
          const dl = daysBetween(today, a.next_service);
          const hasOpen = open.some((k) => k.asset === a.name);
          return (
            <div key={a.id} className="item" style={{ flexDirection: 'column', gap: 6 }}>
              <div className="row between" style={{ width: '100%' }}>
                <div style={{ minWidth: 0 }}><div className="t">{a.name}</div>
                  <div className="s">{a.category} · {t('sections.nextService', { date: dmy(a.next_service) })}{hasOpen && <> · <span style={{ color: 'var(--crit)' }}>{t('sections.ticketOpen')}</span></>}</div></div>
                {dl < 14 ? <span className="pill warn">{t('sections.serviceDue')}</span> : hasOpen ? <span className="pill crit">{t('sections.fault')}</span> : <span className="pill good">{t('common.ok')}</span>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <ActBtn act="reportIssue" ctx={{ asset: a.id, name: a.name }} className="btn small secondary">{t('sections.reportIssue')}</ActBtn>
                <ActBtn act="serviceDone" ctx={{ asset: a.id, name: a.name }} className="btn small secondary">{t('sections.serviceDone')}</ActBtn>
              </div>
            </div>
          );
        })}
        {!tn.assets.length && <div className="s">{t('sections.noAssets')}</div>}
      </div></div>
      {closed.length > 0 && (
        <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.closedN', { n: closed.length })}</div><div className="list">
          {closed.slice(0, 5).map((k) => (
            <div className="item" key={k.id}><div><div className="t">{k.asset}</div><div className="s">{k.issue}</div></div>
              <div className="r"><div className="s">{k.cost ? fmtINR(k.cost) : ''}</div><span className="pill good">{t('state.closed')}</span></div></div>
          ))}
        </div></div>
      )}
    </>
  );
}

function Health({ c: { v, t, dmy }, B }: { c: Ctx; B: React.ReactNode }) {
  const { t: tn, today } = v;
  const due = tn.batches.filter((b) => b.state !== 'closed').flatMap((b) => b.vacc.filter((x) => !x.done).map((x) => ({ ...x, b }))).sort((a, b) => a.due.localeCompare(b.due));
  return (
    <>{B}<Header title={t('sections.healthTitle')} action={<ActBtn act="addVisitPick" className="btn small">{t('sections.addVetVisit')}</ActBtn>} />
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.vaccCal')}</div><div className="list">
        {due.slice(0, 10).map((x) => { const od = daysBetween(x.due, today) > 0; return (
          <div className="item" key={x.id}>
            <div><div className="t">{x.name}</div><div className="s">{x.b.code} · {x.b.shed_name} · {t('common.due', { date: dmy(x.due) })}</div></div>
            <div className="r"><ActBtn act="vaccDone" ctx={{ vacc: x.id, name: x.name }} className={`btn small ${od ? '' : 'secondary'}`}>{od ? t('common.overdueMark') : t('common.markDone')}</ActBtn></div>
          </div>
        ); })}
        {!due.length && <div className="s">{t('sections.allVaccDone')}</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.cases')}</div><div className="list">
        {tn.disease_cases.map((cs) => (
          <div key={cs.id} className={`item stripe ${cs.status === 'open' ? 'crit' : 'good'}`}>
            <div><div className="t">{cs.disease} · {cs.batch}</div><div className="s">{Math.round(cs.confidence * 100)}% · {cs.vet_confirmed ? t('sections.vetConfirmed') : t('sections.awaitingVet')} · {cs.status}</div></div>
            {cs.status === 'open' && <div className="r"><ActBtn act="closeCase" ctx={{ case: cs.id }} className="btn small secondary">{t('sections.resolve')}</ActBtn></div>}
          </div>
        ))}
        {!tn.disease_cases.length && <div className="s">{t('sections.noCases')}</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('batch.vetVisits')}</div><div className="list">
        {tn.vet_visits.map((x, i) => <div className="item" key={i}><div><div className="t">{x.vet} · {x.batch} · {dmy(x.date)}</div><div className="s">{x.findings}</div></div></div>)}
        {!tn.vet_visits.length && <div className="s">{t('common.none')}</div>}
      </div></div>
      <div className="card"><div className="eyebrow" style={{ marginBottom: 6 }}>{t('sections.diseaseCards')}</div><div className="list">
        {v.diseases.filter((d) => d.code !== 'NORMAL' && d.code !== 'OTHER').map((d) => (
          <div className="item" key={d.code}><div><div className="t">{d.name}</div><div className="s">{d.signs}</div></div></div>
        ))}
      </div></div>
    </>
  );
}
