// Printable reports behind More → Reports "Generate" (daily, weekly, vaccination, mortality). The browser's
// print dialog saves them as PDF; globals.css @media print hides the app chrome. Data rules: lib/reports.ts.
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { claimsFromUser } from '@/lib/auth/claims';
import { canAct } from '@/lib/auth/permissions';
import { loadView } from '@/lib/view/load';
import { dateFmt, fmtN } from '@/lib/format';
import { dailyReport, isReport, mortReport, vaccReport, weeklyReport } from '@/lib/reports';
import { Back } from '@/components/ui/bits';
import { PrintButton } from '@/components/ui/PrintButton';
import type { Batch } from '@/lib/view/types';

const TITLE = { daily: 'rDaily', weekly: 'rWeekly', vaccination: 'rVacc', mortality: 'rMort' } as const;
const PILL = { onTime: 'good', late: 'warn', overdue: 'crit', upcoming: 'neutral' } as const;
const n = (x: number | null | undefined, d = 0) => (x == null ? '–' : d ? x.toFixed(d) : fmtN(x));
const who = (b: Batch) => `${b.code} · ${b.farm_name} / ${b.shed_name}`;

export default async function Report({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isReport(kind)) notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !canAct(claimsFromUser(user).roles, 'report')) notFound();

  const [v, t, locale] = await Promise.all([loadView(), getTranslations(), getLocale()]);
  const dmy = dateFmt(locale);
  const r = (k: string, a?: Record<string, string | number>) => t(`report.${k}`, a);
  // first `text` columns are left-aligned, the rest are numbers
  const head = (keys: string[], text = 1) => <thead><tr>{keys.map((k, i) => <th key={k} className={i >= text ? 'n' : undefined}>{r(k)}</th>)}</tr></thead>;
  const empty = (cols: number) => <tr><td colSpan={cols} className="s">{r('noRows')}</td></tr>;

  let sub: string, body: React.ReactNode;
  switch (kind) {
    case 'daily': {
      const d = dailyReport(v.t, v.today);
      sub = r('forDate', { date: dmy(v.today) });
      body = <>
        <table>{head(['batch', 'day', 'birds', 'mortality', 'culls', 'feed', 'eggs', 'eggPct', 'avgW', 'temp'])}<tbody>
          {d.rows.map((x) => (
            <tr key={x.b.id}><td>{who(x.b)}{!x.logged && <> <span className="pill warn">{r('notLogged')}</span></>}</td>
              <td className="n">{x.b.age}</td><td className="n">{n(x.alive)}</td><td className="n">{n(x.mortality)}</td><td className="n">{n(x.culls)}</td>
              <td className="n">{n(x.feed)}</td><td className="n">{x.b.ft === 'layer' ? n(x.eggs) : '–'}</td><td className="n">{n(x.eggPct, 1)}</td>
              <td className="n">{n(x.avgW)}</td><td className="n">{x.tmax == null ? '–' : `${x.tmin ?? '–'}–${x.tmax}°`}</td></tr>
          ))}
          {d.rows.length ? (
            <tr><th>{r('total')}</th><th /><th className="n">{n(d.total.alive)}</th><th className="n">{n(d.total.mortality)}</th><th className="n">{n(d.total.culls)}</th>
              <th className="n">{n(d.total.feed)}</th><th className="n">{n(d.total.eggs)}</th><th colSpan={3} /></tr>
          ) : empty(10)}
        </tbody></table>
        <h3>{r('vaccDue')}</h3>
        <table>{head(['batch', 'vaccine', 'due'], 3)}<tbody>
          {d.vacc.map((x) => <tr key={x.id}><td>{who(x.b)}</td><td>{x.name}</td><td>{dmy(x.due)}</td></tr>)}
          {!d.vacc.length && empty(3)}
        </tbody></table>
      </>;
      break;
    }
    case 'weekly': {
      const w = weeklyReport(v.t, v.today);
      sub = r('range', { from: dmy(w.from), to: dmy(w.to) });
      body = (
        <table>{head(['batch', 'day', 'days', 'birds', 'losses', 'mortPctCum', 'feed', 'eggPct', 'eggStd', 'avgW', 'wStd', 'fcr'])}<tbody>
          {w.rows.map((x) => (
            <tr key={x.b.id}><td>{who(x.b)}</td><td className="n">{x.b.age}</td><td className="n">{x.days}</td><td className="n">{n(x.alive)}</td>
              <td className="n">{n(x.mortality)}</td><td className="n">{n(x.mortPct, 1)}</td><td className="n">{n(x.feed)}</td>
              <td className="n">{n(x.eggPct, 1)}</td><td className="n">{n(x.eggStd, 1)}</td><td className="n">{n(x.avgW)}</td><td className="n">{n(x.wStd)}</td><td className="n">{n(x.fcr, 2)}</td></tr>
          ))}
          {!w.rows.length && empty(12)}
        </tbody></table>
      );
      break;
    }
    case 'vaccination': {
      const c = vaccReport(v.t, v.today);
      sub = r('compliance', { pct: c.compliance ?? 100, onTime: c.onTime, due: c.due, overdue: c.overdue });
      body = (
        <table>{head(['batch', 'vaccine', 'due', 'done', 'status'], 5)}<tbody>
          {c.rows.map((x) => (
            <tr key={x.id}><td>{who(x.b)}</td><td>{x.name}</td><td>{dmy(x.due)}</td><td>{x.done ? dmy(x.done) : '–'}</td>
              <td><span className={`pill ${PILL[x.status]}`}>{r(`st.${x.status}`)}</span></td></tr>
          ))}
          {!c.rows.length && empty(5)}
        </tbody></table>
      );
      break;
    }
    case 'mortality': {
      const m = mortReport(v.t);
      sub = r('mortSub', { mortality: fmtN(m.mortality), culls: fmtN(m.culls) });
      body = (
        <table>{head(['date', 'batch', 'day', 'birds', 'mortality', 'culls', 'lossPct', 'running'], 2)}<tbody>
          {m.rows.map((x) => (
            <tr key={x.b.id + x.date}><td>{dmy(x.date)}</td><td>{who(x.b)}</td><td className="n">{x.day}</td><td className="n">{n(x.birds)}</td>
              <td className="n">{n(x.mortality)}</td><td className="n">{n(x.culls)}</td><td className="n">{n(x.pct, 1)}</td><td className="n">{n(x.run)}</td></tr>
          ))}
          {!m.rows.length && empty(8)}
        </tbody></table>
      );
      break;
    }
  }

  return (
    <>
      <Back href="/more/reports" />
      <div className="card report">
        <div className="row between">
          <div><h2>{t(`sections.${TITLE[kind]}`)}</h2><div className="s">{v.t.name} · {sub}</div></div>
          <PrintButton label={r('print')} />
        </div>
        <div className="tablewrap">{body}</div>
        <div className="s">{r('generated', { date: dmy(v.today) })} · HatchPro</div>
      </div>
    </>
  );
}
