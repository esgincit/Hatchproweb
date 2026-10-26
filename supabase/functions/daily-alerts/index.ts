// Scheduled (cron, evening IST). For every active tenant: per-batch farm rules (_shared/alerts.ts: missing log,
// mortality spike, water/feed drop, heat stress, egg % / weight below standard), vaccinations due in 3 days or
// overdue, stock below reorder, bills due in 7 days, invoices overdue.
// Writes notification rows keyed per rule/entity/day (re-runs add nothing), Web Push for new critical alerts,
// and a WhatsApp summary of new alerts to the owner(s).
// Auth: x-cron-secret must equal CRON_SECRET (verify_jwt is off so the scheduler can call it); returns counts only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import webpush from "npm:web-push@3.6.7";
import { batchAlerts, type AlertBatch } from "../_shared/alerts.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const VAPID = { pub: Deno.env.get("VAPID_PUBLIC_KEY"), priv: Deno.env.get("VAPID_PRIVATE_KEY"), subject: Deno.env.get("VAPID_SUBJECT") ?? "mailto:alerts@hatchpro.in" };
if (VAPID.pub && VAPID.priv) webpush.setVapidDetails(VAPID.subject, VAPID.pub, VAPID.priv);

type Note = { key: string; severity: string; title: string; body: string; entity_type?: string; entity_id?: string };

async function whatsapp(to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN"), phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) return;
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
}

/** Browser push services only — mirrors the push_subscription.endpoint check (0023). */
function pushHost(endpoint: string) {
  try {
    const u = new URL(endpoint), h = u.hostname;
    return u.protocol === "https:" && !u.port && (h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" ||
      h === "push.apple.com" || h.endsWith(".push.apple.com") || h === "notify.windows.com" || h.endsWith(".notify.windows.com"));
  } catch { return false; }
}

/** Web Push to every subscribed device of the tenant; drops subscriptions the push service says are gone. */
async function push(tenantId: string, notes: { title: string; body: string }[]) {
  if (!VAPID.pub || !VAPID.priv || !notes.length) return 0;
  const [{ data: subs }, { data: members }] = await Promise.all([
    admin.from("push_subscription").select("id,user_id,endpoint,p256dh,auth").eq("tenant_id", tenantId),
    admin.from("user_role_assignment").select("user_id").eq("tenant_id", tenantId),
  ]);
  const current = new Set((members ?? []).map((m) => m.user_id));
  const payload = JSON.stringify(notes.length === 1
    ? { title: notes[0].title, body: notes[0].body, url: "/more/notifications" }
    : { title: `${notes.length} critical alerts`, body: notes.map((n) => n.title).join("\n"), url: "/more/notifications" });
  let sent = 0;
  for (const s of subs ?? []) {
    // never POST elsewhere (SSRF); people removed from the farm stop getting its alerts
    if (!pushHost(s.endpoint) || !current.has(s.user_id)) { await admin.from("push_subscription").delete().eq("id", s.id); continue; }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await admin.from("push_subscription").delete().eq("id", s.id);
    }
  }
  return sent;
}

