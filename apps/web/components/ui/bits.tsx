// Small render helpers ported from demo/index.html:294-300 (ragPill, stateLabel, statusPill, back, header, live).
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Rag } from '@/lib/kpi';

const RAG_CLS: Record<Rag, string> = { good: 'good', warn: 'warn', crit: 'crit', neutral: 'neutral' };
export function RagPill({ rag }: { rag: Rag }) {
  const t = useTranslations('rag');
  return <span className={`pill ${RAG_CLS[rag]}`}>{rag === 'neutral' ? '' : '● '}{t(rag)}</span>;
}

export function StatusPill({ s }: { s: string }) {
  const t = useTranslations('pay');
  const cls = { paid: 'good', partial: 'warn', unpaid: 'neutral', overdue: 'crit' }[s] ?? 'neutral';
  return <span className={`pill ${cls}`}>{t.has(s) ? t(s) : s}</span>;
}

export function Back({ href }: { href: string }) {
  const t = useTranslations('common');
  return <Link className="back" href={href}>‹ {t('back')}</Link>;
}

export const Header = ({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) => (
  <div className="row between">
    <div className="h2">{title}</div>
    {action}
  </div>
);

/** Static until Realtime lands (Phase 10); keeps the demo's "live" affordance. */
export function Live({ label }: { label?: string }) {
  const t = useTranslations('common');
  return (
    <span className="live">
      <span className="dot" />
      <span>{label ?? t('live')}</span>
    </span>
  );
}

export const sevStripe = (s: string) => (s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'info');

export const Chips = ({ items, active }: { items: [href: string, key: string, label: string][]; active: string }) => (
  <div className="chips">
    {items.map(([href, k, l]) => (
      <Link key={k} href={href} className={`chip ${active === k ? 'active' : ''}`} scroll={false}>
        {l}
      </Link>
    ))}
  </div>
);
