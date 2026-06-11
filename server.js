// app.momni.com — Momni 2.0 web app server
// Sacred rules live in code here too:
//  - Momni never touches care payments (no care-payment routes exist, by design)
//  - No vetting: the platform stores what members choose to share, nothing more
//  - The booking clickwrap is recorded verbatim with a timestamp on every Link
// Load .env if present (no dependency needed)
try {
  require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8')
    .split('\n').forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    });
} catch (e) { /* no .env — fine */ }

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, seed } = require('./db');
const mailer = require('./mailer');
const calendar = require('./calendar');

seed(); // no-op if already seeded

const app = express();
// JSON body parsing everywhere EXCEPT the Stripe webhook (which needs the raw body for signature checks)
app.use((req, res, next) => req.path === '/api/stripe/webhook' ? next() : express.json()(req, res, next));
app.use(express.urlencoded({ extended: true }));
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD) app.set('trust proxy', 1); // Render/Netlify-style proxy → secure cookies work
// Refuse to boot in production with the public default session secret (forgeable sessions otherwise).
if (IS_PROD && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production.');
// Admin = accounts whose email is in ADMIN_EMAILS. Registration of these addresses is BLOCKED (see /api/register),
// so an account can only hold an admin email via verified Google sign-in or out-of-band seeding — never self-registration.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'karmel@momni.com').toLowerCase().split(',').map(s => s.trim());
// First-boot admin bootstrap: the reserved admin email can't self-register (see /api/register),
// so on a fresh database it's created here from ADMIN_BOOTSTRAP_PASSWORD. One-time: once the
// account exists this is a no-op — delete the env var after your first sign-in.
if (process.env.ADMIN_BOOTSTRAP_PASSWORD) {
  const adminEmail = ADMIN_EMAILS[0];
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
    db.prepare('INSERT INTO users (email,password_hash,name,is_admin) VALUES (?,?,?,1)')
      .run(adminEmail, bcrypt.hashSync(process.env.ADMIN_BOOTSTRAP_PASSWORD, 10), 'Karmel');
    console.log(`Admin account created for ${adminEmail}. Remove ADMIN_BOOTSTRAP_PASSWORD from the environment now.`);
  }
}
const sessionStore = require('./session-store')(session, db);
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'momni-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

// Dependency-free, in-memory rate limiter (single-instance beta). Keeps brute-force
// password guessing and account-enumeration spam off the auth routes. Keyed by client IP.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  const mw = (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    let rec = hits.get(ip);
    if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; hits.set(ip, rec); }
    rec.count++;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: message || 'Too many tries — give it a minute, mama.' });
    }
    next();
  };
  mw.sweep = () => { const now = Date.now(); for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip); };
  return mw;
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many attempts. Please wait a few minutes and try again.' });
// Periodically drop expired buckets so the Map can't grow unbounded.
const _rlSweep = setInterval(() => authLimiter.sweep(), 1000 * 60 * 30);
if (_rlSweep.unref) _rlSweep.unref();
app.use(express.static(path.join(__dirname, 'public')));

const ACKNOWLEDGMENT_TEXT = 'I understand Momni is a community platform, not a childcare provider. Momni does not vet, screen, or endorse any member. I am solely responsible for choosing and evaluating my children’s care, just as I would when choosing a trusted friend. Care payments are between me and my Momni.';

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in first, mama.' });
  next();
}
// Privacy: public payloads only ever carry ~neighborhood-level coords (2 decimals);
// precise lat/lng stays in the DB and never leaves the server.
const round2 = (v) => (v == null ? v : Math.round(v * 100) / 100);
const userPublic = (u) => ({
  id: u.id, name: u.name, city: u.city, lat: round2(u.lat), lng: round2(u.lng),
  is_host: !!u.is_host, bio: u.bio, care_types: JSON.parse(u.care_types || '[]'),
  kids_note: u.kids_note || '', neighborhood: u.neighborhood || '',
  home_highlights: u.home_highlights || '',
  availability: JSON.parse(u.availability || '{}'),
  available_now: !!u.available_now, hourly_note: u.hourly_note,
  shared_items: JSON.parse(u.shared_items || '[]'), legacy_1_0: !!u.legacy_1_0
});

// ---------- auth ----------
app.post('/api/register', authLimiter, (req, res) => {
  const { email, password, name, city, acknowledged } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
  if (!acknowledged) return res.status(400).json({ error: 'One quick checkbox first, mama — it’s how we all stay on the same page about how Momni works.' });
  if (ADMIN_EMAILS.includes(email.toLowerCase().trim())) return res.status(403).json({ error: 'That address is reserved for Momni HQ.' });
  try {
    const info = db.prepare(`INSERT INTO users (email,password_hash,name,city,signup_ack_text,signup_ack_at)
      VALUES (?,?,?,?,?,datetime('now'))`)
      .run(email.toLowerCase().trim(), bcrypt.hashSync(password, 10), name.trim(), (city || '').trim(), ACKNOWLEDGMENT_TEXT);
    mailer.send({ to: email.toLowerCase().trim(), to_user_id: info.lastInsertRowid, template: 'welcome', vars: { name: name.trim() } });
    // Regenerate the session on auth so a pre-login session id can't be fixated.
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not start your session — please try again.' });
      req.session.userId = info.lastInsertRowid;
      res.json({ ok: true, id: info.lastInsertRowid });
    });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'That email is already in the Circle — try signing in.' });
    throw e;
  }
});

