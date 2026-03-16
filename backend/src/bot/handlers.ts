import { Telegraf, Markup } from 'telegraf';
import { parseFlexibleSchedule, parseBookingCommand, parseBookingRange, parseCancelCommand } from './parsers';
import type { FlexibleScheduleCommand } from './parsers';
import { formatDayScheduleText, formatStatsText, formatScheduleCreated, formatBookingConfirmation } from './formatters';
import {
  addDaySlots,
  cancelBooking,
  cancelBookingById,
  clearDay,
  findOverlappingBookings,
  getScheduledDays,
  getSlotsForDate,
  getStats,
  bookRange,
} from '../services/schedule';
import {
  getBusinessesByOwner,
  getBusinessByOwner,
  getBusinessById,
  getBusinessByOwnerAndSlug,
  createBusiness,
  deleteBusiness,
  generateSlug,
  isValidSlug,
  isSlugTaken,
  updateBusinessName,
  updateBusinessSlug,
  updateTelegramUsername,
  hasAgreement,
  saveAgreement,
  ownerHasPhone,
  updateOwnerPhone,
} from '../services/business';
import { toDateKey, fmtDate, getMondayOfWeek, getNextWeekday, resolveDay } from '../utils/date';
import { trackUnrecognizedCommand } from '../services/monitor';
import type { Business } from '../types';

type ConversationStep =
  | 'awaiting_name'
  | 'awaiting_slug_confirm'
  | 'awaiting_settings_name'
  | 'awaiting_settings_slug'
  | 'awaiting_contact';

interface ConversationState {
  step: ConversationStep;
  data: { name?: string; slug?: string; businessId?: number };
}

interface PendingCommand {
  text: string;
  messageId: number;
}

interface PendingBooking {
  businessId: number;
  businessSlug: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  note?: string;
  clientName?: string;
}

const conversations = new Map<number, ConversationState>();
const pendingCommands = new Map<number, PendingCommand>();
const pendingBookings = new Map<number, PendingBooking>();

function getFrontendUrl(slug?: string): string {
  const base = process.env.FRONTEND_URL || '';
  if (!base) return '';
  if (!slug) return base;
  const clean = base.replace(/\/+$/, '');
  return `${clean}/${slug}`;
}

function syncUsername(ctx: any): void {
  const username = ctx.from?.username;
  if (username) {
    updateTelegramUsername(ctx.chat.id, username);
  }
}

function requireBusiness(ctx: any): Business | null {
  const businesses = getBusinessesByOwner(ctx.chat.id);
  if (businesses.length === 0) {
    ctx.reply('Сначала зарегистрируйте заведение. Отправьте /start');
    return null;
  }
  syncUsername(ctx);
  if (businesses.length === 1) {
    return businesses[0];
  }
  return null;
}

function requireBusinessOrAsk(ctx: any, text: string): Business | null {
  const businesses = getBusinessesByOwner(ctx.chat.id);
  if (businesses.length === 0) {
    ctx.reply('Сначала зарегистрируйте заведение. Отправьте /start');
    return null;
  }
  syncUsername(ctx);
  if (businesses.length === 1) {
    return businesses[0];
  }

  pendingCommands.set(ctx.chat.id, { text, messageId: ctx.message?.message_id });

  const buttons = businesses.map((b) =>
    [Markup.button.callback(b.name, `pick_biz:${b.id}`)]
  );

  ctx.reply('Для какого заведения?', Markup.inlineKeyboard(buttons));
  return null;
}

// ---- Handler functions ----

