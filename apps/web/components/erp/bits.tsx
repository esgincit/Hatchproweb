// Small server-side pieces shared by the breeder + hatchery panels (ERP WP1.3–1.10).
import type { getTranslations } from 'next-intl/server';
import { ActBtn } from '@/components/ui/ActBtn';

export type T = Awaited<ReturnType<typeof getTranslations>>;
/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST rows */
export type Row = any;
export const one = (x: any) => (Array.isArray(x) ? x[0] : x);
const PILL: Record<string, string> = { draft: 'neutral', submitted: 'warn', approved: 'good', rejected: 'crit' };

export const pct = (v: unknown, d = 1) => (v == null ? '—' : `${Number(v).toFixed(d)}%`);
export const nz = (v: unknown, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));

export function Status({ status, t }: { status: string; t: T }) {
  return <span className={`pill ${PILL[status] ?? 'neutral'}`}>{t(`trace.status.${status}`)}</span>;
}

/** Approve / Reject for a record awaiting a decision. `act` is the approval act (decideDaily…); ActBtn hides it for roles that cannot decide. */
export function Decide({ act, id, status, t }: { act: string; id: string; status: string; t: T }) {
  if (status !== 'submitted' && status !== 'draft') return null;
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <ActBtn act={`approve:${act}`} ctx={{ id }} className="btn small">{t('trace.approve')}</ActBtn>
      <ActBtn act={`reject:${act}`} ctx={{ id }} className="btn small secondary">{t('trace.reject')}</ActBtn>
    </span>
  );
}

export function Card({ title, testid, action, children }: { title: string; testid: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" data-testid={testid}>
      <div className="row between" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 6 }}><div className="eyebrow">{title}</div><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{action}</div></div>
      {children}
    </div>
  );
}

/** head: column titles (a leading "-" marks a text column, the rest are numeric); rows: cells in the same order. */
export function Tbl({ head, rows, empty }: { head: string[]; rows: { key: string; cells: React.ReactNode[] }[]; empty: string }) {
  if (!rows.length) return <div className="s">{empty}</div>;
  const text = head.map((h) => h.startsWith('-'));
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i} className={text[i] ? undefined : 'n'}>{text[i] ? h.slice(1) : h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}>{r.cells.map((c, i) => <td key={i} className={text[i] ? undefined : 'n'}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
