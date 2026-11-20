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
const SALES = ['tenant_owner', 'sales_officer', 'hatchery_manager'];
const DISPATCH = ['tenant_owner', 'dispatch_officer', 'hatchery_ops_manager'];
const STORE = ['tenant_owner', 'farm_manager', 'store_keeper'];
const PM = ['tenant_owner', 'farm_manager', 'store_keeper', 'hatchery_ops_manager'];
export const DELEGATORS = ['farm_manager', 'hatchery_manager', 'hatchery_ops_manager', 'finance', 'procurement_officer', 'store_keeper'];
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
  saleOpen: MONEY, addBill: MONEY, payOpen: MONEY, addCustomer: MONEY, setTier: MONEY, addVendor: MONEY, // customer policies (0006): owner, manager, finance
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
  // chick sales + dispatch (0043–0049): each list mirrors the table's RLS roles and the trigger that guards the step
  addProduct: [...OWN, 'hatchery_manager'], setBatchProduct: OWN, addOrder: SALES, verifyPayment: ['tenant_owner', 'finance'], confirmOrder: SALES,
  cancelOrder: SALES, moveOrder: SALES, reserveOrder: SALES, priceOrder: ['tenant_owner'], waiveDeposit: ['tenant_owner'],
  allocate: SALES, decideAlloc: ['tenant_owner', 'hatchery_manager'], releaseAlloc: ['tenant_owner', 'hatchery_manager'],
  addVehicle: [...OWN, 'dispatch_officer', 'hatchery_ops_manager'], addTrip: DISPATCH, addLoad: DISPATCH, submitTrip: DISPATCH,
  decideTrip: ['tenant_owner', 'hatchery_ops_manager'], deliverTrip: DISPATCH, completeTrip: DISPATCH,
  doaClaim: [...SALES, 'dispatch_officer'], decideDoa: ['tenant_owner', 'hatchery_manager'],
  // finance / procurement / settings (0050-0053): lists mirror each table's RLS roles and its guard_locked() approvers
  addCreditNote: ['tenant_owner', 'finance', 'sales_officer', 'hatchery_manager'], decideCreditNote: ['tenant_owner', 'finance'],
  addRefund: ['tenant_owner', 'finance'], decideRefund: ['tenant_owner', 'finance'], setLock: ['tenant_owner'], setLimit: ['tenant_owner'],
  addReq: ['tenant_owner', 'farm_manager', 'store_keeper', 'shed_supervisor', 'hatchery_technician', 'hatchery_ops_manager', 'procurement_officer'],
  submitReq: ['tenant_owner', 'farm_manager', 'store_keeper', 'hatchery_ops_manager', 'procurement_officer'], decideReq: ['tenant_owner', 'farm_manager', 'store_keeper', 'hatchery_ops_manager'],
  approvePO: ['tenant_owner', 'procurement_officer'], cancelPO: ['tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'], // 0053 + 0057
  addCount: STORE, submitCount: STORE, decideCount: STORE, addStockXfer: STORE, decideStockXfer: STORE, sendStockXfer: STORE, receiveStockXfer: STORE,
  addBranch: ['tenant_owner'], toggleBranch: ['tenant_owner'], setFarmBranch: ['tenant_owner'], grantSupport: ['tenant_owner'], revokeSupport: ['tenant_owner'],
  toggleWebhook: ['tenant_owner'], revokeApiKey: ['tenant_owner'], createApiKey: ['tenant_owner'], createWebhook: ['tenant_owner'],
  linkPortal: ['tenant_owner'], unlinkPortal: ['tenant_owner'],
  addPm: PM, pmDone: PM,
  addDelegation: DELEGATORS, revokeDelegation: DELEGATORS, // the owner cannot delegate (ownership is not delegable, and roles must be held)
  decidePay: ['tenant_owner'], // payments > ₹50,000 by others wait for the owner (0012)
  inviteUser: ['tenant_owner'], // matches invite-user edge function + user_role_assignment policy
  // downloads (app/api/export) — the route enforces the same lists
  tally: [...MONEY, 'auditor'], gstr: [...MONEY, 'auditor'], stmt: [...MONEY, 'auditor'], payroll: MONEY, // bank file: account numbers (0022)
  report: [...MONEY, 'auditor', 'shed_supervisor'],
};
/** who sees the Sales / Dispatch screens (RLS lets the whole tenant read; this keeps the menu honest) */
export const AREA_ROLES = {
  sales: [...OWN, 'sales_officer', 'hatchery_manager', 'finance', 'auditor'],
  dispatch: [...OWN, 'dispatch_officer', 'hatchery_ops_manager', 'hatchery_manager', 'sales_officer'],
  finance: [...OWN, 'finance', 'auditor', 'sales_officer', 'hatchery_manager'],
  procurement: [...OWN, 'store_keeper', 'procurement_officer', 'hatchery_ops_manager', 'finance', 'auditor', 'shed_supervisor', 'hatchery_technician'],
  dashboards: [...OWN, 'hatchery_manager', 'hatchery_ops_manager', 'finance', 'auditor', 'sales_officer'],
  settings: ['tenant_owner', ...DELEGATORS],
} as const;
export const canSee = (roles: string[], area: keyof typeof AREA_ROLES) => AREA_ROLES[area].some((r) => roles.includes(r));
export const canAct = (roles: string[], act: string) => (ACT_ROLES[act] ?? []).some((r) => roles.includes(r));
