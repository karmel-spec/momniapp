// app/mailer.js — Momni transactional email (dev-safe, provider-pluggable)
//
// Mirrors the Stripe pattern in server.js:
//   - With RESEND_API_KEY set, emails are sent for real via Resend's REST API.
//   - Without it, DEV MODE: nothing is sent — each email is logged to the console
//     AND recorded in the `emails` table so you can see exactly what WOULD go out.
// Set EMAIL_FROM to a verified sending address in production (e.g. "Momni <hello@momni.com>").
//
// Sacred rules live in the copy: warm/candid voice, "mama"; never vetted/verified/
// screened/safe/guaranteed; Momni never touches care payments; entity separation disclosed.

const { db } = require('./db');

const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Momni <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const LIVE = !!RESEND_KEY;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function btn(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#0D878F;color:#ffffff;font-weight:600;text-decoration:none;padding:13px 28px;border-radius:100px;font-size:15px">${esc(label)}</a>`;
}
function layout(inner, preheader) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F5F0FE;font-family:'Albert Sans',Helvetica,Arial,sans-serif;color:#2B2233;line-height:1.6">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0FE"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden">
  <tr><td style="background:#6D58A4;padding:20px 28px"><span style="color:#ffffff;font-family:'Montserrat',Helvetica,Arial,sans-serif;font-weight:700;font-size:21px;letter-spacing:-0.01em">Momni</span></td></tr>
  <tr><td style="padding:30px 28px">${inner}</td></tr>
  <tr><td style="padding:18px 28px;background:#F5F0FE;font-size:12px;color:#6B6477;line-height:1.7">
    Momni is a community platform — mamas make their own care decisions and pay each other directly.<br>
    Momni, Inc. and the Momni Foundation (501(c)(3)) are one brand with separate finances.<br>
    <a href="${esc(APP_URL)}/me.html" style="color:#0D878F">Manage your preferences</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}
const h1 = (t) => `<h1 style="font-family:'Montserrat',Helvetica,Arial,sans-serif;font-size:23px;font-weight:800;letter-spacing:-0.02em;margin:0 0 14px;color:#2B2233">${esc(t)}</h1>`;
const p = (t) => `<p style="font-size:16px;margin:0 0 16px">${t}</p>`;
const script = (t) => `<p style="font-family:'Caveat',cursive;font-size:22px;color:#6D58A4;margin:18px 0 0">${esc(t)}</p>`;