app.post('/api/login', authLimiter, (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.status(401).json({ error: 'Email or password didn’t match.' });
  }
  // Regenerate the session on auth so a pre-login session id can't be fixated.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start your session — please try again.' });
    req.session.userId = u.id;
    res.json({ ok: true, id: u.id, name: u.name });
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ---------- Google sign-in (OAuth 2.0 authorization-code flow) ----------
// Configure at console.cloud.google.com → Credentials → OAuth client ID (Web).
// Authorized redirect URI: {APP_URL}/auth/google/callback
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_ID) return res.redirect('/index.html?google=unconfigured');
  const params = new URLSearchParams({
    client_id: GOOGLE_ID,
    redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.code) return res.redirect('/index.html?google=denied');
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: GOOGLE_ID,
        client_secret: GOOGLE_SECRET,
        redirect_uri: `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();
    if (!info.email || !info.email_verified) return res.redirect('/index.html?google=denied');
    const email = info.email.toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      const placeholder = bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);
      const ins = db.prepare('INSERT INTO users (email,password_hash,name) VALUES (?,?,?)')
        .run(email, placeholder, info.given_name ? `${info.given_name} ${(info.family_name || '').charAt(0)}.`.trim() : email.split('@')[0]);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(ins.lastInsertRowid);
    }
    const uid = user.id;
    req.session.regenerate((err) => {
      if (err) return res.redirect('/index.html?google=error');
      req.session.userId = uid;
      res.redirect('/home.html');
    });
  } catch (e) {
    console.error('google auth error', e);
    res.redirect('/index.html?google=error');
  }
});

// ---------- calendar sync (host connects the calendar she already uses; inert until Google creds + OAuth verification are set up) ----------
app.get('/auth/calendar', requireAuth, (req, res) => {
  if (!calendar.isEnabled()) return res.redirect('/me.html?calendar=unconfigured');
  res.redirect(calendar.connectUrl(req.session.userId));
});
app.get('/auth/calendar/callback', async (req, res) => {
  if (!req.session.userId) return res.redirect('/index.html');
  if (!req.query.code) return res.redirect('/me.html?calendar=denied');
  try {
    const r = await calendar.handleCallback(req.query.code, req.session.userId);
    res.redirect(r.ok ? '/me.html?calendar=connected' : '/me.html?calendar=error');
  } catch (e) { console.error('calendar callback', e); res.redirect('/me.html?calendar=error'); }
});
app.get('/api/me/calendar', requireAuth, (req, res) => {
  const conn = calendar.getConnection(req.session.userId);
  res.json({ enabled: calendar.isEnabled(), connected: !!conn, email: conn ? conn.calendar_email : null });
});
app.delete('/api/me/calendar', requireAuth, (req, res) => { calendar.disconnect(req.session.userId); res.json({ ok: true }); });
// A host's busy blocks, for showing real availability (times only — never event titles/details). Sign-in required.
app.get('/api/hosts/:id/freebusy', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to (ISO timestamps) are required.' });
  const busy = await calendar.getBusy(Number(req.params.id), from, to);
  res.json({ connected: busy !== null, busy: busy || [] });
});

// ---------- me ----------
app.get('/api/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const reviews = db.prepare('SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE subject_id = ?').get(u.id);
  res.json({ ...userPublic(u), email: u.email, links_balance: u.links_balance,
    momni_plus: !!u.momni_plus, circle_up: !!u.circle_up, gives_toggle: !!u.gives_toggle,
    rating: reviews.n ? Number(reviews.avg.toFixed(1)) : null, review_count: reviews.n });
});

app.put('/api/me', requireAuth, (req, res) => {
  const allowed = ['name','city','bio','is_host','care_types','available_now','hourly_note','gives_toggle','lat','lng',
    'kids_note','neighborhood','home_highlights','availability'];
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  if ('care_types' in updates) updates.care_types = JSON.stringify(updates.care_types);
  if ('availability' in updates) updates.availability = JSON.stringify(updates.availability);
  for (const boolKey of ['is_host','available_now','gives_toggle']) if (boolKey in updates) updates[boolKey] = updates[boolKey] ? 1 : 0;
  const keys = Object.keys(updates);
  if (!keys.length) return res.json({ ok: true });
  db.prepare(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map(k => updates[k]), u.id);
  res.json({ ok: true });
});

app.put('/api/me/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'New password needs at least 8 characters.' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current_password || '', u.password_hash)) return res.status(401).json({ error: 'Current password didn’t match.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), u.id);
  res.json({ ok: true });
});

// Member-shared items (e.g., a background check SHE purchased and chooses to display).
// Stored as her content with her label — never as Momni verification.
// Link-out model: she may attach a link to HER provider's own result page (allowlisted
// real consumer-check providers only) plus an "as of" date she enters. Momni never
// receives, hosts, or displays the report's contents — only her link and her date.
const BGC_LINK_HOSTS = ['personal.checkr.com', 'checkr.com', 'goodhire.com'];
app.post('/api/me/shared-items', requireAuth, (req, res) => {
  const { type, label, url, as_of } = req.body;
  if (!type || !label) return res.status(400).json({ error: 'type and label required' });
  const item = { type, label: String(label).slice(0, 120), added_at: new Date().toISOString() };
  if (type === 'background_check') {
    if (url) {
      let host;
      try {
        const parsed = new URL(String(url));
        if (parsed.protocol !== 'https:') throw new Error('not https');
        host = parsed.hostname.toLowerCase();
      } catch (e) {
        return res.status(400).json({ error: 'That link doesn’t look right — paste the full https link from your provider.' });
      }
      if (!BGC_LINK_HOSTS.some(d => host === d || host.endsWith('.' + d))) {
        return res.status(400).json({ error: 'For now, links can point to Checkr or GoodHire result pages. Using another provider? Tell us with the feedback button.' });
      }
      item.url = String(url).slice(0, 300);
    }
    if (as_of) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(as_of))) return res.status(400).json({ error: 'The “as of” date didn’t look like a date.' });
      item.as_of = String(as_of);
    }
  }
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  // one item per type: sharing again replaces, so her profile shows her latest
  const items = JSON.parse(u.shared_items || '[]').filter(it => it.type !== type);
  items.push(item);
  db.prepare('UPDATE users SET shared_items = ? WHERE id = ?').run(JSON.stringify(items), u.id);
  res.json({ ok: true, shared_items: items });
});
// She can take a shared item down anytime — it's hers.
app.delete('/api/me/shared-items/:type', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const items = JSON.parse(u.shared_items || '[]').filter(it => it.type !== req.params.type);
  db.prepare('UPDATE users SET shared_items = ? WHERE id = ?').run(JSON.stringify(items), u.id);
  res.json({ ok: true, shared_items: items });
});

// ---------- search ----------
function haversineMi(lat1, lng1, lat2, lng2) {
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 3958.8 * Math.asin(Math.sqrt(a)); // Earth radius in miles
}

app.get('/api/hosts', (req, res) => {
  const { care_type, available_now, lat, lng, radius_mi } = req.query;
  let rows = db.prepare('SELECT * FROM users WHERE is_host = 1').all();
  if (care_type) rows = rows.filter(r => JSON.parse(r.care_types).includes(care_type));
  if (available_now === '1') rows = rows.filter(r => r.available_now);
  // Nearness: distance is computed from the SAME rounded coords we expose (userPublic), never the precise
  // DB coords — otherwise repeated probes could trilaterate a host's exact home and defeat the neighborhood
  // blur that protects her ("never your exact address"). Distance can't resolve finer than ~0.7mi.
  const qLat = parseFloat(lat), qLng = parseFloat(lng);
  const hasPoint = Number.isFinite(qLat) && Number.isFinite(qLng);
  const dist = new Map();
  if (hasPoint) {
    for (const r of rows) dist.set(r.id, (r.lat == null || r.lng == null) ? null : haversineMi(qLat, qLng, round2(r.lat), round2(r.lng)));
    const radius = parseFloat(radius_mi);
    if (radius_mi && radius_mi !== 'all' && Number.isFinite(radius) && radius > 0) {
      rows = rows.filter(r => dist.get(r.id) != null && dist.get(r.id) <= radius);
    }
    rows.sort((a, b) => {
      const da = dist.get(a.id), dbv = dist.get(b.id);
      if (da == null && dbv == null) return 0;
      if (da == null) return 1;
      if (dbv == null) return -1;
      return da - dbv;
    });
  }
  const ratings = db.prepare('SELECT subject_id, AVG(rating) avg, COUNT(*) n FROM reviews GROUP BY subject_id').all()
    .reduce((m, r) => (m[r.subject_id] = r, m), {});
  res.json(rows.map(r => ({ ...userPublic(r),
    ...(hasPoint ? { distance_mi: dist.get(r.id) == null ? null : Number(dist.get(r.id).toFixed(1)) } : {}),
    rating: ratings[r.id] ? Number(ratings[r.id].avg.toFixed(1)) : null,
    review_count: ratings[r.id] ? ratings[r.id].n : 0 })));
});

app.get('/api/hosts/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ? AND is_host = 1').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const reviews = db.prepare(`SELECT r.rating, r.body, r.created_at, a.name author
    FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.subject_id = ? ORDER BY r.created_at DESC`).all(u.id);
  res.json({ ...userPublic(u), reviews });
});

app.get('/api/map', (req, res) => {
  const hosts = db.prepare('SELECT * FROM users WHERE is_host = 1 AND lat IS NOT NULL').all().map(userPublic);
  const circles = db.prepare('SELECT * FROM circles').all();
  const legacy = db.prepare('SELECT city, lat, lng, count FROM legacy_pins').all(); // anonymized, city-level only
  const litUp = db.prepare('SELECT COUNT(*) c FROM users WHERE legacy_1_0 = 1').get().c;
  const firstMamas = legacy.reduce((s, p) => s + p.count, 0);
  res.json({ hosts, circles, legacy, counters: { first_mamas: firstMamas, lit_up: litUp + 287 } });
});

// ---------- links (a $1 Link per booking — the ONLY thing Momni ever charges for care) ----------
app.post('/api/links', requireAuth, (req, res) => {
  const { host_id, care_type, details, acknowledged, message } = req.body;
  if (!acknowledged) return res.status(400).json({ error: 'The acknowledgment checkbox is required before a Link can be sent.' });
  if (!['one-time','recurring','overnight'].includes(care_type)) return res.status(400).json({ error: 'Unknown care type.' });
  const host = db.prepare('SELECT * FROM users WHERE id = ? AND is_host = 1').get(host_id);
  if (!host) return res.status(404).json({ error: 'That Momni was not found.' });
  if (host.id === req.session.userId) return res.status(400).json({ error: 'You cannot Link with yourself, mama.' });
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!me.momni_plus && me.links_balance < 1) {
    return res.status(402).json({ error: 'You’re out of Links. Buy a bundle (10 for $10) or go Momni+ for unlimited.' });
  }
  const info = db.prepare(`INSERT INTO links (guest_id,host_id,care_type,details,acknowledgment_text,acknowledged_at)
    VALUES (?,?,?,?,?,datetime('now'))`)
    .run(me.id, host.id, care_type, JSON.stringify(details || {}), ACKNOWLEDGMENT_TEXT);
  const firstMessage = typeof message === 'string' ? message.trim().slice(0, 2000) : '';
  if (firstMessage) db.prepare('INSERT INTO messages (link_id,sender_id,body) VALUES (?,?,?)')
    .run(info.lastInsertRowid, me.id, firstMessage);
  if (!me.momni_plus) db.prepare('UPDATE users SET links_balance = links_balance - 1 WHERE id = ?').run(me.id);
  mailer.send({ to: host.email, to_user_id: host.id, template: 'booking_request', vars: { guest: me.name, care_type }, related_type: 'link', related_id: info.lastInsertRowid });
  res.json({ ok: true, link_id: info.lastInsertRowid, host_name: host.name });
});

app.get('/api/links', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db.prepare(`SELECT l.*, h.name host_name, g.name guest_name
    FROM links l JOIN users h ON h.id = l.host_id JOIN users g ON g.id = l.guest_id
    WHERE l.guest_id = ? OR l.host_id = ? ORDER BY l.created_at DESC`)
    .all(me, me);
  const nextVisitStmt = db.prepare(`SELECT * FROM visits WHERE link_id = ?
    AND status IN ('scheduled','checked_in') ORDER BY date, id LIMIT 1`);
  const visitCountStmt = db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) done FROM visits WHERE link_id = ?`);
  const msgStmt = db.prepare('SELECT COUNT(*) n, MAX(created_at) last FROM messages WHERE link_id = ?');
  const reviewStmt = db.prepare('SELECT author_id FROM reviews WHERE link_id = ?');
  res.json(rows.map(r => {
    const vc = visitCountStmt.get(r.id);
    const mc = msgStmt.get(r.id);
    const reviewers = reviewStmt.all(r.id).map(x => x.author_id);
    return { ...r, details: JSON.parse(r.details), i_am_host: r.host_id === me,
      next_visit: nextVisitStmt.get(r.id) || null,
      visits_total: vc.total, visits_completed: vc.done || 0,
      message_count: mc.n, last_message_at: mc.last,
      my_review: reviewers.includes(me),
      their_review: reviewers.some(id => id !== me) };
  }));
});

