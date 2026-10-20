import type { Tab } from '@/lib/auth/permissions';

// SVG paths copied from demo/index.html:164-170
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 } as const;
export const TAB_ICONS: Record<Tab, React.ReactNode> = {
  home: <svg viewBox="0 0 24 24" {...P}><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  farm: <svg viewBox="0 0 24 24" {...P}><path d="M3 20h18M4 20V9l8-5 8 5v11M9 20v-6h6v6M4 12h16" /></svg>,
  log: <svg viewBox="0 0 24 24" {...P}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  money: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 12h.01M17 12h.01" /></svg>,
  more: <svg viewBox="0 0 24 24" {...P}><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
};
export const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" {...P}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></svg>
);
