// Item 7 app-level drill, step A: rewind a seeded DB to "old schema" (version 120)
// and inject NULL-clinicId duplicate rows, simulating a legacy DB that never ran 121.
// Usage: node olddb-rewind.cjs <dbPath>
const { createRequire } = require('node:module');
const req = createRequire('D:/Desktop/rongyi/source/apps/v2/__probe__.cjs');
const Database = req('better-sqlite3');
const path = require('node:path');

const dbPath = process.argv[2];
const db = new Database(dbPath);

// 1. rewind: pretend migrations 121+ were never applied
const removed = db.prepare("DELETE FROM schema_migrations WHERE CAST(version AS INTEGER) >= 121").run();
console.log('removed migration records >= 121:', removed.changes);

// show current applied versions (max)
const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY CAST(version AS INTEGER) DESC LIMIT 5').all();
console.log('top applied versions now:', versions.map((r) => r.version).join(','));

// 2. find a patient to attach member cards
const patient = db.prepare('SELECT id FROM Patient WHERE deletedAt IS NULL LIMIT 1').get();
if (!patient) throw new Error('no patient in seeded db');
console.log('patient id:', patient.id);

// 3. rebuild MemberCard to OLD-schema shape: clinicId nullable (121-era legacy DBs
//    allowed NULL clinicId rows), keeping the 118 unique index present.
db.pragma('foreign_keys = OFF');
db.exec(`CREATE TABLE MemberCard_new (
  id TEXT PRIMARY KEY,
  patientId TEXT NOT NULL,
  cardNo TEXT NOT NULL,
  balance INTEGER,
  totalRecharge INTEGER,
  totalConsume INTEGER,
  points INTEGER,
  totalPoints INTEGER,
  level TEXT,
  status TEXT NOT NULL,
  clinicId TEXT,
  createdAt TEXT,
  updatedAt TEXT,
  deletedAt TEXT
)`);
db.exec(`INSERT INTO MemberCard_new (id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt)
  SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, totalPoints, level, status, clinicId, createdAt, updatedAt, deletedAt FROM MemberCard`);
db.exec('DROP TABLE MemberCard');
db.exec('ALTER TABLE MemberCard_new RENAME TO MemberCard');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_v2_unique_memberCards_cardNo" ON MemberCard (clinicId, cardNo) WHERE deletedAt IS NULL`);
db.pragma('foreign_keys = ON');
console.log('rebuilt MemberCard to old-schema shape (clinicId nullable, unique index kept)');

// 4. inject two rows with NULL clinicId and the SAME cardNo (unique field)
const now = new Date().toISOString();
const ins = db.prepare(`INSERT INTO MemberCard (id, clinicId, createdAt, updatedAt, deletedAt, patientId, cardNo,
  balance, totalRecharge, totalConsume, status, points, totalPoints, level)
  VALUES (?, NULL, ?, ?, NULL, ?, ?, 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`);
ins.run('mc-legacy-1', now, now, patient.id, 'LEGACY-DUP');
ins.run('mc-legacy-2', now, now, patient.id, 'LEGACY-DUP');
console.log('injected 2 NULL-clinicId duplicate MemberCard rows (cardNo=LEGACY-DUP)');

// 5. report state before upgrade
const before = db.prepare(`SELECT id, clinicId, cardNo FROM MemberCard WHERE cardNo = 'LEGACY-DUP' ORDER BY id`).all();
console.log('before upgrade rows:', JSON.stringify(before));
db.close();
console.log('REWIND OK');
