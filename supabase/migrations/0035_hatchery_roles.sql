-- 0035: ERP Phase 1 roles (plan Part C1 RACI). Enum values must commit before 0036 uses them.
alter type app_role add value if not exists 'hatchery_manager';      -- approves hatch reports, chick allocation
alter type app_role add value if not exists 'hatchery_ops_manager';  -- approves receiving, candling, transfers, dispatch
alter type app_role add value if not exists 'hatchery_technician';   -- production technician: receive, set, candle, hatch
alter type app_role add value if not exists 'sales_officer';         -- sales & coordination: orders, allocation proposals
alter type app_role add value if not exists 'dispatch_officer';      -- "Dispatch Team": vehicles, loading, delivery
alter type app_role add value if not exists 'procurement_officer';   -- PR / PO / vendors