function handleInfo(ctx: any, businesses: Business[]): void {
  let header = '';
  if (businesses.length === 1) {
    header = `🏢 <b>${businesses[0].name}</b>\n\n`;
  } else {
    header = `🏢 <b>Ваши заведения:</b>\n`;
    for (const b of businesses) {
      header += `• ${b.name} (<code>${b.slug}</code>)\n`;
    }
    header += '\n';
  }

  let text = header +
    `📌 <b>Все команды:</b>\n\n` +
    `<b>Бронирование</b>\n` +
    `- сегодня бронь с 14 до 18\n` +
    `- сегодня бронь с 14:30 до 18:00 Петров\n` +
    `- в пятницу бронь на 15:00 на 3 часа\n` +
    `- в пятницу бронь на 15:30 на 2 часа Иванов\n\n` +
    `<b>Отмена брони</b>\n` +
    `- отмени бронь на сегодня 14\n` +
    `- отмени бронь на завтра 16\n\n` +
    `<b>Расписание</b>\n` +
    `- расписание на сегодня\n` +
    `- расписание на пятницу\n` +
    `- покажи расписание\n\n` +
    `<b>Время работы</b>\n` +
    `- на этой неделе ПН-ПТ c 10 до 23, ПТ-СБ c 12 до 03\n\n` +
    `<b>Управление</b>\n` +
    `/settings — настройки заведения\n` +
    `/list — список заведений\n` +
    `/add — добавить заведение\n` +
    `/del — удалить заведение`;

  const urls = businesses
    .map((b) => getFrontendUrl(b.slug))
    .filter(Boolean);
  if (urls.length === 1) {
    text += `\n\n🔗 Расписание для гостей: ${urls[0]}`;
  } else if (urls.length > 1) {
    text += '\n\n🔗 <b>Ссылки для гостей:</b>';
    for (let i = 0; i < businesses.length; i++) {
      const url = getFrontendUrl(businesses[i].slug);
      if (url) text += `\n• ${businesses[i].name}: ${url}`;
    }
  }

  ctx.reply(text, { parse_mode: 'HTML' });
}

function handleSettings(ctx: any, biz: Business): void {
  const url = getFrontendUrl(biz.slug);
  let text =
    `⚙️ <b>Настройки — ${biz.name}</b>\n\n` +
    `Название: <b>${biz.name}</b>\n` +
    `Slug: <b>${biz.slug}</b>`;

  if (url) text += `\n🔗 ${url}`;

  ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Изменить название', `settings_name:${biz.id}`)],
      [Markup.button.callback('🔗 Изменить slug', `settings_slug:${biz.id}`)],
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
  const text = formatScheduleCreated(weekLabel, daysInfo);

  ctx.reply(text, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Редактировать слоты', `edit_slots:${biz.id}`)],
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
      const availableSlots = slots.filter((s) => s.status === 'available');
      if (availableSlots.length > 0) {
        const startTime = availableSlots[0].startDatetime.split('T')[1].substring(0, 5);
        const endTime = availableSlots[availableSlots.length - 1].endDatetime.split('T')[1].substring(0, 5);
        text += `${fmtDate(dateKey)} — ${startTime}–${endTime} (${slots.length} сл.)\n`;
      } else {
        text += `${fmtDate(dateKey)} — ${slots.length} сл.\n`;
      }
    }
  }

  if (!hasSlots) {
    text += 'Слотов нет.\n';
  }

  text += '\nЧтобы задать расписание, отправьте, например:\n';
  text += '"на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"';

  ctx.reply(text);
}

function handleCancelCommand(
  ctx: any,
  biz: Business,
  cmd: { dayName: string; startTime: string }
): void {
  const targetDate = resolveDay(cmd.dayName);
  if (!targetDate) {
    return ctx.reply(`Не понял день: "${cmd.dayName}"`);
  }

  const dateKey = toDateKey(targetDate);
  const result = cancelBooking(biz.id, dateKey, cmd.startTime);

  if (result.cancelled === 0) {
    return ctx.reply(`На ${fmtDate(dateKey)} ${cmd.startTime} нет брони.`);
  }

  let text = `❌ Бронь отменена: ${fmtDate(dateKey)} ${cmd.startTime}`;
  if (result.clientName) text += ` (${result.clientName})`;

  ctx.reply(text);
}

function createBooking(ctx: any, pending: PendingBooking): void {
  const result = bookRange(
    pending.businessId, pending.dateKey,
    pending.startTime, pending.endTime,
    pending.note, pending.clientName,
  );
  const frontendUrl = getFrontendUrl(pending.businessSlug);
  const replyText = formatBookingConfirmation(
    pending.dateKey, pending.startTime, pending.endTime,
    pending.clientName, frontendUrl,
  );

  ctx.reply(replyText, {
    ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отменить бронь', `cancel_book:${result.id}`)],
    ]),
  });
}

