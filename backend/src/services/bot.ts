import { Telegraf, Markup } from 'telegraf';
import {
  addDaySlots,
  clearDay,
  getScheduledDays,
  getSlotsForDate,
  getStats,
  bookRange,
} from './schedule';
import {
  getBusinessByOwner,
  createBusiness,
  generateSlug,
  isValidSlug,
  isSlugTaken,
  updateBusinessName,
  updateBusinessSlug,
  updateTelegramUsername,
} from './business';
import type { Business } from '../types';

let bot: Telegraf | null = null;

type ConversationStep =
  | 'awaiting_name'
  | 'awaiting_slug_confirm'
  | 'awaiting_settings_name'
  | 'awaiting_settings_slug';

interface ConversationState {
  step: ConversationStep;
  data: { name?: string; slug?: string };
}

const conversations = new Map<number, ConversationState>();

function getFrontendUrl(slug?: string): string {
  const base = process.env.FRONTEND_URL || '';
  if (!base) return '';
  if (!slug) return base;
  const clean = base.replace(/\/+$/, '');
  return `${clean}/${slug}`;
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

function resolveDay(dayName: string): Date | null {
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

// ---- Парсеры ----

interface DayTimeRange {
  startDay: number;
  endDay: number;
  startHour: number;
  endHour: number;
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

  const rangeRegex = /(?:с\s+)?(пн|вт|ср|чт|пт|сб|вс)\s*(?:[-–]\s*|\s+по\s+)(пн|вт|ср|чт|пт|сб|вс)\s+[сc]\s+(\d{1,2})(?::00)?\s+до\s+(\d{1,2})(?::00)?/g;

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

function parseBookingCommand(text: string): { dayName: string; hour: number; minutes: number; duration: number; clientName?: string } | null {
  const match = text.match(/(?:в|на)\s+([а-яё]+)\s+бронь\s+на\s+(\d+):(\d+)\s+на\s+(\d+)\s+час\S*\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const hour = Number(match[2]);
  const minutes = Number(match[3]);
  const duration = Number(match[4]);
  const rawName = match[5]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (hour < 0 || hour >= 24 || minutes !== 0 || duration < 1) {
    return null;
  }

  return { dayName, hour, minutes, duration, clientName };
}

function parseBookingRange(text: string): { dayName: string; startHour: number; endHour: number; clientName?: string } | null {
  const match = text.match(/(?:(?:в|на)\s+)?(\S+)\s+бронь\s+[сc]\s+(\d{1,2})(?::(\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?::(\d{2}))?\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const startHour = Number(match[2]);
  const startMin = Number(match[3] || '0');
  const endHour = Number(match[4]);
  const endMin = Number(match[5] || '0');
  const rawName = match[6]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (startMin !== 0 || endMin !== 0) return null;
  if (startHour < 0 || startHour >= 24 || endHour < 0 || endHour > 24) return null;
  if (startHour >= endHour) return null;

  return { dayName, startHour, endHour, clientName };
}

// ---- Telegram username sync ----

function syncUsername(ctx: any): void {
  const username = ctx.from?.username;
  if (username) {
    updateTelegramUsername(ctx.chat.id, username);
  }
}

// ---- Require business ----

function requireBusiness(ctx: any): Business | null {
  const biz = getBusinessByOwner(ctx.chat.id);
  if (!biz) {
    ctx.reply('Сначала зарегистрируйте баню. Отправьте /start');
    return null;
  }
  syncUsername(ctx);
  return biz;
}

// ---- Bot init ----

export function initBot(): void {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.warn('[bot] BOT_TOKEN not set, skipping bot init');
    return;
  }

  bot = new Telegraf(token);

  // ---- /start — онбординг или инфо ----

  bot.start((ctx) => {
    const existing = getBusinessByOwner(ctx.chat.id);

    if (existing) {
      syncUsername(ctx);
      handleInfo(ctx, existing);
      return;
    }

    conversations.set(ctx.chat.id, { step: 'awaiting_name', data: {} });
    ctx.reply(
      'Привет! Давайте зарегистрируем вашу баню.\n\n' +
      'Как называется ваша баня?'
    );
  });

  // ---- /info ----

  bot.command('info', (ctx) => {
    const biz = requireBusiness(ctx);
    if (!biz) return;
    handleInfo(ctx, biz);
  });

  // ---- /schedule ----

  bot.command('schedule', (ctx) => {
    const biz = requireBusiness(ctx);
    if (!biz) return;
    const arg = ctx.message.text.replace(/^\/schedule\s*/i, '').trim();
    handleDaySchedule(ctx, biz, arg || 'сегодня');
  });

  // ---- /settings ----

  bot.command('settings', (ctx) => {
    const biz = requireBusiness(ctx);
    if (!biz) return;
    handleSettings(ctx, biz);
  });

  // ---- Callback actions ----

  bot.action('edit_slots', (ctx) => {
    ctx.answerCbQuery();
    const biz = getBusinessByOwner(ctx.chat!.id);
    if (!biz) return;
    handleEditSlots(ctx, biz);
  });

  bot.action('example_show', (ctx) => {
    ctx.answerCbQuery();
    const biz = getBusinessByOwner(ctx.chat!.id);
    if (!biz) return;
    handleShowSchedule(ctx, biz);
  });

  bot.action('settings_name', (ctx) => {
    ctx.answerCbQuery();
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_name', data: {} });
    ctx.reply('Введите новое название бани:');
  });

  bot.action('settings_slug', (ctx) => {
    ctx.answerCbQuery();
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_slug', data: {} });
    ctx.reply('Введите новый slug (латиница, цифры, дефис, минимум 3 символа):');
  });

  // ---- Текстовые сообщения ----

  bot.on('text', (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();

    const conv = conversations.get(chatId);
    if (conv) {
      handleConversation(ctx, conv, text);
      return;
    }

    const biz = requireBusiness(ctx);
    if (!biz) return;

    const textLower = text.toLowerCase();

    const scheduleMatch = textLower.match(/расписание\s+на\s+(\S+)/);
    if (scheduleMatch) {
      return handleDaySchedule(ctx, biz, scheduleMatch[1]);
    }

    if (textLower.includes('покажи') && textLower.includes('расписание')) {
      return handleShowSchedule(ctx, biz);
    }

    const flexCmd = parseFlexibleSchedule(textLower);
    if (flexCmd) {
      return handleFlexibleSchedule(ctx, biz, flexCmd);
    }

    const bookingRangeCmd = parseBookingRange(textLower);
    if (bookingRangeCmd) {
      return handleBookingRangeCommand(ctx, biz, bookingRangeCmd);
    }

    const bookingCmd = parseBookingCommand(textLower);
    if (bookingCmd) {
      return handleBookingCommand(ctx, biz, bookingCmd);
    }

    ctx.reply('Не понял команду. Отправьте /info для списка возможностей.');
  });

  // ---- Conversation handlers ----

  function handleConversation(ctx: any, conv: ConversationState, text: string): void {
    const chatId = ctx.chat.id;

    switch (conv.step) {
      case 'awaiting_name': {
        const name = text;
        const slug = generateSlug(name);
        conversations.set(chatId, {
          step: 'awaiting_slug_confirm',
          data: { name, slug },
        });
        ctx.reply(
          `Отлично! Ваша баня: <b>${name}</b>\n` +
          `Ссылка для клиентов: <b>${slug}</b>\n\n` +
          `Отправьте «да» чтобы подтвердить, или введите свой slug:`,
          { parse_mode: 'HTML' }
        );
        break;
      }

      case 'awaiting_slug_confirm': {
        const lower = text.toLowerCase();
        if (lower === 'да' || lower === 'ok' || lower === 'ок') {
          const biz = createBusiness(
            conv.data.slug!,
            conv.data.name!,
            String(chatId),
            ctx.from?.username
          );
          conversations.delete(chatId);
          const url = getFrontendUrl(biz.slug);
          let reply = `✅ Баня «${biz.name}» зарегистрирована!\n\nSlug: ${biz.slug}`;
          if (url) reply += `\n🔗 ${url}`;
          reply += '\n\nТеперь вы можете управлять расписанием. Отправьте /info для списка возможностей.';
          ctx.reply(reply);
        } else {
          const customSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
          if (!isValidSlug(customSlug)) {
            ctx.reply('Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:');
            return;
          }
          if (isSlugTaken(customSlug)) {
            ctx.reply(`Slug «${customSlug}» уже занят. Попробуйте другой:`);
            return;
          }
          const biz = createBusiness(
            customSlug,
            conv.data.name!,
            String(chatId),
            ctx.from?.username
          );
          conversations.delete(chatId);
          const url = getFrontendUrl(biz.slug);
          let reply = `✅ Баня «${biz.name}» зарегистрирована!\n\nSlug: ${biz.slug}`;
          if (url) reply += `\n🔗 ${url}`;
          reply += '\n\nТеперь вы можете управлять расписанием. Отправьте /info для списка возможностей.';
          ctx.reply(reply);
        }
        break;
      }

      case 'awaiting_settings_name': {
        const biz = getBusinessByOwner(chatId);
        if (!biz) {
          conversations.delete(chatId);
          return;
        }
        updateBusinessName(biz.id, text);
        conversations.delete(chatId);
        ctx.reply(`✅ Название изменено на «${text}»`);
        break;
      }

      case 'awaiting_settings_slug': {
        const biz = getBusinessByOwner(chatId);
        if (!biz) {
          conversations.delete(chatId);
          return;
        }
        const newSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!isValidSlug(newSlug)) {
          ctx.reply('Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:');
          return;
        }
        if (isSlugTaken(newSlug) && newSlug !== biz.slug) {
          ctx.reply(`Slug «${newSlug}» уже занят. Попробуйте другой:`);
          return;
        }
        updateBusinessSlug(biz.id, newSlug);
        conversations.delete(chatId);
        const url = getFrontendUrl(newSlug);
        let reply = `✅ Slug изменён на «${newSlug}»`;
        if (url) reply += `\n🔗 Новая ссылка: ${url}`;
        ctx.reply(reply);
        break;
      }
    }
  }

  // ---- Обработчики ----

  function handleInfo(ctx: any, biz: Business): void {
    const frontendUrl = getFrontendUrl(biz.slug);
    let text =
      `🏢 <b>${biz.name}</b>\n\n` +
      `📌 <b>Возможности:</b>\n\n` +
      `<b>Время работы</b>\n` +
      `Например: на этой неделе ПН-ПТ c 10 до 23, ПТ-СБ c 12 до 03\n\n` +
      `<b>Расписание</b>\n` +
      `Например:\n` +
      `- в пятницу бронь на 15:00 на 3 часа\n` +
      `- в пятницу бронь на 15:00 на 3 часа Иванов\n` +
      `- сегодня бронь с 14:00 до 18:00\n` +
      `- сегодня бронь с 14:00 до 18:00 Петров\n` +
      `- расписание на сегодня\n` +
      `- расписание на пятницу\n\n` +
      `<b>Настройки</b>\n` +
      `/settings — изменить название или slug`;

    if (frontendUrl) {
      text += `\n\n🔗 Расписание для гостей: ${frontendUrl}`;
    }

    ctx.reply(text, { parse_mode: 'HTML' });
  }

  function handleSettings(ctx: any, biz: Business): void {
    const url = getFrontendUrl(biz.slug);
    let text =
      `⚙️ <b>Настройки</b>\n\n` +
      `Название: <b>${biz.name}</b>\n` +
      `Slug: <b>${biz.slug}</b>`;

    if (url) text += `\n🔗 ${url}`;

    ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Изменить название', 'settings_name')],
        [Markup.button.callback('🔗 Изменить slug', 'settings_slug')],
      ]),
    });
  }

  function handleFlexibleSchedule(ctx: any, biz: Business, cmd: FlexibleScheduleCommand): void {
    const monday = getMondayOfWeek(cmd.week);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      clearDay(biz.id, toDateKey(d));
    }

    const daysInfo = new Map<string, string>();

    for (const range of cmd.ranges) {
      let dayNum = range.startDay;
      while (true) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + (dayNum - 1));
        const dateKey = toDateKey(date);

        if (range.endHour > range.startHour) {
          addDaySlots(biz.id, dateKey, range.startHour, range.endHour);
          daysInfo.set(dateKey, `${range.startHour}:00–${range.endHour}:00`);
        } else {
          addDaySlots(biz.id, dateKey, range.startHour, 24);
          const nextDate = new Date(date);
          nextDate.setDate(date.getDate() + 1);
          addDaySlots(biz.id, toDateKey(nextDate), 0, range.endHour);
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

  function handleEditSlots(ctx: any, biz: Business): void {
    const monday = getMondayOfWeek('this');

    let text = '📅 Слоты на текущую неделю:\n\n';
    let hasSlots = false;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateKey = toDateKey(d);
      const slots = getSlotsForDate(biz.id, dateKey);

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
    biz: Business,
    cmd: { dayName: string; hour: number; minutes: number; duration: number; clientName?: string }
  ): void {
    const targetDate = getNextWeekday(cmd.dayName);
    if (!targetDate) {
      return ctx.reply(`Не понял день недели: "${cmd.dayName}"`);
    }

    const dateKey = toDateKey(targetDate);

    const existingSlots = getSlotsForDate(biz.id, dateKey);
    if (existingSlots.length === 0) {
      addDaySlots(biz.id, dateKey, 10, 22);
    }

    const count = bookRange(biz.id, dateKey, cmd.hour, cmd.duration, 'Бронь', cmd.clientName);

    if (count === 0) {
      return ctx.reply(`Не удалось забронировать. Указанное время вне диапазона слотов на ${fmtDate(dateKey)}.`);
    }

    let replyText =
      `✅ Бронь создана!\n\n` +
      `Дата: ${fmtDate(dateKey)}\n` +
      `Время: ${cmd.hour}:00 – ${cmd.hour + cmd.duration}:00`;

    if (cmd.clientName) {
      replyText += `\nКлиент: ${cmd.clientName}`;
    }

    const frontendUrl = getFrontendUrl(biz.slug);
    if (frontendUrl) {
      replyText += `\n\n🔗 ${frontendUrl}?date=${dateKey}`;
    }

    ctx.reply(replyText);
  }

  function handleDaySchedule(ctx: any, biz: Business, dayName: string): void {
    const targetDate = resolveDay(dayName);
    if (!targetDate) {
      return ctx.reply(`Не понял день: "${dayName}". Отправьте /info для списка возможностей.`);
    }

    const dateKey = toDateKey(targetDate);
    const slots = getSlotsForDate(biz.id, dateKey);

    if (slots.length === 0) {
      return ctx.reply(`На ${fmtDate(dateKey)} расписание не задано.`);
    }

    let text = `📅 Расписание на ${fmtDate(dateKey)}:\n\n`;

    for (const slot of slots) {
      const hour = slot.datetime.split('T')[1].split(':')[0];
      const emoji = slot.status === 'available' ? '🟢' : slot.status === 'booked' ? '🔴' : '⛔';
      const note = slot.note ? ` — ${slot.note}` : '';
      const client = slot.clientName ? ` (${slot.clientName})` : '';
      text += `${emoji} ${hour}:00${note}${client}\n`;
    }

    const frontendUrl = getFrontendUrl(biz.slug);
    if (frontendUrl) {
      text += `\n🔗 ${frontendUrl}?date=${dateKey}`;
    }

    ctx.reply(text);
  }

  function handleBookingRangeCommand(
    ctx: any,
    biz: Business,
    cmd: { dayName: string; startHour: number; endHour: number; clientName?: string }
  ): void {
    const targetDate = resolveDay(cmd.dayName);
    if (!targetDate) {
      return ctx.reply(`Не понял день: "${cmd.dayName}"`);
    }

    const dateKey = toDateKey(targetDate);
    const duration = cmd.endHour - cmd.startHour;

    const existingSlots = getSlotsForDate(biz.id, dateKey);
    if (existingSlots.length === 0) {
      addDaySlots(biz.id, dateKey, 10, 22);
    }

    const count = bookRange(biz.id, dateKey, cmd.startHour, duration, 'Бронь', cmd.clientName);

    if (count === 0) {
      return ctx.reply(`Не удалось забронировать. Указанное время вне диапазона слотов на ${fmtDate(dateKey)}.`);
    }

    let replyText =
      `✅ Бронь создана!\n\n` +
      `Дата: ${fmtDate(dateKey)}\n` +
      `Время: ${cmd.startHour}:00 – ${cmd.endHour}:00`;

    if (cmd.clientName) {
      replyText += `\nКлиент: ${cmd.clientName}`;
    }

    const frontendUrl = getFrontendUrl(biz.slug);
    if (frontendUrl) {
      replyText += `\n\n🔗 ${frontendUrl}?date=${dateKey}`;
    }

    ctx.reply(replyText);
  }

  function handleShowSchedule(ctx: any, biz: Business): void {
    const stats = getStats(biz.id);
    const days = getScheduledDays(biz.id, 7);

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
        const slots = getSlotsForDate(biz.id, dateKey);
        const avail = slots.filter((s) => s.status === 'available').length;
        const booked = slots.filter((s) => s.status === 'booked').length;
        text += `${fmtDate(dateKey)} — 🟢 ${avail} / 🔴 ${booked}\n`;
      }
    }

    ctx.reply(text, { parse_mode: 'Markdown' });
  }

  bot.telegram.setMyCommands([
    { command: 'start', description: 'Регистрация / главное меню' },
    { command: 'info', description: 'Возможности бота' },
    { command: 'schedule', description: 'Показать расписание' },
    { command: 'settings', description: 'Настройки бани' },
  ]);

  bot.launch()
    .then(() => console.log('[bot] Telegram bot started'))
    .catch((err: Error) => console.error('[bot] Failed to start:', err.message));

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

export function getBot(): Telegraf | null {
  return bot;
}
