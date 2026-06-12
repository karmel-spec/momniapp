// Momni CRM — 1.0 contact importer.
// Takes the merged export rows (see the /tmp converter: usersB.xlsx + hostsA.csv → crm-import.json)
// and upserts them into crm_contacts. Idempotent on legacy_id, then email — re-running an import
// updates blanks but NEVER overwrites notes, tags, activities, or hand-edited fields.
//
// CLI:  node crm-import.js /path/to/crm-import.json
// HTTP: POST /api/admin/crm/import (server.js) feeds batches to importContacts().

// Hosts typed their state freehand in 1.0 ("Ut", "Utah [UT]", "Rowan county. NC").
// Normalize anything recognizably a US state to its canonical name; leave international
// regions untouched — a mama in Nairobi is still a mama.
const US_STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',
  DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',
  IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',
  MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',
  UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
const STATE_NAMES = Object.values(US_STATES);
function normalizeState(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  for (const name of STATE_NAMES) if (lower.includes(name.toLowerCase())) return name;
  for (const tok of s.toUpperCase().split(/[^A-Z]+/)) if (US_STATES[tok]) return US_STATES[tok];
  return s.slice(0, 40); // not a US state — keep her region as she wrote it
}

function importContacts(db, rows) {
  const byLegacy = db.prepare('SELECT id FROM crm_contacts WHERE legacy_id = ?');
  const byEmail = db.prepare('SELECT id, legacy_id FROM crm_contacts WHERE email = ?');
  const ins = db.prepare(`INSERT INTO crm_contacts
    (legacy_id, first_name, last_name, email, phone, city, state, postal_code,
     source, is_host, host_bio, property_type, joined_1_0)
    VALUES (@legacy_id, @first_name, @last_name, @email, @phone, @city, @state, @postal_code,
            '1.0', @is_host, @host_bio, @property_type, @joined_1_0)`);
  // fill blanks only — an import never clobbers what Karmel typed by hand
  const fill = db.prepare(`UPDATE crm_contacts SET
      legacy_id   = COALESCE(legacy_id, @legacy_id),
      phone       = COALESCE(phone, @phone),
      city        = COALESCE(city, @city),
      state       = COALESCE(state, @state),
      postal_code = COALESCE(postal_code, @postal_code),
      is_host     = MAX(is_host, @is_host),
      host_bio    = COALESCE(host_bio, @host_bio),
      property_type = COALESCE(property_type, @property_type),
      joined_1_0  = COALESCE(joined_1_0, @joined_1_0),
      source      = CASE WHEN source = '2.0' THEN '1.0' ELSE source END,
      stage       = CASE WHEN source = '2.0' THEN 'reactivated' ELSE stage END,
      updated_at  = datetime('now')
    WHERE id = @id`);

  let inserted = 0, updated = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const raw of rows) {
      const r = {
        legacy_id: Number.isFinite(+raw.legacy_id) ? +raw.legacy_id : null,
        first_name: String(raw.first_name || '').slice(0, 60),
        last_name: String(raw.last_name || '').slice(0, 60),
        email: raw.email ? String(raw.email).trim().toLowerCase().slice(0, 120) : null,
        phone: raw.phone ? String(raw.phone).replace(/\D/g, '').slice(0, 11) : null,
        city: raw.city ? String(raw.city).slice(0, 80) : null,
        state: normalizeState(raw.state),
        postal_code: raw.postal_code ? String(raw.postal_code).slice(0, 10) : null,
        is_host: raw.is_host ? 1 : 0,
        host_bio: raw.host_bio ? String(raw.host_bio).slice(0, 600) : null,
        property_type: raw.property_type ? String(raw.property_type).slice(0, 60) : null,
        joined_1_0: raw.joined_1_0 ? String(raw.joined_1_0).slice(0, 10) : null,
      };
      if (!r.email && !r.legacy_id) { skipped++; continue; }
      const hit = (r.legacy_id != null && byLegacy.get(r.legacy_id)) || (r.email && byEmail.get(r.email));
      if (hit) { fill.run({ ...r, id: hit.id }); updated++; }
      else { ins.run(r); inserted++; }
    }
  });
  tx();
  return { inserted, updated, skipped };
}

module.exports = { importContacts };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node crm-import.js <crm-import.json>'); process.exit(1); }
  const { db } = require('./db');
  const rows = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  console.log(`importing ${rows.length} contacts…`);
  const t0 = Date.now();
  const res = importContacts(db, rows);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s —`, res);
  console.log('crm_contacts now:', db.prepare('SELECT COUNT(*) c FROM crm_contacts').get().c);
}
