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

// Who may run each form action (server-enforced in runAct). Owners and managers run the farm;
// finance handles money; supervisors / labour / vets record what happens in the sheds.
// ponytail: RLS is still tenant-only — mirror this in role-aware policies (roadmap Phase 13).
const OWN = ['tenant_owner', 'farm_manager'];
const MONEY = [...OWN, 'finance'];
const SHED = [...OWN, 'shed_supervisor', 'labour', 'veterinarian'];
/** which platform team sees/does what on the console (DB mirrors `billing` in 0016) */
export const TEAM = {
  applications: ['platform_admin', 'platform_sales', 'platform_ops'],
  billing: ['platform_admin', 'platform_finance'],
  feeds: ['platform_admin', 'platform_ops', 'platform_marketing'],
} as const;

export const ACT_ROLES: Record<string, string[]> = {
  addFarm: OWN, addShed: OWN, addBatch: OWN, addWorker: OWN,
  saleOpen: MONEY, addBill: MONEY, payOpen: MONEY, addCustomer: MONEY, addVendor: MONEY,
  mort: SHED, logSave: SHED,
  vaccDone: [...OWN, 'shed_supervisor', 'veterinarian'], addVisit: [...OWN, 'shed_supervisor', 'veterinarian'],
  attSet: [...OWN, 'shed_supervisor'],
  closeBatch: OWN, batchState: OWN, addAsset: OWN, addItem: [...OWN, 'store_keeper'], addDoc: OWN,
  addVacc: [...OWN, 'shed_supervisor', 'veterinarian'],
  confirmCase: [...OWN, 'veterinarian'], closeCase: [...OWN, 'veterinarian'],
  reportIssue: [...OWN, 'shed_supervisor', 'labour', 'store_keeper'],
  closeTicket: [...OWN, 'store_keeper'], serviceDone: [...OWN, 'store_keeper'],
  raisePO: [...MONEY, 'store_keeper'], grnOpen: [...OWN, 'store_keeper'],
  addRate: MONEY, addAdvance: [...OWN, 'finance'], remind: MONEY, // reminder_log policy (0020) mirrors this
  decidePay: ['tenant_owner'], // payments > ₹50,000 by others wait for the owner (0012)
  inviteUser: ['tenant_owner'], // matches invite-user edge function + user_role_assignment policy
  // downloads (app/api/export) — the route enforces the same lists
  tally: [...MONEY, 'auditor'], gstr: [...MONEY, 'auditor'], stmt: [...MONEY, 'auditor'], payroll: [...MONEY, 'auditor'],
  report: [...MONEY, 'auditor', 'shed_supervisor'],
};
export const canAct = (roles: string[], act: string) => (ACT_ROLES[act] ?? []).some((r) => roles.includes(r));
