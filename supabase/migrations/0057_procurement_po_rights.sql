-- 0057: the procurement officer raises and approves POs (plan C1 RACI; po_threshold 0051/0053 already allow it),
-- but 0006's restrictive write policies on purchase_order / po_line predate the role, so every write was refused.
-- Delete stays with owner/manager/finance/store_keeper.
drop policy purchase_order_roles_ins on purchase_order;
drop policy purchase_order_roles_upd on purchase_order;
create policy purchase_order_roles_ins on purchase_order as restrictive for insert
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));
create policy purchase_order_roles_upd on purchase_order as restrictive for update
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'))
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));

drop policy po_line_roles on po_line;
create policy po_line_roles on po_line as restrictive for all
  using (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'))
  with check (auth_has_role('tenant_owner', 'farm_manager', 'finance', 'store_keeper', 'procurement_officer'));
