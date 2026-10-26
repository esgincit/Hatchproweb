// Razorpay webhook: payment.captured → apply to the invoice/bill named in notes (ref_type, ref_id), exactly once.
// apply_gateway_payment (0026) locks the document, takes the tenant from it (never from notes) and ignores
// retries of a payment id it has already applied. Ad-plan payments (notes.ref_type = 'ad') go to
// apply_ad_payment (marketplace) the same way.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const secret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  const sig = Buffer.from(req.headers.get("x-razorpay-signature") ?? "", "utf8");
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"), "utf8");
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return new Response("bad signature", { status: 400 });

  const evt = JSON.parse(raw);
  if (evt.event !== "payment.captured") return Response.json({ ignored: evt.event });
  const p = evt.payload.payment.entity;
  const { ref_type, ref_id } = p.notes ?? {};
  const paidOn = new Date(p.created_at * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [fn, args] = ref_type === "ad"
    ? ["apply_ad_payment", { p_subscription: ref_id, p_amount: p.amount / 100, p_gateway_ref: p.id }]
    : ["apply_gateway_payment", { p_ref_type: ref_type, p_ref_id: ref_id, p_amount: p.amount / 100, p_mode: p.method === "upi" ? "upi" : "neft", p_paid_on: paidOn, p_gateway_ref: p.id }];
  const { data, error } = await admin.rpc(fn as string, args);
  if (error) return new Response(error.message, { status: 500 }); // Razorpay retries; the functions are idempotent
  return Response.json({ result: data });
});
