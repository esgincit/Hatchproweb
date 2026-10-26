// Vendor buys / renews a marketplace plan (0032). Opens a pending ad_subscription and a Razorpay order whose notes
// point razorpay-webhook at it (ref_type 'ad' → apply_ad_payment, which activates it once the payment is captured).
// Body: { plan_id }. Without RAZORPAY_KEY_ID/SECRET the order is still recorded and { configured: false } returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: adv } = await admin.from("advertiser").select("id,business_name,phone").eq("user_id", user.id).eq("status", "active").maybeSingle();
  if (!adv) return json({ error: "not_a_vendor" }, 403);
  const b = await req.json().catch(() => ({}));
  const { data: plan } = await admin.from("ad_plan").select("id,name,price_month").eq("id", String(b.plan_id ?? "")).eq("active", true).maybeSingle();
  if (!plan) return json({ error: "bad_plan" }, 400);

  const { data: sub, error } = await admin.from("ad_subscription").insert({ advertiser_id: adv.id, plan_id: plan.id, amount: plan.price_month }).select("id").single();
  if (error) return json({ error: "server" }, 500);
  const keyId = Deno.env.get("RAZORPAY_KEY_ID"), keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return json({ configured: false, subscription_id: sub.id });

  const r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST", headers: { Authorization: "Basic " + btoa(`${keyId}:${keySecret}`), "Content-Type": "application/json" },
    body: JSON.stringify({ amount: Math.round(Number(plan.price_month) * 100), currency: "INR", receipt: sub.id.slice(0, 40), notes: { ref_type: "ad", ref_id: sub.id } }),
  });
  if (!r.ok) return json({ error: "gateway" }, 502);
  const order = await r.json();
  await admin.from("ad_subscription").update({ gateway_order: order.id }).eq("id", sub.id);
  return json({ configured: true, subscription_id: sub.id, order_id: order.id, key_id: keyId, amount: order.amount, name: adv.business_name, phone: adv.phone, plan: plan.name });
});
