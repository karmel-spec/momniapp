// app/gmaildraft.js — create review-ready emails as DRAFTS in the support@momni.com
// Gmail mailbox, so Karmel reviews and hits Send from her own inbox.
//
// Why a service account (not per-user OAuth): momni.com is Google Workspace, so a
// service account with domain-wide delegation can write drafts into support@'s mailbox
// with NO refresh-token expiry and NO per-login dance. Inert (dev-safe) until creds are set.
//
// To enable (one-time, Karmel — see Docs/gmail-drafts-setup.md):
//   1. Google Cloud Console → create a service account → enable domain-wide delegation →
//      download its JSON key. Enable the Gmail API on the project.
//   2. Google Workspace Admin → Security → API controls → Domain-wide delegation →
//      add the service account's Client ID with scope:
//        https://www.googleapis.com/auth/gmail.compose
//   3. In Render, set:
//        GOOGLE_SA_CLIENT_EMAIL = the service account's email
//        GOOGLE_SA_PRIVATE_KEY  = the private_key from the JSON (keep the \n escapes)
//        GMAIL_DRAFT_USER       = support@momni.com   (the mailbox to draft into)
const crypto = require('crypto');

const SA_EMAIL = process.env.GOOGLE_SA_CLIENT_EMAIL;
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const DRAFT_USER = process.env.GMAIL_DRAFT_USER || 'support@momni.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Momni';
const SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

const ENABLED = !!(SA_EMAIL && SA_KEY);
function isEnabled() { return ENABLED; }

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint a Google access token by signing a JWT with the service-account key (impersonating DRAFT_USER).
async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: SA_EMAIL, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token',
    sub: DRAFT_USER, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = b64url(crypto.createSign('RSA-SHA256').update(signingInput).sign(SA_KEY));
  const assertion = `${signingInput}.${signature}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const t = await r.json();
  if (!t.access_token) throw new Error(t.error_description || t.error || 'gmail token failed');
  return t.access_token;
}

// Encode the recipient + subject + HTML into an RFC 2822 message for the Gmail draft.
function buildRaw({ to, subject, html }) {
  const enc = (s) => `=?UTF-8?B?${Buffer.from(String(s)).toString('base64')}?=`; // RFC 2047 for unicode subjects
  const lines = [
    `From: ${FROM_NAME} <${DRAFT_USER}>`,
    `To: ${to}`,
    `Subject: ${enc(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
  ];
  return b64url(lines.join('\r\n'));
}

// Create one draft in support@'s mailbox. Returns {ok, id} or {ok:false, error}. Never throws.
async function createDraft({ to, subject, html }) {
  if (!ENABLED) return { ok: false, error: 'gmail-drafts-not-configured' };
  try {
    const token = await getToken();
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(DRAFT_USER)}/drafts`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: buildRaw({ to, subject, html }) } }),
    });
    if (!r.ok) return { ok: false, error: `gmail ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const d = await r.json();
    return { ok: true, id: d.id };
  } catch (e) { return { ok: false, error: String(e).slice(0, 200) }; }
}

module.exports = { isEnabled, createDraft, DRAFT_USER };
