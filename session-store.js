// Dependency-free session store backed by the app's existing better-sqlite3 handle.
// Why: the default express-session MemoryStore leaks in production and drops every
// signed-in mama on each deploy/restart. Persisting to SQLite keeps the Circle logged
// in across deploys, with no extra npm dependency to install on Render.
module.exports = function makeStore(session, db) {
  const Store = session.Store;

  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)');

  const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 30; // 30d, matches the cookie maxAge
  const expiryOf = (sess) => {
    if (sess && sess.cookie && sess.cookie.expires) return new Date(sess.cookie.expires).getTime();
    const maxAge = sess && sess.cookie && sess.cookie.originalMaxAge;
    return Date.now() + (maxAge || DEFAULT_TTL);
  };

  const stmts = {
    get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?'),
    upsert: db.prepare(`INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`),
    touch: db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?'),
    del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
    prune: db.prepare('DELETE FROM sessions WHERE expire <= ?'),
  };

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = stmts.get.get(sid, Date.now());
        cb(null, row ? JSON.parse(row.sess) : null);
      } catch (e) { cb(e); }
    }
    set(sid, sess, cb) {
      try {
        stmts.upsert.run(sid, JSON.stringify(sess), expiryOf(sess));
        cb && cb(null);
      } catch (e) { cb && cb(e); }
    }
    touch(sid, sess, cb) {
      try {
        stmts.touch.run(expiryOf(sess), sid);
        cb && cb(null);
      } catch (e) { cb && cb(e); }
    }
    destroy(sid, cb) {
      try {
        stmts.del.run(sid);
        cb && cb(null);
      } catch (e) { cb && cb(e); }
    }
  }

  const store = new SqliteStore();
  // Sweep expired rows hourly so the table can't grow unbounded.
  const prune = () => { try { stmts.prune.run(Date.now()); } catch (e) { /* ignore */ } };
  prune();
  const timer = setInterval(prune, 1000 * 60 * 60);
  if (timer.unref) timer.unref(); // don't keep the process alive for the sweep
  return store;
};
