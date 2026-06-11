// Full end-to-end demo data, as a reusable function so it can run either from the CLI
// (seed-demo.js) or once at server boot (SEED_DEMO_FULL=1). Idempotent: keyed on demo
// emails, so re-running is a no-op. Uses the caller's db connection (no second handle).
const bcrypt = require('bcryptjs');
const { seedDemoCircle } = require('./db');

const ACK = 'I understand Momni is a community platform, not a childcare provider. Momni does not vet, screen, or endorse any member. I am solely responsible for choosing and evaluating my children’s care, just as I would when choosing a trusted friend. Care payments are between me and my Momni.';
const DEMO_EMAILS = ['sarah@example.com','jess@example.com','kristy@example.com','amy@example.com','paula@example.com','maren@example.com',
  'emily@example.com','rachel@example.com','dana@example.com','brooke@example.com','nicole@example.com'];

function wipeDemo(db) {
  const ids = db.prepare(`SELECT id FROM users WHERE email IN (${DEMO_EMAILS.map(() => '?').join(',')})`).all(...DEMO_EMAILS).map(r => r.id);
  if (!ids.length) return 0;
  const inq = ids.map(() => '?').join(',');
  const linkIds = db.prepare(`SELECT id FROM links WHERE guest_id IN (${inq}) OR host_id IN (${inq})`).all(...ids, ...ids).map(r => r.id);
  const linq = linkIds.length ? linkIds.map(() => '?').join(',') : '0';
  db.prepare(`DELETE FROM reviews WHERE link_id IN (${linq})`).run(...linkIds);
  db.prepare(`DELETE FROM messages WHERE link_id IN (${linq})`).run(...linkIds);
  db.prepare(`DELETE FROM visits WHERE link_id IN (${linq})`).run(...linkIds);
  db.prepare(`DELETE FROM links WHERE guest_id IN (${inq}) OR host_id IN (${inq})`).run(...ids, ...ids);
  db.prepare(`DELETE FROM campfire_votes WHERE user_id IN (${inq})`).run(...ids);
  db.prepare(`DELETE FROM campfire_comments WHERE user_id IN (${inq})`).run(...ids);
  db.prepare(`DELETE FROM campfire_posts WHERE user_id IN (${inq})`).run(...ids);
  db.prepare(`DELETE FROM circle_members WHERE user_id IN (${inq})`).run(...ids);
  db.prepare(`UPDATE circles SET leader_id = NULL WHERE leader_id IN (${inq})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE id IN (${inq})`).run(...ids);
  return ids.length;
}

