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

const crypto = require('crypto');
const { db } = require('./db');
const gmaildraft = require('./gmaildraft');

// Bulk templates always route to the HQ Outbox (Resend) — too many to draft in Gmail.
// Everything else is "personal" and, when Gmail drafts are configured, lands in support@'s Drafts.
const BULK_TEMPLATES = new Set(['reactivation', 'reactivation_2', 'reactivation_3',
  'dormant_30', 'dormant_60', 'community_digest', 'trust_education', 'newsletter']);

// Transactional / relationship mail — exempt from the unsubscribe list (CAN-SPAM allows this).
// A parent who opts out of marketing must STILL get a password reset or a booking they're in.
// Everything NOT in this set is treated as marketing: it carries the one-click List-Unsubscribe
// header and is suppressed for any address on the unsubscribe list.
const TRANSACTIONAL_TEMPLATES = new Set(['password_reset', 'booking_request', 'booking_confirmed',
  'booking_reminder', 'review_request', 'download_ready', 'circle_reminder']);

const RESEND_KEY = process.env.RESEND_API_KEY;
// From a branded, REPLYABLE Momni address — never a "no-reply" and never the resend.dev sandbox
// sender. momni.com is verified in Resend, so hello@ is safe as the default From. If EMAIL_FROM is
// ever a sandbox/no-reply address (e.g. a stale value from first setup), override it and warn loudly
// rather than quietly mailing 25K Momnis from a foreign, unreplyable sender.
let EMAIL_FROM = process.env.EMAIL_FROM || 'Momni <hello@momni.com>';
if (/resend\.dev|no-?reply|do-?not-?reply|donotreply/i.test(EMAIL_FROM)) {
  console.warn(`[mailer] EMAIL_FROM was "${EMAIL_FROM}" — a sandbox/no-reply sender. Overriding to "Momni <hello@momni.com>". Set EMAIL_FROM="Momni <hello@momni.com>" in Render to silence this.`);
  EMAIL_FROM = 'Momni <hello@momni.com>';
}
// EVERY email sets Reply-To to a real, monitored inbox (support@ is the Google Workspace mailbox
// Karmel reads), so a recipient can always hit Reply and reach a human. Momni is never "do not reply."
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || 'support@momni.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const LIVE = !!RESEND_KEY;
// CAN-SPAM also requires a valid physical postal address in every commercial email. Set
// EMAIL_POSTAL_ADDRESS in Render (recommend a Provo/Orem PO box, NOT a home address). Until it's
// set the line is omitted rather than inventing an address — pair this with the unsubscribe link.
const EMAIL_POSTAL = (process.env.EMAIL_POSTAL_ADDRESS || '').trim();

// ───────── Unsubscribe: signed, stateless, recipient-specific ─────────
// The footer link and the List-Unsubscribe header carry a token = base64url(email).hmac so the
// recipient unsubscribes in one click without typing anything, and nobody can forge an opt-out for
// someone else. A dedicated UNSUB_SECRET keeps links valid even if the session secret rotates.
const UNSUB_SECRET = process.env.UNSUB_SECRET || process.env.SESSION_SECRET || 'momni-dev-secret-change-in-prod';
const UNSUB_FALLBACK = `${APP_URL}/unsubscribe`;                       // tokenless, still works (shows an email form)
const normEmail = (e) => String(e == null ? '' : e).toLowerCase().trim();
const unsubSig = (emailLower) => crypto.createHmac('sha256', UNSUB_SECRET).update(emailLower).digest('base64url');
function unsubToken(email) {
  const e = normEmail(email);
  return Buffer.from(e).toString('base64url') + '.' + unsubSig(e);
}
function verifyUnsubToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const i = token.indexOf('.');
  let email;
  try { email = Buffer.from(token.slice(0, i), 'base64url').toString('utf8'); } catch (e) { return null; }
  if (!email) return null;
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(unsubSig(email));
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? email : null;
}
const unsubUrl = (email) => `${APP_URL}/unsubscribe?u=${encodeURIComponent(unsubToken(email))}`;

