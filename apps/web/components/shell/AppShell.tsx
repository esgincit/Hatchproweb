'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TAB_ICONS, BellIcon } from './icons';
import { TenantSheet } from './TenantSheet';
import { Toaster } from '@/components/ui/Toast';
import { ActionHost } from '@/components/forms/ActionHost';
import type { FarmType } from '@/lib/farm-types';
import type { Tab } from '@/lib/auth/permissions';

// Markup mirrors demo/index.html:137-143 and renderTabs/renderHeader (:222-227).
// Tab sub-label: Telugu under English (as the demo) when the UI is English, English under the local label otherwise.
const TE: Record<Tab, string> = { home: 'హోమ్', farm: 'ఫారం', log: 'నమోదు', money: 'డబ్బు', more: 'మరిన్ని' };
const EN: Record<Tab, string> = { home: 'Home', farm: 'Farm', log: 'Log', money: 'Money', more: 'More' };

export function AppShell({ tenantName, sub, unread, tabs, mode, modes, today, children }: {
  tenantName: string;
  sub: string;
  unread: number;
  tabs: Tab[];
  mode: FarmType;
  modes: FarmType[];
  today: string;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = tenantName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <button className="tenant" aria-label={t('shell.switchView')} onClick={() => setOpen(true)}>
            <span className="avatar">{initials}</span>
            <span style={{ minWidth: 0 }}>
              <div className="name">{tenantName}</div>
              <div className="sub">{t('shell.view', { type: t(`farmType.${mode}`) })} · {sub}</div>
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>▾</span>
          </button>
          <Link className="iconbtn" href="/more/notifications" aria-label={t('shell.notifications')}>
            <BellIcon />
            {unread > 0 && <span className="badge">{unread}</span>}
          </Link>
        </header>
        <main className="screen"><div className="wrap">{children}</div></main>
      </div>
      <nav className="tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((k) => (
          <Link key={k} href={'/' + k} aria-label={t(`tabs.${k}`)}
            className={`tab ${path === '/' + k || path.startsWith('/' + k + '/') ? 'active' : ''}`}>
            {TAB_ICONS[k]}<span>{t(`tabs.${k}`)}</span><small>{locale === 'en' ? TE[k] : EN[k]}</small>
          </Link>
        ))}
      </nav>
      <Toaster />
      <ActionHost today={today} />
      <TenantSheet open={open} onOpenChange={setOpen} modes={modes} mode={mode} />
    </div>
  );
}
