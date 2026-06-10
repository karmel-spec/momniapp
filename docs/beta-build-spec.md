# Momni 2.0 — Beta Build Spec (TestFlight v0.1)
*Provided by Karmel 2026-06-10. ONE AMENDMENT, approved by Karmel same day:
the Brand section below replaces the spec's original (which listed the older
Matriarch Modern palette). The app uses HERITAGE REFRESH, matching the
websites and CLAUDE.md.*

## Product one-liner
A community platform where moms find moms for childcare. Momni does not vet anyone — moms trust moms. Care payments happen mom-to-mom; Momni never touches care money.

## Stack
- **App:** React Native + Expo (managed workflow), TypeScript. EAS Build + EAS Submit for TestFlight/Play.
- **Backend:** Supabase (Postgres, Auth, Realtime, Storage).
- **Maps:** react-native-maps; city-level geocoding only for public pins.
- **AI:** MomniGPT concierge via Anthropic API, feature-flagged.
- **Payments (subscriptions only):** Apple IAP / RevenueCat for Circle Up, Link bundles, Momni+. **No care payments in-app — ever.**
- **Analytics/crash:** PostHog + Sentry.

## Brand (AMENDED — Heritage Refresh, approved 2026-06-10)
- Original elephant logo, unchanged (assets in /sites/momni.com/assets and Drive "Momni Logo Variants").
- Palette: Momni Purple #6D58A4 / deep #4A3880, Blue Chill teal #0D878F, teal-soft #E1F7F2, Algae Green #92E2C1 (CTAs), lavender #F5F0FE (surfaces), clay #D9C0A3 (legacy map dots ONLY), ink #2B2233.
- Type: Montserrat (display) + Albert Sans (body) + Caveat (script accents only).
- Language rule: never "herd" — use "the Circle," "the mamas," "the movement."
- Marketing language rule: never "vetted / verified / safe / screened by Momni."

## Beta scope (v0.1)

### 1. Auth & onboarding
- Email + Sign in with Apple (required) + Google.
- Onboarding: name, photo, city/neighborhood, kids' ages, "host / find care / both."
- **Clickwrap at signup** (separate, unavoidable checkbox): "I understand Momni does not screen or vet any member…" (exact text in Community Platform Language Kit).

### 2. Profiles
- Mama profile: bio, kids' ages, availability, hourly rate (she sets it), home highlights, photos.
- **"What this mama chose to share" panel:** self-obtained background check (PDF/date she uploads, displayed as her content with disclaimer line), ID-shared flag, Circles attended, reviews. No Momni badges.

### 3. Search & Movement Map
- Map + list, default to local radius. Filters: distance, availability, kids' ages, care type.
- Two-color national map: clay dots = anonymized city-level First Mamas of 1.0 (no names until claimed), teal pins = active 2.0 mamas, plum = Circles. "Claim your pin" flow for returning mamas; "Bring Momni to my city" waitlist pin.

### 4. Care requests (booking-lite)
- Five tiles: **Right Now** (broadcast to nearby available mamas, live count), **Date Night**, **My Regulars** (recurring), **Overnights** (chips: Night Shift / Weekend Getaway / Extended Trip), **Find a Daycare** (public-records directory link-out, neutral, no endorsement).
- A "booking" in beta = a confirmed connection (request → accept → chat thread with date/time). Payment line in UI: "Pay your Momni directly — Venmo, cash, her choice. She keeps every penny."
- **Clickwrap before each first connection** (second acknowledgment, per language kit).
- Rebook row: "Your Momnis" for one-tap repeat requests.

### 5. Messaging
- 1:1 chat per connection (Supabase Realtime). Photo sharing. Push notifications (Expo).

### 6. Circles
- Circle pages: location, schedule, leader, RSVP. Members can post. Leader tools minimal (create event, pin post).

### 7. Reviews
- Post-care mutual reviews (stars + text), displayed as community content with "opinions of members" footer.

### 8. UGC compliance (Apple Guideline 1.2 — required for approval)
- Report content/user (reason picker → flags to founder dashboard).
- Block user (hides both directions).
- Profanity/objectionable-content filter on posts and chat (basic word filter + report fallback).
- Published contact info + ToS/Privacy links in Settings.
- EULA acknowledgment of zero-tolerance for objectionable content.

### 9. Monetization (IAP via RevenueCat)
- Free: browse, Circles, 2 Links/mo.
- Circle Up: $11.99/yr (price tuned for Apple tiers; positioning "a dollar a month").
- Link bundles: 5/$4.99, 10/$9.99, 22/$19.99 (consumables).
- Momni+: $4.99/mo or $49.99/yr (unlimited Links, recurring tools, full MomniGPT).
- Momni Gives $1 toggle: route as external donation to Foundation (web checkout link, NOT IAP — Apple prohibits IAP for nonprofit donations by for-profit apps; confirm current rules at submission).

### 10. Founder dashboard (web, not in app)
- Needs-Karmel queue: reports, flags, claim-pin verifications. Simple Supabase admin or Retool-style page.

## Explicitly OUT of beta
In-app care payments, escrow, or take-rate (never). Momni-ordered background checks (never). Video meetups, check-in/out, multi-guest hosting (later). Android polish (build runs, but iOS TestFlight is the launch target). Web app parity (marketing site + claim-pin web flow only).

## Data & privacy notes
- Location: store precise coords privately; expose only neighborhood/city publicly.
- First Mamas import (KEAP export): city-level pins only, no names/emails surfaced; claimed accounts require fresh opt-in.
- App Privacy label inputs: location (coarse public/fine private), contacts NOT collected, photos user-provided, messages stored.
- Rotate all legacy credentials before any data import (old logins spreadsheet is compromised by age).

## Milestones
1. **Week 1–2:** repo, Supabase schema, auth + onboarding + clickwrap, profile CRUD.
2. **Week 3–4:** map/search, care request tiles + connection flow, chat, push.
3. **Week 5:** Circles, reviews, report/block, founder dashboard.
4. **Week 6:** IAP via RevenueCat, polish, App Privacy labels, screenshots/metadata, internal TestFlight.
5. **Week 7:** external TestFlight (public link = relaunch invitation), feedback loop.

## Definition of done for beta
A mama in Utah County can: claim her pin → complete her profile and share what she chooses → post a Right Now or Date Night request → connect and chat with a nearby mama → pay her directly → leave a review → join a Circle. Karmel can see and act on every report from one dashboard.
