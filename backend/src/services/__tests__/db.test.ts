import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getSchemaVersion, migrations } from '../db';

let testDb: Database.Database;

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
});

afterEach(() => {
  testDb.close();
});

describe('migration system', () => {
  it('creates _migrations table and returns version 0 for fresh DB', () => {
    const version = getSchemaVersion(testDb);
    expect(version).toBe(0);

    const row = testDb.prepare('SELECT version FROM _migrations').get() as any;
    expect(row.version).toBe(0);
  });

  it('detects existing database and sets version to 1', () => {
    testDb.exec(`
      CREATE TABLE businesses (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        owner_chat_id TEXT NOT NULL
      )
    `);

    const version = getSchemaVersion(testDb);
    expect(version).toBe(1);
  });

  it('returns stored version on subsequent calls', () => {
    testDb.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER NOT NULL DEFAULT 0)');
    testDb.prepare('INSERT INTO _migrations (version) VALUES (?)').run(3);

    const version = getSchemaVersion(testDb);
    expect(version).toBe(3);
  });
});

describe('migration v1 — fresh database', () => {
  it('creates all required tables', () => {
    const migrationV1 = migrations[0];
    testDb.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER NOT NULL DEFAULT 0)');
    testDb.prepare('INSERT INTO _migrations (version) VALUES (0)').run();

    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    const tables = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('businesses');
    expect(tableNames).toContain('slots');
    expect(tableNames).toContain('admin_users');
    expect(tableNames).toContain('owner_agreements');
    expect(tableNames).toContain('link_codes');
    expect(tableNames).toContain('reset_tokens');
    expect(tableNames).toContain('contact_links');
    expect(tableNames).toContain('bot_message_counts');
    expect(tableNames).toContain('booking_requests');
  });

  it('admin_users.email has UNIQUE constraint', () => {
    const migrationV1 = migrations[0];
    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    testDb.prepare("INSERT INTO admin_users (email, password_hash) VALUES ('a@b.com', 'hash1')").run();
    expect(() => {
      testDb.prepare("INSERT INTO admin_users (email, password_hash) VALUES ('a@b.com', 'hash2')").run();
    }).toThrow(/UNIQUE/);
  });

  it('creates indexes', () => {
    const migrationV1 = migrations[0];
    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    const indexes = testDb
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_slots_business_date');
    expect(indexNames).toContain('idx_booking_requests_business');
  });

  it('businesses table has all columns including added ones', () => {
    const migrationV1 = migrations[0];
    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    const cols = testDb.prepare("PRAGMA table_info(businesses)").all() as any[];
    const colNames = cols.map((c: any) => c.name);

    expect(colNames).toContain('owner_phone');
    expect(colNames).toContain('agreement_accepted_at');
    expect(colNames).toContain('booking_requests_enabled');
    expect(colNames).toContain('working_hours');
  });
});

describe('migration v1 — idempotent on existing database', () => {
  it('does not fail when run on an already-complete schema', () => {
    const migrationV1 = migrations[0];

    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    expect(() => {
      testDb.transaction(() => {
        migrationV1(testDb);
      })();
    }).not.toThrow();
  });

  it('preserves existing data', () => {
    const migrationV1 = migrations[0];
    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    testDb.prepare(
      "INSERT INTO businesses (slug, name, owner_chat_id) VALUES ('test', 'Test Biz', '123')"
    ).run();
    testDb.prepare(
      "INSERT INTO admin_users (email, password_hash) VALUES ('u@example.com', 'hash')"
    ).run();

    testDb.transaction(() => {
      migrationV1(testDb);
    })();

    const biz = testDb.prepare('SELECT COUNT(*) as cnt FROM businesses').get() as any;
    expect(biz.cnt).toBe(1);
    const admin = testDb.prepare('SELECT COUNT(*) as cnt FROM admin_users').get() as any;
    expect(admin.cnt).toBe(1);
  });
});