function formatOverlapWarning(
  overlaps: Array<{ startTime: string; endTime: string; clientName?: string }>,
): string {
  const lines = overlaps.map((o) => {
    let line = `  • ${o.startTime}–${o.endTime}`;
    if (o.clientName) line += ` (${o.clientName})`;
    return line;
  });
  return `⚠️ На это время уже есть бронь:\n${lines.join('\n')}\n\nСоздать ещё одну?`;
}

function handleBookingCommand(
  ctx: any,
  biz: Business,
  cmd: { dayName: string; startTime: string; endTime: string; clientName?: string }
): void {
  const targetDate = resolveDay(cmd.dayName) || getNextWeekday(cmd.dayName);
  if (!targetDate) {
    return ctx.reply(`Не понял день: "${cmd.dayName}"`);
  }

  const dateKey = toDateKey(targetDate);

  const existingSlots = getSlotsForDate(biz.id, dateKey);
  if (existingSlots.length === 0) {
    addDaySlots(biz.id, dateKey, 10, 22);
  }

  const pending: PendingBooking = {
    businessId: biz.id,
    businessSlug: biz.slug,
    dateKey,
    startTime: cmd.startTime,
    endTime: cmd.endTime,
    note: 'Бронь',
    clientName: cmd.clientName,
  };

  const overlaps = findOverlappingBookings(biz.id, dateKey, cmd.startTime, cmd.endTime);
  if (overlaps.length > 0) {
    pendingBookings.set(ctx.chat.id, pending);
    ctx.reply(formatOverlapWarning(overlaps), {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, создать', 'confirm_book'),
          Markup.button.callback('❌ Нет', 'deny_book'),
        ],
      ]),
    });
    return;
  }

  createBooking(ctx, pending);
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

  const frontendUrl = getFrontendUrl(biz.slug);
  const text = formatDayScheduleText(dateKey, slots, frontendUrl);

  ctx.reply(text);
}

function handleBookingRangeCommand(
  ctx: any,
  biz: Business,
  cmd: { dayName: string; startTime: string; endTime: string; clientName?: string }
): void {
  const targetDate = resolveDay(cmd.dayName);
  if (!targetDate) {
    return ctx.reply(`Не понял день: "${cmd.dayName}"`);
  }

  const dateKey = toDateKey(targetDate);

  const existingSlots = getSlotsForDate(biz.id, dateKey);
  if (existingSlots.length === 0) {
    addDaySlots(biz.id, dateKey, 10, 22);
  }

  const pending: PendingBooking = {
    businessId: biz.id,
    businessSlug: biz.slug,
    dateKey,
    startTime: cmd.startTime,
    endTime: cmd.endTime,
    note: 'Бронь',
    clientName: cmd.clientName,
  };

  const overlaps = findOverlappingBookings(biz.id, dateKey, cmd.startTime, cmd.endTime);
  if (overlaps.length > 0) {
    pendingBookings.set(ctx.chat.id, pending);
    ctx.reply(formatOverlapWarning(overlaps), {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Да, создать', 'confirm_book'),
          Markup.button.callback('❌ Нет', 'deny_book'),
        ],
      ]),
    });
    return;
  }

  createBooking(ctx, pending);
}

