> **ARCHIVED 2026-09-17.** This predates the app going live and contains instructions that no longer work (e.g. "register as karmel@momni.com" — that address is blocked from self-registration by design). The current runbook is `DEPLOY.md` at the repo root.

# Momni 2.0 — Beta Go-Live Runbook
*The build is done and verified. These are the only 3 steps left — each needs a login only Karmel has. ~45 min total.*

## ✅ Verified working (no action needed)
- momni.com + momnifoundation.org: live, all links/images resolve, purple header, chat, map (17K pins), blog, SEO, forms collecting, language picker, beta-feedback button.
- Web app: every page serves; register (age + clickwrap gated), sign-in, Google sign-in, send-a-Link (clickwrap enforced — unacknowledged requests are blocked), messaging, two-way reviews, Links economy, in-app feedback → Founder HQ approval queue. All tested end-to-end.
- Founder HQ (/admin.html): reports, member directory, password reset, suggestions approval queue — all working.
- Email routing (MX + SPF) fixed on momni.com.

---

## STEP 1 — Take the web app live on Render (~15 min, ~$7/mo)
Right now the app only runs on localhost. This puts it at app.momni.com.
1. Go to **render.com** → sign up (use karmel@momni.com).
2. **New → Blueprint** → connect GitHub repo **karmel-spec/momniapp**. It auto-reads `app/render.yaml`.
3. In the service **Environment** tab, set:
   - `ADMIN_EMAILS = karmel@momni.com`  (makes your first signup the HQ admin)
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (from the app's local `.env` — same values already working locally)
   - Leave `STRIPE_*` unset for now → app runs in free-grant dev mode (fine for beta; add Stripe keys when you want real charges).
4. Deploy. When green, **Settings → Custom Domain → add `app.momni.com`** and follow the CNAME prompt.
5. Add the DNS record: I can do this in Netlify DNS the moment you tell me Render gave you the CNAME target (it'll look like `momni-app.onrender.com`).
6. Register fresh at app.momni.com with karmel@momni.com + a STRONG password (the local one was a test placeholder).

## STEP 2 — Rescue momnifoundation.org from the hijacker (~15 min)
The domain's DNS is controlled by an old Cloudflare account now serving gambling spam.
1. **Dashlane:** find the **Cloudflare** entry (login support@momni.com — the password is in Dashlane; the previous one was compromised and must be rotated).
2. Sign in at **dash.cloudflare.com** → select momnifoundation.org → **DNS**.
3. Either: delete the spam A/CNAME records and point to Netlify, OR (cleaner) at the registrar (GoDaddy — it IS registered there, likely a different GoDaddy account; call 480-505-8877 with the Foundation EIN letter from Drive if you can't find the login) change nameservers to:
   `dns1.p05.nsone.net` · `dns2.p05.nsone.net` · `dns3.p05.nsone.net` · `dns4.p05.nsone.net`
4. **Immediately** change that Cloudflare password + turn on 2FA (it's compromised).
5. Tell me when nameservers are switched — I'll watch propagation and confirm the real Foundation site is live.

## STEP 3 — Upgrade the map to precise pins (optional, ~10 min)
The map shows 17,011 real anonymous pins now (state/zip level). Exact host locations live in an encrypted backup.
1. **Reconnect Gmail** (Claude → Settings → Connectors → Gmail → sign in as karmel@momni.com) so I can search all inboxes for the backup passphrase, OR
2. **Dashlane:** search `momni backup`, `passphrase`, `secured`, or check the **Notes** field of the Bluehost / BitBucket entries for an encryption key (a random string, not a login).
3. Paste me any passphrase you find → I decrypt `MOMNI-2022-12-01.secured.tar.gz` → if it holds the MySQL dump, the map upgrades from ~17K anonymized to every host's real (still-anonymized-on-display) location.

---

## The gates before PUBLIC launch (beyond tech)
- [ ] Attorney reviews Terms/Privacy + the two clickwrap texts (draft banners come off after).
- [ ] Confirm Momni Foundation 501(c)(3) status is current (apps.irs.gov/app/eos) before the Donate button takes real money.
- [ ] Rotate every credential in the old "Momni Code Logins" sheet + the Supabase password/token (both exposed in chat during the build).
- [ ] Set up a real donation processor (Givebutter/Zeffy) for the Foundation with its own EIN + bank.
- [ ] Wire Stripe keys in Render when ready to charge for Circle Up / Links / Momni+.

**When Steps 1–2 are done, you have a live friends-and-family beta this week.** Steps 3 and the gates take it to fully public.