app.put('/api/links/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  const isHost = link.host_id === req.session.userId, isGuest = link.guest_id === req.session.userId;
  if (!isHost && !isGuest) return res.status(403).json({ error: 'Not your Link.' });
  const allowed = isHost ? ['confirmed','declined','completed'] : ['cancelled','completed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Not a change you can make on this Link.' });
  // A wrapped-up Link can't change again; re-sending the same status is a harmless no-op (don't re-fire emails/calendar).
  if (['completed','declined','cancelled'].includes(link.status)) return res.status(400).json({ error: 'This Link is already wrapped up.' });
  if (link.status === status) return res.json({ ok: true });
  db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, link.id);
  if (status === 'confirmed') {
    generateVisitsForLink(link);
    const guest = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(link.guest_id);
    const host = db.prepare('SELECT id,name FROM users WHERE id = ?').get(link.host_id);
    if (guest) mailer.send({ to: guest.email, to_user_id: guest.id, template: 'booking_confirmed', vars: { host: host ? host.name : 'your Momni' }, related_type: 'link', related_id: link.id });
    // Drop each scheduled visit onto the host's connected calendar (inert if she hasn't connected one).
    if (calendar.isConnected(link.host_id)) {
      for (const v of db.prepare("SELECT * FROM visits WHERE link_id = ? AND status = 'scheduled'").all(link.id)) {
        calendar.createEvent(link.host_id, {
          summary: `Momni: ${guest ? guest.name : 'a mama'}'s littles`,
          description: `Booked through Momni (${link.care_type}). Care payment is arranged directly between you two.`,
          date: v.date, startTime: v.start_time, endTime: v.end_time,
          attendeeEmail: guest ? guest.email : null,
        }).catch(() => {});
      }
    }
  }
  res.json({ ok: true });
});

