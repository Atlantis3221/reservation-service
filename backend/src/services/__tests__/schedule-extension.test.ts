import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', () => ({
  getDb: () => testDb,
}));

import { extendSchedules, AUTO_EXTEND_DAYS } from '../schedule-extension';

const WEEKDAYS_10_18 = {
  mon: { enabled: true, start: '10:00', end: '18:00' },
  tue: { enabled: true, start: '10:00', end: '18:00' },
  wed: { enabled: true, start: '10:00', end: '18:00' },
  thu: { enabled: true, start: '10:00', end: '18:00' },
  fri: { enabled: true, start: '10:00', end: '18:00' },
  sat: { enabled: false, start: '10:00', end: '18:00' },
  sun: { enabled: false, start: '10:00', end: '18:00' },
};

// Пятница, 16 октября 2026, 05:00 по местному времени
const NOW = new Date(2026, 9, 16, 5, 0, 0);

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE businesses (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      owner_chat_id TEXT NOT NULL,
      working_hours TEXT
    )
  `);
  db.exec(`
    CREATE TABLE slots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      business_id  INTEGER NOT NULL,
      date_key     TEXT    NOT NULL,
      start_time   TEXT    NOT NULL,
      end_time     TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'available',
      note         TEXT,
      client_name  TEXT,
      client_phone TEXT
    )
  `);
}

function addBusiness(slug: string, workingHours: object | null, owner = `web:${slug}`): number {
  const result = testDb
    .prepare('INSERT INTO businesses (slug, name, owner_chat_id, working_hours) VALUES (?, ?, ?, ?)')
    .run(slug, slug, owner, workingHours ? JSON.stringify(workingHours) : null);
  return Number(result.lastInsertRowid);
}

function addSlot(businessId: number, dateKey: string, status = 'available', start = '10:00', end = '18:00'): void {
  testDb
    .prepare('INSERT INTO slots (business_id, date_key, start_time, end_time, status) VALUES (?, ?, ?, ?, ?)')
    .run(businessId, dateKey, start, end, status);
}

function dateKeys(businessId: number): string[] {
  return (testDb
    .prepare('SELECT DISTINCT date_key FROM slots WHERE business_id = ? ORDER BY date_key')
    .all(businessId) as { date_key: string }[]).map((r) => r.date_key);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  createSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

describe('extendSchedules', () => {
  it('reopens a schedule that ran out: weekdays for the next 4 weeks', () => {
    const id = addBusiness('yarvelle', WEEKDAYS_10_18);
    addSlot(id, '2026-10-06');

    extendSchedules(NOW);

    const future = dateKeys(id).filter((k) => k >= '2026-10-16');
    // 16.10 (пт) … 12.11 (чт): 28 дней, из них 20 будних
    expect(future[0]).toBe('2026-10-16');
    expect(future[future.length - 1]).toBe('2026-11-12');
    expect(future).toHaveLength(20);
    expect(future).not.toContain('2026-10-17'); // суббота выключена
    expect(future).not.toContain('2026-10-18'); // воскресенье выключено
  });

  it('only appends after the last published day and keeps bookings', () => {
    const id = addBusiness('dfyz', WEEKDAYS_10_18);
    addSlot(id, '2026-10-20', 'available', '10:00', '12:00');
    addSlot(id, '2026-10-20', 'booked', '12:00', '14:00');
    addSlot(id, '2026-11-09');

    extendSchedules(NOW);

    const slotsOn20 = testDb
      .prepare('SELECT status, start_time FROM slots WHERE business_id = ? AND date_key = ? ORDER BY start_time')
      .all(id, '2026-10-20');
    expect(slotsOn20).toEqual([
      { status: 'available', start_time: '10:00' },
      { status: 'booked', start_time: '12:00' },
    ]);
    // Дни внутри уже открытого периода, которые владелец не открыл, не трогаем
    expect(dateKeys(id)).not.toContain('2026-10-19');
    expect(dateKeys(id)).toEqual(['2026-10-20', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  });

  it('does not duplicate on a second run the same day', () => {
    const id = addBusiness('qqq', WEEKDAYS_10_18);
    addSlot(id, '2026-10-01');

    const first = extendSchedules(NOW);
    const second = extendSchedules(NOW);

    expect(first.days).toBe(20);
    expect(second).toEqual({ businesses: 0, days: 0 });
    const count = testDb.prepare('SELECT COUNT(*) AS n FROM slots WHERE business_id = ?').get(id) as { n: number };
    expect(count.n).toBe(21);
  });

  it('keeps the window rolling: next day adds one more day', () => {
    const id = addBusiness('rolling', WEEKDAYS_10_18);
    addSlot(id, '2026-10-01');
    extendSchedules(NOW);

    // 17.10 окно сдвигается на день и доходит до пятницы 13.11
    const next = extendSchedules(new Date(2026, 9, 17, 0, 20));
    expect(next.days).toBe(1);
    expect(dateKeys(id)).toContain('2026-11-13');
  });

  it('skips businesses that never published, have no hours, or are the demo', () => {
    const neverPublished = addBusiness('never', WEEKDAYS_10_18);
    const noHours = addBusiness('nohours', null);
    addSlot(noHours, '2026-10-01');
    const demo = addBusiness('demo-banya', WEEKDAYS_10_18, 'demo');
    addSlot(demo, '2026-10-01');

    const result = extendSchedules(NOW);

    expect(result).toEqual({ businesses: 0, days: 0 });
    expect(dateKeys(neverPublished)).toEqual([]);
    expect(dateKeys(noHours)).toEqual(['2026-10-01']);
    expect(dateKeys(demo)).toEqual(['2026-10-01']);
  });

  it('stops when the owner switched off every working day', () => {
    const off = Object.fromEntries(
      Object.entries(WEEKDAYS_10_18).map(([k, v]) => [k, { ...v, enabled: false }]),
    );
    const id = addBusiness('paused', off);
    addSlot(id, '2026-10-01');

    expect(extendSchedules(NOW).days).toBe(0);
    expect(dateKeys(id)).toEqual(['2026-10-01']);
  });

  it('keeps overnight hours as one shift', () => {
    const night = Object.fromEntries(
      Object.keys(WEEKDAYS_10_18).map((k) => [k, { enabled: true, start: '18:00', end: '02:00' }]),
    );
    const id = addBusiness('night', night);
    addSlot(id, '2026-10-01');

    extendSchedules(NOW);

    const rows = testDb
      .prepare('SELECT start_time, end_time FROM slots WHERE business_id = ? AND date_key = ?')
      .all(id, '2026-10-16');
    expect(rows).toEqual([{ start_time: '18:00', end_time: '02:00' }]);
    expect(dateKeys(id)).toHaveLength(1 + AUTO_EXTEND_DAYS);
  });
});