function isUnsubscribed(email) {
  try { return !!db.prepare('SELECT 1 FROM email_unsubscribes WHERE email = ? LIMIT 1').get(normEmail(email)); }
  catch (e) { return false; }  // table missing / any doubt → don't block transactional mail
}
// Record an opt-out everywhere it needs to live: the canonical list + the CRM flag (so HQ counts stay honest).
function recordUnsubscribe(email, source) {
  const e = normEmail(email);
  if (!e) return false;
  try { db.prepare('INSERT OR IGNORE INTO email_unsubscribes (email, source) VALUES (?,?)').run(e, source || 'link'); }
  catch (err) { console.error('[mailer] could not record unsubscribe', err); return false; }
  try { db.prepare("UPDATE crm_contacts SET do_not_email = 1, updated_at = datetime('now') WHERE lower(email) = ?").run(e); }
  catch (err) { /* crm row optional */ }
  return true;
}
// Swap the tokenless footer href for this recipient's signed one. Done in send() so the single
// footer in layout() personalizes for every template, current and future, with no per-template work.
const personalizeFooter = (html, to) => html.split(`href="${UNSUB_FALLBACK}"`).join(`href="${unsubUrl(to)}"`);

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
    Questions, or just want to say hi? Reply to this email — a real Momni reads every one.<br>
    Momni is a community platform — Momnis make their own care decisions and pay each other directly.<br>
    Momni, Inc. and the Momni Foundation (501(c)(3)) are one brand with separate finances.<br>
    ${EMAIL_POSTAL ? esc(EMAIL_POSTAL) + '<br>' : ''}
    <a href="${esc(APP_URL)}/me.html" style="color:#0D878F">Manage your preferences</a> &nbsp;·&nbsp; <a href="${esc(UNSUB_FALLBACK)}" style="color:#0D878F">Unsubscribe</a>
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

  // ───────── Booking lifecycle — the day-before reminder (request/confirmed/review already exist above) ─────────
  booking_reminder: (v) => ({
    subject: `Tomorrow: your Momni visit${v.other ? ' with ' + v.other : ''}`,
    html: layout(
      h1('A little reminder 💜') +
      p(`Your Momni visit${v.other ? ` with <strong>${esc(v.other)}</strong>` : ''} is coming up${v.when ? ` — <strong>${esc(v.when)}</strong>` : ' tomorrow'}.`) +
      p('A quick checklist helps the day go smooth: confirm the drop-off time, share any notes about the littles (naps, snacks, the lovey that must not be lost), and swap phone numbers if you haven\'t.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'Open this Link')}</p>` +
      script('— Karmel'),
      `Your visit${v.other ? ' with ' + v.other : ''} is coming up.`),
  }),

  // ───────── Reactivation — 3-touch win-back for the 25,373 first Momnis (touch 1 is the 'reactivation' template above) ─────────
  reactivation_2: (v) => ({
    subject: 'Look who\'s already back near you',
    html: layout(
      h1('The map is lighting up again') +
      p(`Momnis you may remember from the early days are relighting their pins — real lights, glowing in real neighborhoods. The Circle you helped build in the first place is finding its way home.`) +
      p('Your pin is still there, waiting. Come see who\'s near you now.') +
      `<p style="margin:20px 0">${btn('https://momni.com/map/', 'See the map light up')}</p>` +
      script('— Karmel'),
      'The Momnis you remember are relighting their pins.'),
  }),
  reactivation_3: (v) => ({
    subject: 'Come light it up 💡',
    html: layout(
      h1('Your pin is still on the map') +
      p('Six years ago we paused. We\'re back now — community-led, built to last — and the only thing missing is you. It takes a minute to relight your pin and be part of the Circle again.') +
      p('No pressure, ever. Just an open door, the way it always was.') +
      `<p style="margin:20px 0">${btn(APP_URL, 'Light up my pin')}</p>` +
      script('Welcome home, — Karmel'),
      'It takes a minute to come home.'),
  }),

  // ───────── Dormant re-engagement ─────────
  dormant_30: (v) => ({
    subject: `We\'ve missed you, ${v.name || 'Momni'}`,
    html: layout(
      h1('It\'s been a minute') +
      p(`Hi ${esc(v.name || 'Momni')} — no guilt, just a wave from the Circle. New Momnis have joined near you, and a few Circles are meeting this month. Whenever you need a hand (or want to lend one), we\'re here.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/search.html', 'See who\'s near me now')}</p>` +
      script('— Karmel'),
      'A wave from the Circle — no guilt, just here when you need us.'),
  }),
  dormant_60: (v) => ({
    subject: 'Still saving your spot in the Circle',
    html: layout(
      h1('Your spot is still here') +
      p(`We haven\'t seen you in a while, ${esc(v.name || 'Momni')}, and that\'s okay — life is full. Your profile, your pin, and your people are right where you left them. If there\'s something that would make Momni more useful for your family, just reply and tell me — I read these.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Come back anytime')}</p>` +
      script('— Karmel'),
      'Your profile, your pin, and your people are right where you left them.'),
  }),

  // ───────── Milestones & celebrations ─────────
  milestone_first_link: (v) => ({
    subject: 'Your first Link 🎉',
    html: layout(
      h1('You did the thing!') +
      p('You just sent your first Link — the first thread in what we hope is a long, warm web of care around your family. However it goes, you showed up, and that\'s the whole movement in one small act.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/links.html', 'See your Link')}</p>` +
      script('Proud of you, — Karmel'),
      'The first thread in your web of care.'),
  }),
  milestone_first_review: (v) => ({
    subject: 'Your first review just landed ⭐',
    html: layout(
      h1('Someone vouched for you') +
      p('A fellow Momni took a moment to share how it went — and now that trust is part of the Circle\'s map. Reviews are how we grow the most precious thing we have: a trusted picture of who\'s wonderful with our little ones.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'See your review')}</p>` +
      script('— Karmel'),
      'That trust is now part of the Circle.'),
  }),
  milestone_helped: (v) => ({
    subject: `You\'ve helped ${v.count || 'so many'} families 💜`,
    html: layout(
      h1(`${v.count || 'So many'} families — because of you`) +
      p(`Every time you opened your door or sent a Link, a family somewhere breathed a little easier. That\'s ${v.count ? `<strong>${esc(v.count)}</strong> times` : 'more times than you might count'} now. One drop, then rings, then a wave.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Keep circling up')}</p>` +
      script('Thank you, — Karmel'),
      'A family somewhere breathed easier because of you.'),
  }),
  milestone_anniversary: (v) => ({
    subject: `Happy Momni-versary, ${v.name || 'friend'} 💜`,
    html: layout(
      h1(`${v.years ? esc(v.years) + ' ' : ''}year${v.years === 1 ? '' : 's'} in the Circle`) +
      p(`It\'s been ${v.years ? `<strong>${esc(v.years)} year${v.years === 1 ? '' : 's'}</strong>` : 'a year'} since you joined the Circle, ${esc(v.name || 'Momni')}. Thank you for being part of something that runs on nothing but moms — and now, Momnis of every kind — showing up for each other.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Here\'s to the next one')}</p>` +
      script('— Karmel'),
      'Thank you for showing up, year after year.'),
  }),
  milestone_pin_relit: (v) => ({
    subject: 'Your light is back on the map 💡',
    html: layout(
      h1('Welcome home') +
      p('You relit your pin — and the map is brighter for it. A real, glowing light in your neighborhood, right where it belongs. Come see who else is circling up near you.') +
      `<p style="margin:20px 0">${btn('https://momni.com/map/', 'See your light on the map')}</p>` +
      script('So glad you\'re back, — Karmel'),
      'A real, glowing light, right where it belongs.'),
  }),

  // ───────── Circles of Care welcomes (concept pending Karmel; Pre-Momni framed community/mentorship, no minor booking) ─────────
  grandmomni_welcome: (v) => ({
    subject: 'Welcome, GrandMomni 💜',
    html: layout(
      h1('The generation above') +
      p(`You raised yours — and the young Momnis near you are aching for exactly what you carry: patience, steady hands, and ten thousand years of "this is how you settle a fussy baby." As a GrandMomni, you can host, mentor, and simply be present in a circle that needs you.`) +
      `<p style="margin:20px 0">${btn(APP_URL + '/me.html', 'Set up my GrandMomni profile')}</p>` +
      script('— Karmel (a Grand-Mama too)'),
      'The young Momnis near you are aching for what you carry.'),
  }),
  mr_momni_welcome: (v) => ({
    subject: 'Welcome, Mr. Momni 💜',
    html: layout(
      h1('Dads, fully in the circle') +
      p('Asking for help isn\'t a mom-only thing, and neither is giving it. Whether you\'re holding down solo days, covering while a partner travels, or hosting other kids on a Saturday — you belong here, fully, as a Momni. The "Mr." just says we\'re glad you came.') +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Find your circle')}</p>` +
      script('— Karmel'),
      'Asking for help isn\'t a mom-only thing.'),
  }),
  pre_momni_welcome: (v) => ({
    subject: 'Welcome, future Momni 🌱',
    html: layout(
      h1('The next generation of caregivers') +
      p('You\'re the one little ones light up for — and the Circle wants to help you grow that gift. As a Pre-Momni you\'ll learn from Momnis and GrandMomnis, earn badges, and find your people. (A parent helps set this up, and Pre-Momnis are helpers alongside a grown-up, never solo — a parent is always right there.)') +
      `<p style="margin:20px 0">${btn(APP_URL + '/home.html', 'Start learning')}</p>` +
      script('— Karmel'),
      'Learn from the Momnis who came before you.'),
  }),

  // ───────── Community digest (recurring) ─────────
  community_digest: (v) => ({
    subject: v.subject || 'This week in your Circle',
    html: layout(
      h1('What\'s happening near you') +
      (v.circle ? p(`<strong>📍 A Circle near you:</strong> ${esc(v.circle)}${v.when ? ` — ${esc(v.when)}` : ''}.`) : '') +
      (v.campfire ? p(`<strong>🔥 Top of the Campfire:</strong> ${esc(v.campfire)}`) : '') +
      (v.newMomnis ? p(`<strong>💜 New nearby:</strong> ${esc(v.newMomnis)} new Momnis joined your area this week.`) : '') +
      (v.body ? p(esc(v.body)) : '') +
      `<p style="margin:20px 0">${btn(APP_URL + '/circles.html', 'Open your Circle')}</p>` +
      script('— Karmel'),
      v.subject || 'This week in your Circle'),
  }),

  // ───────── How Momni works — trust education ─────────
  trust_education: (v) => ({
    subject: 'How trust works on Momni',
    html: layout(
      h1('You are the one who decides') +
      p('A gentle reminder of how trust gets built here — because it isn\'t us who builds it, it\'s you. Momni doesn\'t vet, screen, or endorse anyone. Instead you get the things real trust is made of:') +
      `<ul style="font-size:16px;padding-left:20px;margin:0 0 16px"><li>Profiles in people\'s own words — read them like you\'re meeting a friend.</li><li>Reviews from other Momnis, both directions.</li><li>A conversation, and a meet-first hello, before anyone\'s alone with your littles.</li><li>Your own gut. You\'re the filter — you always were.</li></ul>` +
      `<p style="margin:20px 0">${btn('https://momni.com/conduct/', 'Read Suggested Momni Conduct')}</p>` +
      script('— Karmel'),
      'It isn\'t us who builds the trust — it\'s you.'),
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
async function send({ to, to_user_id = null, template, vars = {}, related_type = null, related_id = null, prefer = null }) {
  const t = TEMPLATES[template];
  if (!t) { console.error('[mailer] unknown template:', template); return { status: 'failed', error: 'unknown template' }; }
  if (!to) return { status: 'failed', error: 'no recipient' };
  const { subject, html: rawHtml } = t(vars);
  const isTransactional = TRANSACTIONAL_TEMPLATES.has(template);
  // Honor the unsubscribe list for all marketing/community mail. Transactional/relationship mail
  // (password reset, a booking you're in) is exempt — CAN-SPAM allows it and a parent must still get it.
  if (!isTransactional && isUnsubscribed(to)) {
    try {
      db.prepare(`INSERT INTO emails (to_email,to_user_id,template,subject,status,related_type,related_id,error)
        VALUES (?,?,?,?,'suppressed',?,?,'recipient on unsubscribe list')`)
        .run(to, to_user_id, template, subject, related_type, related_id == null ? null : String(related_id));
    } catch (e) { console.error('[mailer] could not log suppressed email', e); }
    return { status: 'suppressed' };
  }
  // Personalize the single footer link in layout() to this recipient's signed unsubscribe URL.
  const html = personalizeFooter(rawHtml, to);
  // One-click List-Unsubscribe (Gmail/Yahoo bulk rules) — marketing mail only.
  const listHeaders = isTransactional ? null : {
    'List-Unsubscribe': `<${unsubUrl(to)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  if (LIVE && approvalRequired()) {
    // HYBRID review flow: personal emails → a draft in support@'s Gmail (Karmel sends from her inbox);
    // bulk templates or an explicit prefer:'outbox' → the HQ Outbox (Resend), reviewed in the dashboard.
    const bulk = BULK_TEMPLATES.has(template) || prefer === 'outbox';
    if (!bulk && gmaildraft.isEnabled()) {
      const d = await gmaildraft.createDraft({ to, subject, html });
      const status = d.ok ? 'gmail-draft' : 'failed';
      try {
        db.prepare(`INSERT INTO emails (to_email,to_user_id,template,subject,status,related_type,related_id,error,html)
          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(to, to_user_id, template, subject, status, related_type, related_id == null ? null : String(related_id), d.ok ? null : d.error, html);
      } catch (e) { console.error('[mailer] could not log gmail draft', e); }
      return { status, error: d.error };
    }
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
        body: JSON.stringify(Object.assign({ from: EMAIL_FROM, to: [to], subject, html, reply_to: EMAIL_REPLY_TO },
          listHeaders ? { headers: listHeaders } : {})),
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
    AND status IN ('sent','dev-logged','held','gmail-draft') LIMIT 1`)
    .get(template, to_user_id, related_type, String(related_id));
}

// Deliver one HELD email after Karmel approves it in HQ. The only path out of the outbox.
async function deliverHeld(id) {
  const row = db.prepare("SELECT * FROM emails WHERE id = ? AND status = 'held'").get(id);
  if (!row) return { status: 'failed', error: 'Not found or not awaiting approval.' };
  if (!row.html) return { status: 'failed', error: 'No stored body for this email.' };
  // The held body already carries this recipient's personalized footer link; re-add the
  // one-click header for marketing mail (the stored HTML can't carry SMTP headers).
  const listHeaders = TRANSACTIONAL_TEMPLATES.has(row.template) ? null : {
    'List-Unsubscribe': `<${unsubUrl(row.to_email)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  let status = 'failed', error = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: EMAIL_FROM, to: [row.to_email], subject: row.subject, html: row.html, reply_to: EMAIL_REPLY_TO },
        listHeaders ? { headers: listHeaders } : {})),
    });
    if (res.ok) status = 'sent';
    else error = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
  } catch (e) { error = String(e).slice(0, 300); }
  db.prepare(`UPDATE emails SET status = ?, error = ? WHERE id = ?`).run(status, error, id);
  return { status, error };
}

module.exports = { send, alreadySent, deliverHeld, LIVE, TEMPLATES, EMAIL_FROM,
  unsubToken, verifyUnsubToken, unsubUrl, recordUnsubscribe, isUnsubscribed };
