// app.momni.com — Momni 2.0 web app server
// Sacred rules live in code here too:
//  - Momni never touches care payments (no care-payment routes exist, by design)
//  - No vetting: the platform stores what members choose to share, nothing more
//  - The booking clickwrap is recorded verbatim with a timestamp on every Link
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { db, seed } = require('./db');

seed(); // no-op if already seeded

const app = express();
// JSON body parsing everywhere EXCEPT the Stripe webhook (which needs the raw body for signature checks)
app.use((req, res, next) => req.path === '/api/stripe/webhook' ? next() : express.json()(req, res, next));
app.use(express.urlencoded({ extended: true }));
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD) app.set('trust proxy', 1); // Render/Netlify-style proxy → secure cookies work
app.use(session({
  secret: process.env.SESSION_SECRET || 'momni-dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const ACKNOWLEDGMENT_TEXT = 'I understand Momni is a community platform, not a childcare provider. Momni does not vet, screen, or endorse any member. I am solely responsible for choosing and evaluating my children’s care, just as I would when choosing a trusted friend. Care payments are between me and my Momni.';

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in first, mama.' });
  next();
}
const userPublic = (u) => ({
  id: u.id, name: u.name, city: u.city, lat: u.lat, lng: u.lng,
  is_host: !!u.is_host, bio: u.bio, care_types: JSON.parse(u.care_types || '[]'),
  available_now: !!u.available_now, hourly_note: u.hourly_note,
  shared_items: JSON.parse(u.shared_items || '[]'), legacy_1_0: !!u.legacy_1_0
});

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const { email, password, name, city } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
  try {
    const info = db.prepare('INSERT INTO users (email,password_hash,name,city) VALUES (?,?,?,?)')
      .run(email.toLowerCase().trim(), bcrypt.hashSync(password, 10), name.trim(), (city || '').trim());
    req.session.userId = info.lastInsertRowid;
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'That email is already in the Circle — try signing in.' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.status(401).json({ error: 'Email or password didn’t match.' });
  }
  req.session.userId = u.id;
  res.json({ ok: true, id: u.id, name: u.name });
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
    req.session.userId = user.id;
    res.redirect('/home.html');
  } catch (e) {
    console.error('google auth error', e);
    res.redirect('/index.html?google=error');
  }
});

// ---------- me ----------
app.get('/api/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const reviews = db.prepare('SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE subject_id = ?').get(u.id);
  res.json({ ...userPublic(u), email: u.email, links_balance: u.links_balance,
    momni_plus: !!u.momni_plus, gives_toggle: !!u.gives_toggle,
    rating: reviews.n ? Number(reviews.avg.toFixed(1)) : null, review_count: reviews.n });
});

app.put('/api/me', requireAuth, (req, res) => {
  const allowed = ['name','city','bio','is_host','care_types','available_now','hourly_note','gives_toggle','lat','lng'];
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  if ('care_types' in updates) updates.care_types = JSON.stringify(updates.care_types);
  for (const boolKey of ['is_host','available_now','gives_toggle']) if (boolKey in updates) updates[boolKey] = updates[boolKey] ? 1 : 0;
  const keys = Object.keys(updates);
  if (!keys.length) return res.json({ ok: true });
  db.prepare(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map(k => updates[k]), u.id);
  res.json({ ok: true });
});

// Member-shared items (e.g., a background check SHE purchased and chooses to display).
// Stored as her content with her label — never as Momni verification.
app.post('/api/me/shared-items', requireAuth, (req, res) => {
  const { type, label } = req.body;
  if (!type || !label) return res.status(400).json({ error: 'type and label required' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const items = JSON.parse(u.shared_items || '[]');
  items.push({ type, label, added_at: new Date().toISOString() });
  db.prepare('UPDATE users SET shared_items = ? WHERE id = ?').run(JSON.stringify(items), u.id);
  res.json({ ok: true, shared_items: items });
});

// ---------- search ----------
app.get('/api/hosts', (req, res) => {
  const { care_type, available_now } = req.query;
  let rows = db.prepare('SELECT * FROM users WHERE is_host = 1').all();
  if (care_type) rows = rows.filter(r => JSON.parse(r.care_types).includes(care_type));
  if (available_now === '1') rows = rows.filter(r => r.available_now);
  const ratings = db.prepare('SELECT subject_id, AVG(rating) avg, COUNT(*) n FROM reviews GROUP BY subject_id').all()
    .reduce((m, r) => (m[r.subject_id] = r, m), {});
  res.json(rows.map(r => ({ ...userPublic(r),
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

// ---------- links (the $1 match — the ONLY thing Momni ever charges for care) ----------
app.post('/api/links', requireAuth, (req, res) => {
  const { host_id, care_type, details, acknowledged } = req.body;
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
  if (!me.momni_plus) db.prepare('UPDATE users SET links_balance = links_balance - 1 WHERE id = ?').run(me.id);
  res.json({ ok: true, link_id: info.lastInsertRowid, host_name: host.name });
});

app.get('/api/links', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT l.*, h.name host_name, g.name guest_name
    FROM links l JOIN users h ON h.id = l.host_id JOIN users g ON g.id = l.guest_id
    WHERE l.guest_id = ? OR l.host_id = ? ORDER BY l.created_at DESC`)
    .all(req.session.userId, req.session.userId);
  res.json(rows.map(r => ({ ...r, details: JSON.parse(r.details), i_am_host: r.host_id === req.session.userId })));
});

app.put('/api/links/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  const isHost = link.host_id === req.session.userId, isGuest = link.guest_id === req.session.userId;
  if (!isHost && !isGuest) return res.status(403).json({ error: 'Not your Link.' });
  const allowed = isHost ? ['confirmed','declined','completed'] : ['cancelled','completed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Not a change you can make on this Link.' });
  db.prepare('UPDATE links SET status = ? WHERE id = ?').run(status, link.id);
  res.json({ ok: true });
});

// ---------- reviews (member content, both directions) ----------
app.post('/api/reviews', requireAuth, (req, res) => {
  const { link_id, rating, body } = req.body;
  const link = db.prepare('SELECT * FROM links WHERE id = ? AND status = ?').get(link_id, 'completed');
  if (!link) return res.status(400).json({ error: 'Reviews come after a completed Link.' });
  const me = req.session.userId;
  if (me !== link.guest_id && me !== link.host_id) return res.status(403).json({ error: 'Not your Link.' });
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
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const PRODUCTS = {
  'links-10':   { name: '10 Links — Link Together bundle', amount: 1000, mode: 'payment',
                  fulfill: (uid) => db.prepare('UPDATE users SET links_balance = links_balance + 10 WHERE id = ?').run(uid) },
  'momni-plus': { name: 'Momni+ (annual)', amount: 4900, mode: 'payment', // simple annual pass for v1; recurring later
                  fulfill: (uid) => db.prepare('UPDATE users SET momni_plus = 1 WHERE id = ?').run(uid) },
  'circle-up':  { name: 'Circle Up membership ($1/mo, billed $12/yr)', amount: 1200, mode: 'payment',
                  fulfill: (uid) => db.prepare('UPDATE users SET links_balance = links_balance + 2 WHERE id = ?').run(uid) },
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
  let event;
  try {
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body);
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
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

// ---------- founder admin (Momni HQ) ----------
// Admin = accounts whose email is in ADMIN_EMAILS (comma-separated env, default karmel@momni.com).
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'karmel@momni.com').toLowerCase().split(',').map(s => s.trim());
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
app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Momni 2.0 app running → http://localhost:${PORT}`));
