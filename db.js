// Momni 2.0 — database schema + seed data (SQLite via better-sqlite3)
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'momni.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// migration: is_admin flag (no-op if present)
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch (e) { /* exists */ }

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
  care_types TEXT DEFAULT '[]',          -- JSON array: right-now, date-night, my-regulars, night-shift, weekend-getaway, extended-trip
  available_now INTEGER DEFAULT 0,
  hourly_note TEXT DEFAULT '',           -- e.g. "$8/hr — paid directly to me"; Momni never touches it
  shared_items TEXT DEFAULT '[]',        -- JSON array of member-shared items, e.g. {"type":"background_check","label":"Background check — purchased and shared by <name>"}
  legacy_1_0 INTEGER DEFAULT 0,
  links_balance INTEGER DEFAULT 2,       -- free tier: a couple of Links to start
  momni_plus INTEGER DEFAULT 0,
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
  member_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id INTEGER NOT NULL REFERENCES circles(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (circle_id, user_id)
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

CREATE TABLE IF NOT EXISTS legacy_pins (    -- anonymized city-level Momni 1.0 clusters; never names, never exact locations
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  count INTEGER NOT NULL
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
    ['sarah@example.com','Sarah M.','Orem',40.2969,-111.6946,1,'Mama of 3, homeschool mornings, big backyard.','["right-now","date-night","my-regulars"]',1,'$8/hr — paid directly to me','[{"type":"background_check","label":"Background check — purchased and shared by Sarah"}]'],
    ['jess@example.com','Jess R.','Provo',40.2338,-111.6585,1,'Night-owl mama, two littles, loves crafts.','["night-shift","my-regulars"]',0,'$10/hr overnight — paid directly to me','[]'],
    ['kristy@example.com','Kristy T.','Provo',40.2483,-111.6448,1,'Former preschool teacher, mama of 4.','["date-night","weekend-getaway","extended-trip"]',1,'$9/hr — paid directly to me','[{"type":"background_check","label":"Background check — purchased and shared by Kristy"}]'],
    ['amy@example.com','Amy L.','Orem',40.3128,-111.7186,1,'Infant-ready, quiet home near UVU.','["right-now","my-regulars"]',1,'$8/hr — paid directly to me','[]'],
    ['paula@example.com','Paula D.','Springville',40.1652,-111.6107,1,'Weekend specialist — kids love our chickens.','["weekend-getaway","extended-trip","date-night"]',0,'$85/night — paid directly to me','[]'],
    ['maren@example.com','Maren H.','Lehi',40.3916,-111.8508,1,'Nurse mama who hosts other nurses’ littles.','["night-shift","right-now"]',1,'$10/hr — paid directly to me','[]'],
  ];
  for (const h of hosts) insertUser.run(h[0],hash,h[1],h[2],h[3],h[4],h[5],h[6],h[7],h[8],h[9],h[10]);

  console.log('Seeded demo data (password for all demo hosts: momni-demo).');
}

if (process.argv.includes('--seed')) seed();

module.exports = { db, seed };
