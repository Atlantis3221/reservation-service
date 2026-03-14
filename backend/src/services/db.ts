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
    CREATE TABLE IF NOT EXISTS businesses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      slug              TEXT    NOT NULL UNIQUE,
      name              TEXT    NOT NULL,
      owner_chat_id     TEXT    NOT NULL,
      telegram_username TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const cols = db.prepare("PRAGMA table_info(slots)").all() as any[];
  const hasBusinessId = cols.some((c: any) => c.name === 'business_id');

  if (cols.length > 0 && !hasBusinessId) {
    console.log('[db] Migrating slots table: adding business_id...');

    db.exec(`
      CREATE TABLE slots_new (
        business_id  INTEGER NOT NULL DEFAULT 1,
        date_key     TEXT    NOT NULL,
        hour         INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'available',
        note         TEXT,
        client_name  TEXT,
        client_phone TEXT,
        PRIMARY KEY (business_id, date_key, hour),
        FOREIGN KEY (business_id) REFERENCES businesses(id)
      )
    `);

    db.exec(`
      INSERT OR IGNORE INTO slots_new (business_id, date_key, hour, status, note, client_name, client_phone)
      SELECT 1, date_key, hour, status, note, client_name, client_phone FROM slots
    `);

    db.exec('DROP TABLE slots');
    db.exec('ALTER TABLE slots_new RENAME TO slots');

    console.log('[db] Migration complete: slots now have business_id');
  } else if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        business_id  INTEGER NOT NULL,
        date_key     TEXT    NOT NULL,
        hour         INTEGER NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'available',
        note         TEXT,
        client_name  TEXT,
        client_phone TEXT,
        PRIMARY KEY (business_id, date_key, hour),
        FOREIGN KEY (business_id) REFERENCES businesses(id)
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_slots_business_date ON slots(business_id, date_key)');
}
