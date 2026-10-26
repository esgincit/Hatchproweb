// Public onboarding helper (0030): proves the applicant's mobile number and hands out document upload slots.
//   send       {phone, captcha}      → Turnstile check (anti SMS-pumping), ≤3 codes / 10 min per number, SMS via MSG91
//                                      → {check_id}
//   verify     {check_id, code}      → ≤5 attempts, 10-min expiry → {ok}
//   upload-url {check_id, name, type, size} → verified + unused check only; ≤5 files; jpeg/png/pdf ≤10 MB
//                                      → signed upload URL in documents/applications/<check_id>/
// Codes are stored only as SHA-256(check id + code). Test mode (local/QA only): APPLY_TEST_OTP + APPLY_TEST_PHONES.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const PHONE = /^\+91[6-9][0-9]{9}$/;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function captchaOk(token: string | undefined, ip: string | null) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) { console.warn("TURNSTILE_SECRET_KEY not set — captcha skipped (set it before launch)"); return true; }
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  return (await r.json()).success === true;
}

async function sms(phone: string, code: string) {
  const key = Deno.env.get("MSG91_AUTH_KEY"), template = Deno.env.get("MSG91_OTP_TEMPLATE_ID");
  if (!key || !template) return false;
  const r = await fetch("https://control.msg91.com/api/v5/flow", {
    method: "POST", headers: { authkey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ template_id: template, recipients: [{ mobiles: phone.replace("+", ""), otp: code }] }),
  });
  return r.ok;
}

async function liveCheck(id: string) {
  const { data: c } = await admin.from("apply_phone_check").select("id,verified_at,used_at").eq("id", id).maybeSingle();
  return c && c.verified_at && !c.used_at && Date.parse(c.verified_at) > Date.now() - 30 * 60_000 ? c : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const b = await req.json().catch(() => ({}));

  if (b.action === "send") {
    const phone = String(b.phone ?? "");
    if (!PHONE.test(phone)) return json({ error: "bad_phone" }, 400);
    if (!(await captchaOk(b.captcha, req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")))) return json({ error: "captcha" }, 400);
    const { count } = await admin.from("apply_phone_check").select("id", { count: "exact", head: true })
      .eq("phone", phone).gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
    if ((count ?? 0) >= 3) return json({ error: "too_many" }, 429);
    const test = Deno.env.get("APPLY_TEST_OTP"), testPhones = (Deno.env.get("APPLY_TEST_PHONES") ?? "").split(",").map((s) => s.trim());
    const isTest = !!test && testPhones.includes(phone);
    const code = isTest ? test! : String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const id = crypto.randomUUID();
    if (!isTest && !(await sms(phone, code))) return json({ error: "sms_not_configured" }, 503);
    const { error } = await admin.from("apply_phone_check").insert({ id, phone, code_hash: await sha(id + code), expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    if (error) return json({ error: "server" }, 500);
    return json({ check_id: id });
  }

  if (b.action === "verify") {
    const id = String(b.check_id ?? "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "expired" }, 400);
    const { data: hash } = await admin.rpc("apply_check_attempt", { p_id: id }); // atomic: counts the guess first (0030)
    if (!hash) return json({ error: "expired" }, 400);
    if ((await sha(id + String(b.code ?? ""))) !== hash) return json({ error: "wrong_code" }, 400);
    await admin.from("apply_phone_check").update({ verified_at: new Date().toISOString() }).eq("id", id).is("verified_at", null);
    return json({ ok: true });
  }

  if (b.action === "upload-url") {
    const c = await liveCheck(String(b.check_id ?? ""));
    if (!c) return json({ error: "not_verified" }, 400);
    const ext = TYPES[String(b.type ?? "")];
    if (!ext || !(Number(b.size) > 0 && Number(b.size) <= 10 * 1024 * 1024)) return json({ error: "bad_file" }, 400);
    const { data: list } = await admin.storage.from("documents").list(`applications/${c.id}`);
    if ((list?.length ?? 0) >= 5) return json({ error: "too_many_files" }, 400);
    const path = `applications/${c.id}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from("documents").createSignedUploadUrl(path);
    if (error) return json({ error: "server" }, 500);
    return json({ path, token: data.token });
  }

  return json({ error: "bad_action" }, 400);
});
