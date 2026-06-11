// app/calendar.js — host calendar sync (provider-pluggable; dev-safe)
//
// A host connects the calendar she ALREADY uses, so her availability stays current
// without touching the app, and a confirmed booking lands on her calendar.
//
// Two providers behind one interface, chosen by env at startup:
//   - NYLAS  (preferred): set NYLAS_API_KEY + NYLAS_CLIENT_ID. Covers Google +
//     Microsoft + Apple iCloud through Nylas v3 (hosted auth → grant → calendar API).
//   - GOOGLE (fallback): set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Google only.
//   - Neither set → ENABLED is false, every function no-ops, the app runs as before.
//
// Going live (Nylas): in the Nylas dashboard add a Google/Microsoft/iCloud connector
// and register the callback URI {APP_URL}/auth/calendar/callback. Put NYLAS_API_KEY,
// NYLAS_CLIENT_ID, and NYLAS_API_URI (region) in the app .env.

const { db } = require('./db');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const TZ = process.env.CALENDAR_TZ || 'America/Denver';
const REDIRECT = `${APP_URL}/auth/calendar/callback`;

// Nylas v3
const NYLAS_KEY = process.env.NYLAS_API_KEY;
const NYLAS_CLIENT = process.env.NYLAS_CLIENT_ID;
const NYLAS_BASE = (process.env.NYLAS_API_URI || 'https://api.us.nylas.com').replace(/\/+$/, '');

// Google direct
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_SCOPES = ['openid', 'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'].join(' ');

const PROVIDER = (NYLAS_KEY && NYLAS_CLIENT) ? 'nylas' : ((GOOGLE_ID && GOOGLE_SECRET) ? 'google' : null);
const ENABLED = !!PROVIDER;
const now = () => Math.floor(Date.now() / 1000);

function isEnabled() { return ENABLED; }
function provider() { return PROVIDER; }
function getConnection(userId) { return db.prepare('SELECT * FROM calendar_connections WHERE user_id = ?').get(userId); }
function isConnected(userId) { return !!getConnection(userId); }
function disconnect(userId) { db.prepare('DELETE FROM calendar_connections WHERE user_id = ?').run(userId); }

// Wall-clock time in an IANA tz -> unix seconds. DST-correct, no dependencies (Intl offset trick).
function zonedUnix(dateStr, timeStr, tz) {
  const [Y, M, D] = String(dateStr).split('-').map(Number);
  const [h, m] = String(timeStr || '09:00').split(':').map(Number);
  const utcGuess = Date.UTC(Y, (M || 1) - 1, D || 1, h || 0, m || 0);
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(utcGuess)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +(p.second || 0));
  return Math.floor((utcGuess - (asTz - utcGuess)) / 1000);
}

function upsert(userId, f) {
  db.prepare(`INSERT INTO calendar_connections (user_id,provider,access_token,refresh_token,token_expiry,grant_id,calendar_id,calendar_email,connected_at)
    VALUES (?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, access_token=excluded.access_token,
      refresh_token=COALESCE(excluded.refresh_token, calendar_connections.refresh_token), token_expiry=excluded.token_expiry,
      grant_id=excluded.grant_id, calendar_id=excluded.calendar_id, calendar_email=excluded.calendar_email, connected_at=datetime('now')`)
    .run(userId, f.provider, f.access_token || null, f.refresh_token || null, f.token_expiry || null, f.grant_id || null, f.calendar_id || null, f.calendar_email || null);
}

