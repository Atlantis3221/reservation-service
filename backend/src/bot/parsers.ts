import { DAY_ABBREV, pad2 } from '../utils/date';

export interface DayTimeRange {
  startDay: number;
  endDay: number;
  startHour: number;
  endHour: number;
  /** Минуты начала — для смен вида «с 10:30» */
  startMinute?: number;
  /** Минуты конца */
  endMinute?: number;
}

export interface FlexibleScheduleCommand {
  week: 'this' | 'next';
  ranges: DayTimeRange[];
}

/**
 * «эту неделю пн-пт с 10 до 22», «на этой неделе сб с 10:30 до 23».
 * Поддерживает диапазон дней и одиночный день, целые часы и получас —
 * раньше «сб с 10 до 22» и «10:30» молча не распознавались.
 */
export function parseFlexibleSchedule(text: string): FlexibleScheduleCommand | null {
  const lower = text.toLowerCase();

  let week: 'this' | 'next';
  if (/(?:на\s+)?эт(?:ой|у|а)\s+недел/.test(lower)) {
    week = 'this';
  } else if (/(?:на\s+)?следующ\S*\s+недел/.test(lower)) {
    week = 'next';
  } else {
    return null;
  }

  const DAY = '(пн|вт|ср|чт|пт|сб|вс)';
  const TIME = '(\\d{1,2})(?::(\\d{2}))?';
  const rangeRegex = new RegExp(
    `(?:с\\s+)?${DAY}(?:\\s*(?:[-–—]\\s*|\\s+по\\s+)${DAY})?` +
    `\\s+[сc]\\s+${TIME}\\s+(?:до|по)\\s+${TIME}`,
    'g',
  );

  const ranges: DayTimeRange[] = [];
  let match;
  while ((match = rangeRegex.exec(lower)) !== null) {
    const startDay = DAY_ABBREV[match[1]];
    // День не указан вторым — значит смена на один день
    const endDay = match[2] ? DAY_ABBREV[match[2]] : startDay;
    const startHour = Number(match[3]);
    const startMinute = Number(match[4] ?? '0');
    const endHour = Number(match[5]);
    const endMinute = Number(match[6] ?? '0');

    if (startDay === undefined || endDay === undefined) continue;
    if (startHour > 23 || endHour > 24) continue;
    if (startMinute > 59 || endMinute > 59) continue;

    ranges.push({ startDay, endDay, startHour, endHour, startMinute, endMinute });
  }

  if (ranges.length === 0) return null;

  return { week, ranges };
}

export function parseBookingCommand(text: string): { dayName: string; startTime: string; endTime: string; clientName?: string } | null {
  const match = text.match(/(?:в|на)\s+([а-яё]+)\s+бронь\s+на\s+(\d+):(\d+)\s+на\s+(\d+)\s+час\S*\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const hour = Number(match[2]);
  const minutes = Number(match[3]);
  const duration = Number(match[4]);
  const rawName = match[5]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (hour < 0 || hour >= 24 || minutes < 0 || minutes >= 60 || duration < 1) {
    return null;
  }

  const startTime = `${pad2(hour)}:${pad2(minutes)}`;
  const endHour = (hour + duration) % 24;
  const endTime = `${pad2(endHour)}:${pad2(minutes)}`;

  return { dayName, startTime, endTime, clientName };
}

export function parseBookingRange(text: string): { dayName: string; startTime: string; endTime: string; clientName?: string } | null {
  const match = text.match(/(?:(?:в|на)\s+)?(\S+)\s+бронь\s+[сc]\s+(\d{1,2})(?::(\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?::(\d{2}))?\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const startHour = Number(match[2]);
  const startMin = Number(match[3] || '0');
  const endHour = Number(match[4]);
  const endMin = Number(match[5] || '0');
  const rawName = match[6]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (startHour < 0 || startHour >= 24 || endHour < 0 || endHour > 24) return null;
  if (startMin < 0 || startMin >= 60 || endMin < 0 || endMin >= 60) return null;

  const startTime = `${pad2(startHour)}:${pad2(startMin)}`;
  const endTime = endHour === 24 ? '00:00' : `${pad2(endHour)}:${pad2(endMin)}`;

  if (startTime === endTime) return null;

  return { dayName, startTime, endTime, clientName };
}

/**
 * «запиши Иванова на субботу в 15:00» — без указания длительности.
 * Длительность берётся из настроек заведения (длительность сеанса).
 */
export function parseBookingAt(text: string): { dayName: string; startTime: string; clientName?: string } | null {
  // «отмени бронь на субботу 15:00» — это отмена, а не запись
  if (/^\s*отмени/i.test(text)) return null;

  const match = text.match(
    /(?:запиши|запись|бронь)\s+(?:([а-яё\s.-]+?)\s+)?(?:на|в)\s+([а-яё]+)\s+(?:в\s+)?(\d{1,2})(?::(\d{2}))?(?!\s*(?::|до|по|-))/i,
  );
  if (!match) return null;

  const rawName = match[1]?.trim();
  const dayName = match[2];
  const hour = Number(match[3]);
  const minutes = Number(match[4] || '0');

  if (hour > 23 || minutes > 59) return null;
  if (DAY_WORDS.has(rawName ?? '')) return null;

  const clientName = rawName
    ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
    : undefined;

  return { dayName, startTime: `${pad2(hour)}:${pad2(minutes)}`, clientName };
}

/** Слова-дни, которые нельзя принять за имя клиента */
const DAY_WORDS = new Set([
  'сегодня', 'завтра', 'послезавтра',
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье',
  'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье',
  'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс',
]);

export function parseCancelCommand(text: string): { dayName: string; startTime: string } | null {
  const match = text.match(/отмени\s+бронь\s+(?:на\s+)?(\S+)\s+(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hour = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return { dayName: match[1], startTime: `${pad2(hour)}:${pad2(minutes)}` };
}
