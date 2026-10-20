// Small render helpers ported from demo/index.html:294-300 (ragPill, stateLabel, statusPill, back, header, live).
import Link from 'next/link';
import type { Rag } from '@/lib/kpi';

export const RagPill = ({ rag }: { rag: Rag }) =>
  ({
    good: <span className="pill good">● On track</span>,
    warn: <span className="pill warn">● Below curve</span>,
    crit: <span className="pill crit">● Mortality spike</span>,
    neutral: <span className="pill neutral">Closed</span>,
  })[rag];

const STATE: Record<string, string> = {
  planned: 'Planned', placed: 'Placed', brooding: 'Brooding', growing: 'Growing', laying: 'Laying', finishing: 'Finishing', lifting: 'Lifting', closed: 'Closed',
};
export const stateLabel = (s: string) => STATE[s] ?? s;

export const StatusPill = ({ s }: { s: string }) =>
  ({
    paid: <span className="pill good">Paid</span>,
    partial: <span className="pill warn">Partial</span>,
    unpaid: <span className="pill neutral">Unpaid</span>,
    overdue: <span className="pill crit">Overdue</span>,
  })[s] ?? <span className="pill neutral">{s}</span>;

export const Back = ({ href }: { href: string }) => (
  <Link className="back" href={href}>
    ‹ Back
  </Link>
);

export const Header = ({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) => (
  <div className="row between">
    <div className="h2">{title}</div>
    {action}
  </div>
);

/** Static until Realtime lands (Phase 10); keeps the demo's "live" affordance. */
export const Live = ({ label = 'live' }: { label?: string }) => (
  <span className="live">
    <span className="dot" />
    <span>{label}</span>
  </span>
);

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