function seedDemoFull(db) {
  if (db.prepare("SELECT 1 FROM users WHERE email = 'emily@example.com'").get()) {
    seedDemoCircle(db);
    return { skipped: true };
  }
  const PW = bcrypt.hashSync('momni-demo', 10);

  const insertHost = db.prepare(`INSERT OR IGNORE INTO users
    (email,password_hash,name,city,lat,lng,is_host,bio,care_types,available_now,hourly_note,kids_note,neighborhood,home_highlights,availability,shared_items)
    VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)`);
  const hosts = [
    ['sarah@example.com','Sarah M.','Orem',40.2969,-111.6946,'Mama of 3, homeschool mornings, big fenced backyard. I love a houseful of littles.','["available-now","night-out","recurring"]',1,'$8/hr — paid directly to me','7yr, 4yr & 18mo','Sharon Park, Orem','Big fenced backyard, no pets, lots of toys','{"Mon":["am","pm"],"Tue":["am","pm"],"Wed":["am"],"Thu":["am","pm"],"Fri":["am"]}','[{"type":"background_check","label":"Background check — purchased and shared by Sarah"}]'],
    ['jess@example.com','Jess R.','Provo',40.2338,-111.6585,'Night-owl mama, two littles, loves crafts and quiet evenings.','["overnight","recurring"]',0,'$10/hr overnight — paid directly to me','5yr & 2yr','Joaquin, Provo','Calm home, craft corner, early bedtimes','{"Fri":["eve","overnight"],"Sat":["eve","overnight"]}','[]'],
    ['kristy@example.com','Kristy T.','Provo',40.2483,-111.6448,'Former preschool teacher, mama of 4. Snacks, songs, and story time.','["night-out","overnight","recurring"]',1,'$9/hr — paid directly to me','9yr, 6yr, 4yr & 1yr','Grandview, Provo','Playroom, fenced yard, friendly dog','{"Mon":["pm","eve"],"Wed":["pm","eve"],"Fri":["eve"],"Sat":["am","pm"]}','[{"type":"background_check","label":"Background check — purchased and shared by Kristy"}]'],
    ['amy@example.com','Amy L.','Orem',40.3128,-111.7186,'Infant-ready, quiet home near UVU. Gentle with the tiny ones.','["available-now","recurring"]',1,'$8/hr — paid directly to me','3yr & 6mo','Near UVU, Orem','Quiet, smoke-free, infant gear on hand','{"Tue":["am","pm"],"Thu":["am","pm"]}','[]'],
    ['paula@example.com','Paula D.','Springville',40.1652,-111.6107,'Weekend specialist — the kids love our chickens and the trampoline.','["overnight","night-out"]',0,'$85/night — paid directly to me','8yr & 5yr','Springville','Acreage, chickens, trampoline, bunk room','{"Fri":["eve","overnight"],"Sat":["am","pm","eve","overnight"],"Sun":["am"]}','[]'],
    ['maren@example.com','Maren H.','Lehi',40.3916,-111.8508,'Nurse mama who hosts other nurses’ littles around shift work.','["overnight","available-now"]',1,'$10/hr — paid directly to me','4yr','Traverse Mountain, Lehi','Close to the hospital, overnight-ready','{"Mon":["overnight"],"Tue":["overnight"],"Wed":["overnight"],"Sun":["eve","overnight"]}','[]'],
  ];
  for (const h of hosts) insertHost.run(h[0],PW,h[1],h[2],h[3],h[4],h[5],h[6],h[7],h[8],h[9],h[10],h[11],h[12],h[13]);

  const insertGuest = db.prepare(`INSERT OR IGNORE INTO users (email,password_hash,name,city,lat,lng,is_host,bio,kids_note) VALUES (?,?,?,?,?,?,0,?,?)`);
  const guests = [
    ['emily@example.com','Emily P.','Orem',40.2887,-111.6946,'Grad student mama, always juggling class and a wild toddler.','2yr'],
    ['rachel@example.com','Rachel B.','Provo',40.2410,-111.6610,'Work-from-home mama of twins. Date nights keep us sane.','twins, 3yr'],
    ['dana@example.com','Dana K.','Lehi',40.3900,-111.8480,'Travel nurse. Overnight care is my lifeline on shift weeks.','6yr & 4yr'],
    ['brooke@example.com','Brooke S.','Orem',40.3000,-111.7000,'New to town, building my village one mama at a time.','5yr'],
    ['nicole@example.com','Nicole W.','Springville',40.1680,-111.6090,'Mama of 4, runs a little Etsy shop from home.','10yr, 7yr, 4yr & 1yr'],
  ];
  for (const g of guests) insertGuest.run(g[0],PW,g[1],g[2],g[3],g[4],g[5],g[6]);

  const id = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

  const mkLink = db.prepare(`INSERT INTO links (guest_id,host_id,care_type,details,status,acknowledgment_text,acknowledged_at,created_at)
    VALUES (?,?,?,?,?,?, datetime('now', ?), datetime('now', ?))`);
  const link = (guest, host, care_type, details, status, daysAgo) =>
    mkLink.run(id(guest), id(host), care_type, JSON.stringify(details), status, ACK, `-${daysAgo} days`, `-${daysAgo} days`).lastInsertRowid;
  const L = {};
  L.s1 = link('emily@example.com','sarah@example.com','one-time',{date:'last Tue',time:'9am–12pm',kids:'1 toddler'},'completed',21);
  L.s2 = link('rachel@example.com','sarah@example.com','recurring',{weekdays:['Mon','Wed'],time:'9am–11am'},'completed',18);
  L.s3 = link('brooke@example.com','sarah@example.com','one-time',{date:'2 wks ago',time:'1pm–4pm'},'completed',14);
  L.s4 = link('nicole@example.com','sarah@example.com','one-time',{date:'last Fri',time:'10am–1pm'},'completed',8);
  L.s5 = link('dana@example.com','sarah@example.com','recurring',{weekdays:['Thu'],time:'9am–12pm'},'completed',5);
  L.k1 = link('emily@example.com','kristy@example.com','one-time',{date:'date night',time:'6pm–10pm'},'completed',12);
  L.k2 = link('rachel@example.com','kristy@example.com','recurring',{weekdays:['Fri'],time:'eve'},'completed',6);
  L.m1 = link('dana@example.com','maren@example.com','overnight',{nights:'Tue–Wed',note:'shift week'},'confirmed',2);
  L.a1 = link('brooke@example.com','amy@example.com','one-time',{date:'this Thu',time:'9am–11am'},'requested',1);
  L.j1 = link('nicole@example.com','jess@example.com','overnight',{nights:'Sat'},'declined',9);
  L.p1 = link('rachel@example.com','paula@example.com','one-time',{date:'last weekend'},'cancelled',7);

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dt = (daysAgo, h, m) => { const d = new Date(Date.now() - daysAgo * 86400000); d.setHours(h, m, 0, 0); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(h)}:${pad(m)}:00`; };
  const mkVisit = db.prepare(`INSERT INTO visits (link_id,date,end_date,start_time,end_time,status,checkin_at,checkout_at) VALUES (?,?,?,?,?,?,?,?)`);
  mkVisit.run(L.s1, ymd(21), null, '09:00', '12:00', 'completed', dt(21, 9, 0), dt(21, 12, 0));
  mkVisit.run(L.s4, ymd(8), null, '10:00', '13:00', 'completed', dt(8, 10, 0), dt(8, 13, 0));
  mkVisit.run(L.k1, ymd(12), null, '18:00', '22:00', 'completed', dt(12, 18, 0), dt(12, 22, 0));
  mkVisit.run(L.m1, ymd(1), null, '19:00', '07:00', 'completed', dt(1, 19, 0), dt(0, 7, 0));
  mkVisit.run(L.m1, ymd(-3), null, '19:00', '07:00', 'scheduled', null, null);

  const mkMsg = db.prepare(`INSERT INTO messages (link_id,sender_id,body,created_at) VALUES (?,?,?, datetime('now', ?))`);
  mkMsg.run(L.m1, id('dana@example.com'), 'Hi Maren! So grateful you can take the kids Tue night — I’m on a 12-hr shift. They’ll have eaten by 6.', '-2 days');
  mkMsg.run(L.m1, id('maren@example.com'), 'Of course! Bunk room is ready. Send any bedtime routines and allergy info and we’re set. 💜', '-2 days');
  mkMsg.run(L.m1, id('dana@example.com'), 'No allergies, lights out by 8. You’re a lifesaver!', '-2 days');
  mkMsg.run(L.a1, id('brooke@example.com'), 'Hi Amy! New to Orem — would love a couple hours Thursday morning if you’re open. 🙏', '-1 days');
  mkMsg.run(L.s2, id('rachel@example.com'), 'Thank you for another lovely week, Sarah! The twins adore you.', '-17 days');

  const mkReview = db.prepare(`INSERT INTO reviews (link_id,author_id,subject_id,rating,body,created_at) VALUES (?,?,?,?,?, datetime('now', ?))`);
  const review = (linkId, author, subject, rating, body, daysAgo) => mkReview.run(linkId, id(author), id(subject), rating, body, `-${daysAgo} days`);
  review(L.s1,'emily@example.com','sarah@example.com',5,'Sarah is a dream. My toddler did not want to leave! Backyard heaven.',20);
  review(L.s1,'sarah@example.com','emily@example.com',5,'Emily’s little guy is so sweet and easygoing. Welcome anytime!',20);
  review(L.s2,'rachel@example.com','sarah@example.com',5,'Reliable, warm, and the twins light up every Monday. Couldn’t ask for more.',17);
  review(L.s2,'sarah@example.com','rachel@example.com',5,'Such well-prepared kiddos and a thoughtful mama. A joy.',17);
  review(L.s3,'brooke@example.com','sarah@example.com',4,'Lovely afternoon, my 5yr had a blast. Pickup ran a touch late but no worries.',13);
  review(L.s3,'sarah@example.com','brooke@example.com',5,'Brooke’s daughter is delightful and so polite. Loved having her.',13);
  review(L.s4,'nicole@example.com','sarah@example.com',5,'Three hours of peace to get my orders out — and a happy kid. Thank you Sarah!',7);
  review(L.s4,'sarah@example.com','nicole@example.com',5,'Easy drop-off, clear notes, lovely child. 10/10.',7);
  review(L.s5,'dana@example.com','sarah@example.com',5,'Sarah makes my shift weeks possible. The kids feel at home with her.',4);
  review(L.s5,'sarah@example.com','dana@example.com',5,'Dana’s crew is wonderful — independent and kind. Always welcome.',4);
  review(L.k1,'emily@example.com','kristy@example.com',5,'Date night saved! Came home to sleeping, happy kids. Kristy is the best.',11);
  review(L.k1,'kristy@example.com','emily@example.com',5,'Sweetest little one, went down without a peep. Loved having him.',11);
  review(L.k2,'rachel@example.com','kristy@example.com',4,'Great every Friday. The dog was a big hit. Highly recommend.',5);
  review(L.k2,'kristy@example.com','rachel@example.com',5,'Always a pleasure — thoughtful mama, easy kids.',5);

  seedDemoCircle(db);

  if (db.prepare('SELECT COUNT(*) c FROM campfire_posts').get().c === 0) {
    const post = db.prepare(`INSERT INTO campfire_posts (user_id,category,title,body,status,created_at) VALUES (?,?,?,?,?, datetime('now', ?))`);
    const p1 = post.run(id('rachel@example.com'),'feature','Let me favorite a few go-to Momnis','A “favorites” list so my regulars are one tap away on the home screen.','planned','-9 days').lastInsertRowid;
    const p2 = post.run(id('emily@example.com'),'idea','A shared snack/allergy card per kid','Fill it once, share it with any Momni I book. No more re-typing allergies every time.','open','-6 days').lastInsertRowid;
    const p3 = post.run(id('nicole@example.com'),'win','Found my village in two weeks 💜','Joined for date nights, stayed for the whole Orem Circle. You mamas are everything.','open','-3 days').lastInsertRowid;
    const vote = db.prepare('INSERT OR IGNORE INTO campfire_votes (post_id,user_id) VALUES (?,?)');
    ['emily@example.com','dana@example.com','brooke@example.com','nicole@example.com','sarah@example.com'].forEach(e => vote.run(p1, id(e)));
    ['rachel@example.com','dana@example.com','sarah@example.com'].forEach(e => vote.run(p2, id(e)));
    ['emily@example.com','rachel@example.com','dana@example.com','brooke@example.com'].forEach(e => vote.run(p3, id(e)));
    db.prepare(`INSERT INTO campfire_comments (post_id,user_id,body,created_at) VALUES (?,?,?, datetime('now','-2 days'))`)
      .run(p1, id('dana@example.com'), 'Yes please — I rebook the same two mamas constantly.');
  }
  return { skipped: false };
}

module.exports = { seedDemoFull, wipeDemo, DEMO_EMAILS };