// ---------- messages (the thread between the two mamas on a Link — participants only) ----------
function linkForParticipant(req, res) {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) { res.status(404).json({ error: 'Not found' }); return null; }
  if (link.guest_id !== req.session.userId && link.host_id !== req.session.userId) {
    res.status(403).json({ error: 'Not your Link.' });
    return null;
  }
  return link;
}

app.get('/api/links/:id/messages', requireAuth, (req, res) => {
  const link = linkForParticipant(req, res);
  if (!link) return;
  const rows = db.prepare(`SELECT m.id, m.sender_id, u.name sender_name, m.body, m.created_at
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.link_id = ? ORDER BY m.created_at, m.id`).all(link.id);
  res.json(rows.map(m => ({ ...m, mine: m.sender_id === req.session.userId })));
});

app.post('/api/links/:id/messages', requireAuth, (req, res) => {
  const link = linkForParticipant(req, res);
  if (!link) return;
  const body = String(req.body.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Say a little something first, mama.' });
  const info = db.prepare('INSERT INTO messages (link_id,sender_id,body) VALUES (?,?,?)')
    .run(link.id, req.session.userId, body);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ---------- visits (the shared drop-off/pick-up timeline both mamas can see — coordination, never supervision) ----------
// When a host confirms, build the timeline from the Link's details (once; never duplicates).
function generateVisitsForLink(link) {
  if (db.prepare('SELECT COUNT(*) c FROM visits WHERE link_id = ?').get(link.id).c > 0) return;
  let d;
  try { d = JSON.parse(link.details || '{}'); } catch (e) { d = {}; }
  if (!d.start_date) return; // nothing to schedule from
  const ins = db.prepare('INSERT INTO visits (link_id,date,end_date,start_time,end_time) VALUES (?,?,?,?,?)');
  const st = d.start_time || null, et = d.end_time || null;
  if (link.care_type === 'overnight') return void ins.run(link.id, d.start_date, d.end_date || null, st, et);
  if (link.care_type === 'recurring' && Array.isArray(d.weekdays) && d.weekdays.length) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d.start_date));
    if (!m) return;
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const startUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const tx = db.transaction(() => {
      for (let i = 0; i < 28; i++) { // 28 days from start_date; start_date itself counts if it matches
        const day = new Date(startUtc + i * 86400000);
        if (d.weekdays.includes(names[day.getUTCDay()])) ins.run(link.id, day.toISOString().slice(0, 10), null, st, et);
      }
    });
    tx();
    return;
  }
  // one-time — or recurring with no weekdays picked — gets a single visit on start_date
  ins.run(link.id, d.start_date, null, st, et);
}

app.get('/api/links/:id/visits', requireAuth, (req, res) => {
  const link = linkForParticipant(req, res);
  if (!link) return;
  res.json(db.prepare('SELECT * FROM visits WHERE link_id = ? ORDER BY date, id').all(link.id));
});

