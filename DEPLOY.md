# Momni 2.0 — Go-Live Runbook (app.momni.com on Render)

Work through this top to bottom. Each step says what you'll need, where to click,
and how to confirm it worked. Steps 1–3 get the app live; 4–7 turn on the
integrations one switch at a time (the app runs fine with them off — features
stay quietly inert until their keys exist).

**Never paste keys into chat, email, or git.** Keys go straight into the Render
dashboard (production) or `app/.env` (local only — it's gitignored).

---

## 1. Deploy to Render (~15 min)

1. Sign in at [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
2. Connect GitHub and pick the **karmel-spec/momniapp** repo. Render reads
   `render.yaml` and shows the service (`momni-app`, starter plan ~$7/mo,
   1 GB persistent disk for the database).
3. Render prompts for the `sync: false` environment variables. For this first
   deploy you only need ONE:
   - **ADMIN_BOOTSTRAP_PASSWORD** — invent a strong password (12+ chars).
     This creates your `karmel@momni.com` admin account on the fresh
     database at first boot. Leave every other prompted key **blank** for now.
4. Click **Apply**. First build takes a few minutes. The service is healthy when
   the deploy goes green (health check is `/index.html`).
5. Open the service URL Render gives you (something like
   `https://momni-app.onrender.com`) and **sign in** as `karmel@momni.com`
   with the bootstrap password.
6. **Immediately do these two things:**
   - In the app: **Me → Change password** → set your real password.
   - In Render: **Environment → delete ADMIN_BOOTSTRAP_PASSWORD** → Save.
     (It's a no-op once the account exists, but don't leave passwords in env vars.)

✅ **Confirm:** you can sign in, and `/admin.html` (Momni HQ) loads for you.

> Every `git push` to `main` now auto-deploys. Sessions survive deploys —
> nobody gets signed out by a release.

## 2. Point app.momni.com at Render (~10 min + DNS wait)

1. Render → momni-app service → **Settings → Custom Domains → Add** →
   `app.momni.com`.
2. Render shows a CNAME target. At your DNS provider for momni.com, add:
   `app` → CNAME → the target Render shows.
3. Wait for DNS + automatic TLS (minutes to an hour).

✅ **Confirm:** `https://app.momni.com` loads the app with a padlock.
`APP_URL` is already set to `https://app.momni.com` in render.yaml, so OAuth
callbacks and emailed links use the right address from day one.

## 3. Smoke-test the live app (~10 min)

- Register a fresh test account (use a real email you own) — should land on Home.
- Map loads with teal + clay pins; search works.
- Request a Link as the test account → confirm it as Karmel → both lifecycle
  states update.
- HQ (`/admin.html`): members list, email log, campaign card all render.

## 4. Stripe — turn on payments (~20 min)

The app sells: 10-Link bundle ($10), Momni+ annual ($49), Circle Up ($12/yr).
Prices are created inline by the code — **no product setup needed in Stripe.**
Reminder of the sacred rule: these are Momni's only charges; care payments stay
mom-to-mom and never touch the platform.

1. [dashboard.stripe.com](https://dashboard.stripe.com) → **Developers → API keys**
   → copy the **Secret key** (`sk_live_...`). (Use the test-mode `sk_test_...`
   first if you want a dry run.)
2. **Developers → Webhooks → Add endpoint**:
   - URL: `https://app.momni.com/api/stripe/webhook`
   - Events: select **`checkout.session.completed`** (the only event the app uses).
   - After creating it, copy the **Signing secret** (`whsec_...`).
3. Render → Environment → paste **STRIPE_SECRET_KEY** and
   **STRIPE_WEBHOOK_SECRET** → Save (Render redeploys).

⚠️ Set **both or neither** — the app deliberately refuses to boot with the
secret key but no webhook secret (that gap is how forged "payments" would get in).

✅ **Confirm:** buy a Link bundle with Stripe test card `4242 4242 4242 4242`
(in test mode), and your Links balance goes up by 10. Webhook deliveries show
**Succeeded** in the Stripe dashboard; retries are harmless (idempotent).

## 5. Resend — turn on email (~20 min + DNS wait)

Until this step, every email (welcome, booking, review requests, newsletters)
is logged in HQ's email log but not sent — by design.

1. [resend.com](https://resend.com) → sign in → **Domains → Add Domain** →
   `momni.com` → add the DKIM/SPF DNS records it shows → wait for **Verified**.
2. **API Keys → Create** → copy the `re_...` key.
3. Render → Environment:
   - **RESEND_API_KEY** = the key
   - **EMAIL_FROM** = `Momni <hello@momni.com>` (any address on the verified domain)

✅ **Confirm:** register a throwaway test account → the welcome email arrives
in a real inbox. HQ email log shows status `sent`.

## 6. Nylas — turn on calendar sync (~10 min)

The key already validates and the google/microsoft/imap connectors exist in
your Nylas app; the only missing piece is the callback registration.

1. [dashboard-v3.nylas.com](https://dashboard-v3.nylas.com) → your app →
   **Hosted Authentication → Callback URIs → Add**:
   `https://app.momni.com/auth/calendar/callback`
2. Render → Environment:
   - **NYLAS_API_KEY** = your `nyk_...` key (same one as in local `.env`)
   - **NYLAS_CLIENT_ID** = the client ID shown on the Nylas overview page

✅ **Confirm:** Me → "Sync your calendar" → Google consent → lands back on
Me showing connected; a host's busy times then show on her profile.

## 7. Optional: "Sign in with Google"

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services →
   Credentials → **Create OAuth client ID (Web application)**.
2. Authorized redirect URI: `https://app.momni.com/auth/google/callback`
3. Render → Environment: **GOOGLE_CLIENT_ID** + **GOOGLE_CLIENT_SECRET**.

Until set, the Google button politely no-ops — password sign-in is unaffected.

---

## Still outside this runbook

- **momni.com** → already on Netlify; point the apex domain when ready.
- **momnifoundation.org** → recover the hijacked domain at the registrar, then
  tell Claude to flip the interim Netlify Foundation links back to the real domain.
- **Legal** — attorney pass on Terms/Privacy, the booking clickwrap, and the
  background-check copy before wide launch.

## If something breaks

- Render → service → **Logs** shows boot errors in plain English (the app
  refuses to boot loudly rather than run half-secured: missing SESSION_SECRET,
  or Stripe key without webhook secret).
- Rollback = Render → Deploys → **Rollback** to the previous green deploy.
- The database lives on the persistent disk (`/var/data/momni.db`) and is
  untouched by deploys/rollbacks.
