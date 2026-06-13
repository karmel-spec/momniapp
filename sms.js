// app/sms.js — Momni real-time text alerts (dev-safe, provider-pluggable)
//
// Mirrors mailer.js / the Stripe pattern:
//   - With TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM set, texts send for real via
//     Twilio's REST API (uses global fetch + Basic auth — no new dependency).
//   - Without them, DEV MODE: nothing is sent — each text is logged to the console AND recorded
//     in the `sms_log` table so HQ can see exactly what WOULD go out.
//
// Texts are real-time, opt-in, and transactional (a parent messaged you, a booking confirmed) —
// never marketing. The caller decides who gets one; this module just sends + logs.

const { db } = require('./db');

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM = process.env.TWILIO_FROM;            // e.g. +18015551234
const LIVE = !!(SID && TOKEN && FROM);

// Best-effort E.164 normalization for US numbers entered loosely ("(801) 555-1234").
// Returns null if we can't make sense of it (so we skip rather than send garbage).
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s[0] === '+') { const d = s.slice(1).replace(/\D/g, ''); return d.length >= 8 && d.length <= 15 ? '+' + d : null; }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;           // bare US 10-digit
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d.length >= 8 && d.length <= 15 ? '+' + d : null;
}

function log(row) {
  try {
    db.prepare(`INSERT INTO sms_log (to_phone,to_user_id,kind,body,status,error,related_type,related_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      row.to_phone || null, row.to_user_id == null ? null : row.to_user_id, row.kind || null,
      row.body || null, row.status, row.error || null, row.related_type || null,
      row.related_id == null ? null : String(row.related_id));
  } catch (e) { console.error('[sms] could not log', e); }
}

// Send one text. Never throws — a texting problem must never break a core action.
async function send({ to, to_user_id = null, body, kind = null, related_type = null, related_id = null, opted_in = true }) {
  const phone = normalizePhone(to);
  if (!phone) { log({ to_phone: to || null, to_user_id, kind, body, status: 'skipped-no-phone', related_type, related_id }); return { status: 'skipped-no-phone' }; }
  if (!opted_in) { log({ to_phone: phone, to_user_id, kind, body, status: 'skipped-opt-out', related_type, related_id }); return { status: 'skipped-opt-out' }; }
  let status = 'dev-logged', error = null;
  try {
    if (LIVE) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: FROM, To: phone, Body: String(body || '').slice(0, 480) }),
      });
      if (res.ok) status = 'sent';
      else { status = 'failed'; error = `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`; }
    } else {
      console.log(`[SMS · DEV MODE — not sent] to=${phone} kind=${kind} body="${String(body || '').slice(0, 80)}"  (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM to send)`);
    }
  } catch (e) { status = 'failed'; error = String(e).slice(0, 300); }
  log({ to_phone: phone, to_user_id, kind, body, status, error, related_type, related_id });
  return { status, error };
}

module.exports = { send, normalizePhone, LIVE };
