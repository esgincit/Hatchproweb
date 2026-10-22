import type { Claims } from './claims';
import { TABS, tabsFor, type Tab } from './permissions';

const PUBLIC = ['/login', '/platform/login', '/apply'];
const under = (path: string, base: string) => path === base || path.startsWith(base + '/');
const NO_ACCESS = '/login?error=no-access';

export function landingFor(c: Claims): string {
  if (c.platform) return '/admin';
  const first = tabsFor(c.roles)[0];
  return c.tenantId && first ? '/' + first : NO_ACCESS;
}

/** Where to send this request, or null to let it through. Pure: unit-tested, used by middleware. */
export function redirectFor(pathname: string, c: Claims | null): string | null {
  const isPublic = PUBLIC.some((p) => under(pathname, p));
  const isAdmin = under(pathname, '/admin');
  let to: string | null;
  if (!c) to = isPublic ? null : isAdmin ? '/platform/login' : '/login';
  else if (c.platform) to = isAdmin || under(pathname, '/apply') ? null : '/admin'; // staff fill /apply for farms that call in
  else if (isAdmin || isPublic) to = landingFor(c);
  else {
    const seg = pathname.split('/')[1] as Tab;
    const land = landingFor(c);
    to = land === NO_ACCESS ? land : TABS.includes(seg) && !tabsFor(c.roles).includes(seg) ? land : null;
  }
  // never redirect to the page we are on (prevents loops, e.g. no-access → /login)
  return to && to.split('?')[0] === pathname ? null : to;
}
