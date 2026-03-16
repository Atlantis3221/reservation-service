export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export const DAY_ABBREV: Record<string, number> = {
  'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
};

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nextDateKey(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return toDateKey(d);
}

export function fmtDate(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const wd = WEEKDAYS_SHORT[d.getDay()];
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} (${wd})`;
}

export function getMondayOfWeek(week: 'this' | 'next'): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysFromMonday);
  if (week === 'next') {
    monday.setDate(monday.getDate() + 7);
  }
  return monday;
}

export function getNextWeekday(dayName: string): Date | null {
  const lower = dayName.toLowerCase();

  const dayMap: Record<string, number> = {
    'понедельник': 1, 'понедельника': 1, 'понедельнику': 1, 'понедельником': 1,
    'вторник': 2, 'вторника': 2, 'вторнику': 2, 'вторником': 2,
    'среда': 3, 'среды': 3, 'среде': 3, 'средой': 3, 'среду': 3,
    'четверг': 4, 'четверга': 4, 'четвергу': 4, 'четвергом': 4,
    'пятница': 5, 'пятницы': 5, 'пятнице': 5, 'пятницей': 5, 'пятницу': 5,
    'суббота': 6, 'субботы': 6, 'субботе': 6, 'субботой': 6, 'субботу': 6,
    'воскресенье': 0, 'воскресенья': 0, 'воскресенью': 0, 'воскресеньем': 0,
  };

  const dayIndex = dayMap[lower];
  if (dayIndex === undefined) {
    const found = WEEKDAYS_FULL.findIndex((d) => d.startsWith(lower));
    if (found === -1) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentDay = today.getDay();
    let daysUntil = found - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntil);
    return targetDate;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentDay = today.getDay();
  let daysUntil = dayIndex - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntil);
  return targetDate;
}

export function resolveDay(dayName: string): Date | null {
  const lower = dayName.toLowerCase();

  if (lower === 'сегодня') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  if (lower === 'завтра') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    return d;
  }

  const dayMap: Record<string, number> = {
    'понедельник': 1, 'понедельника': 1, 'понедельнику': 1, 'понедельником': 1,
    'вторник': 2, 'вторника': 2, 'вторнику': 2, 'вторником': 2,
    'среда': 3, 'среды': 3, 'среде': 3, 'средой': 3, 'среду': 3,
    'четверг': 4, 'четверга': 4, 'четвергу': 4, 'четвергом': 4,
    'пятница': 5, 'пятницы': 5, 'пятнице': 5, 'пятницей': 5, 'пятницу': 5,
    'суббота': 6, 'субботы': 6, 'субботе': 6, 'субботой': 6, 'субботу': 6,
    'воскресенье': 0, 'воскресенья': 0, 'воскресенью': 0, 'воскресеньем': 0,
  };

  const dayIndex = dayMap[lower];
  if (dayIndex === undefined) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentDay = today.getDay();
  let daysUntil = dayIndex - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntil);
  return targetDate;
}
