// Owner invites staff / labour into their own tenant. They then log in with phone OTP (no self-signup).
// Body: { name, phone, role, language?, farm_id? }
// The service role bypasses RLS, so every rule the database would apply is checked here explicitly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STAFF_ROLES = ["farm_manager", "finance", "shed_supervisor", "labour", "veterinarian", "store_keeper", "auditor"];
const LANGS = ["en", "te", "hi", "ta", "kn"];
const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req) => {
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await caller.auth.getUser();
  const meta = (user?.app_metadata ?? {}) as { tenant_id?: string; roles?: string[] };
  if (!user || !meta.tenant_id || !(meta.roles ?? []).includes("tenant_owner")) return json({ error: "only the owner can invite people" }, 403);

  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const digits = String(b.phone ?? "").replace(/\D/g, "").slice(-10);
  const role = String(b.role ?? "");
  const language = LANGS.includes(b.language) ? b.language : "te";
  if (name.length < 2 || digits.length !== 10) return json({ error: "name and a 10-digit mobile number are required" }, 400);
  if (!STAFF_ROLES.includes(role)) return json({ error: "role not allowed" }, 400);
  const phone = "+91" + digits;
  const tenantId = meta.tenant_id;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // service role skips RLS, so repeat the 0017 suspension rule here
  const { data: ten } = await admin.from("tenant").select("status").eq("id", tenantId).maybeSingle();
  if (!ten || ten.status === "suspended") return json({ error: "account suspended" }, 403);
  if (b.farm_id) { // farm scope must belong to the inviter's tenant
    const { data: farm } = await admin.from("farm").select("id").eq("id", b.farm_id).eq("tenant_id", tenantId).maybeSingle();
    if (!farm) return json({ error: "farm not found" }, 400);
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    phone, phone_confirm: true, user_metadata: { full_name: name },
    app_metadata: { tenant_id: tenantId, roles: [role], platform: false },
  });
  if (error) return json({ error: /already/i.test(error.message) ? "this number already has an account" : error.message }, 409);
  const id = created.user!.id;

  const { error: pErr } = await admin.from("app_user").insert({ id, tenant_id: tenantId, full_name: name, phone, language });
  if (pErr) { await admin.auth.admin.deleteUser(id); return json({ error: pErr.message }, 400); }
  await admin.from("user_role_assignment").insert({
    tenant_id: tenantId, user_id: id, role, scope_type: b.farm_id ? "farm" : "tenant", scope_id: b.farm_id ?? null,
  });
  await admin.from("audit_log").insert({ tenant_id: tenantId, user_id: user.id, action: "user.invited", entity_type: "app_user", entity_id: id, after: { role, phone } });
  return json({ user_id: id, phone });
});
