import { Telegraf, Markup } from 'telegraf';
import {
  addDaySlots,
  clearDay,
  getScheduledDays,
  getSlotsForDate,
  getStats,
  bookRange,
} from './schedule';
import type { SlotStatus } from '../types';

let bot: Telegraf | null = null;

function getAdminId(): number | null {
  const raw = process.env.ADMIN_CHAT_ID;
  return raw ? Number(raw) : null;
}

function isAdmin(chatId: number): boolean {
  const adminId = getAdminId();
  if (!adminId) return true;
  return chatId === adminId;
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || '';
}

// ---- Форматирование ----

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const DAY_ABBREV: Record<string, number> = {
  'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
};

function fmtDate(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const wd = WEEKDAYS_SHORT[d.getDay()];
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} (${wd})`;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(week: 'this' | 'next'): Date {
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

function getNextWeekday(dayName: string): Date | null {
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

// ---- Парсеры ----

interface DayTimeRange {
  startDay: number; // 1=пн ... 7=вс
  endDay: number;
  startHour: number;
  endHour: number; // может быть < startHour (ночной диапазон, например 12-03)
}

interface FlexibleScheduleCommand {
  week: 'this' | 'next';
  ranges: DayTimeRange[];
}

function parseFlexibleSchedule(text: string): FlexibleScheduleCommand | null {
  const lower = text.toLowerCase();

  let week: 'this' | 'next';
  if (/эт(?:ой|у|а)\s+недел/.test(lower)) {
    week = 'this';
  } else if (/следующ\S*\s+недел/.test(lower)) {
    week = 'next';
  } else {
    return null;
  }

  const rangeRegex = /с\s+(пн|вт|ср|чт|пт|сб|вс)\s+по\s+(пн|вт|ср|чт|пт|сб|вс)\s+с\s+(\d{1,2})(?::00)?\s+до\s+(\d{1,2})(?::00)?/g;

  const ranges: DayTimeRange[] = [];
  let match;
  while ((match = rangeRegex.exec(lower)) !== null) {
    const startDay = DAY_ABBREV[match[1]];
    const endDay = DAY_ABBREV[match[2]];
    const startHour = Number(match[3]);
    const endHour = Number(match[4]);

    if (startDay === undefined || endDay === undefined) continue;
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) continue;

    ranges.push({ startDay, endDay, startHour, endHour });
  }

  if (ranges.length === 0) return null;

  return { week, ranges };
}

function parseBookingCommand(text: string): { dayName: string; hour: number; minutes: number; duration: number } | null {
  const match = text.match(/(?:в|на)\s+([а-яё]+)\s+бронь\s+на\s+(\d+):(\d+)\s+на\s+(\d+)\s+час/i);
  if (!match) return null;

  const dayName = match[1];
  const hour = Number(match[2]);
  const minutes = Number(match[3]);
  const duration = Number(match[4]);

  if (hour < 0 || hour >= 24 || minutes !== 0 || duration < 1) {
    return null;
  }

  return { dayName, hour, minutes, duration };
}

// ---- Bot init ----

export function initBot(): void {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.warn('[bot] BOT_TOKEN not set, skipping bot init');
    return;
  }

  bot = new Telegraf(token);

  bot.start((ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ Этот бот только для администратора.');
    }

    const text =
      `Привет! Я бот управления расписанием.\n\n` +
      `Примеры команд:\n\n` +
      `📅 Расписание:\n` +
      `"на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"\n\n` +
      `🔴 Бронь:\n` +
      `"в пятницу бронь на 15:00 на 3 часа"\n\n` +
      `📋 Показать:\n` +
      `"покажи расписание"`;

    return ctx.reply(text, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Редактировать слоты', 'edit_slots')],
        [
          Markup.button.callback('🔴 Пример брони', 'example_booking'),
          Markup.button.callback('📋 Показать расписание', 'example_show'),
        ],
      ]),
    });
  });

  bot.action('edit_slots', (ctx) => {
    ctx.answerCbQuery();
    handleEditSlots(ctx);
  });

  bot.action('example_booking', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Отправьте: в пятницу бронь на 15:00 на 3 часа');
  });

  bot.action('example_show', (ctx) => {
    ctx.answerCbQuery();
    handleShowSchedule(ctx);
  });

  bot.on('text', (ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ У вас нет доступа.');
    }

    const text = ctx.message.text.trim();
    const textLower = text.toLowerCase();

    if (textLower.includes('покажи') && textLower.includes('расписание')) {
      return handleShowSchedule(ctx);
    }

    const flexCmd = parseFlexibleSchedule(textLower);
    if (flexCmd) {
      return handleFlexibleSchedule(ctx, flexCmd);
    }

    const bookingCmd = parseBookingCommand(textLower);
    if (bookingCmd) {
      return handleBookingCommand(ctx, bookingCmd);
    }

    ctx.reply(
      'Не понял команду. Используйте:\n' +
      '• "на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"\n' +
      '• "в пятницу бронь на 15:00 на 3 часа"\n' +
      '• "покажи расписание"'
    );
  });

  // ---- Обработчики ----

  function handleFlexibleSchedule(ctx: any, cmd: FlexibleScheduleCommand): void {
    const monday = getMondayOfWeek(cmd.week);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      clearDay(toDateKey(d));
    }

    const daysInfo = new Map<string, string>();

    for (const range of cmd.ranges) {
      let dayNum = range.startDay;
      while (true) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + (dayNum - 1));
        const dateKey = toDateKey(date);

        if (range.endHour > range.startHour) {
          addDaySlots(dateKey, range.startHour, range.endHour);
          daysInfo.set(dateKey, `${range.startHour}:00–${range.endHour}:00`);
        } else {
          addDaySlots(dateKey, range.startHour, 24);
          const nextDate = new Date(date);
          nextDate.setDate(date.getDate() + 1);
          addDaySlots(toDateKey(nextDate), 0, range.endHour);
          daysInfo.set(dateKey, `${range.startHour}:00–${String(range.endHour).padStart(2, '0')}:00`);
        }

        if (dayNum === range.endDay) break;
        dayNum = dayNum >= 7 ? 1 : dayNum + 1;
      }
    }

    const weekLabel = cmd.week === 'this' ? 'эту' : 'следующую';
    let text = `✅ Расписание создано на ${weekLabel} неделю!\n\n`;

    const sortedDays = [...daysInfo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [dateKey, timeRange] of sortedDays) {
      text += `${fmtDate(dateKey)} — ${timeRange}\n`;
    }

    ctx.reply(text, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Редактировать слоты', 'edit_slots')],
      ]),
    });
  }

  function handleEditSlots(ctx: any): void {
    const monday = getMondayOfWeek('this');

    let text = '📅 Слоты на текущую неделю:\n\n';
    let hasSlots = false;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateKey = toDateKey(d);
      const slots = getSlotsForDate(dateKey);

      if (slots.length > 0) {
        hasSlots = true;
        const hours = slots.map((s) => {
          const timePart = s.datetime.split('T')[1];
          return Number(timePart.split(':')[0]);
        }).sort((a, b) => a - b);

        const minHour = hours[0];
        const maxHour = hours[hours.length - 1] + 1;
        text += `${fmtDate(dateKey)} — ${minHour}:00–${maxHour}:00 (${slots.length} сл.)\n`;
      }
    }

    if (!hasSlots) {
      text += 'Слотов нет.\n';
    }

    text += '\nЧтобы задать расписание, отправьте, например:\n';
    text += '"на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"';

    ctx.reply(text);
  }

  function handleBookingCommand(
    ctx: any,
    cmd: { dayName: string; hour: number; minutes: number; duration: number }
  ): void {
    const targetDate = getNextWeekday(cmd.dayName);
    if (!targetDate) {
      return ctx.reply(`Не понял день недели: "${cmd.dayName}"`);
    }

    const dateKey = toDateKey(targetDate);

    const existingSlots = getSlotsForDate(dateKey);
    if (existingSlots.length === 0) {
      const DEFAULT_START = 10;
      const DEFAULT_END = 22;
      addDaySlots(dateKey, DEFAULT_START, DEFAULT_END);
    }

    const count = bookRange(dateKey, cmd.hour, cmd.duration, 'Бронь');

    if (count === 0) {
      return ctx.reply(`Не удалось забронировать. Указанное время вне диапазона слотов на ${fmtDate(dateKey)}.`);
    }

    let replyText =
      `✅ Бронь создана!\n\n` +
      `Дата: ${fmtDate(dateKey)}\n` +
      `Время: ${cmd.hour}:00 – ${cmd.hour + cmd.duration}:00`;

    const frontendUrl = getFrontendUrl();
    if (frontendUrl) {
      replyText += `\n\n🔗 ${frontendUrl}?date=${dateKey}`;
    }

    ctx.reply(replyText);
  }

  function handleShowSchedule(ctx: any): void {
    const stats = getStats();
    const days = getScheduledDays(7);

    let text = `📊 *Статистика:*\n\n`;
    text += `• Всего слотов: ${stats.total}\n`;
    text += `• 🟢 Свободно: ${stats.available}\n`;
    text += `• 🔴 Забронировано: ${stats.booked}\n`;
    text += `• ⛔ Заблокировано: ${stats.blocked}\n\n`;

    if (days.length === 0) {
      text += `Расписание пусто. Создайте расписание командой:\n"на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"`;
    } else {
      text += `📅 *Ближайшие дни:*\n\n`;
      for (const dateKey of days) {
        const slots = getSlotsForDate(dateKey);
        const avail = slots.filter((s) => s.status === 'available').length;
        const booked = slots.filter((s) => s.status === 'booked').length;
        text += `${fmtDate(dateKey)} — 🟢 ${avail} / 🔴 ${booked}\n`;
      }
    }

    ctx.reply(text, { parse_mode: 'Markdown' });
  }

  bot.launch()
    .then(() => console.log('[bot] Telegram bot started'))
    .catch((err: Error) => console.error('[bot] Failed to start:', err.message));

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

export function getBot(): Telegraf | null {
  return bot;
}