function handleShowSchedule(ctx: any, biz: Business): void {
  const stats = getStats(biz.id);
  const days = getScheduledDays(biz.id, 7);

  const daySlots = days.map((dateKey) => {
    const slots = getSlotsForDate(biz.id, dateKey);
    return {
      dateKey,
      available: slots.filter((s) => s.status === 'available').length,
      booked: slots.filter((s) => s.status === 'booked').length,
    };
  });

  const text = formatStatsText(stats, daySlots);
  ctx.reply(text, { parse_mode: 'Markdown' });
}

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
        `Отлично! Название: <b>${name}</b>\n` +
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
        let reply = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
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
        let reply = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
        if (url) reply += `\n🔗 ${url}`;
        reply += '\n\nТеперь вы можете управлять расписанием. Отправьте /info для списка возможностей.';
        ctx.reply(reply);
      }
      break;
    }

    case 'awaiting_settings_name': {
      const biz = conv.data.businessId
        ? getBusinessById(conv.data.businessId)
        : getBusinessByOwner(chatId);
      if (!biz) {
        conversations.delete(chatId);
        return;
      }
      updateBusinessName(biz.id, text);
      conversations.delete(chatId);
      ctx.reply(`✅ Название изменено на «${text}»`);
      break;
    }

    case 'awaiting_contact': {
      ctx.reply(
        '📱 Пожалуйста, нажмите кнопку «Поделиться контактом» ниже для передачи номера.',
        {
          reply_markup: {
            keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      break;
    }

    case 'awaiting_settings_slug': {
      const biz = conv.data.businessId
        ? getBusinessById(conv.data.businessId)
        : getBusinessByOwner(chatId);
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

function executeCommand(ctx: any, biz: Business, text: string): void {
  const textLower = text.toLowerCase();

  if (textLower === '/info') {
    const allBiz = getBusinessesByOwner(biz.ownerChatId);
    return handleInfo(ctx, allBiz.length > 0 ? allBiz : [biz]);
  }

  if (textLower === '/settings') {
    return handleSettings(ctx, biz);
  }

  if (textLower.startsWith('/schedule')) {
    const arg = textLower.replace(/^\/schedule\s*/i, '').trim();
    return handleDaySchedule(ctx, biz, arg || 'сегодня');
  }

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

  const cancelCmd = parseCancelCommand(textLower);
  if (cancelCmd) {
    return handleCancelCommand(ctx, biz, cancelCmd);
  }

  const bookingRangeCmd = parseBookingRange(textLower);
  if (bookingRangeCmd) {
    return handleBookingRangeCommand(ctx, biz, bookingRangeCmd);
  }

  const bookingCmd = parseBookingCommand(textLower);
  if (bookingCmd) {
    return handleBookingCommand(ctx, biz, bookingCmd);
  }

  trackUnrecognizedCommand();
  ctx.reply('Не понял команду. Отправьте /info для списка возможностей.');
}

// ---- Register all handlers on the bot instance ----

export function registerHandlers(bot: Telegraf): void {

  function showAgreement(ctx: any): void {
    const text =
      `📜 <b>Пользовательское соглашение</b>\n\n` +
      `Используя данный сервис, вы соглашаетесь со следующими условиями:\n\n` +
      `1. Вы предоставляете достоверные данные о себе и своём заведении.\n` +
      `2. Вы даёте согласие на обработку персональных данных (имя, контактный телефон, Telegram ID) в целях функционирования сервиса.\n` +
      `3. Сервис предоставляется «как есть» без каких-либо гарантий.\n` +
      `4. Администрация сервиса может связаться с вами по предоставленному контакту для решения вопросов, связанных с использованием сервиса.\n` +
      `5. Вы можете прекратить использование сервиса в любой момент, удалив своё заведение.\n\n` +
      `Нажмите «Принимаю» для продолжения или «Отклоняю» для отказа.`;

    ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принимаю', 'agree_accept')],
        [Markup.button.callback('❌ Отклоняю', 'agree_decline')],
      ]),
    });
  }

  function requestContact(ctx: any): void {
    ctx.reply(
      '📱 Пожалуйста, поделитесь вашим контактом, чтобы мы могли связаться с вами при необходимости.',
      {
        reply_markup: {
          keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }
    );
    conversations.set(ctx.chat.id, { step: 'awaiting_contact', data: {} });
  }

  // ---- /start ----

  bot.start((ctx) => {
    const chatId = ctx.chat.id;
    const businesses = getBusinessesByOwner(chatId);

    if (businesses.length > 0) {
      syncUsername(ctx);
      handleInfo(ctx, businesses);

      if (!ownerHasPhone(chatId)) {
        requestContact(ctx);
      }
      return;
    }

    if (!hasAgreement(chatId)) {
      showAgreement(ctx);
      return;
    }

    if (!ownerHasPhone(chatId)) {
      requestContact(ctx);
      return;
    }

    conversations.set(chatId, { step: 'awaiting_name', data: {} });
    ctx.reply(
      'Привет! Давайте зарегистрируем ваше заведение.\n\n' +
      'Как оно называется?'
    );
  });

  // ---- /info ----

  bot.command('info', (ctx) => {
    const businesses = getBusinessesByOwner(ctx.chat.id);
    if (businesses.length === 0) {
      ctx.reply('Сначала зарегистрируйте заведение. Отправьте /start');
      return;
    }
    syncUsername(ctx);
    handleInfo(ctx, businesses);
  });

  // ---- /schedule ----

  bot.command('schedule', (ctx) => {
    const text = ctx.message.text.trim();
    const biz = requireBusinessOrAsk(ctx, text);
    if (!biz) return;
    const arg = text.replace(/^\/schedule\s*/i, '').trim();
    handleDaySchedule(ctx, biz, arg || 'сегодня');
  });

  // ---- /settings ----

  bot.command('settings', (ctx) => {
    const biz = requireBusinessOrAsk(ctx, '/settings');
    if (!biz) return;
    handleSettings(ctx, biz);
  });

  // ---- /add ----

  bot.command('add', (ctx) => {
    const businesses = getBusinessesByOwner(ctx.chat.id);
    if (businesses.length === 0) {
      ctx.reply('Сначала зарегистрируйте первое заведение. Отправьте /start');
      return;
    }
    syncUsername(ctx);
    conversations.set(ctx.chat.id, { step: 'awaiting_name', data: {} });
    ctx.reply('Как называется новое заведение?');
  });

  // ---- /del ----

  bot.command('del', (ctx) => {
    const businesses = getBusinessesByOwner(ctx.chat.id);
    if (businesses.length === 0) {
      ctx.reply('У вас нет зарегистрированных заведений.');
      return;
    }
    syncUsername(ctx);

    const slug = ctx.message.text.replace(/^\/del\s*/i, '').trim();
    if (!slug) {
      ctx.reply('Укажите slug заведения: /del <slug>\n\nВаши заведения:\n' +
        businesses.map((b) => `• ${b.name} — <code>${b.slug}</code>`).join('\n'),
        { parse_mode: 'HTML' }
      );
      return;
    }

    const biz = getBusinessByOwnerAndSlug(ctx.chat.id, slug);
    if (!biz) {
      ctx.reply('Заведение не найдено. Проверьте slug командой /list');
      return;
    }

    if (businesses.length === 1) {
      ctx.reply('Нельзя удалить единственное заведение.');
      return;
    }

    deleteBusiness(biz.id);
    ctx.reply(`✅ «${biz.name}» (${biz.slug}) удалено вместе со всеми слотами.`);
  });

  // ---- /list ----

  bot.command('list', (ctx) => {
    const businesses = getBusinessesByOwner(ctx.chat.id);
    if (businesses.length === 0) {
      ctx.reply('У вас нет зарегистрированных заведений. Отправьте /start');
      return;
    }
    syncUsername(ctx);

    let text = `🏢 <b>Ваши заведения (${businesses.length}):</b>\n\n`;
    for (const b of businesses) {
      const url = getFrontendUrl(b.slug);
      text += `• <b>${b.name}</b> — <code>${b.slug}</code>`;
      if (url) text += `\n  🔗 ${url}`;
      text += '\n';
    }

    ctx.reply(text, { parse_mode: 'HTML' });
  });

  // ---- /phone ----

  bot.command('phone', (ctx) => {
    const businesses = getBusinessesByOwner(ctx.chat.id);
    if (businesses.length === 0) {
      ctx.reply('Сначала зарегистрируйте заведение. Отправьте /start');
      return;
    }
    requestContact(ctx);
  });

  // ---- Callback actions ----

  bot.action('agree_accept', (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    saveAgreement(chatId);
    ctx.editMessageText('✅ Спасибо! Соглашение принято.');
    requestContact(ctx);
  });

  bot.action('agree_decline', (ctx) => {
    ctx.answerCbQuery();
    ctx.editMessageText(
      '❌ Без принятия пользовательского соглашения использование сервиса невозможно.\n\n' +
      'Если передумаете — отправьте /start'
    );
  });

  bot.action(/^pick_biz:(\d+)$/, (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const bizId = Number(ctx.match[1]);

    const biz = getBusinessById(bizId);
    if (!biz || biz.ownerChatId !== String(chatId)) {
      ctx.reply('Заведение не найдено.');
      return;
    }

    const pending = pendingCommands.get(chatId);
    pendingCommands.delete(chatId);

    if (!pending) {
      ctx.reply(`Выбрано «${biz.name}». Отправьте команду.`);
      return;
    }

    ctx.deleteMessage().catch(() => {});
    executeCommand(ctx, biz, pending.text);
  });

  bot.action(/^edit_slots:(\d+)$/, (ctx) => {
    ctx.answerCbQuery();
    const bizId = Number(ctx.match[1]);
    const biz = getBusinessById(bizId);
    if (!biz) return;
    handleEditSlots(ctx, biz);
  });

  bot.action('edit_slots', (ctx) => {
    ctx.answerCbQuery();
    const biz = requireBusiness(ctx);
    if (!biz) return;
    handleEditSlots(ctx, biz);
  });

  bot.action(/^cancel_book:(\d+)$/, (ctx) => {
    ctx.answerCbQuery();
    const slotId = Number(ctx.match[1]);

    const result = cancelBookingById(slotId);
    if (result.cancelled === 0) {
      ctx.reply('Бронь не найдена или уже отменена.');
      return;
    }

    let text = `❌ Бронь отменена`;
    if (result.dateKey) text += `: ${fmtDate(result.dateKey)} ${result.startTime}–${result.endTime}`;
    if (result.clientName) text += ` (${result.clientName})`;

    ctx.editMessageText(text);
  });

  bot.action('confirm_book', (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat!.id;
    const pending = pendingBookings.get(chatId);
    pendingBookings.delete(chatId);

    if (!pending) {
      ctx.editMessageText('Бронирование не найдено. Попробуйте заново.');
      return;
    }

    ctx.deleteMessage().catch(() => {});
    createBooking(ctx, pending);
  });

  bot.action('deny_book', (ctx) => {
    ctx.answerCbQuery();
    pendingBookings.delete(ctx.chat!.id);
    ctx.editMessageText('Бронирование отменено.');
  });

  bot.action('example_show', (ctx) => {
    ctx.answerCbQuery();
    const biz = requireBusiness(ctx);
    if (!biz) return;
    handleShowSchedule(ctx, biz);
  });

  bot.action(/^settings_name:(\d+)$/, (ctx) => {
    ctx.answerCbQuery();
    const bizId = Number(ctx.match[1]);
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_name', data: { businessId: bizId } });
    ctx.reply('Введите новое название:');
  });

  bot.action('settings_name', (ctx) => {
    ctx.answerCbQuery();
    const biz = requireBusiness(ctx);
    if (!biz) return;
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_name', data: { businessId: biz.id } });
    ctx.reply('Введите новое название:');
  });

  bot.action(/^settings_slug:(\d+)$/, (ctx) => {
    ctx.answerCbQuery();
    const bizId = Number(ctx.match[1]);
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_slug', data: { businessId: bizId } });
    ctx.reply('Введите новый slug (латиница, цифры, дефис, минимум 3 символа):');
  });

  bot.action('settings_slug', (ctx) => {
    ctx.answerCbQuery();
    const biz = requireBusiness(ctx);
    if (!biz) return;
    conversations.set(ctx.chat!.id, { step: 'awaiting_settings_slug', data: { businessId: biz.id } });
    ctx.reply('Введите новый slug (латиница, цифры, дефис, минимум 3 символа):');
  });

  // ---- Контакт ----

  bot.on('contact' as any, (ctx: any) => {
    const chatId = ctx.chat.id;
    const contact = ctx.message?.contact;
    if (!contact?.phone_number) return;

    updateOwnerPhone(chatId, contact.phone_number);
    conversations.delete(chatId);

    const businesses = getBusinessesByOwner(chatId);
    if (businesses.length === 0) {
      ctx.reply(
        '✅ Спасибо! Ваш номер телефона сохранён.\n\n' +
        'Давайте зарегистрируем ваше заведение. Как оно называется?',
        { reply_markup: { remove_keyboard: true } }
      );
      conversations.set(chatId, { step: 'awaiting_name', data: {} });
    } else {
      ctx.reply('✅ Спасибо! Ваш номер телефона сохранён.', {
        reply_markup: { remove_keyboard: true },
      });
    }
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

    const biz = requireBusinessOrAsk(ctx, text);
    if (!biz) return;

    executeCommand(ctx, biz, text);
  });
}