app.post('/api/links/:id/visits', requireAuth, (req, res) => {
  const link = linkForParticipant(req, res);
  if (!link) return;
  if (link.status !== 'confirmed') return res.status(400).json({ error: 'Visits can be added once the Link is confirmed.' });
  const { date, end_date, start_time, end_time } = req.body;
  if (!date) return res.status(400).json({ error: 'Pick a date first, mama.' });
  const info = db.prepare('INSERT INTO visits (link_id,date,end_date,start_time,end_time) VALUES (?,?,?,?,?)')
    .run(link.id, String(date), end_date || null, start_time || null, end_time || null);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.put('/api/visits/:id', requireAuth, (req, res) => {
  const { action } = req.body;
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Not found' });
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(visit.link_id);
  if (link.guest_id !== req.session.userId && link.host_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not your Link.' });
  }
  if (action === 'checkin') {
    if (visit.status !== 'scheduled') return res.status(400).json({ error: 'Only a scheduled visit can be checked in.' });
    db.prepare(`UPDATE visits SET status = 'checked_in', checkin_at = datetime('now') WHERE id = ?`).run(visit.id);
    return res.json({ ok: true, status: 'checked_in', link_status: link.status });
  }
  if (action === 'checkout') {
    if (visit.status !== 'checked_in' && visit.status !== 'scheduled') {
      return res.status(400).json({ error: 'This visit is already wrapped up.' });
    }
    db.prepare(`UPDATE visits SET status = 'completed', checkout_at = datetime('now') WHERE id = ?`).run(visit.id);
    // One-time and overnight Links complete themselves when the last visit checks out.
    // Recurring Links stay confirmed until a mama marks them completed herself.
    let linkStatus = link.status;
    if ((link.care_type === 'one-time' || link.care_type === 'overnight') && link.status === 'confirmed') {
      const open = db.prepare(`SELECT COUNT(*) c FROM visits WHERE link_id = ?
        AND status IN ('scheduled','checked_in')`).get(link.id).c;
      if (!open) {
        db.prepare(`UPDATE links SET status = 'completed' WHERE id = ?`).run(link.id);
        linkStatus = 'completed';
      }
    }
    // Both mamas get one review request per Link the moment a visit wraps up (guarded against double-sends).
    const g = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(link.guest_id);
    const h = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(link.host_id);
    for (const [who, other] of [[g, h], [h, g]]) {
      if (who && other && !mailer.alreadySent({ template: 'review_request', to_user_id: who.id, related_type: 'link', related_id: link.id })) {
        mailer.send({ to: who.email, to_user_id: who.id, template: 'review_request', vars: { other: other.name }, related_type: 'link', related_id: link.id });
      }
    }
    return res.json({ ok: true, status: 'completed', link_status: linkStatus });
  }
  if (action === 'cancel') {
    if (visit.status !== 'scheduled') return res.status(400).json({ error: 'Only a scheduled visit can be cancelled.' });
    db.prepare(`UPDATE visits SET status = 'cancelled' WHERE id = ?`).run(visit.id);
    return res.json({ ok: true, status: 'cancelled', link_status: link.status });
  }
  return res.status(400).json({ error: 'Unknown action.' });
});

// ---------- reviews (member content, both directions) ----------
app.post('/api/reviews', requireAuth, (req, res) => {
  const { link_id, rating, body } = req.body;
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(link_id);
  if (!link) return res.status(400).json({ error: 'Reviews come after a completed visit or Link.' });
  const me = req.session.userId;
  if (me !== link.guest_id && me !== link.host_id) return res.status(403).json({ error: 'Not your Link.' });
  const completedVisit = db.prepare(`SELECT id FROM visits WHERE link_id = ? AND status = 'completed' LIMIT 1`).get(link.id);
  if (link.status !== 'completed' && !completedVisit) {
    return res.status(400).json({ error: 'Reviews come after a completed visit or Link.' });
  }
  const subject = me === link.guest_id ? link.host_id : link.guest_id;
  const dup = db.prepare('SELECT id FROM reviews WHERE link_id = ? AND author_id = ?').get(link_id, me);
  if (dup) return res.status(409).json({ error: 'You already reviewed this Link.' });
  db.prepare('INSERT INTO reviews (link_id,author_id,subject_id,rating,body) VALUES (?,?,?,?,?)')
    .run(link_id, me, subject, Math.max(1, Math.min(5, rating | 0)), (body || '').slice(0, 2000));
  res.json({ ok: true });
});

// ---------- circles ----------
app.get('/api/circles', (req, res) => res.json(db.prepare('SELECT * FROM circles').all()));
app.post('/api/circles', requireAuth, (req, res) => {
  const { name, city, meets } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Your Circle needs a name, mama.' });
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const info = db.prepare('INSERT INTO circles (name,city,meets,member_count) VALUES (?,?,?,1)')
    .run(name.trim().slice(0, 80), (city || me.city || '').slice(0, 60), (meets || 'Schedule coming soon').slice(0, 120));
  db.prepare('INSERT INTO circle_members (circle_id,user_id) VALUES (?,?)').run(info.lastInsertRowid, me.id);
  res.json({ ok: true, circle_id: info.lastInsertRowid });
});
app.post('/api/circles/:id/join', requireAuth, (req, res) => {
  try {
    db.prepare('INSERT INTO circle_members (circle_id,user_id) VALUES (?,?)').run(req.params.id, req.session.userId);
    db.prepare('UPDATE circles SET member_count = member_count + 1 WHERE id = ?').run(req.params.id);
  } catch (e) { /* already a member — fine */ }
  res.json({ ok: true });
});

// ---------- purchases (Momni's only revenue — NEVER care payments) ----------
// With STRIPE_SECRET_KEY set, purchases go through Stripe Checkout and are
// fulfilled by the webhook below. Without it (local dev), purchases are granted
// directly so the app stays testable.
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
// If live charging is on, the webhook MUST be able to verify signatures — refuse to boot otherwise.
if (stripe && !process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is set.');
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const PRODUCTS = {
  'links-10':   { name: '10 Links — Link Together bundle', amount: 1000, mode: 'payment',
                  fulfill: (uid) => db.prepare('UPDATE users SET links_balance = links_balance + 10 WHERE id = ?').run(uid) },
  'momni-plus': { name: 'Momni+ (annual)', amount: 4900, mode: 'payment', // simple annual pass for v1; recurring later
                  fulfill: (uid) => db.prepare('UPDATE users SET momni_plus = 1 WHERE id = ?').run(uid) },
  'circle-up':  { name: 'Circle Up membership ($1/mo, billed $12/yr)', amount: 1200, mode: 'payment',
                  fulfill: (uid) => db.prepare('UPDATE users SET circle_up = 1, links_balance = links_balance + 2 WHERE id = ?').run(uid) },
};

async function checkoutOrGrant(req, res, productKey) {
  const product = PRODUCTS[productKey];
  if (!stripe) { // dev mode
    product.fulfill(req.session.userId);
    return res.json({ ok: true, note: `DEV MODE: ${product.name} granted without charge (set STRIPE_SECRET_KEY in production).` });
  }
  const sess = await stripe.checkout.sessions.create({
    mode: product.mode,
    line_items: [{ quantity: 1, price_data: {
      currency: 'usd', unit_amount: product.amount, product_data: { name: product.name } } }],
    metadata: { user_id: String(req.session.userId), product: productKey },
    success_url: `${APP_URL}/links.html?purchase=success`,
    cancel_url: `${APP_URL}/links.html?purchase=cancelled`,
  });
  res.json({ ok: true, checkout_url: sess.url });
}

app.post('/api/purchase/links', requireAuth, (req, res, next) => checkoutOrGrant(req, res, 'links-10').catch(next));
app.post('/api/purchase/momni-plus', requireAuth, (req, res, next) => checkoutOrGrant(req, res, 'momni-plus').catch(next));
app.post('/api/purchase/circle-up', requireAuth, (req, res, next) => checkoutOrGrant(req, res, 'circle-up').catch(next));

// Stripe webhook — fulfillment happens here, after real payment.
// Configure the endpoint in the Stripe dashboard with STRIPE_WEBHOOK_SECRET.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(503).end();
  // Fail closed: never fulfill an unsigned/unverifiable event.
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook not configured.');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
  // Idempotency: Stripe retries — never fulfill the same event twice.
  try { db.prepare('INSERT INTO stripe_events (id) VALUES (?)').run(event.id); }
  catch (e) { return res.json({ received: true, duplicate: true }); }
  if (event.type === 'checkout.session.completed') {
    const { user_id, product } = event.data.object.metadata || {};
    if (user_id && PRODUCTS[product]) PRODUCTS[product].fulfill(Number(user_id));
  }
  res.json({ received: true });
});

app.get('/api/acknowledgment', (req, res) => res.json({ text: ACKNOWLEDGMENT_TEXT }));

// ---------- reports (any member can flag; Karmel reviews) ----------
app.post('/api/reports', requireAuth, (req, res) => {
  const { subject_type, subject_id, reason, details } = req.body;
  if (!subject_type || !subject_id || !reason) return res.status(400).json({ error: 'subject and reason required' });
  db.prepare('INSERT INTO reports (reporter_id,subject_type,subject_id,reason,details) VALUES (?,?,?,?,?)')
    .run(req.session.userId, subject_type, String(subject_id), reason, (details || '').slice(0, 2000));
  res.json({ ok: true, note: 'Thank you — Karmel reviews every report.' });
});

// ---------- in-app feedback (lands in Karmel's Suggestions queue) ----------
app.post('/api/feedback', requireAuth, (req, res) => {
  const { body, page } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Tell us a little something first, mama.' });
  const me = db.prepare('SELECT name FROM users WHERE id = ?').get(req.session.userId);
  db.prepare("INSERT INTO suggestions (source,submitted_by,body,page) VALUES ('in-app',?,?,?)")
    .run(me.name, String(body).trim().slice(0, 4000), String(page || '').slice(0, 200));
  res.json({ ok: true, note: 'Thank you, mama — your idea is in Karmel’s queue. The Circle is built by YOU. 💜' });
});

// ---------- founder admin (Momni HQ) ----------
// ADMIN_EMAILS is defined near the top. Because /api/register blocks those addresses,
// an account can only carry an admin email via verified Google sign-in or seeding.
function syncAdminFlag(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (u && ADMIN_EMAILS.includes(u.email) && !u.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
  }
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Sign in first.' });
  syncAdminFlag(req.session.userId);
  const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!u || !u.is_admin) return res.status(403).json({ error: 'This room is Karmel-only.' });
  next();
}

