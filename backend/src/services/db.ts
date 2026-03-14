import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = process.env.DB_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'reservations.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(): void {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (process.env.NODE_ENV === 'production' && DB_DIR === '/app/data') {
    try {
      const stat = fs.statSync(DB_DIR);
      if (!stat.isDirectory()) {
        console.warn('[db] WARNING: /app/data is not a directory — data may be lost on container restart');
      }
    } catch {
      console.warn('[db] WARNING: /app/data does not exist — data WILL be lost on container restart. Mount a volume!');
    }
  }

  try {
    db = new Database(DB_PATH);
  } catch (err) {
    console.error(`[db] Failed to open database at ${DB_PATH}:`, err);
    process.exit(1);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate();

  console.log(`[db] SQLite initialized at ${DB_PATH}`);
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
      date_key     TEXT    NOT NULL,
      hour         INTEGER NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'available',
      note         TEXT,
      client_name  TEXT,
      client_phone TEXT,
      PRIMARY KEY (date_key, hour)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_slots_date_key ON slots(date_key)
  `);
}
