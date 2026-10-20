// Port of demo/index.html moreScreen menu (:465-468).
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loadView } from '@/lib/view/load';
import { daysBetween } from '@/lib/format';
import { Header } from '@/components/ui/bits';
import { LanguagePicker } from '@/components/i18n/LanguagePicker';

export default async function More() {
  const [{ t: tn, today }, t] = await Promise.all([loadView(), getTranslations('more')]);
  const openT = tn.tickets.filter((k) => k.status === 'open').length;
  const low = tn.stock.filter((s) => s.qty <= s.reorder).length;
  const overdueV = tn.batches.flatMap((b) => b.vacc).filter((x) => !x.done && daysBetween(x.due, today) > 0).length;
  const items: [string, string, string][] = [
    ['people', t('people'), t('peopleSub', { n: tn.workers.length })],
    ['equipment', t('equipment'), openT ? t('openTickets', { n: openT }) : t('assetsOk', { n: tn.assets.length })],
    ['stock', t('stock'), low ? t('belowReorder', { n: low }) : t('stockOk')],
    ['vendors', t('vendors'), t('nVendors', { n: tn.vendors.length })],
    ['customers', t('customers'), t('nTraders', { n: tn.customers.length })],
    ['health', t('health'), overdueV ? t('vaccOverdue', { n: overdueV }) : t('onTrack')],
    ['docs', t('docs'), t('docsSub')],
    ['reports', t('reports'), t('reportsSub')],
    ['users', t('users'), t('nUsers', { n: tn.users.length })],
    ['notifications', t('notifications'), t('nUnread', { n: tn.notifications.filter((n) => !n.read).length })],
  ];
  return (
    <>
      <Header title={t('title')} />
      <div className="menu">
        {items.map(([k, l, s]) => (
          <Link key={k} href={`/more/${k}`}>
            <div className="t">{l}</div>
            <div className="s">{s}</div>
          </Link>
        ))}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t('settings')}</div>
        <LanguagePicker />
        <div className="kv" style={{ marginTop: 10 }}>
          <div>{t('offlineCache')}</div><div>{t('last90')}</div>
          <div>{t('plan')}</div><div>{tn.plan[0].toUpperCase() + tn.plan.slice(1)}</div>
          <div>{t('waSummary')}</div><div>7:00 PM</div>
        </div>
      </div>
    </>
  );
}
