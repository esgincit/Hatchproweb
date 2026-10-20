export type Claims = { tenantId: string | null; roles: string[]; platform: boolean };

/** JWT app_metadata (set by provision-tenant / create_demo_users) → typed claims. RLS reads the same fields. */
export function claimsFromUser(user: { app_metadata?: Record<string, unknown> } | null): Claims {
  const m = user?.app_metadata ?? {};
  return {
    tenantId: typeof m.tenant_id === 'string' && m.tenant_id ? m.tenant_id : null,
    roles: Array.isArray(m.roles) ? m.roles.filter((r): r is string => typeof r === 'string') : [],
    platform: m.platform === true,
  };
}
