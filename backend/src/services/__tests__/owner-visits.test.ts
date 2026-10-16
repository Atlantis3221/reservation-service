import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db')>()),
  getDb: () => testDb,
}));

import { migrations } from '../db';
import { getOwnerVisits, recordOwnerVisit, resetOwnerVisitThrottle } from '../owner-visits';

/** Локальная дата-время: дни считаются по часам процесса, как на проде. */
const at = (day: number, hh: number, mm = 0) => new Date(2026, 9, day, hh, mm);

function addOwner(createdAt: Date): number {
  const utc = createdAt.toISOString().replace('T', ' ').replace(/\..*$/, '');
  return testDb
    .prepare('INSERT INTO admin_users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(`o${Math.random()}@example.com`, 'x', utc).lastInsertRowid as number;
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      owner_chat_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Колонка и таблица — ровно из миграции v5, чтобы тест ловил расхождение схемы.
  migrations[4](testDb);
  resetOwnerVisitThrottle();
});

afterEach(() => {
  testDb.close();
});

describe('owner visits', () => {
  it('до первого захода — не мерили: lastSeenAt пустой, дней 0', () => {
    const id = addOwner(at(13, 10));
    expect(getOwnerVisits().get(id)).toEqual({ lastSeenAt: null, activeDays: 0 });
  });

  it('день регистрации не считается, следующие дни — каждый один раз', () => {
    const id = addOwner(at(13, 10));
    recordOwnerVisit(id, at(13, 10, 5));
    recordOwnerVisit(id, at(13, 18));
    expect(getOwnerVisits().get(id)?.activeDays).toBe(0);

    recordOwnerVisit(id, at(15, 9));
    recordOwnerVisit(id, at(15, 20));
    recordOwnerVisit(id, at(17, 12));
    const v = getOwnerVisits().get(id)!;
    expect(v.activeDays).toBe(2);
    expect(v.lastSeenAt).toBe(at(17, 12).toISOString().replace('T', ' ').replace(/\..*$/, ''));
  });

  it('пишет не чаще раза в 10 минут, но новый день — сразу', () => {
    const id = addOwner(at(13, 10));
    recordOwnerVisit(id, at(14, 12, 0));
    recordOwnerVisit(id, at(14, 12, 5));
    expect(getOwnerVisits().get(id)?.lastSeenAt).toBe(
      at(14, 12, 0).toISOString().replace('T', ' ').replace(/\..*$/, ''),
    );

    recordOwnerVisit(id, at(14, 23, 58));
    recordOwnerVisit(id, at(15, 0, 3));
    expect(getOwnerVisits().get(id)?.activeDays).toBe(2);
  });

  it('ошибка базы не ломает вход', () => {
    testDb.exec('DROP TABLE owner_visit_days');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => recordOwnerVisit(1, at(14, 12))).not.toThrow();
    err.mockRestore();
  });

  it('миграция повторно не падает', () => {
    expect(() => migrations[4](testDb)).not.toThrow();
  });
});
