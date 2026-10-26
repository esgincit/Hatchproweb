// Platform marketing adds a marketplace advertiser (0032): creates the vendor's phone-OTP login (role 'vendor', no
// tenant) and its advertiser profile. Body: { business_name, phone, category, district?, state? }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const CATS = ["feed", "medicine", "vaccine", "equipment", "chicks", "transport", "services", "other"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await caller.auth.getUser();
  const meta = (user?.app_metadata ?? {}) as { platform?: boolean; roles?: string[] };
  if (!user || meta.platform !== true || !(meta.roles ?? []).some((r) => r === "platform_admin" || r === "platform_marketing")) return json({ error: "forbidden" }, 403);

  const b = await req.json().catch(() => ({}));
  const name = String(b.business_name ?? "").trim().slice(0, 120);
  const digits = String(b.phone ?? "").replace(/\D/g, "").slice(-10);
  if (name.length < 2 || !/^[6-9]\d{9}$/.test(digits) || !CATS.includes(b.category)) return json({ error: "invalid" }, 400);
  const phone = "+91" + digits;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: created, error } = await admin.auth.admin.createUser({
    phone, phone_confirm: true, user_metadata: { full_name: name }, app_metadata: { roles: ["vendor"], platform: false },
  });
  if (error || !created.user) return json({ error: error?.message?.includes("already") ? "phone_in_use" : "server" }, 400);
  const { error: aErr } = await admin.from("advertiser").insert({
    user_id: created.user.id, business_name: name, phone, category: b.category,
    district: b.district ? String(b.district).slice(0, 60) : null, state: b.state ? String(b.state).slice(0, 60) : null,
  });
  if (aErr) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: "server" }, 500); }
  await admin.from("audit_log").insert({ tenant_id: null, user_id: user.id, action: "vendor.invited", entity_type: "advertiser", entity_id: null, after: { name, phone } });
  return json({ ok: true });
});
