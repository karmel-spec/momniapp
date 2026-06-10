# Momni 2.0 — Public Beta Relaunch Checklist
*Updated 2026-06-10. Everything Claude can automate is DONE. The remaining
switches are account-gated (your identity, your money, your legal counsel) —
each is minutes of work.*

## ✅ DONE — built, tested, live
- momni.com marketing site (19 pages) — LIVE at momni-2.netlify.app, auto-deploys on push
- momnifoundation.org single-pager — LIVE at momnifoundation-878.netlify.app, auto-deploys
- Waitlist with Netlify Forms (roles, interests, first-mama flag) — LIVE and collecting
- Web app (app.momni.com): auth, Google sign-in code, map, Links + clickwrap record,
  reviews, reports, Stripe Checkout + webhook, founder dashboard (/admin.html),
  production hardening (no demo data in prod, secure cookies) — runs locally, repo ready for Render
- Mobile TestFlight beta: full Expo app (auth+clickwraps, onboarding, 5-tile home, movement
  map, connections, Realtime chat, Circles, reviews, report/block, profile) — TypeScript clean
- Supabase production backend: 17 tables w/ RLS privacy, 3 storage buckets w/ policies, seeded
- 3 GitHub repos (momni, momnifoundation, momniapp) with working push→deploy pipeline

## 🔑 YOUR SWITCHES (in order of impact)

### 1. Point the domains (≈10 min, GoDaddy)
- momni.com → move domain in Netlify from "momni2026" (empty site) to "momni-2" (the real one),
  then at GoDaddy either switch nameservers to Netlify DNS or add A 75.2.60.5 + CNAME www→momni-2.netlify.app
- momnifoundation.org → same dance onto the momnifoundation-878 site

### 2. Launch the web app on Render (≈10 min + $7/mo)
- render.com → New → Blueprint → connect karmel-spec/momniapp (reads render.yaml)
- Environment tab: set ADMIN_EMAILS=karmel@momni.com (you = HQ admin on first signup)
- Add custom domain app.momni.com (CNAME at GoDaddy)

### 3. Stripe (≈20 min, when ready to charge)
- dashboard.stripe.com → create account for Momni, Inc.
- Copy secret key → Render env STRIPE_SECRET_KEY
- Developers → Webhooks → add endpoint https://app.momni.com/api/stripe/webhook
  (event: checkout.session.completed) → copy signing secret → STRIPE_WEBHOOK_SECRET
- Until then the app runs free-grant dev mode — fine for friends-and-family beta, not public.

### 4. Google sign-in (≈10 min)
- console.cloud.google.com → OAuth client (Web) → redirect URI
  https://app.momni.com/auth/google/callback
- Render env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

### 5. TestFlight (the iOS beta — needs Apple)
- Apple Developer Program ($99/yr) at developer.apple.com
- Then Claude runs: eas build + eas submit from mobile/ (Expo EAS account is free)
- App Privacy labels and screenshots are spec'd in docs/beta-build-spec.md

### 6. The non-tech gates (before PUBLIC beta, not before friends-and-family)
- [ ] Attorney reviews Terms/Privacy + the two clickwrap texts (banners come off after)
- [ ] Investor/board conversation about the relaunch (brand belongs to Momni, Inc.)
- [ ] Rotate old "Momni Code Logins" passwords; reset the Supabase DB password and
      revoke the momni-claude access token (both were pasted in chat)
- [ ] Foundation: confirm 501(c)(3) status current before the Donate button goes real

## Definition of "100% public-ready"
All six switches flipped. Sequence that works: 1 → 2 (sites + app live on real domains,
friends-and-family beta starts immediately) → 4 → 3 (money on) → 5 (iOS) → 6 gates the
public announcement.
