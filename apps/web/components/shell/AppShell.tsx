'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TAB_ICONS, BellIcon } from './icons';
import { TenantSheet } from './TenantSheet';
import { FARM_TYPE_INFO, type FarmType } from '@/lib/farm-types';
import type { Tab } from '@/lib/auth/permissions';

// Markup mirrors demo/index.html:137-143 and renderTabs/renderHeader (:222-227)
const TAB_LABELS: Record<Tab, [string, string]> = {
  home: ['Home', 'హోమ్'], farm: ['Farm', 'ఫారం'], log: ['Log', 'నమోదు'], money: ['Money', 'డబ్బు'], more: ['More', 'మరిన్ని'],
};

export function AppShell({ tenantName, sub, unread, tabs, mode, modes, children }: {
  tenantName: string;
  sub: string;
  unread: number;
  tabs: Tab[];
  mode: FarmType;
  modes: FarmType[];
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = tenantName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <div className="col">
        <header className="topbar">
          <button className="tenant" aria-label="Switch view" onClick={() => setOpen(true)}>
            <span className="avatar">{initials}</span>
            <span style={{ minWidth: 0 }}>
              <div className="name">{tenantName}</div>
              <div className="sub">{FARM_TYPE_INFO[mode].label} view · {sub}</div>
            </span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>▾</span>
          </button>
          <Link className="iconbtn" href="/more" aria-label="Notifications">
            <BellIcon />
            {unread > 0 && <span className="badge">{unread}</span>}
          </Link>
        </header>
        <main className="screen"><div className="wrap">{children}</div></main>
      </div>
      <nav className="tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => (
          <Link key={t} href={'/' + t} aria-label={TAB_LABELS[t][0]}
            className={`tab ${path === '/' + t || path.startsWith('/' + t + '/') ? 'active' : ''}`}>
            {TAB_ICONS[t]}<span>{TAB_LABELS[t][0]}</span><small>{TAB_LABELS[t][1]}</small>
          </Link>
        ))}
      </nav>
      <TenantSheet open={open} onOpenChange={setOpen} modes={modes} mode={mode} />
    </div>
  );
}
