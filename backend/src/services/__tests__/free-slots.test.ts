import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', () => ({
  getDb: () => testDb,
}));

import {
  getFreeSlots, isRangeBookable, timeToMinutes, minutesToTime,
  checkDuration, durationChoices, rulesOf, humanDuration,
} from '../free-slots';

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

// ---- Гибкая длительность: «от двух часов», максимум опциональный ----

describe('гибкая длительность', () => {
  /** Смена 10:00–18:00, минимум 2 часа, шаг 30 минут */
  const FROM_TWO_HOURS = { stepMinutes: 30, minMinutes: 120, maxMinutes: null };

  it('предлагает начало каждые step минут, а не каждые min', () => {
    addSlot('available', '10:00', '18:00');
    expect(times(getFreeSlots(BIZ, DAY, FROM_TWO_HOURS, LONG_BEFORE)).slice(0, 4)).toEqual([
      '10:00-12:00', '10:30-12:30', '11:00-13:00', '11:30-13:30',
    ]);
  });

  it('последнее начало — такое, с которого влезает минимум', () => {
    addSlot('available', '10:00', '18:00');
    const slots = getFreeSlots(BIZ, DAY, FROM_TWO_HOURS, LONG_BEFORE);
    expect(slots.at(-1)).toMatchObject({ startTime: '16:00', endTime: '18:00' });
  });

  it('без верхней границы maxMinutes — это остаток окна', () => {
    addSlot('available', '10:00', '18:00');
    const slots = getFreeSlots(BIZ, DAY, FROM_TWO_HOURS, LONG_BEFORE);
    expect(slots[0].maxMinutes).toBe(480);
    expect(slots.at(-1)!.maxMinutes).toBe(120);
  });

  it('максимум обрезает окно', () => {
    addSlot('available', '10:00', '18:00');
    const slots = getFreeSlots(BIZ, DAY, { ...FROM_TWO_HOURS, maxMinutes: 240 }, LONG_BEFORE);
    expect(slots[0].maxMinutes).toBe(240);
  });

  it('бронь посередине обрезает и окно, и maxMinutes', () => {
    addSlot('available', '10:00', '18:00');
    addSlot('booked', '14:00', '16:00');
    const slots = getFreeSlots(BIZ, DAY, FROM_TWO_HOURS, LONG_BEFORE);
    expect(times(slots)).toEqual([
      '10:00-12:00', '10:30-12:30', '11:00-13:00', '11:30-13:30', '12:00-14:00',
      '16:00-18:00',
    ]);
    // с 12:00 остаётся ровно до 14:00
    expect(slots.find((s) => s.startTime === '12:00')!.maxMinutes).toBe(120);
  });

  it('фиксированный сеанс (min === max) работает как раньше', () => {
    addSlot('available', '10:00', '18:00');
    const fixed = { stepMinutes: 120, minMinutes: 120, maxMinutes: 120 };
    expect(times(getFreeSlots(BIZ, DAY, fixed, LONG_BEFORE)))
      .toEqual(times(getFreeSlots(BIZ, DAY, 120, LONG_BEFORE)));
  });
});

describe('durationChoices', () => {
  it('от минимума шагами, пока влезает в окно', () => {
    expect(durationChoices({ stepMinutes: 30, minMinutes: 120, maxMinutes: null }, 240))
      .toEqual([120, 150, 180, 210, 240]);
  });

  it('упирается в максимум раньше окна', () => {
    expect(durationChoices({ stepMinutes: 60, minMinutes: 60, maxMinutes: 180 }, 600))
      .toEqual([60, 120, 180]);
  });

  it('фиксированный сеанс — один вариант', () => {
    expect(durationChoices({ stepMinutes: 120, minMinutes: 120, maxMinutes: 120 }, 600))
      .toEqual([120]);
  });

  it('окно меньше минимума — вариантов нет', () => {
    expect(durationChoices({ stepMinutes: 30, minMinutes: 120, maxMinutes: null }, 90))
      .toEqual([]);
  });
});

describe('checkDuration', () => {
  const rules = { stepMinutes: 30, minMinutes: 120, maxMinutes: 300 };

  it('пропускает длительность из сетки', () => {
    expect(checkDuration(rules, '10:00', '12:00').ok).toBe(true);
    expect(checkDuration(rules, '10:00', '14:30').ok).toBe(true);
  });

  it('отвергает меньше минимума', () => {
    const result = checkDuration(rules, '10:00', '11:00');
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain('2 часа');
  });

  it('отвергает больше максимума', () => {
    expect(checkDuration(rules, '10:00', '16:00').ok).toBe(false);
  });

  it('отвергает длительность вне шага', () => {
    expect(checkDuration(rules, '10:00', '12:20').ok).toBe(false);
  });

  it('считает переход через полночь', () => {
    expect(checkDuration(rules, '23:00', '01:00').ok).toBe(true);
  });

  it('для суток длительность не проверяет — день продаётся целиком', () => {
    const daily = { stepMinutes: 1440, minMinutes: 1440, maxMinutes: 1440 };
    expect(checkDuration(daily, '14:00', '12:00').ok).toBe(true);
  });
});

describe('rulesOf', () => {
  it('старое заведение без колонок — фиксированный сеанс', () => {
    expect(rulesOf({ slotDurationMinutes: 120 }))
      .toEqual({ stepMinutes: 120, minMinutes: 120, maxMinutes: 120 });
  });

  it('null в максимуме — снятое ограничение, а не отсутствие данных', () => {
    expect(rulesOf({ slotDurationMinutes: 30, minDurationMinutes: 120, maxDurationMinutes: null }))
      .toEqual({ stepMinutes: 30, minMinutes: 120, maxMinutes: null });
  });
});

describe('humanDuration', () => {
  it('склоняет часы и добавляет минуты', () => {
    expect(humanDuration(30)).toBe('30 минут');
    expect(humanDuration(60)).toBe('1 час');
    expect(humanDuration(120)).toBe('2 часа');
    expect(humanDuration(300)).toBe('5 часов');
    expect(humanDuration(150)).toBe('2 часа 30 мин');
    expect(humanDuration(1440)).toBe('сутки');
  });
});
