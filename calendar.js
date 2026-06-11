// app/calendar.js — host calendar sync (dev-safe, provider-pluggable; Google implemented)
//
// The feature mamas asked for: connect the calendar you ALREADY use, so your
// availability stays current without touching the app, and an accepted booking
// lands on your calendar automatically.
//
// Mirrors the Stripe/mailer dev-safe pattern: ENTIRELY INERT unless Google OAuth
// credentials are configured (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET). Without
// them, isEnabled() is false and every function no-ops gracefully — the app runs
// exactly as before.
//
// Provider note: this implements GOOGLE directly (reuses the existing Google
// OAuth client, $0). It's structured so a unified provider (e.g. Nylas, for
// Apple iCloud + Outlook) can be added behind the same interface later.
//
// Going live (Google): in Google Cloud Console add the calendar scopes and the
// redirect URI {APP_URL}/auth/google/calendar/callback, and complete Google's
// one-time OAuth verification (Calendar is a "sensitive" — not "restricted" —
// scope, so no paid security assessment).

const { db } = require('./db');

const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const REDIRECT = `${APP_URL}/auth/google/calendar/callback`;
const TZ = process.env.CALENDAR_TZ || 'America/Denver'; // Momni's home county; hosts can be anywhere
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events',   // create the booking on her calendar
  'https://www.googleapis.com/auth/calendar.freebusy', // read busy blocks for real-time availability
].join(' ');
const ENABLED = !!(GOOGLE_ID && GOOGLE_SECRET);
const now = () => Math.floor(Date.now() / 1000);

function isEnabled() { return ENABLED; }
function getConnection(userId) { return db.prepare('SELECT * FROM calendar_connections WHERE user_id = ?').get(userId); }
function isConnected(userId) { return !!getConnection(userId); }

function connectUrl(userId) {
  const params = new URLSearchParams({
    client_id: GOOGLE_ID, redirect_uri: REDIRECT, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', state: String(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function handleCallback(code, userId) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const t = await tokenRes.json();
  if (!t.access_token) return { ok: false, error: t.error_description || 'token exchange failed' };
  let email = null;
  try {
    const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    email = info.email || null;
  } catch (e) { /* email is best-effort */ }
  const expiry = now() + (t.expires_in || 3600) - 60;
  db.prepare(`INSERT INTO calendar_connections (user_id,provider,access_token,refresh_token,token_expiry,calendar_email,connected_at)
    VALUES (?,'google',?,?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, calendar_connections.refresh_token),
      token_expiry=excluded.token_expiry, calendar_email=excluded.calendar_email, connected_at=datetime('now')`)
    .run(userId, t.access_token, t.refresh_token || null, expiry, email);
  return { ok: true, email };
}

function disconnect(userId) { db.prepare('DELETE FROM calendar_connections WHERE user_id = ?').run(userId); }

// Return a non-expired access token, refreshing via refresh_token if needed.
async function validToken(conn) {
  if (conn.access_token && conn.token_expiry && conn.token_expiry > now()) return conn.access_token;
  if (!conn.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  });
  const t = await r.json();
  if (!t.access_token) return null;
  const expiry = now() + (t.expires_in || 3600) - 60;
  db.prepare('UPDATE calendar_connections SET access_token=?, token_expiry=? WHERE user_id=?').run(t.access_token, expiry, conn.user_id);
  return t.access_token;
}

// Busy intervals for a connected user between two ISO timestamps. Returns [{start,end}] or null.
// Only busy/free is ever returned — never event titles or details.
async function getBusy(userId, timeMin, timeMax) {
  if (!ENABLED) return null;
  const conn = getConnection(userId); if (!conn) return null;
  try {
    const token = await validToken(conn); if (!token) return null;
    const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: 'primary' }] }),
    });
    const d = await r.json();
    return (d.calendars && d.calendars.primary && d.calendars.primary.busy) || [];
  } catch (e) { return null; }
}

// Create an event on the user's primary calendar. Never throws — calendar problems
// must never break a booking. date=YYYY-MM-DD, times=HH:MM.
async function createEvent(userId, { summary, description, date, startTime, endTime, attendeeEmail }) {
  if (!ENABLED) return { ok: false, reason: 'disabled' };
  const conn = getConnection(userId); if (!conn) return { ok: false, reason: 'not-connected' };
  try {
    const token = await validToken(conn); if (!token) return { ok: false, reason: 'no-token' };
    const start = `${date}T${(startTime || '09:00')}:00`;
    const end = `${date}T${(endTime || startTime || '10:00')}:00`;
    const body = {
      summary: summary || 'Momni care',
      description: description || '',
      start: { dateTime: start, timeZone: TZ },
      end: { dateTime: end, timeZone: TZ },
    };
    if (attendeeEmail) body.attendees = [{ email: attendeeEmail }];
    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, reason: `google ${r.status}` };
    const ev = await r.json();
    return { ok: true, id: ev.id, htmlLink: ev.htmlLink };
  } catch (e) { return { ok: false, reason: String(e).slice(0, 120) }; }
}

module.exports = { isEnabled, isConnected, getConnection, connectUrl, handleCallback, disconnect, getBusy, createEvent, TZ };
