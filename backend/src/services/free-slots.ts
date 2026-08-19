import { getDb } from './db';
import { pad2, toDateKey, nextDateKey } from '../utils/date';
import type { FreeSlot } from '../types';

const MINUTES_IN_DAY = 24 * 60;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

interface Interval {
  start: number;
  end: number;
}

/**
 * Приводит слот к абсолютным минутам относительно начала дня расписания.
 * Смена может уходить за полночь (10:00 → 03:00), поэтому у брони, которая
 * началась после полуночи, минуты сдвигаются на сутки вперёд.
 */
function toInterval(row: any, dayStartMin: number, dayCrossesMidnight: boolean): Interval {
  let start = timeToMinutes(row.start_time);
  let end = timeToMinutes(row.end_time);

  if (end <= start) end += MINUTES_IN_DAY;

  if (dayCrossesMidnight && start < dayStartMin) {
    start += MINUTES_IN_DAY;
    end += MINUTES_IN_DAY;
  }

  return { start, end };
}

function subtract(windows: Interval[], busy: Interval[]): Interval[] {
  let result = windows;

  for (const b of busy) {
    const next: Interval[] = [];
    for (const w of result) {
      if (b.end <= w.start || b.start >= w.end) {
        next.push(w);
        continue;
      }
      if (b.start > w.start) next.push({ start: w.start, end: b.start });
      if (b.end < w.end) next.push({ start: b.end, end: w.end });
    }
    result = next;
  }

  return result.sort((a, b) => a.start - b.start);
}

/**
 * Разбивает свободные окна дня на конкретные интервалы длиной durationMinutes.
 * Это то, что клиент видит и нажимает: «10:00–12:00», «12:00–14:00», …
 */
export function getFreeSlots(
  businessId: number,
  dateKey: string,
  durationMinutes: number,
  now: Date = new Date(),
): FreeSlot[] {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY start_time')
    .all(businessId, dateKey) as any[];

  const availableRows = rows.filter((r) => r.status === 'available');
  if (availableRows.length === 0) return [];

  const dayStartMin = Math.min(...availableRows.map((r) => timeToMinutes(r.start_time)));
  const dayCrossesMidnight = availableRows.some(
    (r) => timeToMinutes(r.end_time) <= timeToMinutes(r.start_time),
  );

  const windows = availableRows.map((r) => toInterval(r, dayStartMin, dayCrossesMidnight));
  const busy = rows
    .filter((r) => r.status !== 'available')
    .map((r) => toInterval(r, dayStartMin, dayCrossesMidnight));

  const free = subtract(windows, busy);

  const step = Math.max(15, durationMinutes);
  const nowKey = toDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Для вчерашней смены, уходящей за полночь, «сейчас» тоже сдвигается на сутки.
  const cutoff =
    dateKey === nowKey ? nowMinutes
    : nextDateKey(dateKey) === nowKey ? nowMinutes + MINUTES_IN_DAY
    : -Infinity;

  const slots: FreeSlot[] = [];
  for (const gap of free) {
    for (let start = gap.start; start + step <= gap.end; start += step) {
      if (start < cutoff) continue;
      slots.push({
        startTime: minutesToTime(start),
        endTime: minutesToTime(start + step),
        crossesMidnight: start + step > MINUTES_IN_DAY,
      });
    }
  }

  return slots;
}

/**
 * Проверяет, что интервал целиком попадает в опубликованное свободное время.
 * Используется перед тем, как принять бронь от клиента.
 */
export function isRangeBookable(
  businessId: number,
  dateKey: string,
  startTime: string,
  endTime: string,
): boolean {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ?')
    .all(businessId, dateKey) as any[];

  const availableRows = rows.filter((r) => r.status === 'available');
  if (availableRows.length === 0) return false;

  const dayStartMin = Math.min(...availableRows.map((r) => timeToMinutes(r.start_time)));
  const dayCrossesMidnight = availableRows.some(
    (r) => timeToMinutes(r.end_time) <= timeToMinutes(r.start_time),
  );

  const windows = availableRows.map((r) => toInterval(r, dayStartMin, dayCrossesMidnight));
  const busy = rows
    .filter((r) => r.status !== 'available')
    .map((r) => toInterval(r, dayStartMin, dayCrossesMidnight));

  const target = toInterval(
    { start_time: startTime, end_time: endTime },
    dayStartMin,
    dayCrossesMidnight,
  );

  const free = subtract(windows, busy);
  return free.some((gap) => target.start >= gap.start && target.end <= gap.end);
}

/** Есть ли у заведения хотя бы один свободный интервал в этот день */
export function hasFreeSlots(businessId: number, dateKey: string, durationMinutes: number): boolean {
  return getFreeSlots(businessId, dateKey, durationMinutes).length > 0;
}

/**
 * Даты, в которые клиент реально может что-то забронировать.
 * Отличается от «дат с расписанием»: день, забронированный целиком,
 * не должен подсвечиваться в календаре как доступный.
 */
export function getBookableDateKeys(businessId: number, durationMinutes: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ? AND status = 'available' AND date_key >= ?
       ORDER BY date_key`,
    )
    .all(businessId, toDateKey(new Date())) as Array<{ date_key: string }>;

  return rows
    .map((r) => r.date_key)
    .filter((dateKey) => hasFreeSlots(businessId, dateKey, durationMinutes));
}