// ---- connect URL (begin OAuth) ----
function connectUrl(userId) {
  if (PROVIDER === 'nylas') {
    const params = new URLSearchParams({ client_id: NYLAS_CLIENT, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', state: String(userId) });
    return `${NYLAS_BASE}/v3/connect/auth?${params}`;
  }
  if (PROVIDER === 'google') {
    const params = new URLSearchParams({ client_id: GOOGLE_ID, redirect_uri: REDIRECT, response_type: 'code', scope: GOOGLE_SCOPES, access_type: 'offline', prompt: 'consent', state: String(userId) });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  return null;
}

// ---- handle OAuth callback (code -> stored connection) ----
async function handleCallback(code, userId) {
  if (PROVIDER === 'nylas') return nylasExchange(code, userId);
  if (PROVIDER === 'google') return googleExchange(code, userId);
  return { ok: false, error: 'disabled' };
}

async function nylasExchange(code, userId) {
  const r = await fetch(`${NYLAS_BASE}/v3/connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: NYLAS_CLIENT, client_secret: NYLAS_KEY, grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: 'nylas' }),
  });
  const t = await r.json();
  if (!t.grant_id) return { ok: false, error: t.error_description || t.error || 'grant exchange failed' };
  const email = t.email || null;
  // Find her primary calendar id for event creation; fall back to the connected email.
  let calId = email;
  try {
    const cr = await fetch(`${NYLAS_BASE}/v3/grants/${t.grant_id}/calendars`, { headers: { Authorization: `Bearer ${NYLAS_KEY}`, Accept: 'application/json' } });
    const cd = await cr.json();
    const cals = cd.data || [];
    const primary = cals.find(c => c.is_primary) || cals[0];
    if (primary && primary.id) calId = primary.id;
  } catch (e) { /* fall back to email */ }
  upsert(userId, { provider: 'nylas', grant_id: t.grant_id, calendar_id: calId, calendar_email: email });
  return { ok: true, email };
}

async function googleExchange(code, userId) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const t = await r.json();
  if (!t.access_token) return { ok: false, error: t.error_description || 'token exchange failed' };
  let email = null;
  try {
    const info = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
    email = info.email || null;
  } catch (e) { /* best-effort */ }
  upsert(userId, { provider: 'google', access_token: t.access_token, refresh_token: t.refresh_token || null, token_expiry: now() + (t.expires_in || 3600) - 60, calendar_email: email, calendar_id: 'primary' });
  return { ok: true, email };
}

async function googleToken(conn) {
  if (conn.access_token && conn.token_expiry && conn.token_expiry > now()) return conn.access_token;
  if (!conn.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, grant_type: 'refresh_token', refresh_token: conn.refresh_token }),
  });
  const t = await r.json();
  if (!t.access_token) return null;
  db.prepare('UPDATE calendar_connections SET access_token=?, token_expiry=? WHERE user_id=?').run(t.access_token, now() + (t.expires_in || 3600) - 60, conn.user_id);
  return t.access_token;
}

// ---- free/busy: busy blocks between two ISO timestamps -> [{start,end}] ISO, or null ----
async function getBusy(userId, timeMinISO, timeMaxISO) {
  if (!ENABLED) return null;
  const conn = getConnection(userId); if (!conn) return null;
  try {
    if (conn.provider === 'nylas') {
      const start = Math.floor(Date.parse(timeMinISO) / 1000), end = Math.floor(Date.parse(timeMaxISO) / 1000);
      const r = await fetch(`${NYLAS_BASE}/v3/grants/${conn.grant_id}/calendars/free-busy`, {
        method: 'POST', headers: { Authorization: `Bearer ${NYLAS_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ start_time: start, end_time: end, emails: [conn.calendar_email] }),
      });
      const d = await r.json();
      const entry = (d.data && d.data[0]) || {};
      const slots = entry.time_slots || entry.busy || [];
      return slots.map(s => ({ start: new Date((s.start_time || s.start) * 1000).toISOString(), end: new Date((s.end_time || s.end) * 1000).toISOString() }));
    }
    if (conn.provider === 'google') {
      const token = await googleToken(conn); if (!token) return null;
      const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: 'primary' }] }),
      });
      const d = await r.json();
      return (d.calendars && d.calendars.primary && d.calendars.primary.busy) || [];
    }
  } catch (e) { return null; }
  return null;
}

// ---- create event on booking confirm. Never throws. date=YYYY-MM-DD, times=HH:MM ----
async function createEvent(userId, ev) {
  if (!ENABLED) return { ok: false, reason: 'disabled' };
  const conn = getConnection(userId); if (!conn) return { ok: false, reason: 'not-connected' };
  try {
    if (conn.provider === 'nylas') {
      const start = zonedUnix(ev.date, ev.startTime || '09:00', TZ);
      const end = zonedUnix(ev.date, ev.endTime || ev.startTime || '10:00', TZ);
      const body = { title: ev.summary || 'Momni care', description: ev.description || '',
        when: { start_time: start, end_time: end, start_timezone: TZ, end_timezone: TZ } };
      if (ev.attendeeEmail) body.participants = [{ email: ev.attendeeEmail, name: ev.attendeeName || '' }];
      const calId = conn.calendar_id || conn.calendar_email || 'primary';
      const r = await fetch(`${NYLAS_BASE}/v3/grants/${conn.grant_id}/events?calendar_id=${encodeURIComponent(calId)}&notify_participants=true`, {
        method: 'POST', headers: { Authorization: `Bearer ${NYLAS_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, reason: `nylas ${r.status}` };
      const d = await r.json();
      return { ok: true, id: (d.data && d.data.id) || d.id };
    }
    if (conn.provider === 'google') {
      const token = await googleToken(conn); if (!token) return { ok: false, reason: 'no-token' };
      const body = {
        summary: ev.summary || 'Momni care', description: ev.description || '',
        start: { dateTime: `${ev.date}T${(ev.startTime || '09:00')}:00`, timeZone: TZ },
        end: { dateTime: `${ev.date}T${(ev.endTime || ev.startTime || '10:00')}:00`, timeZone: TZ },
      };
      if (ev.attendeeEmail) body.attendees = [{ email: ev.attendeeEmail }];
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false, reason: `google ${r.status}` };
      const d = await r.json();
      return { ok: true, id: d.id, htmlLink: d.htmlLink };
    }
  } catch (e) { return { ok: false, reason: String(e).slice(0, 120) }; }
  return { ok: false, reason: 'no-provider' };
}

module.exports = { isEnabled, provider, isConnected, getConnection, connectUrl, handleCallback, disconnect, getBusy, createEvent, TZ };
