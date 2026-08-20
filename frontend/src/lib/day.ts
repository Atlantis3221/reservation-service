/** Общая арифметика дня для клиентской страницы. */

export const MINUTES_IN_DAY = 24 * 60;

/**
 * Таймзона заведения. Своей у заведений пока нет, и весь бэкенд считает
 * расписание по Москве — крон очистки для этого даже написан со сдвигом
 * руками. Здесь это зашито в одном месте: когда у заведения появится
 * собственная TZ, менять надо только тут.
 *
 * Брать часы зрителя нельзя: клиент из Красноярска, глядя на московскую
 * баню, видел бы «сейчас» на четыре часа в стороне от её настоящих часов.
 */
export const BUSINESS_TZ = 'Europe/Moscow';

const TZ_PARTS = new Intl.DateTimeFormat('ru-RU', {
  timeZone: BUSINESS_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** «Сейчас» по часам заведения: дата и минуты от полуночи */
export function nowInBusinessTz(): { dateKey: string; minutes: number } {
  const parts: Record<string, string> = {};
  for (const p of TZ_PARTS.formatToParts(new Date())) parts[p.type] = p.value;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00`);
}

/** Минуты (в т.ч. больше 1440) обратно в HH:MM */
export function minutesToTime(minutes: number): string {
  const norm = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad2(Math.floor(norm / 60))}:${pad2(norm % 60)}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function addDays(dateKey: string, days: number): string {
  const d = fromDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function weekdayShort(dateKey: string): string {
  return WEEKDAY_SHORT[fromDateKey(dateKey).getDay()];
}

export function isWeekend(dateKey: string): boolean {
  const dow = fromDateKey(dateKey).getDay();
  return dow === 0 || dow === 6;
}

/** «Сегодня», «Завтра» или «пятница, 22 августа» */
export function dayTitle(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Сегодня';
  if (dateKey === addDays(todayKey, 1)) return 'Завтра';
  return fromDateKey(dateKey).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export function dateLong(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long',
  });
}

export function dateWithWeekday(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

/** «2 часа», «30 мин», «сутки» — длительность сеанса словами */
export function durationLabel(minutes: number): string {
  if (minutes >= MINUTES_IN_DAY) return 'сутки';
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    if (h === 1) return '1 час';
    return `${h} ${h < 5 ? 'часа' : 'часов'}`;
  }
  if (minutes > 60) {
    const h = Math.floor(minutes / 60);
    return `${h} ч ${minutes % 60} мин`;
  }
  return `${minutes} мин`;
}

/** «4 окна», «1 окно» — согласование с числом */
export function slotsCountLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} окно`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} окна`;
  return `${n} окон`;
}

/** Короткая подпись длительности для чипов: «2 ч», «2:30», «30 мин» */
export function durationShort(minutes: number): string {
  if (minutes >= MINUTES_IN_DAY) return 'сутки';
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ч` : `${h}:${pad2(m)}`;
}

/** Прибавляет минуты к HH:MM, сворачивая за полночь */
export function shiftTime(time: string, minutes: number): string {
  const total = ((timeToMinutes(time) + minutes) % MINUTES_IN_DAY + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/**
 * Правила длительности заведения на стороне клиента. Повторяет серверный
 * `rulesOf`: у старых заведений колонок нет, и тогда сеанс фиксированный.
 */
export interface DurationRules {
  step: number;
  min: number;
  /** null — без ограничения */
  max: number | null;
  fixed: boolean;
}

export function durationRules(business: {
  slotDurationMinutes: number;
  minDurationMinutes?: number;
  maxDurationMinutes?: number | null;
}): DurationRules {
  const min = business.minDurationMinutes ?? business.slotDurationMinutes;
  const max = business.maxDurationMinutes === undefined
    ? min
    : business.maxDurationMinutes;
  return {
    step: business.slotDurationMinutes,
    min,
    max,
    fixed: max !== null && max <= min,
  };
}

/** Варианты длительности для конкретного начала: от минимума шагами step */
export function durationChoices(rules: DurationRules, roomMinutes: number): number[] {
  const cap = rules.max === null ? roomMinutes : Math.min(roomMinutes, rules.max);
  const step = Math.max(15, rules.step);
  const out: number[] = [];
  for (let d = rules.min; d <= cap; d += step) out.push(d);
  return out;
}

/**
 * Родительный падеж: «от 2 часов», «до 1 часа». После «от» и «до» нужен
 * именно он — «от 2 часа» читается как опечатка.
 */
export function durationGenitive(minutes: number): string {
  if (minutes >= MINUTES_IN_DAY) return 'суток';
  if (minutes < 60) return `${minutes} минут`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? '1 часа' : `${h} часов`;
  return m === 0 ? hours : `${hours} ${m} минут`;
}

/** «сеанс 2 часа» / «от 2 часов» / «от 1 часа до 4 часов» — что писать под датой */
export function durationSummary(rules: DurationRules): string {
  if (rules.min >= MINUTES_IN_DAY) return 'сутки целиком';
  if (rules.fixed) return `сеанс ${durationLabel(rules.min)}`;
  if (rules.max === null) return `от ${durationGenitive(rules.min)}`;
  return `от ${durationGenitive(rules.min)} до ${durationGenitive(rules.max)}`;
}
