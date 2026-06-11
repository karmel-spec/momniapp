# Sign in with Momni — integration kit for the Momni Boards

Momni is the identity provider for every app in the Boards family (ChoreBoard,
Motherboard, GrandBoard, …). A member taps **Sign in with Momni**, approves once,
and the app learns who she is and her Circle membership tier — which is how the
$1/mo member pricing and the Momni+ "every Board included" bundle get applied.

## The button

Drop-in HTML/CSS (Heritage Refresh, matches every Momni surface):

```html
<a class="momni-signin" href="https://app.momni.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&response_type=code&scope=profile&state=RANDOM_STATE">
  <svg class="momni-signin-mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="#92E2C1"/>
    <text x="12" y="16.5" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="13" font-weight="800" fill="#0B4A36">m</text>
  </svg>
  Sign in with Momni
</a>

<style>
.momni-signin{display:inline-flex;align-items:center;gap:10px;background:#6D58A4;color:#fff;
  font-family:'Albert Sans','Montserrat',sans-serif;font-size:15px;font-weight:600;
  padding:12px 22px;border-radius:100px;text-decoration:none;line-height:1}
.momni-signin:hover{background:#4A3880}
</style>
```

(The circled-m mark is a placeholder — the approved elephant icon asset can be
used as-is per the logo rules: never recolored beyond approved versions, never
stretched or redrawn.)

## Public vs confidential clients

Choose the right type when you register — it's enforced server-side, not by what
your request sends:

- **Public** (the mobile Boards, single-page apps): holds **no secret** (a binary
  can't keep one). **PKCE with S256 is mandatory** — an authorize request without
  a `code_challenge` is rejected, so the flow can't be downgraded out of PKCE.
- **Confidential** (server-side apps that can keep a secret): authenticates the
  token request with a **client secret**. PKCE is still welcome on top.

## The flow (OAuth 2.0 authorization code)

1. **Register the app** in Momni HQ (`/admin.html` → "Sign in with Momni —
   connected apps"), choosing Public or Confidential. You get a `client_id`;
   confidential clients also get a `client_secret`, shown once. Register every
   redirect URI exactly (https, `http://localhost` for dev, or a custom scheme
   like `choreboard://callback` for mobile). `javascript:`/`data:` schemes are
   rejected.

2. **Send the member to authorize:**
   ```
   GET https://app.momni.com/oauth/authorize
       ?client_id=momni_xxxx
       &redirect_uri=https://choreboard.app/auth/momni/callback
       &response_type=code
       &scope=profile
       &state=<random, verified on return>
   ```
   Public clients **must** add PKCE: `&code_challenge=<base64url(sha256(verifier))>&code_challenge_method=S256`
   (then send `code_verifier` in step 3). She signs in if needed, sees exactly
   what the app will know (name, email, membership level — nothing else), and
   taps to approve. **Every connection requires a tap** — there is no silent
   auto-approve, even for apps she's connected before. Momni then redirects to
   your `redirect_uri` with `?code=…&state=…` (always echo and verify `state`).
   Protocol errors (bad `scope`, `response_type`, or PKCE) come back to your
   `redirect_uri` as `?error=invalid_scope|unsupported_response_type|invalid_request&state=…`;
   if she declines, `?error=access_denied&state=…`.

3. **Exchange the code within 10 minutes** (`Content-Type: application/x-www-form-urlencoded`):
   ```
   POST https://app.momni.com/oauth/token

   grant_type=authorization_code&code=…&redirect_uri=…&client_id=…
   &code_verifier=…            (public clients — PKCE)
   ```
   Confidential clients authenticate with the secret, either as an HTTP Basic
   header `Authorization: Basic base64(client_id:client_secret)` (client_secret_basic)
   or as `&client_secret=…` in the body.
   → `{ "access_token": "…", "token_type": "Bearer", "expires_in": 2592000, "scope": "profile" }`
   (sent with `Cache-Control: no-store`). Codes are single-use; tokens last 30 days.

4. **Fetch the member:**
   ```
   GET https://app.momni.com/oauth/userinfo
   Authorization: Bearer <access_token>
   ```
   → `{ "sub": "42", "name": "Sarah", "email": "sarah@…", "tier": "circle_up", "member_since": "2026-06-11 …" }`
   A 401 carries a `WWW-Authenticate: Bearer` header — key your re-auth off it.

## Tier semantics (pricing rules, per Karmel's decisions)

| `tier` | Who | What the app charges |
|---|---|---|
| `momni_plus` | Momni+ member | **Included** — every Board is part of Momni+ |
| `circle_up` | Circle Up member ($1/mo) | **$1/mo or $10/yr** member pricing |
| `free` | Has a Momni account, no membership | App Store price ($3.99–$7.99/mo) |

Member-priced subscriptions are billed through the member's Momni account on the
web (Stripe), never through in-app purchase — non-members subscribe in-app at
the store price. The Momni Gives $1 toggle applies across app subscriptions too.

## What Momni never shares

Location, kids' details, Links, bookings, messages — none of it crosses the
OAuth boundary. `scope=profile` is the only scope, and it carries exactly four
fields: id, name, email, tier (+ member_since).
