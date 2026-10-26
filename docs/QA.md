# HatchPro — QA environment setup

`main` holds the web app (`apps/web`, Next.js 15), the Supabase schema (`supabase/migrations` 0001–0020), edge
functions (`supabase/functions`) and demo seed data. Nothing deploys automatically: the database workflow is manual.

## 1. Supabase QA project (owner of the Supabase account)
1. Create a project (region Mumbai `ap-south-1`) for QA — keep it separate from production.
2. GitHub → repo **Settings → Environments → New environment `qa`**, add secrets:
   - `SUPABASE_PROJECT_REF` — the project ref (from the project URL)
   - `SUPABASE_ACCESS_TOKEN` — Supabase account → Access Tokens
   - `SUPABASE_DB_PASSWORD` — the database password
3. GitHub → **Actions → "Supabase migrate (manual)" → Run workflow → environment `qa`**. It applies every migration
   and deploys the functions. (CLI alternative: `npx supabase@2 link --project-ref <ref>`, `npx supabase@2 db push`,
   `npx supabase@2 functions deploy`.)
4. Optional function secrets (features stay off without them):
   `npx supabase@2 secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_ID=… ANTHROPIC_API_KEY=… RAZORPAY_WEBHOOK_SECRET=…`
   **Alerts (required for daily alerts + push):** generate push keys once with `npx web-push@3.6.7 generate-vapid-keys`, then
   `npx supabase@2 secrets set CRON_SECRET=<long random> VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<team email>`
   (QA with the demo seed also: `APP_TODAY=2026-10-19`). Without `CRON_SECRET` the function refuses every call.
   **Applications (/apply):** `npx supabase@2 secrets set TURNSTILE_SECRET_KEY=<Cloudflare Turnstile secret> MSG91_AUTH_KEY=… MSG91_OTP_TEMPLATE_ID=…`
   (web host: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`). QA without SMS: `APPLY_TEST_OTP=123456 APPLY_TEST_PHONES=+91…,+91…` makes those
   numbers accept the fixed code — **never set these in production**. Without MSG91 keys other numbers get "SMS not set up".
   **Marketplace payments:** `npx supabase@2 secrets set RAZORPAY_KEY_ID=… RAZORPAY_KEY_SECRET=… RAZORPAY_WEBHOOK_SECRET=…` and in the
   Razorpay dashboard add the webhook `https://<ref>.supabase.co/functions/v1/razorpay-webhook` (event `payment.captured`).
   Without keys vendors see "online payment is not set up" and nothing is charged.
   Schedule it (Database → Extensions: enable `pg_cron` and `pg_net`; then SQL editor — 13:30 UTC = 7 PM IST):
   ```sql
   select cron.schedule('daily-alerts', '30 13 * * *', $$
     select net.http_post(url := 'https://<ref>.supabase.co/functions/v1/daily-alerts',
                          headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')) $$);
   ```
5. **Authentication** settings:
   - Providers → **Phone**: on, with an SMS provider (MSG91 / Twilio …).
   - **Test phone numbers** (same screen) so QA can log in without SMS, e.g. `919849012345` → `123456`
     (full list in `supabase/config.toml` under `[auth.sms.test_otp]`).
   - Turn **off** "Allow new users to sign up" — accounts are created by approval / invite only.
   - URL Configuration → Site URL + Redirect URLs = the QA web address.

### Demo data (QA only, optional)
- SQL editor → run `supabase/seed.sql` (two demo tenants: VKR Poultry Farms, KS Farms).
- Create their logins: `SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> deno run -A scripts/create_demo_users.ts`
- The seed is dated around 2026-10-19; set `APP_TODAY=2026-10-19` on the QA web host so dashboards look current.

## 2. Web app (Vercel or any Node 20+ host)
- Root directory `apps/web`, install `pnpm install`, build `pnpm build`, start `pnpm start`.
- Environment variables (see `apps/web/.env.example`):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the QA project's URL + anon key
  - `APP_TODAY` — only if using the demo seed data
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the same public key as the function's `VAPID_PUBLIC_KEY` (push alerts)
  - Never set the service-role key on the web host.

## 3. Smoke test checklist
| Area | Check |
|---|---|
| Login | Farm login with a test number + OTP; platform login (`919000000000`) lands on /admin |
| Onboarding | /apply → approve in admin → new owner logs in with farms/sheds pre-created |
| Farm 3D | Farm screen shows the 3D farm; tap a shed → panel with expected vs actual; Inside / Top views; Live time |
| Daily work | Daily log, mortality, vaccination, vet visit; the 3D panel updates within seconds |
| Money | Sale, bill, payment; payment over ₹50,000 by finance waits for owner approval; Tally / GSTR exports |
| Reminders | Money → Receivables → WhatsApp reminders → Send opens WhatsApp with the message; row shows "Reminded today" |
| Reports | More → Reports → Generate (daily / weekly / vaccination / mortality) → print dialog → Save as PDF |
| Payroll | More → People → Wages → Bank details for a worker → Download salary bank file (CSV has the account) |
| Hatchery | KS Farms owner (`919440012121`) → hatchery view → batch KS-H-2026-37 → Candling → Hatch results → Dispatch chicks; card shows fertility / hatchability / hatch of fertile; too many chicks is refused |
| Marketplace | Platform console → + Advertiser → vendor logs in at /login → /vendor: add listing, pay plan → console approves → farmer More → Marketplace → Contact → vendor sees the enquiry |
| Contract farming | KS owner → More → Customers → + Contract (SKR Integrators) → broiler batch → Link to a contract → card shows estimate → Settle with integrator → growing-charge invoice in Money |
| Labour / offline | Log tab → "Simple shift entry" → +/- per shift adds to the day; turn on airplane mode, save → "saved on this phone" → back online → syncs |
| Alerts | Run daily-alerts (curl with `x-cron-secret`) → new alerts pop up in the open app; a second run adds none |
| Push (by hand, real phone) | Android Chrome: More → Notifications → Turn on → allow; run daily-alerts with a critical alert (e.g. log mortality spike) → phone shows it. iPhone: Add to Home Screen first |
| Roles | Supervisor has no Money tab; finance can't approve big payments |
| Languages | Switch en / te / hi / ta / kn |

## Known limits in this build
- 3D needs hardware graphics; machines without it show "3D view isn't available on this device".
- WhatsApp reminders use click-to-chat links; automatic sending needs a WhatsApp Business API token + approved template.
- Reports are generated on demand; scheduled sending (WhatsApp 7 PM / Monday) needs the WhatsApp Business API.
- Salary bank file is a generic NEFT sheet; map columns to your bank's upload template if it differs.
- Alert thresholds are defaults (heat stress THI ≥ 78 warns — fires often in hot, humid weeks); per-farm tuning comes later.
