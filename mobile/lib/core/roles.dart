import 'package:supabase_flutter/supabase_flutter.dart';

/// Roles from the JWT app_metadata (same claim the web app and RLS read). UI gating only: RLS is the real guard.
List<String> currentRoles() =>
    ((Supabase.instance.client.auth.currentUser?.appMetadata['roles'] as List?) ?? const []).cast<String>();

bool hasAnyRole(Iterable<String> allowed) => currentRoles().any(allowed.toSet().contains);

// Mirrors the DB policies: 0039 (egg collection), 0041 (candling), 0042 (hatch), 0045 (dispatch).
const eggRoles = ['tenant_owner', 'farm_manager', 'shed_supervisor'];
const candlingRoles = ['tenant_owner', 'farm_manager', 'shed_supervisor', 'hatchery_technician', 'hatchery_ops_manager'];
const hatchRoles = [...candlingRoles, 'hatchery_manager'];
const deliveryRoles = ['tenant_owner', 'dispatch_officer', 'hatchery_ops_manager'];
