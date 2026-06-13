// app/mailer.js — Momni transactional email (dev-safe, provider-pluggable)
//
// Mirrors the Stripe pattern in server.js:
//   - With RESEND_API_KEY set, emails are sent for real via Resend's REST API.
//   - Without it, DEV MODE: nothing is sent — each email is logged to the console
//     AND recorded in the `emails` table so you can see exactly what WOULD go out.
// Set EMAIL_FROM to a verified sending address in production (e.g. "Momni <hello@momni.com>").
//
// Sacred rules live in the copy: warm/candid voice, "Momni" (gender-neutral, 2026-06-12); never vetted/verified/
// screened/safe/guaranteed; Momni never touches care payments; entity separation disclosed.

const { db } = require('./db');

const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Momni <onboarding@resend.dev>';
// Replies land in a real, monitored inbox — hello@ is a display identity only.
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@momni.com';
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
    Momni is a community platform — Momnis make their own care decisions and pay each other directly.<br>
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
    subject: `Welcome to the Circle, ${v.name || 'Momni'} 💜`,
    html: layout(
      h1(`Welcome, ${esc(v.name || 'Momni')}.`) +
      p(`You're in the Circle now — a community of Momnis helping Momnis, one connection at a time.`) +
      p(`Here's a gentle first step: complete your profile so other Momnis can get to know you, and take a look at who's near you on the map.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Open Momni')}</p>` +
      script('— Karmel'),
      `Welcome to the Circle, ${v.name || 'Momni'}.`),
  }),
  onboarding: (v) => ({
    subject: `Your next step in the Circle, ${v.name || 'Momni'}`,
    html: layout(
      h1('A few things that make Momni feel like home') +
      p(`Hi ${esc(v.name || 'Momni')} — a few Momnis asked what to do first, so here's the short list:`) +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Finish your profile and add what you'd want a new friend to know.</li><li>If you'd like to host, flip on hosting and set your own rate — you keep every penny.</li><li>Put your pin on the map so your neighborhood can find you.</li></ul>` +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Finish your profile')}</p>` +
      script('— Karmel'),
      'Your next step in the Circle'),
  }),
  reactivation: (v) => ({
    subject: `Your pin is still on the map, ${v.name || 'Momni'}`,
    html: layout(
      h1('Come light it up again') +
      p(`We've missed you, ${esc(v.name || 'Momni')}. Momni is back — community-led, Momni-powered, and built to last — and your spot in the Circle is waiting.`) +
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
      p(`Honest reviews from Momnis like you are how the Circle grows the most precious thing we have — a trusted map of who's wonderful with our little ones. It's the kind of word-of-mouth that used to live over the back fence, now shared with the whole Circle.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'Leave a review')}</p>` +
      script('— Karmel'),
      `How did your visit with ${v.other || 'your Momni'} go?`),
  }),
  booking_request: (v) => ({
    subject: `${v.guest || 'A Momni'} wants to book you on Momni`,
    html: layout(
      h1('You have a new booking request') +
      p(`<strong>${esc(v.guest || 'A Momni')}</strong> sent you a Link${v.care_type ? ` for ${esc(v.care_type)} care` : ''}. Open your Links to see their note and confirm or decline.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'View the request')}</p>` +
      p(`<span style="font-size:14px;color:#6B6477">When you confirm, you two arrange the details and they pay you directly — you keep every penny.</span>`),
      `${v.guest || 'A Momni'} wants to book you`),
  }),
  booking_confirmed: (v) => ({
    subject: `${v.host || 'Your Momni'} confirmed your Link 🎉`,
    html: layout(
      h1('You\'re booked!') +
      p(`<strong>${esc(v.host || 'Your Momni')}</strong> confirmed your Link. You'll find the visit details — and a thread to chat — in your Links.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'See the details')}</p>` +
      p(`<span style="font-size:14px;color:#6B6477">Pay your Momni directly — Venmo, cash, their choice. They keep every penny.</span>`),
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
      p(`Hi ${esc(v.name || 'Momni')} — tap below to set a new password for your Momni account. The link works once and expires in an hour.`) +
      `<p style="margin:20px 0">${btn(v.resetHref, 'Choose a new password')}</p>` +
      p('If you didn’t ask for this, just ignore this email — your password is unchanged.') +
      script('— Momni'),
      'Reset your Momni password'),
  }),

  // Digital download delivery after a shop purchase.
  download_ready: (v) => ({
    subject: `Your download: ${v.title || 'Momni Shop'}`,
    html: layout(
      h1('Thank you, Momni! 💜') +
      p(`Here’s your download — <strong>${esc(v.title || 'your purchase')}</strong>. The link works for a little while and a few downloads, so save the file somewhere safe.`) +
      `<p style="margin:20px 0">${btn(v.downloadHref, 'Download now')}</p>` +
      p('Every purchase in the Momni Shop helps fund care for parents in need through the Momni Foundation. Thank you for circling up.') +
      script('— Momni'),
      `Your download: ${v.title || 'Momni Shop'}`),
  }),

  // CRM outreach — a personal note from Karmel, composed in the HQ CRM.
  crm_outreach: (v) => ({
    subject: v.subject || 'A note from Karmel at Momni',
    html: layout(
      (v.heading ? h1(v.heading) : '') +
      String(v.body || '').split(/\n{2,}/).map(par => p(esc(par).replace(/\n/g, '<br>'))).join('') +
      (v.ctaHref ? `<p style="margin:20px 0">${btn(v.ctaHref, v.ctaLabel || 'Open Momni')}</p>` : '') +
      script('— Karmel'),
      v.subject || 'A note from Karmel'),
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

  // ───────── Welcome & onboarding series (host + guest) — drafts for Karmel; send from HQ, held by the approval gate ─────────
  host_welcome: (v) => ({
    subject: `You're a Momni now, ${v.name || 'friend'} 💜`,
    html: layout(
      h1(`Welcome home, ${esc(v.name || 'Momni')}.`) +
      p('You just did something quietly brave: you opened your door.') +
      p('Being a host means you\'re part of a circle of parents who show up for each other — hour for hour, Momni to Momni. You set your own rate and hours, and you keep every penny. Momni never takes a cut of care.') +
      p('No one to impress here. Just families finding families. One small first step: finish your profile so the Momnis nearby can get to know you.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Finish my profile')}</p>` +
      script('Welcome home, — Karmel'),
      'What it means to open your door — and one small first step.'),
  }),
  host_profile_nudge: (v) => ({
    subject: 'Three minutes to finish your profile',
    html: layout(
      h1('A few warm words go a long way') +
      p('The Momnis near you read profiles like they\'d size up a new friend — your story, your littles, your home. The fuller yours is, the easier it is for someone to say "them — I trust them with mine."') +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Your story — a few sentences about your family</li><li>Your littles — so others know who\'ll be in the mix</li><li>Your home — the backyard, the playroom, the no-pets</li></ul>` +
      p('You don\'t have to be polished. Just be you.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Finish my profile')}</p>` +
      script('— Karmel'),
      'A few words help a nearby Momni feel like they already know you.'),
  }),
  host_calendar_nudge: (v) => ({
    subject: 'Keep your availability honest (the easy way)',
    html: layout(
      h1('Connect the calendar you already live by') +
      p('Nothing deflates a tired parent like reaching out to someone who turns out to be busy.') +
      p('Connect the calendar you already use, and your availability stays accurate on its own — booked in real life, booked here. Confirmed Links land on it automatically, too. One tap, and Momni only ever reads your free/busy times — never the details of what\'s on it.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Sync my calendar')}</p>` +
      script('— Karmel'),
      'Connect the calendar you already use, and Momni keeps your openings true.'),
  }),
  host_golive: (v) => ({
    subject: 'Your light is on the map',
    html: layout(
      h1('Your pin is glowing') +
      p('You\'re a real, lit-up Momni in your neighborhood now. Soon a nearby parent may send you a Link (that\'s a booking request). When they do:') +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>You\'ll see their profile and a note — trust runs both ways here.</li><li>We always encourage a quick video hello or a park meetup first.</li><li>You arrange the details together, and they pay you directly. You decide every yes.</li></ul>` +
      p('That\'s the whole thing. No agency, no middleman, no one deciding for you.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/search.html', 'See who\'s circling up near me')}</p>` +
      script('— Karmel'),
      'What happens when a Momni reaches out — and how the first Link works.'),
  }),
  guest_welcome: (v) => ({
    subject: `Welcome to the Circle, ${v.name || 'friend'} 💜`,
    html: layout(
      h1(`Welcome home, ${esc(v.name || 'Momni')}.`) +
      p('Momni is a circle of parents who share care neighbor to neighbor, Momni to Momni. Not an agency. Not strangers. The family three streets over you just haven\'t met yet.') +
      p('We don\'t vet or screen anyone, and we\'ll never pretend to. Instead we hand you what real trust is built on: profiles in people\'s own words, reviews from other Momnis, and a conversation before you ever meet. You decide who\'s right for your littles — always.') +
      p('One first step: open the map and see who\'s near you.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/search.html', 'See the Momnis near me')}</p>` +
      script('So glad you\'re here, — Karmel'),
      'Your people are closer than you think.'),
  }),
  guest_profile_nudge: (v) => ({
    subject: 'Tell your future Momni about your littles',
    html: layout(
      h1('Trust runs both ways') +
      p('When you reach out to a Momni, they see your profile the same way you see theirs. A few warm words about you and your littles makes it easy for someone to say "yes, come over."') +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Your story — who you are, what your days look like</li><li>Your littles — names, ages, the things that help</li></ul>` +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Complete my profile')}</p>` +
      script('— Karmel'),
      'A host gets to know you, too.'),
  }),
  guest_find: (v) => ({
    subject: 'How to find the one',
    html: layout(
      h1('Reading a profile, and trusting your gut') +
      p('Finding the right Momni isn\'t a five-star score — it\'s the feeling you get reading their story and seeing their home. Here\'s how Momnis do it:') +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Open a profile like you\'re meeting a new friend.</li><li>Send a Link and start a conversation — ask anything.</li><li>Always meet first: a video hello or a park playdate. The kids tell you a lot.</li><li>Trust your gut. You\'re the filter. You always were.</li></ul>` +
      `<p style="margin:20px 0">${btn(APP_URL + '/search.html', 'Find the Momni near me')}</p>` +
      script('— Karmel'),
      'The meet-first hello, and trusting your gut.'),
  }),
  guest_link_explainer: (v) => ({
    subject: 'What\'s a Link? (and why it\'s just $1)',
    html: layout(
      h1('A Link is a single booking — and it\'s $1') +
      p('That dollar is the whole price list. The care itself? You pay your Momni directly — cash, Venmo, their choice — and they keep every penny. Momni never touches the money and never takes a percentage. We just help you find each other.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/search.html', 'Send my first Link')}</p>` +
      script('— Karmel'),
      'The only thing Momni ever charges for — and it\'s a dollar.'),
  }),
};

// BETA APPROVAL GATE (Karmel's standing rule, 2026-06-12): NO email leaves the building
// on its own. Every live email is HELD in the outbox (status 'held') until she approves
// it in HQ. Flip only by her explicit request: site_settings email_approval_required='0'.
function approvalRequired() {
  try {
    const r = db.prepare("SELECT value FROM site_settings WHERE key = 'email_approval_required'").get();
    return !r || r.value !== '0'; // default: approval required
  } catch (e) { return true; }   // any doubt → hold
}

// Send one email. Never throws — email problems must never break a core action.
async function send({ to, to_user_id = null, template, vars = {}, related_type = null, related_id = null }) {
  const t = TEMPLATES[template];
  if (!t) { console.error('[mailer] unknown template:', template); return { status: 'failed', error: 'unknown template' }; }
  if (!to) return { status: 'failed', error: 'no recipient' };
  const { subject, html } = t(vars);
  if (LIVE && approvalRequired()) {
    try {
      db.prepare(`INSERT INTO emails (to_email,to_user_id,template,subject,status,related_type,related_id,error,html)
        VALUES (?,?,?,?,'held',?,?,NULL,?)`)
        .run(to, to_user_id, template, subject, related_type, related_id == null ? null : String(related_id), html);
    } catch (e) { console.error('[mailer] could not hold email', e); }
    return { status: 'held' };
  }
  let status = 'dev-logged', error = null;
  try {
    if (LIVE) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, reply_to: EMAIL_REPLY_TO }),
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
    AND status IN ('sent','dev-logged','held') LIMIT 1`)
    .get(template, to_user_id, related_type, String(related_id));
}

// Deliver one HELD email after Karmel approves it in HQ. The only path out of the outbox.
async function deliverHeld(id) {
  const row = db.prepare("SELECT * FROM emails WHERE id = ? AND status = 'held'").get(id);
  if (!row) return { status: 'failed', error: 'Not found or not awaiting approval.' };
  if (!row.html) return { status: 'failed', error: 'No stored body for this email.' };
  let status = 'failed', error = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [row.to_email], subject: row.subject, html: row.html, reply_to: EMAIL_REPLY_TO }),
    });
    if (res.ok) status = 'sent';
    else error = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (e) { error = String(e).slice(0, 300); }
  db.prepare(`UPDATE emails SET status = ?, error = ? WHERE id = ?`).run(status, error, id);
  return { status, error };
}

module.exports = { send, alreadySent, deliverHeld, LIVE, TEMPLATES, EMAIL_FROM };
