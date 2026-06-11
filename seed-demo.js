// CLI for the full end-to-end demo data. Logic lives in demo-data.js so the server can
// also run it once at boot (SEED_DEMO_FULL=1).
//   node seed-demo.js          → seed (idempotent)
//   node seed-demo.js --wipe   → remove all demo data before real launch
const { db } = require('./db');
const { seedDemoFull, wipeDemo } = require('./demo-data');

if (process.argv.includes('--wipe')) {
  console.log(`Wiped ${wipeDemo(db)} demo users and all their links/reviews/messages/visits/campfire.`);
  process.exit(0);
}

const r = seedDemoFull(db);
if (r.skipped) { console.log('Demo already seeded — re-ensured the Circle, nothing else to do.'); process.exit(0); }

const n = (q) => db.prepare(q).get().c;
console.log('✅ Demo seeded:');
console.log('   users   :', n("SELECT COUNT(*) c FROM users WHERE email LIKE '%@example.com'"), '(6 hosts + 5 guests)');
console.log('   links   :', n('SELECT COUNT(*) c FROM links'));
console.log('   visits  :', n('SELECT COUNT(*) c FROM visits'));
console.log('   messages:', n('SELECT COUNT(*) c FROM messages'));
console.log('   reviews :', n('SELECT COUNT(*) c FROM reviews'));
console.log('   campfire:', n('SELECT COUNT(*) c FROM campfire_posts'), 'posts');
console.log('All demo logins use password: momni-demo');
