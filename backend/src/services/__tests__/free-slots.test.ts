import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', () => ({
  getDb: () => testDb,
}));

import { getFreeSlots, isRangeBookable, timeToMinutes, minutesToTime } from '../free-slots';

const DAY = '2026-09-10';
const BIZ = 1;

function addSlot(status: string, start: string, end: string, dateKey = DAY): void {
  testDb
    .prepare(
      `INSERT INTO slots (business_id, date_key, start_time, end_time, status)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(BIZ, dateKey, start, end, status);
}

function times(slots: Array<{ startTime: string; endTime: string }>): string[] {
  return slots.map((s) => `${s.startTime}-${s.endTime}`);
}

/** Полдень «в прошлом» относительно тестового дня — фильтр по «сейчас» не мешает */
const LONG_BEFORE = new Date('2026-09-01T12:00:00');

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
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
});

describe('helpers', () => {
  it('переводит время в минуты и обратно', () => {
    expect(timeToMinutes('10:30')).toBe(630);
    expect(minutesToTime(630)).toBe('10:30');
    expect(minutesToTime(24 * 60)).toBe('00:00');
    expect(minutesToTime(25 * 60 + 30)).toBe('01:30');
  });
});

describe('getFreeSlots', () => {
  it('без расписания свободных интервалов нет', () => {
    expect(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE)).toEqual([]);
  });

  it('нарезает смену на интервалы по длительности сеанса', () => {
    addSlot('available', '10:00', '16:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '10:00-12:00', '12:00-14:00', '14:00-16:00',
    ]);
  });

  it('не отдаёт хвост, который короче сеанса', () => {
    addSlot('available', '10:00', '15:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '10:00-12:00', '12:00-14:00',
    ]);
  });

  it('вырезает занятое время', () => {
    addSlot('available', '10:00', '18:00');
    addSlot('booked', '12:00', '14:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '10:00-12:00', '14:00-16:00', '16:00-18:00',
    ]);
  });

  it('выравнивает сетку по началу свободного окна, а не по началу смены', () => {
    addSlot('available', '10:00', '18:00');
    addSlot('booked', '11:00', '12:30');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '12:30-14:30', '14:30-16:30',
    ]);
  });

  it('учитывает blocked так же, как booked', () => {
    addSlot('available', '10:00', '14:00');
    addSlot('blocked', '10:00', '12:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual(['12:00-14:00']);
  });

  it('работает со сменой, уходящей за полночь', () => {
    addSlot('available', '22:00', '04:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '22:00-00:00', '00:00-02:00', '02:00-04:00',
    ]);
  });

  it('вырезает ночную бронь из смены за полночь', () => {
    addSlot('available', '22:00', '04:00');
    addSlot('booked', '00:00', '02:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '22:00-00:00', '02:00-04:00',
    ]);
  });

  it('помечает интервалы, уходящие за полночь', () => {
    addSlot('available', '22:00', '04:00');
    const slots = getFreeSlots(BIZ, DAY, 120, LONG_BEFORE);
    expect(slots.map((s) => s.crossesMidnight)).toEqual([false, true, true]);
  });

  it('скрывает интервалы, которые уже начались сегодня', () => {
    addSlot('available', '10:00', '18:00');
    const atFifteen = new Date(`${DAY}T15:00:00`);
    expect(times(getFreeSlots(BIZ, DAY, 120, atFifteen))).toEqual(['16:00-18:00']);
  });

  it('поддерживает получасовые границы смены', () => {
    addSlot('available', '10:30', '14:30');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '10:30-12:30', '12:30-14:30',
    ]);
  });

  it('склеивает несколько окон одного дня', () => {
    addSlot('available', '08:00', '10:00');
    addSlot('available', '14:00', '16:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '08:00-10:00', '14:00-16:00',
    ]);
  });
});

describe('сутки: день бронируется целиком', () => {
  const DAY_MINUTES = 24 * 60;

  it('отдаёт одну бронь на весь опубликованный день', () => {
    addSlot('available', '14:00', '12:00');
    const slots = getFreeSlots(BIZ, DAY, DAY_MINUTES, LONG_BEFORE);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ startTime: '14:00', endTime: '12:00', fullDay: true });
  });

  it('поддерживает круглосуточную смену 00:00–00:00', () => {
    addSlot('available', '00:00', '00:00');
    const slots = getFreeSlots(BIZ, DAY, DAY_MINUTES, LONG_BEFORE);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ startTime: '00:00', endTime: '00:00', fullDay: true });
  });

  it('не отдаёт день, если он частично занят', () => {
    addSlot('available', '14:00', '12:00');
    addSlot('booked', '18:00', '20:00');
    expect(getFreeSlots(BIZ, DAY, DAY_MINUTES, LONG_BEFORE)).toEqual([]);
  });

  it('не отдаёт день, который уже начался', () => {
    addSlot('available', '10:00', '22:00');
    const midday = new Date(`${DAY}T12:00:00`);
    expect(getFreeSlots(BIZ, DAY, DAY_MINUTES, midday)).toEqual([]);
  });

  it('без расписания суток тоже нет', () => {
    expect(getFreeSlots(BIZ, DAY, DAY_MINUTES, LONG_BEFORE)).toEqual([]);
  });

  it('обычная длительность по-прежнему нарезает день', () => {
    addSlot('available', '10:00', '14:00');
    expect(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE))).toEqual([
      '10:00-12:00', '12:00-14:00',
    ]);
  });
});

describe('isRangeBookable', () => {
  beforeEach(() => {
    addSlot('available', '10:00', '18:00');
    addSlot('booked', '12:00', '14:00');
  });

  it('пропускает интервал внутри свободного окна', () => {
    expect(isRangeBookable(BIZ, DAY, '10:00', '12:00')).toBe(true);
    expect(isRangeBookable(BIZ, DAY, '14:00', '15:30')).toBe(true);
  });

  it('отклоняет пересечение с бронью', () => {
    expect(isRangeBookable(BIZ, DAY, '11:00', '13:00')).toBe(false);
    expect(isRangeBookable(BIZ, DAY, '12:00', '14:00')).toBe(false);
    expect(isRangeBookable(BIZ, DAY, '13:00', '16:00')).toBe(false);
  });

  it('отклоняет выход за пределы смены', () => {
    expect(isRangeBookable(BIZ, DAY, '09:00', '11:00')).toBe(false);
    expect(isRangeBookable(BIZ, DAY, '17:00', '19:00')).toBe(false);
  });

  it('отклоняет день без расписания', () => {
    expect(isRangeBookable(BIZ, '2026-09-11', '10:00', '12:00')).toBe(false);
  });
});

describe('абсолютные минуты для клиента', () => {
  it('отдаёт минуты от полуночи, не сбрасывая их за полночь', () => {
    addSlot('available', '22:00', '04:00');
    const slots = getFreeSlots(BIZ, DAY, 120, LONG_BEFORE);
    expect(slots.map((s) => [s.startMinutes, s.endMinutes])).toEqual([
      [22 * 60, 24 * 60],
      [24 * 60, 26 * 60],
      [26 * 60, 28 * 60],
    ]);
  });

  it('для суток минуты покрывают всю смену', () => {
    addSlot('available', '14:00', '12:00');
    const [slot] = getFreeSlots(BIZ, DAY, 24 * 60, LONG_BEFORE);
    expect([slot.startMinutes, slot.endMinutes]).toEqual([14 * 60, 36 * 60]);
  });

  it('минуты согласованы со временем в обычном дне', () => {
    addSlot('available', '10:30', '14:30');
    const slots = getFreeSlots(BIZ, DAY, 120, LONG_BEFORE);
    expect(slots.map((s) => [s.startTime, s.startMinutes])).toEqual([
      ['10:30', 630],
      ['12:30', 750],
    ]);
  });
});
