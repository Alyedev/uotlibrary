const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, 'library.db'));

// WAL improves concurrent read/write throughput for this single-file DB, and
// enforcing foreign keys (off by default in sqlite) keeps visits tied to real people.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    college TEXT NOT NULL,
    grade TEXT NOT NULL,
    gender TEXT NOT NULL,
    photo_path TEXT NOT NULL,
    descriptor TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    visited_at TEXT NOT NULL,
    FOREIGN KEY (person_id) REFERENCES people (id)
  );

  CREATE INDEX IF NOT EXISTS idx_visits_person_id ON visits(person_id);
  CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits(visited_at);
`);

module.exports = db;
