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
  const hasHour = cols.some((c: any) => c.name === 'hour');
  const hasStartTime = cols.some((c: any) => c.name === 'start_time');

  if (cols.length > 0 && hasHour && !hasStartTime) {
    console.log('[db] Migrating slots: hour → start_time/end_time...');
    migrateHourToTimeRange();
    console.log('[db] Migration complete: slots now use start_time/end_time');
  } else if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        business_id  INTEGER NOT NULL,
        date_key     TEXT    NOT NULL,
        start_time   TEXT    NOT NULL,
        end_time     TEXT    NOT NULL,
        status       TEXT    NOT NULL DEFAULT 'available',
        note         TEXT,
        client_name  TEXT,
        client_phone TEXT,
        FOREIGN KEY (business_id) REFERENCES businesses(id)
      )
    `);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_slots_business_date ON slots(business_id, date_key)');

  const bizCols = db.prepare("PRAGMA table_info(businesses)").all() as any[];
  if (!bizCols.some((c: any) => c.name === 'owner_phone')) {
    db.exec('ALTER TABLE businesses ADD COLUMN owner_phone TEXT');
  }
  if (!bizCols.some((c: any) => c.name === 'agreement_accepted_at')) {
    db.exec('ALTER TABLE businesses ADD COLUMN agreement_accepted_at TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS owner_agreements (
      owner_chat_id  TEXT PRIMARY KEY,
      accepted_at    TEXT NOT NULL DEFAULT (datetime('now')),
      phone          TEXT
    )
  `);

  const agrCols = db.prepare("PRAGMA table_info(owner_agreements)").all() as any[];
  if (agrCols.length > 0 && !agrCols.some((c: any) => c.name === 'phone')) {
    db.exec('ALTER TABLE owner_agreements ADD COLUMN phone TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT    NOT NULL UNIQUE,
      password_hash  TEXT    NOT NULL,
      owner_chat_id  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS link_codes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT    NOT NULL,
      owner_chat_id  TEXT    NOT NULL,
      expires_at     TEXT    NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      token          TEXT    NOT NULL UNIQUE,
      admin_user_id  INTEGER NOT NULL,
      expires_at     TEXT    NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
    )
  `);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function migrateHourToTimeRange(): void {
  const rows = db
    .prepare('SELECT * FROM slots ORDER BY business_id, date_key, hour')
    .all() as any[];

  interface Range {
    business_id: number;
    date_key: string;
    start_hour: number;
    end_hour: number;
    status: string;
    note: string | null;
    client_name: string | null;
    client_phone: string | null;
  }

  const ranges: Range[] = [];
  let current: Range | null = null;

  for (const row of rows) {
    if (
      current &&
      current.business_id === row.business_id &&
      current.date_key === row.date_key &&
      current.status === row.status &&
      (current.note || null) === (row.note || null) &&
      (current.client_name || null) === (row.client_name || null) &&
      current.end_hour === row.hour
    ) {
      current.end_hour = row.hour + 1;
    } else {
      if (current) ranges.push(current);
      current = {
        business_id: row.business_id,
        date_key: row.date_key,
        start_hour: row.hour,
        end_hour: row.hour + 1,
        status: row.status,
        note: row.note,
        client_name: row.client_name,
        client_phone: row.client_phone,
      };
    }
  }
  if (current) ranges.push(current);

  db.exec(`
    CREATE TABLE slots_new (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      date_key     TEXT    NOT NULL,
      start_time   TEXT    NOT NULL,
      end_time     TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'available',
      note         TEXT,
      client_name  TEXT,
      client_phone TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);

  const insert = db.prepare(`
    INSERT INTO slots_new (business_id, date_key, start_time, end_time, status, note, client_name, client_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const range of ranges) {
      const startTime = `${pad2(range.start_hour)}:00`;
      const endTime = range.end_hour === 24 ? '00:00' : `${pad2(range.end_hour)}:00`;
      insert.run(
        range.business_id, range.date_key, startTime, endTime,
        range.status, range.note, range.client_name, range.client_phone,
      );
    }
  });
  tx();

  db.exec('DROP TABLE slots');
  db.exec('ALTER TABLE slots_new RENAME TO slots');
  db.exec('CREATE INDEX IF NOT EXISTS idx_slots_business_date ON slots(business_id, date_key)');
}
