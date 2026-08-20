import { getDb } from './db';
import { pad2, toDateKey, nextDateKey } from '../utils/date';
import type { FreeSlot } from '../types';

const MINUTES_IN_DAY = 24 * 60;

/**
 * Длительность «сутки» и больше означает другую единицу бронирования:
 * не интервал внутри дня, а весь опубликованный день целиком.
 * Так сдаются дома, глемпинги и бани с проживанием.
 */
export const FULL_DAY_MINUTES = MINUTES_IN_DAY;

export function isFullDayDuration(durationMinutes: number): boolean {
  return durationMinutes >= FULL_DAY_MINUTES;
}

/**
 * Правила длительности заведения. Фиксированный сеанс — это частный случай,
 * где min === max: до появления гибкой длительности других и не было.
 */
export interface DurationRules {
  /** Шаг сетки: как часто предлагается начало и какими шагами растёт бронь */
  stepMinutes: number;
  minMinutes: number;
  /** null — без верхней границы: занять можно до конца свободного окна */
  maxMinutes: number | null;
}

export const MIN_STEP_MINUTES = 15;

/** Число вместо правил означает старое поведение: сеанс ровно такой длины */
export function toRules(rules: DurationRules | number): DurationRules {
  if (typeof rules === 'number') {
    return { stepMinutes: rules, minMinutes: rules, maxMinutes: rules };
  }
  return rules;
}

export function rulesOf(biz: {
  slotDurationMinutes: number;
  minDurationMinutes?: number;
  maxDurationMinutes?: number | null;
}): DurationRules {
  const min = biz.minDurationMinutes ?? biz.slotDurationMinutes;
  return {
    stepMinutes: biz.slotDurationMinutes,
    minMinutes: min,
    // undefined — колонки ещё нет (старая база): считаем сеанс фиксированным.
    // null — владелец снял ограничение осознанно.
    maxMinutes: biz.maxDurationMinutes === undefined ? min : biz.maxDurationMinutes,
  };
}

export function isFixedDuration(rules: DurationRules): boolean {
  return rules.maxMinutes !== null && rules.maxMinutes <= rules.minMinutes;
}

/**
 * Длительности, которые клиент может выбрать для конкретного начала:
 * от минимума шагами `step`, пока влезает в окно и в максимум.
 */
export function durationChoices(rules: DurationRules, roomMinutes: number): number[] {
  const cap = rules.maxMinutes === null ? roomMinutes : Math.min(roomMinutes, rules.maxMinutes);
  const step = Math.max(MIN_STEP_MINUTES, rules.stepMinutes);
  const out: number[] = [];
  for (let d = rules.minMinutes; d <= cap; d += step) out.push(d);
  return out;
}

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
 * Разбивает свободные окна дня на варианты начала брони.
 * Это то, что клиент видит и нажимает: «10:00–12:00», «12:00–14:00», …
 */
export function getFreeSlots(
  businessId: number,
  dateKey: string,
  duration: DurationRules | number,
  now: Date = new Date(),
): FreeSlot[] {
  const rules = toRules(duration);
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

  const nowKey = toDateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Для вчерашней смены, уходящей за полночь, «сейчас» тоже сдвигается на сутки.
  const cutoff =
    dateKey === nowKey ? nowMinutes
    : nextDateKey(dateKey) === nowKey ? nowMinutes + MINUTES_IN_DAY
    : -Infinity;

  // Сутки: день продаётся целиком. Либо он свободен полностью, либо занят —
  // «половины суток» не бывает, поэтому нарезать нечего.
  if (isFullDayDuration(rules.minMinutes)) {
    const dayStart = Math.min(...windows.map((w) => w.start));
    const dayEnd = Math.max(...windows.map((w) => w.end));
    const wholeDayFree = free.some((gap) => gap.start <= dayStart && gap.end >= dayEnd);

    if (!wholeDayFree || dayStart < cutoff) return [];

    return [{
      startTime: minutesToTime(dayStart),
      endTime: minutesToTime(dayEnd),
      crossesMidnight: dayEnd > MINUTES_IN_DAY,
      fullDay: true,
      startMinutes: dayStart,
      endMinutes: dayEnd,
      maxMinutes: dayEnd - dayStart,
    }];
  }

  const step = Math.max(MIN_STEP_MINUTES, rules.stepMinutes);
  const min = Math.max(MIN_STEP_MINUTES, rules.minMinutes);

  const slots: FreeSlot[] = [];
  for (const gap of free) {
    // Начало предлагается каждые `step` минут, пока с него влезает минимальная
    // бронь. Раньше шаг был равен длительности, поэтому «от двух часов»
    // означало старт только в 10:00, 12:00, 14:00 — и ничего между.
    for (let start = gap.start; start + min <= gap.end; start += step) {
      if (start < cutoff) continue;
      const room = gap.end - start;
      slots.push({
        startTime: minutesToTime(start),
        endTime: minutesToTime(start + min),
        crossesMidnight: start + min > MINUTES_IN_DAY,
        startMinutes: start,
        endMinutes: start + min,
        maxMinutes: rules.maxMinutes === null ? room : Math.min(room, rules.maxMinutes),
      });
    }
  }

  return slots;
}

/**
 * Проверяет длительность против правил заведения. Отдельно от попадания
 * в свободное окно: тексты ошибок разные, и клиенту важно понять, что не так
 * — время уже заняли или он просит меньше минимума.
 */
export function checkDuration(
  rules: DurationRules,
  startTime: string,
  endTime: string,
): { ok: true } | { ok: false; error: string } {
  let minutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (minutes <= 0) minutes += MINUTES_IN_DAY;

  if (isFullDayDuration(rules.minMinutes)) return { ok: true };

  if (minutes < rules.minMinutes) {
    return { ok: false, error: `Минимальная бронь — ${humanDuration(rules.minMinutes)}` };
  }
  if (rules.maxMinutes !== null && minutes > rules.maxMinutes) {
    return { ok: false, error: `Максимальная бронь — ${humanDuration(rules.maxMinutes)}` };
  }

  const step = Math.max(MIN_STEP_MINUTES, rules.stepMinutes);
  if ((minutes - rules.minMinutes) % step !== 0) {
    return { ok: false, error: `Длительность — с шагом ${humanDuration(step)}` };
  }

  return { ok: true };
}

/** «2 часа», «30 минут», «сутки» — для текстов ошибок и уведомлений */
export function humanDuration(minutes: number): string {
  if (minutes >= MINUTES_IN_DAY) return 'сутки';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} минут`;
  const hours = h === 1 ? '1 час' : `${h} ${h < 5 ? 'часа' : 'часов'}`;
  return m === 0 ? hours : `${hours} ${m} мин`;
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
export function hasFreeSlots(
  businessId: number,
  dateKey: string,
  duration: DurationRules | number,
): boolean {
  return getFreeSlots(businessId, dateKey, duration).length > 0;
}

/**
 * Даты, в которые клиент реально может что-то забронировать.
 * Отличается от «дат с расписанием»: день, забронированный целиком,
 * не должен подсвечиваться в календаре как доступный.
 */
export function getBookableDateKeys(
  businessId: number,
  duration: DurationRules | number,
): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ? AND status = 'available' AND date_key >= ?
       ORDER BY date_key`,
    )
    .all(businessId, toDateKey(new Date())) as Array<{ date_key: string }>;

  return rows
    .map((r) => r.date_key)
    .filter((dateKey) => hasFreeSlots(businessId, dateKey, duration));
}
