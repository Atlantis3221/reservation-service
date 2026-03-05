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

// ID администратора (из .env)
function getAdminId(): number | null {
  const raw = process.env.ADMIN_CHAT_ID;
  return raw ? Number(raw) : null;
}

function isAdmin(chatId: number): boolean {
  const adminId = getAdminId();
  if (!adminId) return true;
  return chatId === adminId;
}

// ---- Форматирование ----

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

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

function getDayOfWeek(date: Date): number {
  return date.getDay();
}

function getNextWeekday(dayName: string): Date | null {
  const lower = dayName.toLowerCase();
  
  // Маппинг разных форм дней недели (падежи)
  const dayMap: Record<string, number> = {
    'понедельник': 1, 'понедельника': 1, 'понедельнику': 1, 'понедельником': 1,
    'вторник': 2, 'вторника': 2, 'вторнику': 2, 'вторником': 2,
    'среда': 3, 'среды': 3, 'среде': 3, 'средой': 3,
    'четверг': 4, 'четверга': 4, 'четвергу': 4, 'четвергом': 4,
    'пятница': 5, 'пятницы': 5, 'пятнице': 5, 'пятницей': 5, 'пятницу': 5,
    'суббота': 6, 'субботы': 6, 'субботе': 6, 'субботой': 6, 'субботу': 6,
    'воскресенье': 0, 'воскресенья': 0, 'воскресенью': 0, 'воскресеньем': 0,
  };

  const dayIndex = dayMap[lower];
  if (dayIndex === undefined) {
    // Fallback: поиск по началу слова
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

// ---- Парсер команд ----

function parseScheduleCommand(text: string): { week: 'this' | 'next'; startHour: number; endHour: number } | null {
  // "расписание на эту неделю с 10 до 22"
  const match = text.match(/расписание\s+на\s+(эту|следующую)\s+неделю(?:\s*,?\s*все\s+дни)?\s+с\s+(\d+)\s+до\s+(\d+)/i);
  if (!match) return null;

  const week = match[1] === 'эту' ? 'this' : 'next';
  const startHour = Number(match[2]);
  const endHour = Number(match[3]);

  if (startHour < 0 || startHour >= 24 || endHour <= startHour || endHour > 24) {
    return null;
  }

  return { week, startHour, endHour };
}

function parseBookingCommand(text: string): { dayName: string; hour: number; minutes: number; duration: number } | null {
  // "в пятницу бронь на 15:00 на 3 часа"
  // Используем [а-яё]+ для кириллицы вместо \w+
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

  // ====================
  //   /start
  // ====================
  bot.start((ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ Этот бот только для администратора.');
    }

    const text =
      `Привет! Я бот управления расписанием бани.\n\n` +
      `Примеры команд:\n\n` +
      `📅 Расписание:\n` +
      `"расписание на эту неделю с 10 до 22"\n` +
      `"расписание на следующую неделю с 10 до 22"\n\n` +
      `🔴 Бронь:\n` +
      `"в пятницу бронь на 15:00 на 3 часа"\n` +
      `"в понедельник бронь на 10:00 на 2 часа"\n\n` +
      `📋 Показать:\n` +
      `"покажи расписание"`;

    return ctx.reply(text, {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📅 Пример расписания', 'example_schedule'),
          Markup.button.callback('🔴 Пример брони', 'example_booking'),
        ],
        [Markup.button.callback('📋 Показать расписание', 'example_show')],
      ]),
    });
  });

  // Примеры через кнопки
  bot.action('example_schedule', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Отправьте: расписание на эту неделю с 10 до 22');
  });

  bot.action('example_booking', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('Отправьте: в пятницу бронь на 15:00 на 3 часа');
  });

  bot.action('example_show', (ctx) => {
    ctx.answerCbQuery();
    handleShowSchedule(ctx);
  });

  // ====================
  //   Обработка текстовых команд
  // ====================

  bot.on('text', (ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ У вас нет доступа.');
    }

    const text = ctx.message.text.trim();
    const textLower = text.toLowerCase();

    // Покажи расписание
    if (textLower.includes('покажи') && textLower.includes('расписание')) {
      return handleShowSchedule(ctx);
    }

    // Расписание на неделю (парсим с учетом регистра)
    const scheduleCmd = parseScheduleCommand(textLower);
    if (scheduleCmd) {
      return handleScheduleCommand(ctx, scheduleCmd);
    }

    // Бронь (парсим с учетом регистра)
    const bookingCmd = parseBookingCommand(textLower);
    if (bookingCmd) {
      return handleBookingCommand(ctx, bookingCmd);
    }

    // Не распознано
    ctx.reply(
      'Не понял команду. Используйте:\n' +
      '• "расписание на эту неделю с 10 до 22"\n' +
      '• "в пятницу бронь на 15:00 на 3 часа"\n' +
      '• "покажи расписание"'
    );
  });

  // ====================
  //   Обработчики команд
  // ====================

  function handleScheduleCommand(ctx: any, cmd: { week: 'this' | 'next'; startHour: number; endHour: number }): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (cmd.week === 'next') {
      today.setDate(today.getDate() + 7);
    }

    let totalAdded = 0;
    const daysAdded: string[] = [];

    // Понедельник = 1, Воскресенье = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      // Пропускаем воскресенье
      if (d.getDay() === 0) continue;

      const dateKey = toDateKey(d);
      addDaySlots(dateKey, cmd.startHour, cmd.endHour);
      totalAdded += cmd.endHour - cmd.startHour;
      daysAdded.push(fmtDate(dateKey));
    }

    const weekLabel = cmd.week === 'this' ? 'эту' : 'следующую';
    ctx.reply(
      `✅ Расписание создано!\n\n` +
      `Неделя: ${weekLabel}\n` +
      `Время: ${cmd.startHour}:00 - ${cmd.endHour}:00\n` +
      `Добавлено слотов: ${totalAdded}\n\n` +
      `Дни:\n${daysAdded.join('\n')}`
    );
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

    ctx.reply(
      `✅ Бронь создана!\n\n` +
      `Дата: ${fmtDate(dateKey)}\n` +
      `Время: ${cmd.hour}:00 - ${cmd.hour + cmd.duration}:00\n` +
      `Заблокировано слотов: ${count}`
    );
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
      text += `Расписание пусто. Создайте расписание командой:\n"расписание на эту неделю с 10 до 22"`;
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

  // ====================
  //   Запуск
  // ====================

  bot.launch()
    .then(() => console.log('[bot] Telegram bot started'))
    .catch((err: Error) => console.error('[bot] Failed to start:', err.message));

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

export function getBot(): Telegraf | null {
  return bot;
}
