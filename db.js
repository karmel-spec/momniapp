// Momni 2.0 — database schema + seed data (SQLite via better-sqlite3)
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'momni.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// migration: is_admin flag (no-op if present)
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
// migration: calendar provider fields (Nylas grant_id + primary calendar_id) — no-op if present/table-absent
try { db.exec('ALTER TABLE calendar_connections ADD COLUMN grant_id TEXT'); } catch (e) { /* exists or table not yet created */ }
try { db.exec('ALTER TABLE calendar_connections ADD COLUMN calendar_id TEXT'); } catch (e) { /* exists or table not yet created */ }

// migrations: lifecycle refinement profile columns (no-op if present)
try { db.exec("ALTER TABLE users ADD COLUMN kids_note TEXT DEFAULT ''"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN neighborhood TEXT DEFAULT ''"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN home_highlights TEXT DEFAULT ''"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN availability TEXT DEFAULT '{}'"); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN signup_ack_text TEXT'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN signup_ack_at TEXT'); } catch (e) { /* exists */ }
// migration: Circle Up membership flag (set by the circle-up purchase; read by Sign in with Momni tier)
try { db.exec('ALTER TABLE users ADD COLUMN circle_up INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
// migration: paid profile add-ons — search-placement boost + a live business/social link
try { db.exec('ALTER TABLE users ADD COLUMN profile_boost INTEGER DEFAULT 0'); } catch (e) { /* exists */ }
// migration: Circle Leader (creator) on circles
try { db.exec('ALTER TABLE circles ADD COLUMN leader_id INTEGER'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN live_link TEXT'); } catch (e) { /* exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN live_link_label TEXT'); } catch (e) { /* exists */ }
// migration: OAuth client_type + nullable secret_hash (public clients hold no secret). The
// oauth_clients table is pre-launch with no registered clients, so rebuilding it is safe.
try {
  const cols = db.prepare('PRAGMA table_info(oauth_clients)').all();
  if (cols.length && !cols.find(c => c.name === 'client_type')) db.exec('DROP TABLE oauth_clients');
} catch (e) { /* table absent — CREATE TABLE below handles it */ }
// migration: remap host care_types to the 2.0 booking vocabulary (Available Now / Night Out /
// Recurring / Overnight). Idempotent — only rewrites rows that still carry an old token.
try {
  const CT_MAP = { 'right-now': 'available-now', 'date-night': 'night-out', 'my-regulars': 'recurring',
    'night-shift': 'overnight', 'weekend-getaway': 'overnight', 'extended-trip': 'overnight' };
  const rows = db.prepare("SELECT id, care_types FROM users WHERE care_types LIKE '%-%'").all();
  const upd = db.prepare('UPDATE users SET care_types = ? WHERE id = ?');
  for (const r of rows) {
    let arr; try { arr = JSON.parse(r.care_types || '[]'); } catch (e) { continue; }
    if (!arr.some(t => CT_MAP[t])) continue;
    const mapped = [...new Set(arr.map(t => CT_MAP[t] || t))];
    upd.run(JSON.stringify(mapped), r.id);
  }
} catch (e) { /* users table not created yet on first boot — seed uses new vocab directly */ }

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  lat REAL, lng REAL,
  is_host INTEGER DEFAULT 0,
  bio TEXT DEFAULT '',
  care_types TEXT DEFAULT '[]',          -- JSON array: available-now, night-out, recurring, overnight
  available_now INTEGER DEFAULT 0,
  hourly_note TEXT DEFAULT '',           -- e.g. "$8/hr — paid directly to me"; Momni never touches it
  shared_items TEXT DEFAULT '[]',        -- JSON array of member-shared items, e.g. {"type":"background_check","label":"Background check — purchased and shared by <name>"}
  kids_note TEXT DEFAULT '',             -- her littles, free text ("18mo & 4yr")
  neighborhood TEXT DEFAULT '',
  home_highlights TEXT DEFAULT '',       -- host only ("big backyard, no pets")
  availability TEXT DEFAULT '{}',        -- JSON { "Mon": ["am","pm"], ... }; blocks: am | pm | eve | overnight
  signup_ack_text TEXT,                  -- clickwrap record at signup
  signup_ack_at TEXT,
  legacy_1_0 INTEGER DEFAULT 0,
  links_balance INTEGER DEFAULT 2,       -- free tier: a couple of Links to start
  momni_plus INTEGER DEFAULT 0,
  circle_up INTEGER DEFAULT 0,           -- Circle Up membership ($1/mo billed $12/yr)
  profile_boost INTEGER DEFAULT 0,       -- paid: bumps her up in search results
  live_link TEXT,                        -- paid: a live link to her business/social
  live_link_label TEXT,
  is_admin INTEGER DEFAULT 0,
  gives_toggle INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER NOT NULL REFERENCES users(id),
  host_id INTEGER NOT NULL REFERENCES users(id),
  care_type TEXT NOT NULL,               -- one-time | recurring | overnight
  details TEXT DEFAULT '{}',             -- JSON: dates, times, weekdays, kids
  status TEXT DEFAULT 'requested',       -- requested | confirmed | completed | declined | cancelled
  acknowledgment_text TEXT NOT NULL,     -- exact clickwrap text the guest accepted
  acknowledged_at TEXT NOT NULL,         -- timestamp of acceptance (the legal record)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (      -- the thread between the two mamas on a Link
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (        -- shared drop-off/pick-up timeline both mamas can see — coordination, never supervision
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  date TEXT NOT NULL,                      -- YYYY-MM-DD
  end_date TEXT,                           -- multi-day/overnight only
  start_time TEXT, end_time TEXT,          -- HH:MM
  status TEXT DEFAULT 'scheduled',         -- scheduled | checked_in | completed | cancelled
  checkin_at TEXT, checkout_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  subject_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS circles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  lat REAL, lng REAL,
  meets TEXT DEFAULT '',
  member_count INTEGER DEFAULT 0,
  leader_id INTEGER REFERENCES users(id)   -- the Circle Leader (creator); gates the leader dashboard
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (circle_id, user_id)
);

-- Circle planning guide: gatherings a leader schedules; cadence drives the weekly/monthly view
CREATE TABLE IF NOT EXISTS circle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  title TEXT NOT NULL,
  when_text TEXT DEFAULT '',                -- friendly time, e.g. "Tuesday 10am"
  event_date TEXT,                          -- optional YYYY-MM-DD for ordering
  cadence TEXT DEFAULT 'once',              -- once | weekly | monthly
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suggestions (   -- founder approval queue: feedback awaiting Karmel
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT DEFAULT 'email',              -- email (pasted by Karmel) | in-app
  submitted_by TEXT DEFAULT '',
  body TEXT NOT NULL,
  page TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','shipped')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_connections (  -- a host's connected calendar (OAuth tokens, server-side only — never exposed via API)
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  provider TEXT DEFAULT 'google',          -- google (Nylas/others slot in later)
  access_token TEXT,
  refresh_token TEXT,
  token_expiry INTEGER,                    -- unix seconds (Google direct)
  grant_id TEXT,                           -- Nylas grant id (the persistent handle)
  calendar_id TEXT,                        -- primary calendar id (for event creation)
  calendar_email TEXT,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stripe_events (  -- processed Stripe webhook event ids (idempotency: never fulfill twice)
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (        -- transactional email log (one row per send attempt; dev-mode rows too)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  to_user_id INTEGER,
  template TEXT NOT NULL,                  -- welcome | onboarding | reactivation | review_request | booking_request | booking_confirmed | newsletter
  subject TEXT,
  status TEXT DEFAULT 'queued',            -- sent | dev-logged | failed
  related_type TEXT,                       -- e.g. 'link' (for dedupe)
  related_id TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legacy_pins (    -- anonymized city-level Momni 1.0 clusters; never names, never exact locations
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  count INTEGER NOT NULL
);

-- "Sign in with Momni" — OAuth 2.0 provider tables for the Momni Boards companion apps
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,                   -- momni_<hex>; the public identifier
  client_type TEXT NOT NULL DEFAULT 'confidential', -- 'public' (mobile Boards, PKCE only) | 'confidential' (server-side, secret)
  secret_hash TEXT,                      -- bcrypt of the client secret; NULL for public clients (they hold no secret)
  name TEXT NOT NULL,                    -- shown on the consent screen ("ChoreBoard")
  redirect_uris TEXT NOT NULL DEFAULT '[]', -- JSON array; exact-match only
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_codes (  -- single-use authorization codes, 10-minute lifetime
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT DEFAULT 'profile',
  code_challenge TEXT,                   -- PKCE S256, for mobile/public clients
  code_challenge_method TEXT,
  expires_at INTEGER NOT NULL,           -- epoch ms
  used INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens ( -- access tokens, stored hashed (sha256) — never plaintext
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  scope TEXT DEFAULT 'profile',
  expires_at INTEGER NOT NULL,           -- epoch ms
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_user_grants ( -- which apps a member has approved (skip re-consent)
  user_id INTEGER NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_id)
);

-- Campfire: the community board where the Circle talks, suggests features, and votes on what to build next
CREATE TABLE IF NOT EXISTS campfire_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL DEFAULT 'idea',  -- idea | feature | question | win
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  status TEXT DEFAULT 'open',             -- open | planned | building | shipped | declined (set by HQ)
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS campfire_votes (  -- one upvote per member per post
  post_id INTEGER NOT NULL REFERENCES campfire_posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS campfire_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES campfire_posts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Badges a member has earned or purchased; auto-badges are computed live, these are the awarded/bought ones
CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id),
  badge_key TEXT NOT NULL,
  source TEXT DEFAULT 'earned',           -- earned | purchased | granted
  awarded_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge_key)
);
`);

function seed() {
  // Real data only in production: Circles + anonymized legacy pins always seed;
  // fictional demo hosts only when SEED_DEMO=1 (local dev).
  if (db.prepare('SELECT COUNT(*) c FROM circles').get().c === 0) {
    const insertCircleProd = db.prepare('INSERT INTO circles (name,city,lat,lng,meets,member_count) VALUES (?,?,?,?,?,?)');
    insertCircleProd.run('Orem Moms Circle','Orem',40.2989,-111.6985,'Tuesdays 10am · Orem City Park',0);
    insertCircleProd.run('Provo Night Shift Mamas','Provo',40.2400,-111.6500,'First Saturdays · rotating homes',0);
    insertCircleProd.run('BYU Married Housing Circle','Provo',40.2520,-111.6360,'Thursdays 4pm · Wymount playground',0);
  }
  if (db.prepare('SELECT COUNT(*) c FROM legacy_pins').get().c === 0) {
    const ip = db.prepare('INSERT INTO legacy_pins (city,lat,lng,count) VALUES (?,?,?,?)');
    // Individual anonymous 1.0 pins (city-level, jittered; no names ever) from legacy_pins.json if present
    const pinsPath = path.join(__dirname, 'legacy_pins.json');
    let loaded = false;
    try {
      const pins = JSON.parse(require('fs').readFileSync(pinsPath, 'utf8'));
      const tx = db.transaction(() => {
        for (const p of pins) ip.run(`${p.city}, ${p.state}`, p.lat, p.lng, 1);
      });
      tx();
      loaded = pins.length > 0;
    } catch (e) { /* fall back to clusters */ }
    if (!loaded) {
      ip.run('Salt Lake City',40.7608,-111.8910,420); ip.run('Houston',29.7604,-95.3698,267);
      ip.run('Dallas',32.7767,-96.7970,198); ip.run('Atlanta',33.7490,-84.3880,154);
      ip.run('Phoenix',33.4484,-112.0740,96); ip.run('Boise',43.6150,-116.2023,52);
      ip.run('St. George',37.0965,-113.5684,61);
    }
  }
  if (process.env.SEED_DEMO !== '1') return;
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) {
    console.log('Already seeded.');
    return;
  }
  const hash = bcrypt.hashSync('momni-demo', 10);
  const insertUser = db.prepare(`INSERT INTO users
    (email,password_hash,name,city,lat,lng,is_host,bio,care_types,available_now,hourly_note,shared_items)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Demo hosts around Provo/Orem — sample data, clearly fictional
  const hosts = [
    ['sarah@example.com','Sarah M.','Orem',40.2969,-111.6946,1,'Mama of 3, homeschool mornings, big backyard.','["available-now","night-out","recurring"]',1,'$8/hr — paid directly to me','[{"type":"background_check","label":"Background check — purchased and shared by Sarah"}]'],
    ['jess@example.com','Jess R.','Provo',40.2338,-111.6585,1,'Night-owl mama, two littles, loves crafts.','["overnight","recurring"]',0,'$10/hr overnight — paid directly to me','[]'],
    ['kristy@example.com','Kristy T.','Provo',40.2483,-111.6448,1,'Former preschool teacher, mama of 4.','["night-out","overnight"]',1,'$9/hr — paid directly to me','[{"type":"background_check","label":"Background check — purchased and shared by Kristy"}]'],
    ['amy@example.com','Amy L.','Orem',40.3128,-111.7186,1,'Infant-ready, quiet home near UVU.','["available-now","recurring"]',1,'$8/hr — paid directly to me','[]'],
    ['paula@example.com','Paula D.','Springville',40.1652,-111.6107,1,'Weekend specialist — kids love our chickens.','["overnight","night-out"]',0,'$85/night — paid directly to me','[]'],
    ['maren@example.com','Maren H.','Lehi',40.3916,-111.8508,1,'Nurse mama who hosts other nurses’ littles.','["overnight","available-now"]',1,'$10/hr — paid directly to me','[]'],
  ];
  for (const h of hosts) insertUser.run(h[0],hash,h[1],h[2],h[3],h[4],h[5],h[6],h[7],h[8],h[9],h[10]);

  // Demo Circle Leader setup: Sarah leads the Orem Moms Circle, with a few members and a plan.
  seedDemoCircle(db);

  console.log('Seeded demo data (password for all demo hosts: momni-demo).');
}

// Make a demo Circle fully runnable: a leader, members, and a sample plan. Keyed strictly on
// demo emails + the demo circle name, so it never touches real production circles or users.
function seedDemoCircle(database) {
  const sarah = database.prepare('SELECT id FROM users WHERE email = ?').get('sarah@example.com');
  const circle = database.prepare("SELECT id, leader_id FROM circles WHERE name = 'Orem Moms Circle'").get();
  if (!sarah || !circle) return;
  if (!circle.leader_id) database.prepare('UPDATE circles SET leader_id = ? WHERE id = ?').run(sarah.id, circle.id);
  const memberEmails = ['sarah@example.com', 'amy@example.com', 'kristy@example.com', 'maren@example.com'];
  const addMember = database.prepare('INSERT OR IGNORE INTO circle_members (circle_id, user_id) VALUES (?, ?)');
  for (const e of memberEmails) {
    const u = database.prepare('SELECT id FROM users WHERE email = ?').get(e);
    if (u) addMember.run(circle.id, u.id);
  }
  const count = database.prepare('SELECT COUNT(*) c FROM circle_members WHERE circle_id = ?').get(circle.id).c;
  database.prepare('UPDATE circles SET member_count = ? WHERE id = ?').run(count, circle.id);
  if (database.prepare('SELECT COUNT(*) c FROM circle_events WHERE circle_id = ?').get(circle.id).c === 0) {
    const ev = database.prepare('INSERT INTO circle_events (circle_id,title,when_text,cadence,location,notes) VALUES (?,?,?,?,?,?)');
    ev.run(circle.id, 'Tuesday Park Playgroup', 'Tuesdays 10am', 'weekly', 'Orem City Park', 'Bring a snack to share. Littles welcome.');
    ev.run(circle.id, 'Mamas Night Out', 'Last Friday, 7pm', 'monthly', 'Rotating — see chat', 'No kiddos — just us. Trade off hosting.');
    ev.run(circle.id, 'Welcome Coffee for new mamas', 'Saturday 9am', 'once', 'The Daily Grind', 'Say hi to mamas who just joined the Circle.');
  }
}

if (process.argv.includes('--seed')) seed();

module.exports = { db, seed, seedDemoCircle };
