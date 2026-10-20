// Port of demo/index.html moreScreen menu (:465-468).
import Link from 'next/link';
import { loadView } from '@/lib/view/load';
import { daysBetween } from '@/lib/format';
import { Header } from '@/components/ui/bits';

export default async function More() {
  const { t, today } = await loadView();
  const openT = t.tickets.filter((k) => k.status === 'open').length;
  const low = t.stock.filter((s) => s.qty <= s.reorder).length;
  const overdueV = t.batches.flatMap((b) => b.vacc).filter((x) => !x.done && daysBetween(x.due, today) > 0).length;
  const items: [string, string, string][] = [
    ['people', '👷 People', `Attendance · wages · ${t.workers.length} workers`],
    ['equipment', '🔧 Equipment', openT ? `${openT} open ticket${openT > 1 ? 's' : ''}` : `${t.assets.length} assets · all OK`],
    ['stock', '📦 Stock & POs', low ? `${low} below reorder` : 'stock OK'],
    ['vendors', '🏪 Vendors', `${t.vendors.length} vendors`],
    ['customers', '🤝 Customers', `${t.customers.length} traders`],
    ['health', '💉 Health', overdueV ? `${overdueV} vaccination overdue` : 'schedules on track'],
    ['docs', '📄 Compliance', 'licences & renewals'],
    ['reports', '📊 Reports', 'daily · weekly · monthly'],
    ['users', '👤 Users', `${t.users.length} users`],
    ['notifications', '🔔 Notifications', `${t.notifications.filter((n) => !n.read).length} unread`],
  ];
  return (
    <>
      <Header title="More" />
      <div className="menu">
        {items.map(([k, l, s]) => (
          <Link key={k} href={`/more/${k}`}>
            <div className="t">{l}</div>
            <div className="s">{s}</div>
          </Link>
        ))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Settings</div>
        <div className="kv">
          <div>Language</div><div>తెలుగు / English</div>
          <div>Offline cache</div><div>last 90 days</div>
          <div>Plan</div><div>{t.plan[0].toUpperCase() + t.plan.slice(1)}</div>
          <div>Daily WhatsApp summary</div><div>7:00 PM</div>
        </div>
      </div>
    </>
  );
}
