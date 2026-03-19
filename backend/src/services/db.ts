import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = process.env.DB_DIR || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'reservations.db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const MAX_BACKUPS = 10;

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

  backupDb();
  runMigrations();

  console.log(`[db] SQLite initialized at ${DB_PATH}`);
}

/**
 * Checks if the DB looks empty in production.
 * Call AFTER initMonitor() so alerts can be sent.
 */
export function checkDbIntegrity(): void {
  if (process.env.NODE_ENV !== 'production') return;

  try {
    const d = getDb();
    const bizCount = (d.prepare('SELECT COUNT(*) as cnt FROM businesses').get() as any)?.cnt ?? 0;
    const adminCount = (d.prepare('SELECT COUNT(*) as cnt FROM admin_users').get() as any)?.cnt ?? 0;

    if (bizCount === 0 && adminCount === 0) {
      const msg = 'Database is empty (0 businesses, 0 admin users) — possible data loss!';
      console.warn(`[db] WARNING: ${msg}`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { notifyError } = require('./monitor');
        notifyError(new Error(msg), 'DB Integrity Check');
      } catch {}
    }
  } catch {}
}

// ---- Backup ----

function backupDb(): void {
  if (!fs.existsSync(DB_PATH)) return;

  const stats = fs.statSync(DB_PATH);
  if (stats.size < 4096) return;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const now = new Date();
  const ts = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join('');
  const backupPath = path.join(BACKUP_DIR, `reservations-${ts}.db`);

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[db] Backup created: ${backupPath}`);
    rotateBackups();
  } catch (err) {
    console.error('[db] Backup failed (continuing startup):', err);
  }
}

function rotateBackups(): void {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('reservations-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (const file of files.slice(MAX_BACKUPS)) {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
      console.log(`[db] Removed old backup: ${file}`);
    }
  } catch (err) {
    console.error('[db] Backup rotation failed:', err);
  }
}

// ---- Versioned Migrations ----

type MigrationFn = (d: Database.Database) => void;

export const migrations: MigrationFn[] = [
  migrationV1,
];

function tableExists(d: Database.Database, name: string): boolean {
  return !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function columnExists(d: Database.Database, table: string, column: string): boolean {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some((c: any) => c.name === column);
}

export function getSchemaVersion(database?: Database.Database): number {
  const d = database ?? getDb();
  d.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER NOT NULL DEFAULT 0)');

  const row = d.prepare('SELECT version FROM _migrations').get() as { version: number } | undefined;
  if (!row) {
    const alreadyHasSchema = tableExists(d, 'businesses');
    const initialVersion = alreadyHasSchema ? 1 : 0;
    d.prepare('INSERT INTO _migrations (version) VALUES (?)').run(initialVersion);
    if (alreadyHasSchema) {
      console.log('[db] Detected existing database — marked as schema v1');
    }
    return initialVersion;
  }
  return row.version;
}

function runMigrations(): void {
  const d = getDb();
  const currentVersion = getSchemaVersion(d);

  for (let i = currentVersion; i < migrations.length; i++) {
    const ver = i + 1;
    console.log(`[db] Applying migration v${ver}...`);
    try {
      d.transaction(() => {
        migrations[i](d);
        d.prepare('UPDATE _migrations SET version = ?').run(ver);
      })();
      console.log(`[db] Migration v${ver} applied`);
    } catch (err) {
      console.error(`[db] Migration v${ver} FAILED (rolled back):`, err);
      throw err;
    }
  }
}

// ---- Migration V1: Full initial schema ----

function migrationV1(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      slug              TEXT    NOT NULL UNIQUE,
      name              TEXT    NOT NULL,
      owner_chat_id     TEXT    NOT NULL,
      telegram_username TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const slotCols = d.prepare("PRAGMA table_info(slots)").all() as any[];
  const hasHour = slotCols.some((c: any) => c.name === 'hour');
  const hasStartTime = slotCols.some((c: any) => c.name === 'start_time');

  if (slotCols.length > 0 && hasHour && !hasStartTime) {
    console.log('[db] Migrating slots: hour → start_time/end_time...');
    migrateHourToTimeRange(d);
    console.log('[db] Migration complete: slots now use start_time/end_time');
  } else if (slotCols.length === 0) {
    d.exec(`
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

  d.exec('CREATE INDEX IF NOT EXISTS idx_slots_business_date ON slots(business_id, date_key)');

  if (!columnExists(d, 'businesses', 'owner_phone')) {
    d.exec('ALTER TABLE businesses ADD COLUMN owner_phone TEXT');
  }
  if (!columnExists(d, 'businesses', 'agreement_accepted_at')) {
    d.exec('ALTER TABLE businesses ADD COLUMN agreement_accepted_at TEXT');
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS owner_agreements (
      owner_chat_id  TEXT PRIMARY KEY,
      accepted_at    TEXT NOT NULL DEFAULT (datetime('now')),
      phone          TEXT
    )
  `);

  if (tableExists(d, 'owner_agreements') && !columnExists(d, 'owner_agreements', 'phone')) {
    d.exec('ALTER TABLE owner_agreements ADD COLUMN phone TEXT');
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      email          TEXT    NOT NULL UNIQUE,
      password_hash  TEXT    NOT NULL,
      owner_chat_id  TEXT,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS link_codes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT    NOT NULL,
      owner_chat_id  TEXT    NOT NULL,
      expires_at     TEXT    NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS reset_tokens (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      token          TEXT    NOT NULL UNIQUE,
      admin_user_id  INTEGER NOT NULL,
      expires_at     TEXT    NOT NULL,
      used           INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS contact_links (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      type         TEXT    NOT NULL CHECK(type IN ('telegram', 'vk', 'max')),
      url          TEXT    NOT NULL,
      FOREIGN KEY (business_id) REFERENCES businesses(id),
      UNIQUE(business_id, type)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS bot_message_counts (
      chat_id      TEXT PRIMARY KEY,
      msg_count    INTEGER NOT NULL DEFAULT 0,
      last_msg_at  TEXT
    )
  `);

  if (!columnExists(d, 'businesses', 'booking_requests_enabled')) {
    d.exec('ALTER TABLE businesses ADD COLUMN booking_requests_enabled INTEGER NOT NULL DEFAULT 0');
  }

  if (!columnExists(d, 'businesses', 'working_hours')) {
    d.exec('ALTER TABLE businesses ADD COLUMN working_hours TEXT');
  }

  d.exec(`
    CREATE TABLE IF NOT EXISTS booking_requests (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id      INTEGER NOT NULL,
      client_name      TEXT    NOT NULL,
      client_phone     TEXT    NOT NULL,
      description      TEXT,
      preferred_date   TEXT    NOT NULL,
      preferred_time   TEXT    NOT NULL,
      preferred_end_time TEXT,
      status           TEXT    NOT NULL DEFAULT 'pending',
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);

  if (tableExists(d, 'booking_requests') && !columnExists(d, 'booking_requests', 'preferred_end_time')) {
    d.exec('ALTER TABLE booking_requests ADD COLUMN preferred_end_time TEXT');
  }

  d.exec('CREATE INDEX IF NOT EXISTS idx_booking_requests_business ON booking_requests(business_id, status)');
}

// ---- Helpers ----

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function migrateHourToTimeRange(d: Database.Database): void {
  const rows = d
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

  d.exec(`
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

  const insert = d.prepare(`
    INSERT INTO slots_new (business_id, date_key, start_time, end_time, status, note, client_name, client_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = d.transaction(() => {
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

  d.exec('DROP TABLE slots');
  d.exec('ALTER TABLE slots_new RENAME TO slots');
  d.exec('CREATE INDEX IF NOT EXISTS idx_slots_business_date ON slots(business_id, date_key)');
}
