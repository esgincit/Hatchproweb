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
  hatchery_manager: ['home', 'farm', 'log', 'more'], // ERP Phase 1 roles (0035)
  hatchery_ops_manager: ['home', 'farm', 'log', 'more'],
  hatchery_technician: ['home', 'farm', 'log', 'more'],
  sales_officer: ['home', 'money', 'more'],
  dispatch_officer: ['home', 'more'],
  procurement_officer: ['home', 'more'],
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
const BREED = [...OWN, 'shed_supervisor'];
const HATCH = ['hatchery_technician', 'hatchery_ops_manager'];
const SHED = [...OWN, 'shed_supervisor', 'labour', 'veterinarian'];
/** which platform team sees/does what on the console (DB mirrors `billing` in 0016) */
export const TEAM = {
  applications: ['platform_admin', 'platform_sales', 'platform_ops'],
  billing: ['platform_admin', 'platform_finance'],
  feeds: ['platform_admin', 'platform_ops', 'platform_marketing'],
  support: ['platform_admin', 'platform_support'], // read-only "view tenant", every view audit-logged (0031)
  ops: ['platform_admin', 'platform_ops'],         // sync health
  sales: ['platform_admin', 'platform_sales'],     // pipeline + usage
  marketing: ['platform_admin', 'platform_marketing'], // marketplace listing approvals (0032)
} as const;

export const ACT_ROLES: Record<string, string[]> = {
  addFarm: OWN, addShed: OWN, addBatch: OWN, addWorker: OWN,
  saleOpen: MONEY, addBill: MONEY, payOpen: MONEY, addCustomer: MONEY, addVendor: MONEY,
  mort: SHED, logSave: SHED, shiftLog: SHED,
  vaccDone: [...OWN, 'shed_supervisor', 'veterinarian'], addVisit: [...OWN, 'shed_supervisor', 'veterinarian'],
  attSet: [...OWN, 'shed_supervisor'],
  closeBatch: OWN, batchState: OWN, addAsset: OWN, addItem: [...OWN, 'store_keeper'], addDoc: OWN,
  addVacc: [...OWN, 'shed_supervisor', 'veterinarian'],
  confirmCase: [...OWN, 'veterinarian'], closeCase: [...OWN, 'veterinarian'],
  reportIssue: [...OWN, 'shed_supervisor', 'labour', 'store_keeper'],
  closeTicket: [...OWN, 'store_keeper'], serviceDone: [...OWN, 'store_keeper'],
  raisePO: [...MONEY, 'store_keeper'], grnOpen: [...OWN, 'store_keeper'],
  addRate: MONEY, addAdvance: [...OWN, 'finance'], remind: MONEY, // reminder_log policy (0020) mirrors this
  setBank: MONEY, // worker_bank policy (0022) mirrors this
  addContract: MONEY, settleContract: MONEY, linkContract: OWN, // contract / settlement policies (0029); link = batch update (owner/manager)
  hatchCandle: [...OWN, 'shed_supervisor'], hatchResult: [...OWN, 'shed_supervisor'], // hatch_record policy (0025)
  // egg transfers / setting sources / rules mirror the egg_transfer, setting_lot and tenant_rule policies + guard_locked (0036)
  addTransfer: [...OWN, 'shed_supervisor'], submitTransfer: [...OWN, 'shed_supervisor'], decideTransfer: OWN, cancelTransfer: OWN,
  receiveTransfer: [...OWN, 'shed_supervisor', 'hatchery_technician', 'hatchery_ops_manager'],
  loadSetting: [...OWN, 'shed_supervisor', 'hatchery_technician', 'hatchery_ops_manager'],
  setRule: ['tenant_owner'],
  // breeder + hatchery (0038–0044): each list mirrors that table's RLS roles; approvals mirror its guard_locked() approvers
  breederDaily: BREED, bodyWeight: BREED, eggCollection: BREED, medication: [...OWN, 'veterinarian'],
  biosecurity: [...BREED, 'veterinarian', 'hatchery_ops_manager'], houseReading: [...BREED, ...HATCH], machineReading: [...BREED, ...HATCH],
  addMachine: OWN, loadSetter: [...OWN, ...HATCH], candling: [...BREED, ...HATCH], hatcherTransfer: [...OWN, ...HATCH],
  hatchFull: [...BREED, ...HATCH, 'hatchery_manager'], releaseHatcher: ['tenant_owner', 'hatchery_ops_manager', 'hatchery_manager'],
  chickQuality: ['tenant_owner', 'veterinarian', 'hatchery_manager', 'hatchery_ops_manager'],
  chickVaccine: ['tenant_owner', 'veterinarian', 'hatchery_manager', 'hatchery_technician'],
  decideDaily: OWN, decideEggs: OWN, decideCandling: ['tenant_owner', 'hatchery_ops_manager'], decideXfer: ['tenant_owner', 'hatchery_ops_manager'],
  decideHatch: ['tenant_owner', 'hatchery_manager'], decideQuality: ['tenant_owner', 'veterinarian', 'hatchery_manager'],
  decidePay: ['tenant_owner'], // payments > ₹50,000 by others wait for the owner (0012)
  inviteUser: ['tenant_owner'], // matches invite-user edge function + user_role_assignment policy
  // downloads (app/api/export) — the route enforces the same lists
  tally: [...MONEY, 'auditor'], gstr: [...MONEY, 'auditor'], stmt: [...MONEY, 'auditor'], payroll: MONEY, // bank file: account numbers (0022)
  report: [...MONEY, 'auditor', 'shed_supervisor'],
};
export const canAct = (roles: string[], act: string) => (ACT_ROLES[act] ?? []).some((r) => roles.includes(r));
