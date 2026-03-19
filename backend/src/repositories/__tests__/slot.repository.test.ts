import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../services/db', () => ({
  getDb: () => testDb,
}));

import {
  addDaySlots,
  getSlotsForDate,
  getSlotsForDateFull,
  getAvailableDateKeys,
  getAllSlots,
  bookRange,
  findOverlappingBookings,
  cancelBooking,
  cancelBookingById,
  clearDay,
  getScheduledDays,
  getStats,
} from '../slot.repository';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE businesses (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      slug              TEXT    NOT NULL UNIQUE,
      name              TEXT    NOT NULL,
      owner_chat_id     TEXT    NOT NULL,
      telegram_username TEXT,
      owner_phone       TEXT,
      agreement_accepted_at TEXT,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
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
      client_phone TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id)
    )
  `);
  db.exec('CREATE INDEX idx_slots_business_date ON slots(business_id, date_key)');

  db.exec(`
    CREATE TABLE owner_agreements (
      owner_chat_id  TEXT PRIMARY KEY,
      accepted_at    TEXT NOT NULL DEFAULT (datetime('now')),
      phone          TEXT
    )
  `);
}

function insertBusiness(id?: number): number {
  const result = testDb.prepare(
    "INSERT INTO businesses (slug, name, owner_chat_id) VALUES ('test', 'Test', '1')"
  ).run();
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  createSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ---- addDaySlots ----

describe('addDaySlots', () => {
  it('creates an available slot', () => {
    const bizId = insertBusiness();
    const slots = addDaySlots(bizId, '2026-03-16', 10, 14);

    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe('available');
    expect(slots[0].startDatetime).toBe('2026-03-16T10:00:00');
    expect(slots[0].endDatetime).toBe('2026-03-16T14:00:00');
  });

  it('handles endHour=24 as 00:00 next day (midnight boundary)', () => {
    const bizId = insertBusiness();
    const slots = addDaySlots(bizId, '2026-03-16', 20, 24);

    expect(slots[0].startDatetime).toBe('2026-03-16T20:00:00');
    expect(slots[0].endDatetime).toBe('2026-03-17T00:00:00');
  });

  it('handles overnight slot (end < start → crosses midnight)', () => {
    const bizId = insertBusiness();
    const slots = addDaySlots(bizId, '2026-03-16', 22, 3);

    expect(slots[0].startDatetime).toBe('2026-03-16T22:00:00');
    expect(slots[0].endDatetime).toBe('2026-03-17T03:00:00');
  });
});

// ---- getSlotsForDate ----

describe('getSlotsForDate', () => {
  it('returns slots ordered by start_time', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 14, 18);
    addDaySlots(bizId, '2026-03-16', 10, 14);

    const slots = getSlotsForDate(bizId, '2026-03-16');
    expect(slots).toHaveLength(2);
    expect(slots[0].startDatetime).toBe('2026-03-16T10:00:00');
    expect(slots[1].startDatetime).toBe('2026-03-16T14:00:00');
  });

  it('returns empty array when no slots', () => {
    const bizId = insertBusiness();
    expect(getSlotsForDate(bizId, '2026-03-16')).toEqual([]);
  });

  it('isolates slots by business_id', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 14);

    testDb.prepare(
      "INSERT INTO businesses (slug, name, owner_chat_id) VALUES ('other', 'Other', '2')"
    ).run();
    const otherId = Number((testDb.prepare("SELECT id FROM businesses WHERE slug = 'other'").get() as Record<string, unknown>)?.id);
    addDaySlots(otherId, '2026-03-16', 10, 14);

    expect(getSlotsForDate(bizId, '2026-03-16')).toHaveLength(1);
    expect(getSlotsForDate(otherId, '2026-03-16')).toHaveLength(1);
  });
});

// ---- getSlotsForDateFull ----

describe('getSlotsForDateFull', () => {
  it('returns slots without note and clientName', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '14:00', '18:00', 'Note', 'Client');

    const full = getSlotsForDateFull(bizId, '2026-03-16');
    expect(full).toHaveLength(1);
    expect((full[0] as any).note).toBeUndefined();
    expect((full[0] as any).clientName).toBeUndefined();
  });
});

// ---- bookRange ----

describe('bookRange', () => {
  it('creates a booked slot', () => {
    const bizId = insertBusiness();
    const result = bookRange(bizId, '2026-03-16', '14:00', '18:00', 'Бронь', 'Иванов');

    expect(result.count).toBe(1);
    expect(result.id).toBeGreaterThan(0);

    const slots = getSlotsForDate(bizId, '2026-03-16');
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe('booked');
    expect(slots[0].clientName).toBe('Иванов');
  });

  it('allows multiple bookings on same date', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '10:00', '12:00');
    bookRange(bizId, '2026-03-16', '14:00', '16:00');

    const slots = getSlotsForDate(bizId, '2026-03-16');
    expect(slots).toHaveLength(2);
  });
});

// ---- findOverlappingBookings ----

describe('findOverlappingBookings', () => {
  it('detects overlapping booking', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '14:00', '18:00', 'Бронь', 'Иванов');

    const overlaps = findOverlappingBookings(bizId, '2026-03-16', '16:00', '20:00');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].clientName).toBe('Иванов');
  });

  it('does not flag non-overlapping slots', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '10:00', '12:00');

    const overlaps = findOverlappingBookings(bizId, '2026-03-16', '14:00', '18:00');
    expect(overlaps).toHaveLength(0);
  });

  it('does not flag available slots', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 22);

    const overlaps = findOverlappingBookings(bizId, '2026-03-16', '10:00', '14:00');
    expect(overlaps).toHaveLength(0);
  });

  it('detects fully contained booking', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '10:00', '20:00');

    const overlaps = findOverlappingBookings(bizId, '2026-03-16', '12:00', '16:00');
    expect(overlaps).toHaveLength(1);
  });

  it('detects booking that fully contains the query range', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '12:00', '16:00');

    const overlaps = findOverlappingBookings(bizId, '2026-03-16', '10:00', '20:00');
    expect(overlaps).toHaveLength(1);
  });
});

// ---- cancelBooking ----

describe('cancelBooking', () => {
  it('cancels existing booking by date+time', () => {
    const bizId = insertBusiness();
    bookRange(bizId, '2026-03-16', '14:00', '18:00', 'Бронь', 'Петров');

    const result = cancelBooking(bizId, '2026-03-16', '14:00');
    expect(result.cancelled).toBe(1);
    expect(result.clientName).toBe('Петров');

    expect(getSlotsForDate(bizId, '2026-03-16')).toHaveLength(0);
  });

  it('returns cancelled=0 for non-existent booking', () => {
    const bizId = insertBusiness();
    const result = cancelBooking(bizId, '2026-03-16', '14:00');
    expect(result.cancelled).toBe(0);
  });

  it('does not cancel available slots', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 14, 18);

    const result = cancelBooking(bizId, '2026-03-16', '14:00');
    expect(result.cancelled).toBe(0);
    expect(getSlotsForDate(bizId, '2026-03-16')).toHaveLength(1);
  });
});

// ---- cancelBookingById ----

describe('cancelBookingById', () => {
  it('cancels booking by slot id', () => {
    const bizId = insertBusiness();
    const { id } = bookRange(bizId, '2026-03-16', '14:00', '18:00', 'Бронь', 'Сидоров');

    const result = cancelBookingById(id);
    expect(result.cancelled).toBe(1);
    expect(result.clientName).toBe('Сидоров');
    expect(result.dateKey).toBe('2026-03-16');
    expect(result.startTime).toBe('14:00');
    expect(result.endTime).toBe('18:00');
  });

  it('returns cancelled=0 for non-existent id', () => {
    expect(cancelBookingById(999)).toEqual({ cancelled: 0 });
  });

  it('does not cancel available slot by id', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 14);
    const slots = getSlotsForDate(bizId, '2026-03-16');

    const result = cancelBookingById(slots[0].id);
    expect(result.cancelled).toBe(0);
  });
});

// ---- clearDay ----

describe('clearDay', () => {
  it('removes all slots for a date', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-16', 14, 18);
    bookRange(bizId, '2026-03-16', '18:00', '22:00');

    const count = clearDay(bizId, '2026-03-16');
    expect(count).toBe(3);
    expect(getSlotsForDate(bizId, '2026-03-16')).toHaveLength(0);
  });

  it('does not affect other dates', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-17', 10, 14);

    clearDay(bizId, '2026-03-16');
    expect(getSlotsForDate(bizId, '2026-03-17')).toHaveLength(1);
  });

  it('returns 0 when no slots on date', () => {
    const bizId = insertBusiness();
    expect(clearDay(bizId, '2026-03-16')).toBe(0);
  });
});

// ---- getAvailableDateKeys ----

describe('getAvailableDateKeys', () => {
  it('returns dates with available slots in the future', () => {
    const bizId = insertBusiness();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16, 8, 0));

    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-17', 10, 14);

    const dates = getAvailableDateKeys(bizId);
    expect(dates).toContain('2026-03-16');
    expect(dates).toContain('2026-03-17');

    vi.useRealTimers();
  });

  it('excludes dates with only booked slots', () => {
    const bizId = insertBusiness();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16, 8, 0));

    bookRange(bizId, '2026-03-16', '10:00', '14:00');
    addDaySlots(bizId, '2026-03-17', 10, 14);

    const dates = getAvailableDateKeys(bizId);
    expect(dates).not.toContain('2026-03-16');
    expect(dates).toContain('2026-03-17');

    vi.useRealTimers();
  });

  it('returns empty array when no available slots', () => {
    const bizId = insertBusiness();
    expect(getAvailableDateKeys(bizId)).toEqual([]);
  });
});

// ---- getAllSlots ----

describe('getAllSlots', () => {
  it('groups slots by date', () => {
    const bizId = insertBusiness();
    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-17', 10, 14);
    addDaySlots(bizId, '2026-03-17', 14, 18);

    const all = getAllSlots(bizId);
    expect(all).toHaveLength(2);
    expect(all[0].dateKey).toBe('2026-03-16');
    expect(all[0].slots).toHaveLength(1);
    expect(all[1].dateKey).toBe('2026-03-17');
    expect(all[1].slots).toHaveLength(2);
  });

  it('returns empty array for no slots', () => {
    const bizId = insertBusiness();
    expect(getAllSlots(bizId)).toEqual([]);
  });
});

// ---- getScheduledDays ----

describe('getScheduledDays', () => {
  it('returns future dates with any slots', () => {
    const bizId = insertBusiness();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16));

    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-18', 10, 14);

    const days = getScheduledDays(bizId);
    expect(days).toEqual(['2026-03-16', '2026-03-18']);

    vi.useRealTimers();
  });

  it('respects limit parameter', () => {
    const bizId = insertBusiness();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16));

    for (let i = 16; i <= 30; i++) {
      addDaySlots(bizId, `2026-03-${String(i).padStart(2, '0')}`, 10, 14);
    }

    const days = getScheduledDays(bizId, 3);
    expect(days).toHaveLength(3);

    vi.useRealTimers();
  });
});

// ---- getStats ----

describe('getStats', () => {
  it('counts slots by status', () => {
    const bizId = insertBusiness();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 16, 8, 0));

    addDaySlots(bizId, '2026-03-16', 10, 14);
    addDaySlots(bizId, '2026-03-16', 14, 18);
    bookRange(bizId, '2026-03-16', '18:00', '22:00');

    const stats = getStats(bizId);
    expect(stats.available).toBe(2);
    expect(stats.booked).toBe(1);
    expect(stats.total).toBe(3);

    vi.useRealTimers();
  });

  it('returns all zeros when no slots', () => {
    const bizId = insertBusiness();
    const stats = getStats(bizId);
    expect(stats).toEqual({ total: 0, available: 0, booked: 0, blocked: 0 });
  });
});
