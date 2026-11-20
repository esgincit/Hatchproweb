// ERP Phase 5 tenant API (0051 api_key, 0052). Auth: header x-api-key = a key from create_api_key(); the key's scopes
// decide what it may do. verify_jwt is off (machines call this, not users). The service role bypasses RLS, so EVERY
// query below is filtered by the key's tenant_id explicitly.
//   POST /erp-api/readings   scope readings:write  body {readings:[{asset_id, read_at, temp_c?, wet_bulb_c?, rh_pct?, co2_ppm?, fan_rpm?, alarm?}]} (<=100)
//   GET  /erp-api/orders     scope orders:read     ?since=YYYY-MM-DD
//   GET  /erp-api/stock      scope stock:read      chick stock per setting
//   GET  /erp-api/trace      scope trace:read      ?dispatch_no=...
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => Response.json(body, { status });
const num = (v: unknown, lo: number, hi: number) => (v === undefined || v === null ? null : typeof v === "number" && v >= lo && v <= hi ? v : NaN);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const key = req.headers.get("x-api-key") ?? "";
  if (!/^[0-9a-f]{48}$/.test(key)) return json({ error: "missing or malformed x-api-key" }, 401);
  const { data: rows, error: kerr } = await admin.rpc("api_key_lookup", { p_key: key });
  const k = (rows ?? [])[0] as { tenant_id: string; scopes: string[] } | undefined;
  if (kerr || !k) return json({ error: "invalid key" }, 401);
  const { data: ten } = await admin.from("tenant").select("status").eq("id", k.tenant_id).maybeSingle();
  if (ten?.status === "suspended") return json({ error: "tenant suspended" }, 403);
  const can = (s: string) => k.scopes.includes(s);
  const route = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const q = new URL(req.url).searchParams;

  if (req.method === "POST" && route === "readings") {
    if (!can("readings:write")) return json({ error: "scope readings:write required" }, 403);
    const body = await req.json().catch(() => null) as { readings?: Record<string, unknown>[] } | null;
    const list = body?.readings;
    if (!Array.isArray(list) || list.length < 1 || list.length > 100) return json({ error: "send 1-100 readings" }, 400);
    const ids = [...new Set(list.map((r) => String(r.asset_id ?? "")))];
    if (ids.some((id) => !UUID.test(id))) return json({ error: "asset_id must be a uuid" }, 400);
    const { data: own } = await admin.from("asset").select("id").eq("tenant_id", k.tenant_id).in("id", ids);
    if ((own ?? []).length !== ids.length) return json({ error: "unknown machine" }, 400);
    const out = [];
    for (const r of list) {
      const at = Date.parse(String(r.read_at ?? ""));
      const v = { temp_c: num(r.temp_c, -20, 60), wet_bulb_c: num(r.wet_bulb_c, -20, 60), rh_pct: num(r.rh_pct, 0, 100), co2_ppm: num(r.co2_ppm, 0, 100000), fan_rpm: num(r.fan_rpm, 0, 100000) };
      if (Number.isNaN(at) || Object.values(v).some(Number.isNaN)) return json({ error: "bad reading", reading: r }, 400);
      out.push({ tenant_id: k.tenant_id, asset_id: r.asset_id, read_at: new Date(at).toISOString(), ...v, alarm: r.alarm === true, source: "sensor" });
    }
    // ponytail: one insert per reading so a gateway retry (same asset + time) skips duplicates; batch if volume demands
    let accepted = 0;
    for (const row of out) {
      const { error } = await admin.from("env_reading").insert(row);
      if (!error) accepted++;
      else if (!/duplicate key/.test(error.message)) return json({ error: error.message, accepted }, 400);
    }
    return json({ accepted, duplicates: out.length - accepted });
  }

  if (req.method === "GET" && route === "orders") {
    if (!can("orders:read")) return json({ error: "scope orders:read required" }, 403);
    const since = q.get("since") ?? "1970-01-01";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return json({ error: "since must be YYYY-MM-DD" }, 400);
    const { data, error } = await admin.from("sales_order")
      .select("order_no,status,payment_status,qty,hatch_date,price,created_at,customer(name),chick_product(name)")
      .eq("tenant_id", k.tenant_id).gte("created_at", since).order("created_at").limit(500);
    return error ? json({ error: error.message }, 500) : json({ orders: data });
  }

  if (req.method === "GET" && route === "stock") {
    if (!can("stock:read")) return json({ error: "scope stock:read required" }, 403);
    const { data, error } = await admin.from("chick_stock").select("code,hatched_on,saleable,allocated,available,quality_ok,vaccinated_all")
      .eq("tenant_id", k.tenant_id).order("hatched_on", { ascending: false }).limit(100);
    return error ? json({ error: error.message }, 500) : json({ stock: data });
  }

  if (req.method === "GET" && route === "trace") {
    if (!can("trace:read")) return json({ error: "scope trace:read required" }, 403);
    const no = q.get("dispatch_no") ?? "";
    if (!/^[A-Za-z0-9-]{3,40}$/.test(no)) return json({ error: "dispatch_no required" }, 400);
    const { data, error } = await admin.from("delivery_trace").select("*").eq("tenant_id", k.tenant_id).eq("dispatch_no", no);
    return error ? json({ error: error.message }, 500) : json({ trace: data });
  }

  return json({ error: "not found" }, 404);
});
