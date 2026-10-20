export type Tab = 'home' | 'farm' | 'log' | 'money' | 'more';
export const TABS: Tab[] = ['home', 'farm', 'log', 'money', 'more'];

// BUILD-BRIEF §3 matrix (+ labour). UI hiding only — RLS is the real guard.
const BY_ROLE: Record<string, Tab[]> = {
  tenant_owner: TABS,
  farm_manager: TABS,
  finance: ['home', 'money', 'more'],
  shed_supervisor: ['home', 'farm', 'log', 'more'],
  labour: ['log', 'more'],
  veterinarian: ['home', 'farm', 'log', 'more'],
  store_keeper: ['home', 'more'],
  auditor: ['home', 'farm', 'money', 'more'],
};

export function tabsFor(roles: string[]): Tab[] {
  const allowed = new Set(roles.flatMap((r) => BY_ROLE[r] ?? []));
  return TABS.filter((t) => allowed.has(t));
}
