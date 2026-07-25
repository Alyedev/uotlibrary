#!/usr/bin/env node
// Backs up library.db (via SQLite's own .backup, which is safe to run while
// the server is live and in WAL mode — a plain file copy of library.db is
// NOT safe, since recent writes may only exist in library.db-wal at the
// moment of copying) plus everything in photos/, into a timestamped folder.
//
// Usage: node scripts/backup.js [destination-directory]
// Defaults to ./backups/<timestamp>/ if no destination is given.
// Schedule this with Windows Task Scheduler (or cron/systemd timers on
// Linux) to run nightly — see README.md.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destDir = process.argv[2] || path.join(ROOT, 'backups', timestamp);

fs.mkdirSync(destDir, { recursive: true });

const dbPath = path.join(ROOT, 'library.db');
const dbBackupPath = path.join(destDir, 'library.db');
const db = new DatabaseSync(dbPath);
db.exec(`VACUUM INTO '${dbBackupPath.replace(/'/g, "''")}'`);
db.close();
console.log(`Database backed up to ${dbBackupPath}`);

const photosDir = path.join(ROOT, 'photos');
const photosBackupDir = path.join(destDir, 'photos');
fs.mkdirSync(photosBackupDir, { recursive: true });
let copied = 0;
for (const file of fs.readdirSync(photosDir)) {
  if (file === '.gitkeep') continue;
  fs.copyFileSync(path.join(photosDir, file), path.join(photosBackupDir, file));
  copied++;
}
console.log(`Copied ${copied} photo(s) to ${photosBackupDir}`);
console.log(`Backup complete: ${destDir}`);
console.log('Copy this folder to a second location (another drive, network share, or cloud storage) — a backup that only lives on the same machine is not a real backup.');