// ---- templates: each returns { subject, html } from its vars ----
const TEMPLATES = {
  welcome: (v) => ({
    subject: `Welcome to the Circle, ${v.name || 'mama'} 💜`,
    html: layout(
      h1(`Welcome, ${esc(v.name || 'mama')}.`) +
      p(`You're in the Circle now — a community of mamas helping mamas, one connection at a time.`) +
      p(`Here's a gentle first step: complete your profile so other mamas can get to know you, and take a look at who's near you on the map.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Open Momni')}</p>` +
      script('— Karmel'),
      `Welcome to the Circle, ${v.name || 'mama'}.`),
  }),
  onboarding: (v) => ({
    subject: `Your next step in the Circle, ${v.name || 'mama'}`,
    html: layout(
      h1('A few things that make Momni feel like home') +
      p(`Hi ${esc(v.name || 'mama')} — a few mamas asked what to do first, so here's the short list:`) +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Finish your profile and add what you'd want a new friend to know.</li><li>If you'd like to host, flip on hosting and set your own rate — you keep every penny.</li><li>Put your pin on the map so your neighborhood can find you.</li></ul>` +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Finish your profile')}</p>` +
      script('— Karmel'),
      'Your next step in the Circle'),
  }),
  reactivation: (v) => ({
    subject: `Your pin is still on the map, ${v.name || 'mama'}`,
    html: layout(
      h1('Come light it up again') +
      p(`We've missed you, ${esc(v.name || 'mama')}. Momni is back — community-led, mama-powered, and built to last — and your spot in the Circle is waiting.`) +
      p(`Nothing's lost: your pin is still on the map. Come see who's circling up near you now.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Come back to the Circle')}</p>` +
      script('— Karmel'),
      'Your pin is still on the map'),
  }),
  review_request: (v) => ({
    subject: `How did your visit with ${v.other || 'your Momni'} go?`,
    html: layout(
      h1('Tell the Circle how it went') +
      p(`Your visit with <strong>${esc(v.other || 'your Momni')}</strong> just wrapped up. Would you take a moment to leave a review?`) +
      p(`Honest reviews from mamas like you are how the Circle grows the most precious thing we have — a trusted map of who's wonderful with our little ones. It's the kind of word-of-mouth that used to live over the back fence, now shared with the whole Circle.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'Leave a review')}</p>` +
      script('— Karmel'),
      `How did your visit with ${v.other || 'your Momni'} go?`),
  }),
  booking_request: (v) => ({
    subject: `${v.guest || 'A mama'} wants to book you on Momni`,
    html: layout(
      h1('You have a new booking request') +
      p(`<strong>${esc(v.guest || 'A mama')}</strong> sent you a Link${v.care_type ? ` for ${esc(v.care_type)} care` : ''}. Open your Links to see her note and confirm or decline.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'View the request')}</p>` +
      p(`<span style="font-size:14px;color:#6B6477">When you confirm, you two arrange the details and she pays you directly — you keep every penny.</span>`),
      `${v.guest || 'A mama'} wants to book you`),
  }),
  booking_confirmed: (v) => ({
    subject: `${v.host || 'Your Momni'} confirmed your Link 🎉`,
    html: layout(
      h1('You\'re booked!') +
      p(`<strong>${esc(v.host || 'Your Momni')}</strong> confirmed your Link. You'll find the visit details — and a thread to chat — in your Links.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'See the details')}</p>` +
      p(`<span style="font-size:14px;color:#6B6477">Pay your Momni directly — Venmo, cash, her choice. She keeps every penny.</span>`),
      `${v.host || 'Your Momni'} confirmed your Link`),
  }),
  newsletter: (v) => ({
    subject: v.subject || 'News from the Circle',
    html: layout((v.heading ? h1(v.heading) : '') + (v.bodyHtml || p(esc(v.body || ''))) +
      (v.ctaHref ? `<p style="margin:20px 0">${btn(v.ctaHref, v.ctaLabel || 'Read more')}</p>` : '') +
      script('— Karmel'),
      v.subject || 'News from the Circle'),
  }),

  // Password reset — single-use link, 1-hour expiry.
  password_reset: (v) => ({
    subject: 'Reset your Momni password',
    html: layout(
      h1('Choose a new password') +
      p(`Hi ${esc(v.name || 'mama')} — tap below to set a new password for your Momni account. The link works once and expires in an hour.`) +
      `<p style="margin:20px 0">${btn(v.resetHref, 'Choose a new password')}</p>` +
      p('If you didn’t ask for this, just ignore this email — your password is unchanged.') +
      script('— Momni'),
      'Reset your Momni password'),
  }),

  // Circle Leader reminder to her members about a gathering.
  circle_reminder: (v) => ({
    subject: v.subject || `Reminder: ${v.circle || 'your Circle'} is getting together`,
    html: layout(
      h1(esc(v.event || 'A Circle gathering')) +
      (v.when ? p(`<strong>When:</strong> ${esc(v.when)}`) : '') +
      (v.location ? p(`<strong>Where:</strong> ${esc(v.location)}`) : '') +
      (v.notes ? p(esc(v.notes)) : '') +
      p(`From ${esc(v.leader || 'your Circle Leader')} · ${esc(v.circle || 'your Circle')}`) +
      script('See you there! 💜'),
      v.subject || 'A reminder from your Circle'),
  }),
};

// Send one email. Never throws — email problems must never break a core action.
async function send({ to, to_user_id = null, template, vars = {}, related_type = null, related_id = null }) {
  const t = TEMPLATES[template];
  if (!t) { console.error('[mailer] unknown template:', template); return { status: 'failed', error: 'unknown template' }; }
  if (!to) return { status: 'failed', error: 'no recipient' };
  const { subject, html } = t(vars);
  let status = 'dev-logged', error = null;
  try {
    if (LIVE) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
      });
      if (res.ok) status = 'sent';
      else { status = 'failed'; error = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`; }
    } else {
      console.log(`[EMAIL · DEV MODE — not sent] to=${to} template=${template} subject="${subject}"  (set RESEND_API_KEY + EMAIL_FROM to send for real)`);
    }
  } catch (e) {
    status = 'failed'; error = String(e).slice(0, 300);
  }
  try {
    db.prepare(`INSERT INTO emails (to_email,to_user_id,template,subject,status,related_type,related_id,error)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(to, to_user_id, template, subject, status, related_type, related_id == null ? null : String(related_id), error);
  } catch (e) { console.error('[mailer] could not log email', e); }
  return { status, error };
}

// Have we already sent this template for this item to this user? (prevents double-sends)
function alreadySent({ template, to_user_id, related_type, related_id }) {
  return !!db.prepare(`SELECT 1 FROM emails WHERE template=? AND to_user_id=? AND related_type=? AND related_id=?
    AND status IN ('sent','dev-logged') LIMIT 1`)
    .get(template, to_user_id, related_type, String(related_id));
}

module.exports = { send, alreadySent, LIVE, TEMPLATES, EMAIL_FROM };