app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const q = (sql) => db.prepare(sql).get().c;
  res.json({
    mamas: q('SELECT COUNT(*) c FROM users'),
    hosts: q('SELECT COUNT(*) c FROM users WHERE is_host = 1'),
    links_week: q("SELECT COUNT(*) c FROM links WHERE created_at > datetime('now','-7 days')"),
    links_total: q('SELECT COUNT(*) c FROM links'),
    completed: q("SELECT COUNT(*) c FROM links WHERE status = 'completed'"),
    reviews: q('SELECT COUNT(*) c FROM reviews'),
    circles: q('SELECT COUNT(*) c FROM circles'),
    gives: q('SELECT COUNT(*) c FROM users WHERE gives_toggle = 1'),
    open_reports: q("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
  });
});
app.get('/api/admin/reports', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT r.*, u.name reporter_name FROM reports r
    JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.created_at DESC`).all());
});
app.put('/api/admin/reports/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['actioned','dismissed','reviewing'].includes(status)) return res.status(400).json({ error: 'bad status' });
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const search = `%${(req.query.q || '')}%`;
  res.json(db.prepare(`SELECT id,name,email,city,is_host,available_now,links_balance,momni_plus,created_at
    FROM users WHERE name LIKE ? OR email LIKE ? OR city LIKE ? ORDER BY created_at DESC LIMIT 100`)
    .all(search, search, search));
});
app.get('/api/admin/links', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT l.id,l.care_type,l.status,l.created_at,g.name guest,h.name host
    FROM links l JOIN users g ON g.id=l.guest_id JOIN users h ON h.id=l.host_id
    ORDER BY l.created_at DESC LIMIT 50`).all());
});
// Admin password reset: HQ sets a temporary password, mama changes it after signing in.
app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const temp = 'circle-' + require('crypto').randomBytes(4).toString('hex');
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(temp, 10), req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Mama not found.' });
  res.json({ ok: true, temp_password: temp, note: 'Share this with her privately; she should change it after signing in.' });
});