async function tenantNotes(tenantId: string, today: string): Promise<Note[]> {
  const notes: Note[] = [];
  // per-batch farm rules
  const { data: batches } = await admin.from("batch").select("id,code,farm_type,placed_on,breed_id").eq("tenant_id", tenantId).neq("state", "closed");
  const ids = (batches ?? []).map((b) => b.id);
  if (ids.length) {
    const [{ data: logs }, { data: curves }] = await Promise.all([
      admin.from("daily_shed_log").select("batch_id,log_date,birds_opening,mortality,feed_kg,water_litres,temp_max_c,humidity_pct,avg_weight_g,egg_production(count)")
        .in("batch_id", ids).gte("log_date", addDays(today, -8)).lte("log_date", today).order("log_date"),
      admin.from("breed_standard_curve").select("breed_id,age_week,std_egg_pct,std_weight_g"),
    ]);
    const num = (x: unknown) => (x == null ? null : Number(x));
    for (const b of batches ?? []) {
      const ab: AlertBatch = {
        id: b.id, code: b.code, ft: b.farm_type, placed: b.placed_on,
        logs: (logs ?? []).filter((l) => l.batch_id === b.id).map((l) => ({
          date: l.log_date, birds: Number(l.birds_opening), mortality: Number(l.mortality), feed_kg: Number(l.feed_kg ?? 0), water: Number(l.water_litres ?? 0),
          eggs: ((l as { egg_production?: { count: number }[] }).egg_production ?? []).reduce((a, e) => a + Number(e.count), 0),
          avg_w: num(l.avg_weight_g), tmax: num(l.temp_max_c), rh: num(l.humidity_pct),
        })),
        curve: (curves ?? []).filter((c) => c.breed_id === b.breed_id).map((c) => ({ week: c.age_week, egg: num(c.std_egg_pct), weight: num(c.std_weight_g) })),
      };
      notes.push(...batchAlerts(ab, today));
    }
  }
  // vaccinations due in 3 days / overdue
  const { data: vacc } = await admin.from("vaccination_schedule").select("id,batch_id,due_date,vaccine_master(name)").eq("tenant_id", tenantId).is("done_on", null).lte("due_date", addDays(today, 3));
  for (const v of vacc ?? []) {
    const overdue = v.due_date < today;
    notes.push({ key: `vacc:${v.id}:${today}`, severity: overdue ? "critical" : "warning", title: `${overdue ? "Overdue" : "Due"}: ${(v as any).vaccine_master?.name}`, body: `Due ${v.due_date}.`, entity_type: "batch", entity_id: v.batch_id });
  }
  // stock below reorder
  const { data: stock } = await admin.from("v_stock_balance").select("item_id, qty, item(name, reorder_level, unit)").eq("tenant_id", tenantId);
  for (const s of stock ?? []) {
    const it = (s as any).item;
    if (it?.reorder_level != null && Number(s.qty) <= Number(it.reorder_level))
      notes.push({ key: `stock:${s.item_id}:${today}`, severity: "warning", title: `Stock below reorder: ${it.name}`, body: `${s.qty} ${it.unit} on hand, reorder level ${it.reorder_level}.` });
  }
  // money
  const { data: ap } = await admin.from("bill").select("total, paid").eq("tenant_id", tenantId).neq("status", "paid").lte("due_date", addDays(today, 7));
  const apDue = (ap ?? []).reduce((a, b) => a + Number(b.total) - Number(b.paid), 0);
  const { data: ar } = await admin.from("invoice").select("total, paid").eq("tenant_id", tenantId).neq("status", "paid").lt("due_date", today);
  const arOver = (ar ?? []).reduce((a, b) => a + Number(b.total) - Number(b.paid), 0);
  if (apDue) notes.push({ key: `ap:${today}`, severity: "info", title: `${inr(apDue)} payable in next 7 days`, body: `${ap!.length} bills.` });
  if (arOver) notes.push({ key: `ar:${today}`, severity: "warning", title: `${inr(arOver)} receivable overdue`, body: `${ar!.length} invoices. Send WhatsApp reminders?` });
  return notes;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("unauthorized", { status: 401 });
  const today = Deno.env.get("APP_TODAY") || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { data: tenants } = await admin.from("tenant").select("id,name").in("status", ["active", "trial"]);
  const out = { tenants: 0, alerts: 0, pushed: 0 };

  for (const t of tenants ?? []) {
    const notes = await tenantNotes(t.id, today);
    if (!notes.length) continue;
    // only rows actually inserted come back: a same-day re-run pushes/WhatsApps nothing
    const { data: fresh, error } = await admin.from("notification")
      .upsert(notes.map(({ key, ...n }) => ({ ...n, dedupe_key: key, tenant_id: t.id, kind: n.severity === "info" ? "info" : "alert" })), { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true })
      .select("severity,title,body");
    if (error) { console.error("notification insert", t.id, error.message); continue; }
    if (!fresh?.length) continue;
    out.tenants++; out.alerts += fresh.length;
    out.pushed += await push(t.id, fresh.filter((n) => n.severity === "critical"));

    const { data: owners } = await admin.from("user_role_assignment").select("app_user(phone)").eq("tenant_id", t.id).eq("role", "tenant_owner");
    const text = `HatchPro daily summary — ${t.name}\n` + fresh.slice(0, 6).map((n) => `• ${n.title}`).join("\n") + (fresh.length > 6 ? `\n…and ${fresh.length - 6} more in the app` : "");
    for (const o of owners ?? []) { const ph = (o as any).app_user?.phone?.replace(/\D/g, ""); if (ph) await whatsapp(ph, text); }
  }
  return Response.json(out);
});
