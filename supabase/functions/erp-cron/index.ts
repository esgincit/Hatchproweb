// ERP scheduled jobs (every 15-30 min). Auth: x-cron-secret = CRON_SECRET (verify_jwt off, like daily-alerts).
//  1. expire_reservations()   temporary chick reservations past their window (0043)
//  2. machine_silence_check() machines in use with no reading for 2x the interval (0041)
//  3. pm_due_alerts()          preventive maintenance due (0050, once a day per schedule)
//  4. webhook delivery         webhook_outbox -> tenant URLs, HMAC-SHA256 signed, retried with backoff (0052)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { resolvesPublic, safeWebhookUrl } from "./url.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (body: unknown, status = 200) => Response.json(body, { status });

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deliverWebhooks() {
  const { data: due } = await admin.from("webhook_outbox").select("id,tenant_id,event,payload,attempts")
    .is("delivered_at", null).lte("next_attempt_at", new Date().toISOString()).lt("attempts", 8).order("id").limit(100);
  let sent = 0, failed = 0;
  for (const m of due ?? []) {
    const { data: subs } = await admin.from("webhook_subscription").select("url,secret,events").eq("tenant_id", m.tenant_id).eq("active", true);
    const targets = (subs ?? []).filter((s) => s.events.includes(m.event));
    const body = JSON.stringify({ id: m.id, event: m.event, data: m.payload });
    let err: string | null = null;
    for (const s of targets) {
      if (!safeWebhookUrl(s.url) || !await resolvesPublic(new URL(s.url).hostname)) { err = "url not allowed"; continue; }
      try {
        const r = await fetch(s.url, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
          headers: { "Content-Type": "application/json", "X-HatchPro-Event": m.event, "X-HatchPro-Signature": "sha256=" + await sign(s.secret, body) },
          body,
        });
        if (r.status < 200 || r.status >= 300) err = `HTTP ${r.status}`;
      } catch (e) { err = String(e).slice(0, 200); }
    }
    const attempts = m.attempts + 1;
    await admin.from("webhook_outbox").update(err
      ? { attempts, last_error: err, next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString() }
      : { attempts, delivered_at: new Date().toISOString(), last_error: null }).eq("id", m.id);
    if (err) failed++; else sent++;
  }
  return { sent, failed };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  const [exp, silent, pm] = await Promise.all([
    admin.rpc("expire_reservations"), admin.rpc("machine_silence_check"), admin.rpc("pm_due_alerts"),
  ]);
  const errors = [exp.error, silent.error, pm.error].filter(Boolean).map((e) => e!.message);
  const webhooks = await deliverWebhooks();
  return json({ expired: exp.data, silent_machines: silent.data, pm_alerts: pm.data, webhooks, errors }, errors.length ? 500 : 200);
});