// Suggestions queue — everything awaiting Karmel's yes/no
app.get('/api/admin/suggestions', requireAdmin, (req, res) => {
  res.json(db.prepare("SELECT * FROM suggestions WHERE status != 'declined' ORDER BY created_at DESC, id DESC").all());
});
// Karmel pastes in feedback emails from developer@momni.com
app.post('/api/admin/suggestions', requireAdmin, (req, res) => {
  const { body, submitted_by, page } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body required' });
  const info = db.prepare("INSERT INTO suggestions (source,submitted_by,body,page) VALUES ('email',?,?,?)")
    .run(String(submitted_by || '').slice(0, 100), String(body).trim().slice(0, 4000), String(page || '').slice(0, 200));
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.put('/api/admin/suggestions/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['approved','declined','shipped'].includes(status)) return res.status(400).json({ error: 'bad status' });
  const r = db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- "Sign in with Momni" — OAuth 2.0 provider for the Momni Boards ----------
// Companion apps authenticate members through the Circle with the authorization-code flow.
//  - PUBLIC clients (the mobile Boards): PKCE (S256) is MANDATORY and they hold no secret —
//    the binary can't keep one. PKCE is enforced by client TYPE, never by a per-request flag,
//    so a request can't downgrade out of it.
//  - CONFIDENTIAL clients (server-side apps): authenticate with a client secret (Basic or body).
// Codes are single-use, 10-minute lifetime; access tokens are stored hashed; expired rows are
// swept. userinfo exposes the membership tier so apps can apply Circle pricing.
const crypto = require('crypto');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const OAUTH_SCOPES = ['profile'];
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const tierOf = (u) => (u.momni_plus ? 'momni_plus' : (u.circle_up ? 'circle_up' : 'free'));
const oauthClient = (id) => db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(String(id || ''));
const clientRedirects = (client) => { try { return JSON.parse(client.redirect_uris || '[]'); } catch (e) { return []; } };
const validRedirect = (client, uri) => clientRedirects(client).includes(String(uri || ''));
const noStore = (res) => res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache');
// Schemes that must never be a redirect target — they'd execute in the member's session if navigated to.
const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'];
function redirectUriAllowed(u) {
  try {
    const p = new URL(u);
    if (DANGEROUS_SCHEMES.includes(p.protocol.toLowerCase())) return false;
    // https anywhere, http only on loopback (dev), or a custom app scheme (choreboard://…) for mobile
    return p.protocol === 'https:'
      || (p.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(p.hostname))
      || (!['http:', 'https:'].includes(p.protocol) && /^[a-z][a-z0-9+.-]*:$/.test(p.protocol));
  } catch (e) { return false; }
}
// Client authentication for the token endpoint: HTTP Basic (client_secret_basic) or POST body.
function parseClientAuth(req) {
  const m = String(req.headers.authorization || '').match(/^Basic (.+)$/);
  if (m) {
    try {
      const [cid, csec] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
      return { client_id: decodeURIComponent(cid || ''), client_secret: decodeURIComponent(csec || '') };
    } catch (e) { /* fall through to body */ }
  }
  const b = req.body || {};
  return { client_id: b.client_id, client_secret: b.client_secret };
}
// Sweep expired/used codes and expired tokens so the tables can't grow unbounded.
const oauthSweep = () => {
  try {
    db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ? OR used = 1').run(Date.now() - 60 * 1000);
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?').run(Date.now());
  } catch (e) { /* ignore */ }
};
oauthSweep();
const _oauthSweepTimer = setInterval(oauthSweep, 60 * 60 * 1000);
if (_oauthSweepTimer.unref) _oauthSweepTimer.unref();

// Apps send members here; the consent page reads context from authorize-info and posts approve.
app.get('/oauth/authorize', (req, res) => res.sendFile(path.join(__dirname, 'public', 'authorize.html')));

// Context for the consent page — fully validates the request before anything is shown.
// Errors the spec says to return to the client (bad scope/response_type/PKCE) come back as a
// ready-built error_redirect; errors we can't trust a redirect for (bad client/redirect) hard-fail.
app.get('/api/oauth/authorize-info', (req, res) => {
  const { client_id, redirect_uri, scope, response_type, code_challenge, code_challenge_method, state } = req.query;
  const client = oauthClient(client_id);
  if (!client) return res.status(400).json({ error: 'This sign-in link isn’t from a registered Momni app.' });
  if (!validRedirect(client, redirect_uri)) return res.status(400).json({ error: 'That app’s return address doesn’t match what’s registered with Momni.' });
  // From here the redirect_uri is trusted, so protocol errors go back to the client per RFC 6749 §4.1.2.1.
  const back = (errCode) => {
    const sep = String(redirect_uri).includes('?') ? '&' : '?';
    return res.json({ error_redirect: `${redirect_uri}${sep}error=${errCode}${state ? `&state=${encodeURIComponent(String(state))}` : ''}` });
  };
  if (response_type !== undefined && response_type !== 'code') return back('unsupported_response_type');
  const scopes = String(scope || 'profile').split(' ').filter(Boolean);
  if (!scopes.length || scopes.some(s => !OAUTH_SCOPES.includes(s))) return back('invalid_scope');
  if (code_challenge && code_challenge_method !== 'S256') return back('invalid_request');
  if (client.client_type === 'public' && !code_challenge) return back('invalid_request'); // public clients MUST use PKCE
  const me = req.session.userId ? db.prepare('SELECT id,name FROM users WHERE id = ?').get(req.session.userId) : null;
  const granted = me ? !!db.prepare('SELECT 1 FROM oauth_user_grants WHERE user_id = ? AND client_id = ?').get(me.id, client.id) : false;
  res.json({ client_name: client.name, signed_in: !!me, user_name: me ? me.name : null, already_granted: granted });
});

// Approve mints a code. requireAuth + a same-origin Origin check; never auto-issued without a fresh
// click (the consent page no longer auto-submits), which closes the lax-cookie forced-authorization path.
app.post('/api/oauth/approve', requireAuth, (req, res) => {
  const origin = req.get('origin');
  const expected = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expected) return res.status(403).json({ error: 'Bad origin.' });
  const { client_id, redirect_uri, state, scope, response_type, code_challenge, code_challenge_method } = req.body;
  const client = oauthClient(client_id);
  if (!client || !validRedirect(client, redirect_uri)) return res.status(400).json({ error: 'Invalid sign-in request.' });
  if (response_type !== undefined && response_type !== 'code') return res.status(400).json({ error: 'Unsupported response type.' });
  const scopes = String(scope || 'profile').split(' ').filter(Boolean);
  if (!scopes.length || scopes.some(s => !OAUTH_SCOPES.includes(s))) return res.status(400).json({ error: 'Unsupported scope.' });
  if (code_challenge && code_challenge_method !== 'S256') return res.status(400).json({ error: 'Only S256 PKCE is supported.' });
  if (client.client_type === 'public' && !code_challenge) return res.status(400).json({ error: 'This app must use PKCE.' });
  const code = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO oauth_codes (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(code, client.id, req.session.userId, String(redirect_uri), scopes.join(' '),
         code_challenge || null, code_challenge ? 'S256' : null, Date.now() + 10 * 60 * 1000);
  db.prepare('INSERT OR IGNORE INTO oauth_user_grants (user_id, client_id) VALUES (?,?)').run(req.session.userId, client.id);
  const sep = String(redirect_uri).includes('?') ? '&' : '?';
  res.json({ redirect: `${redirect_uri}${sep}code=${code}${state ? `&state=${encodeURIComponent(String(state))}` : ''}` });
});

const tokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: 'Too many token requests.' });
app.post('/oauth/token', tokenLimiter, (req, res) => {
  noStore(res);
  const b = req.body || {};
  if (b.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
  const { client_id, client_secret } = parseClientAuth(req);
  const row = db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(String(b.code || ''));
  if (!row || row.used || row.expires_at < Date.now()) return res.status(400).json({ error: 'invalid_grant' });
  const client = oauthClient(client_id);
  if (!client || client.id !== row.client_id || String(b.redirect_uri || '') !== row.redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant' });
  }
  // PKCE: whenever a challenge was recorded, the verifier MUST match. Public clients always have one.
  if (row.code_challenge) {
    const challenge = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
    if (!b.code_verifier || challenge !== row.code_challenge) return res.status(400).json({ error: 'invalid_grant' });
  }
  // Client authentication by TYPE — not by what the request chose to send.
  if (client.client_type === 'public') {
    if (!row.code_challenge) return res.status(400).json({ error: 'invalid_grant' }); // public ⇒ PKCE required, no secret accepted
  } else {
    if (!client_secret || !client.secret_hash || !bcrypt.compareSync(String(client_secret), client.secret_hash)) {
      return res.status(401).json({ error: 'invalid_client' });
    }
  }
  db.prepare('UPDATE oauth_codes SET used = 1 WHERE code = ?').run(row.code);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO oauth_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES (?,?,?,?,?)')
    .run(sha256hex(token), client.id, row.user_id, row.scope, Date.now() + TOKEN_TTL_SECONDS * 1000);
  res.json({ access_token: token, token_type: 'Bearer', expires_in: TOKEN_TTL_SECONDS, scope: row.scope });
});

app.get('/oauth/userinfo', (req, res) => {
  noStore(res);
  const m = String(req.headers.authorization || '').match(/^Bearer (.+)$/);
  if (!m) return res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'invalid_token' });
  const t = db.prepare('SELECT * FROM oauth_tokens WHERE token_hash = ?').get(sha256hex(m[1]));
  if (!t || t.expires_at < Date.now()) return res.set('WWW-Authenticate', 'Bearer error="invalid_token"').status(401).json({ error: 'invalid_token' });
  const u = db.prepare('SELECT id,name,email,momni_plus,circle_up,created_at FROM users WHERE id = ?').get(t.user_id);
  if (!u) return res.set('WWW-Authenticate', 'Bearer error="invalid_token"').status(401).json({ error: 'invalid_token' });
  res.json({ sub: String(u.id), name: u.name, email: u.email, tier: tierOf(u), member_since: u.created_at });
});

// HQ: register the Boards as OAuth clients. A confidential client's secret is shown exactly once.
app.get('/api/admin/oauth/clients', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,client_type,name,redirect_uris,created_at FROM oauth_clients ORDER BY created_at DESC').all());
});
app.post('/api/admin/oauth/clients', requireAdmin, (req, res) => {
  const { name, redirect_uris, client_type } = req.body;
  const type = client_type === 'confidential' ? 'confidential' : 'public'; // default public (the mobile Boards)
  const uris = Array.isArray(redirect_uris) ? redirect_uris.map(u => String(u).trim()).filter(Boolean) : [];
  if (!name || !String(name).trim() || !uris.length) return res.status(400).json({ error: 'A name and at least one redirect URI are required.' });
  for (const u of uris) {
    if (!redirectUriAllowed(u)) return res.status(400).json({ error: `Redirect URI not allowed: ${u} (use https, localhost, or a custom app scheme — not javascript:/data:).` });
  }
  const id = 'momni_' + crypto.randomBytes(8).toString('hex');
  if (type === 'public') {
    db.prepare('INSERT INTO oauth_clients (id, client_type, secret_hash, name, redirect_uris) VALUES (?,?,?,?,?)')
      .run(id, 'public', null, String(name).trim(), JSON.stringify(uris));
    return res.json({ ok: true, client_id: id, client_type: 'public', note: 'Public client — no secret. It must use PKCE (S256).' });
  }
  const secret = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_clients (id, client_type, secret_hash, name, redirect_uris) VALUES (?,?,?,?,?)')
    .run(id, 'confidential', bcrypt.hashSync(secret, 10), String(name).trim(), JSON.stringify(uris));
  res.json({ ok: true, client_id: id, client_type: 'confidential', client_secret: secret, note: 'Copy the secret now — it is shown only this once.' });
});
app.delete('/api/admin/oauth/clients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM oauth_clients WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(req.params.id);
  db.prepare('DELETE FROM oauth_user_grants WHERE client_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- email log + manual sends (welcome / onboarding / reactivation / newsletter) ----------
app.get('/api/admin/emails', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id,to_email,to_user_id,template,subject,status,related_type,related_id,error,created_at
    FROM emails ORDER BY id DESC LIMIT 200`).all());
});
// Send a template to one user (user_id or to=email) or a segment (all | legacy). Dev-safe: logs in dev mode.
const MAX_BROADCAST = 2000; // safety ceiling per call — beyond this, send in batches
app.post('/api/admin/email', requireAdmin, async (req, res) => {
  const { template, user_id, to, segment, vars, confirm } = req.body;
  if (!mailer.TEMPLATES[template]) return res.status(400).json({ error: 'Unknown template.' });
  let recipients = [];
  if (user_id) {
    const u = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(user_id);
    if (u) recipients = [u];
  } else if (to) {
    recipients = [{ id: null, name: '', email: String(to) }];
  } else if (segment === 'all') {
    recipients = db.prepare('SELECT id,name,email FROM users').all();
  } else if (segment === 'legacy') {
    recipients = db.prepare('SELECT id,name,email FROM users WHERE legacy_1_0 = 1').all();
  } else {
    return res.status(400).json({ error: 'Provide user_id, to, or segment (all | legacy).' });
  }
  if (!recipients.length) return res.status(404).json({ error: 'No recipients matched.' });
  // Guard against accidental mass-sends: a segment blast must be explicitly confirmed.
  if (segment && !confirm) {
    return res.status(409).json({ error: 'confirm_required', needsConfirm: true, recipients: recipients.length,
      message: `This will email ${recipients.length} ${segment === 'all' ? 'members' : 'legacy mamas'}. Resend with confirm to proceed.` });
  }
  if (recipients.length > MAX_BROADCAST) {
    return res.status(413).json({ error: `That's ${recipients.length} recipients — over the ${MAX_BROADCAST} per-send limit. Send in smaller batches.` });
  }
  let sent = 0;
  for (const u of recipients) {
    const r = await mailer.send({ to: u.email, to_user_id: u.id, template, vars: Object.assign({ name: u.name }, vars || {}) });
    if (r.status !== 'failed') sent++;
  }
  res.json({ ok: true, recipients: recipients.length, sent, mode: mailer.LIVE ? 'live' : 'dev (logged, not sent)' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Momni 2.0 app running → http://localhost:${PORT}`));
