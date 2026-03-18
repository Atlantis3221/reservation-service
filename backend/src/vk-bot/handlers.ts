import type { VK } from 'vk-io';
import { parseFlexibleSchedule, parseBookingCommand, parseBookingRange, parseCancelCommand } from '../bot/parsers';
import type { FlexibleScheduleCommand } from '../bot/parsers';
import { formatDayScheduleText, formatStatsText, formatScheduleCreated, formatBookingConfirmation } from '../bot/formatters';
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
  hasAgreement,
  saveAgreement,
  getContactLinks,
  upsertContactLink,
  deleteContactLink,
} from '../services/business';
import { toDateKey, fmtDate, getMondayOfWeek, getNextWeekday, resolveDay } from '../utils/date';
import { trackUnrecognizedCommand } from '../services/monitor';
import { createLinkCode, getAdminUserByOwnerChatId, createResetToken } from '../repositories/admin-user.repository';
import crypto from 'crypto';
import type { Business } from '../types';
import { buildKeyboard, stripFormatting } from './keyboard';

type ContactLinkType = 'telegram' | 'vk' | 'max';

type ConversationStep =
  | 'awaiting_name'
  | 'awaiting_slug_confirm'
  | 'awaiting_settings_name'
  | 'awaiting_settings_slug'
  | 'awaiting_contact_link';

interface ConversationState {
  step: ConversationStep;
  data: { name?: string; slug?: string; businessId?: number; linkType?: ContactLinkType };
}

interface PendingCommand {
  text: string;
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

type ReplyFn = (text: string, keyboard?: string) => Promise<any>;

const conversations = new Map<number, ConversationState>();
const pendingCommands = new Map<number, PendingCommand>();
const pendingBookings = new Map<number, PendingBooking>();

function vkOwnerId(peerId: number): string {
  return `vk:${peerId}`;
}

function getFrontendUrl(slug?: string): string {
  const base = process.env.FRONTEND_URL || '';
  if (!base) return '';
  if (!slug) return base;
  const clean = base.replace(/\/+$/, '');
  return `${clean}/${slug}`;
}

const CONTACT_TYPE_LABELS: Record<ContactLinkType, string> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

function handleInfo(reply: ReplyFn, businesses: Business[]): void {
  let header = '';
  if (businesses.length === 1) {
    header = `🏢 ${businesses[0].name}\n\n`;
  } else {
    header = `🏢 Ваши заведения:\n`;
    for (const b of businesses) {
      header += `• ${b.name} (${b.slug})\n`;
    }
    header += '\n';
  }

  let text = header +
    `📌 Все команды:\n\n` +
    `Бронирование\n` +
    `- сегодня бронь с 14 до 18\n` +
    `- сегодня бронь с 14:30 до 18:00 Петров\n` +
    `- в пятницу бронь на 15:00 на 3 часа\n` +
    `- в пятницу бронь на 15:30 на 2 часа Иванов\n\n` +
    `Отмена брони\n` +
    `- отмени бронь на сегодня 14\n` +
    `- отмени бронь на завтра 16\n\n` +
    `Расписание\n` +
    `- расписание на сегодня\n` +
    `- расписание на пятницу\n` +
    `- покажи расписание\n\n` +
    `Время работы\n` +
    `- на этой неделе ПН-ПТ c 10 до 23, ПТ-СБ c 12 до 03\n\n` +
    `Управление\n` +
    `/settings — настройки заведения\n` +
    `/list — список заведений\n` +
    `/add — добавить заведение\n` +
    `/del — удалить заведение\n\n` +
    `Веб-панель\n` +
    `/link — код для привязки веб-панели`;

  const urls = businesses
    .map((b) => getFrontendUrl(b.slug))
    .filter(Boolean);
  if (urls.length === 1) {
    text += `\n\n🔗 Расписание для гостей: ${urls[0]}`;
  } else if (urls.length > 1) {
    text += '\n\n🔗 Ссылки для гостей:';
    for (let i = 0; i < businesses.length; i++) {
      const url = getFrontendUrl(businesses[i].slug);
      if (url) text += `\n• ${businesses[i].name}: ${url}`;
    }
  }

  reply(text);
}

function handleSettings(reply: ReplyFn, biz: Business): void {
  const url = getFrontendUrl(biz.slug);
  const links = getContactLinks(biz.id);

  let text =
    `⚙️ Настройки — ${biz.name}\n\n` +
    `Название: ${biz.name}\n` +
    `Slug: ${biz.slug}`;

  if (url) text += `\n🔗 ${url}`;

  if (links.length > 0) {
    text += '\n\n📞 Ссылки для связи:';
    for (const link of links) {
      text += `\n• ${CONTACT_TYPE_LABELS[link.type]}: ${link.url}`;
    }
  }

  reply(text, buildKeyboard([
    [{ label: '✏️ Изменить название', action: `settings_name:${biz.id}` }],
    [{ label: '🔗 Изменить slug', action: `settings_slug:${biz.id}` }],
    [{ label: '📞 Ссылки для связи', action: `contact_links:${biz.id}` }],
  ]));
}

function handleContactLinks(reply: ReplyFn, biz: Business): void {
  const links = getContactLinks(biz.id);
  const allTypes: ContactLinkType[] = ['telegram', 'vk', 'max'];
  const existingTypes = new Set(links.map((l) => l.type));

  let text = `📞 Ссылки для связи — ${biz.name}\n`;

  if (links.length > 0) {
    for (const link of links) {
      text += `\n• ${CONTACT_TYPE_LABELS[link.type]}: ${link.url}`;
    }
  } else {
    text += '\nСсылок пока нет.';
  }

  const buttons: Array<Array<{ label: string; action: string }>> = [];
  for (const type of allTypes) {
    if (existingTypes.has(type)) {
      buttons.push([{ label: `❌ Удалить ${CONTACT_TYPE_LABELS[type]}`, action: `del_contact:${type}:${biz.id}` }]);
    } else {
      buttons.push([{ label: `➕ Добавить ${CONTACT_TYPE_LABELS[type]}`, action: `add_contact:${type}:${biz.id}` }]);
    }
  }

  reply(text, buildKeyboard(buttons));
}

function handleFlexibleSchedule(reply: ReplyFn, biz: Business, cmd: FlexibleScheduleCommand): void {
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

  reply(text, buildKeyboard([
    [{ label: '✏️ Редактировать слоты', action: `edit_slots:${biz.id}` }],
  ]));
}

function handleEditSlots(reply: ReplyFn, biz: Business): void {
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

  reply(text);
}

function handleCancelCommand(
  reply: ReplyFn,
  biz: Business,
  cmd: { dayName: string; startTime: string }
): void {
  const targetDate = resolveDay(cmd.dayName);
  if (!targetDate) {
    reply(`Не понял день: "${cmd.dayName}"`);
    return;
  }

  const dateKey = toDateKey(targetDate);
  const result = cancelBooking(biz.id, dateKey, cmd.startTime);

  if (result.cancelled === 0) {
    reply(`На ${fmtDate(dateKey)} ${cmd.startTime} нет брони.`);
    return;
  }

  let text = `❌ Бронь отменена: ${fmtDate(dateKey)} ${cmd.startTime}`;
  if (result.clientName) text += ` (${result.clientName})`;

  reply(text);
}

function doCreateBooking(reply: ReplyFn, pending: PendingBooking): void {
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

  reply(replyText, buildKeyboard([
    [{ label: '❌ Отменить бронь', action: `cancel_book:${result.id}` }],
  ]));
}

function handleBookingCommand(
  reply: ReplyFn,
  peerId: number,
  biz: Business,
  cmd: { dayName: string; startTime: string; endTime: string; clientName?: string }
): void {
  const targetDate = resolveDay(cmd.dayName) || getNextWeekday(cmd.dayName);
  if (!targetDate) {
    reply(`Не понял день: "${cmd.dayName}"`);
    return;
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
    pendingBookings.set(peerId, pending);
    const lines = overlaps.map((o) => {
      let line = `  • ${o.startTime}–${o.endTime}`;
      if (o.clientName) line += ` (${o.clientName})`;
      return line;
    });
    reply(
      `⚠️ На это время уже есть бронь:\n${lines.join('\n')}\n\nСоздать ещё одну?`,
      buildKeyboard([[
        { label: '✅ Да, создать', action: 'confirm_book' },
        { label: '❌ Нет', action: 'deny_book' },
      ]]),
    );
    return;
  }

  doCreateBooking(reply, pending);
}

function handleDaySchedule(reply: ReplyFn, biz: Business, dayName: string): void {
  const targetDate = resolveDay(dayName);
  if (!targetDate) {
    reply(`Не понял день: "${dayName}". Отправьте /info для списка возможностей.`);
    return;
  }

  const dateKey = toDateKey(targetDate);
  const slots = getSlotsForDate(biz.id, dateKey);

  if (slots.length === 0) {
    reply(`На ${fmtDate(dateKey)} расписание не задано.`);
    return;
  }

  const frontendUrl = getFrontendUrl(biz.slug);
  const text = formatDayScheduleText(dateKey, slots, frontendUrl);

  reply(text);
}

function handleShowSchedule(reply: ReplyFn, biz: Business): void {
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

  const text = stripFormatting(formatStatsText(stats, daySlots));
  reply(text);
}

function handleConversation(reply: ReplyFn, peerId: number, conv: ConversationState, text: string): void {
  const ownerId = vkOwnerId(peerId);

  switch (conv.step) {
    case 'awaiting_name': {
      const name = text;
      const slug = generateSlug(name);
      conversations.set(peerId, {
        step: 'awaiting_slug_confirm',
        data: { name, slug },
      });
      reply(
        `Отлично! Название: ${name}\n` +
        `Ссылка для клиентов: ${slug}\n\n` +
        `Отправьте «да» чтобы подтвердить, или введите свой slug:`
      );
      break;
    }

    case 'awaiting_slug_confirm': {
      const lower = text.toLowerCase();
      if (lower === 'да' || lower === 'ok' || lower === 'ок') {
        const biz = createBusiness(conv.data.slug!, conv.data.name!, ownerId);
        conversations.delete(peerId);
        const url = getFrontendUrl(biz.slug);
        let r = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
        if (url) r += `\n🔗 ${url}`;
        r += '\n\nТеперь вы можете управлять расписанием. Отправьте /info для списка возможностей.';
        reply(r);
      } else {
        const customSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!isValidSlug(customSlug)) {
          reply('Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:');
          return;
        }
        if (isSlugTaken(customSlug)) {
          reply(`Slug «${customSlug}» уже занят. Попробуйте другой:`);
          return;
        }
        const biz = createBusiness(customSlug, conv.data.name!, ownerId);
        conversations.delete(peerId);
        const url = getFrontendUrl(biz.slug);
        let r = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
        if (url) r += `\n🔗 ${url}`;
        r += '\n\nТеперь вы можете управлять расписанием. Отправьте /info для списка возможностей.';
        reply(r);
      }
      break;
    }

    case 'awaiting_settings_name': {
      const biz = conv.data.businessId
        ? getBusinessById(conv.data.businessId)
        : getBusinessByOwner(ownerId);
      if (!biz) {
        conversations.delete(peerId);
        return;
      }
      updateBusinessName(biz.id, text);
      conversations.delete(peerId);
      reply(`✅ Название изменено на «${text}»`);
      break;
    }

    case 'awaiting_settings_slug': {
      const biz = conv.data.businessId
        ? getBusinessById(conv.data.businessId)
        : getBusinessByOwner(ownerId);
      if (!biz) {
        conversations.delete(peerId);
        return;
      }
      const newSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!isValidSlug(newSlug)) {
        reply('Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:');
        return;
      }
      if (isSlugTaken(newSlug) && newSlug !== biz.slug) {
        reply(`Slug «${newSlug}» уже занят. Попробуйте другой:`);
        return;
      }
      updateBusinessSlug(biz.id, newSlug);
      conversations.delete(peerId);
      const url = getFrontendUrl(newSlug);
      let r = `✅ Slug изменён на «${newSlug}»`;
      if (url) r += `\n🔗 Новая ссылка: ${url}`;
      reply(r);
      break;
    }

    case 'awaiting_contact_link': {
      const biz = conv.data.businessId ? getBusinessById(conv.data.businessId) : null;
      const linkType = conv.data.linkType;
      conversations.delete(peerId);
      if (!biz || !linkType) return;

      const url = text.trim();
      if (!url.startsWith('https://')) {
        reply('Ссылка должна начинаться с https://. Попробуйте ещё раз через настройки.');
        return;
      }

      upsertContactLink(biz.id, linkType, url);
      reply(`✅ Ссылка ${CONTACT_TYPE_LABELS[linkType]} сохранена: ${url}`);
      break;
    }
  }
}

function requireBusiness(reply: ReplyFn, peerId: number): Business | null {
  const ownerId = vkOwnerId(peerId);
  const businesses = getBusinessesByOwner(ownerId);
  if (businesses.length === 0) {
    reply('Сначала зарегистрируйте заведение. Отправьте /start');
    return null;
  }
  if (businesses.length === 1) {
    return businesses[0];
  }
  return null;
}

function requireBusinessOrAsk(reply: ReplyFn, peerId: number, text: string): Business | null {
  const ownerId = vkOwnerId(peerId);
  const businesses = getBusinessesByOwner(ownerId);
  if (businesses.length === 0) {
    return null;
  }
  if (businesses.length === 1) {
    return businesses[0];
  }

  pendingCommands.set(peerId, { text });

  const buttons = businesses.map((b) =>
    [{ label: b.name, action: `pick_biz:${b.id}` }]
  );

  reply('Для какого заведения?', buildKeyboard(buttons));
  return null;
}

function executeCommand(reply: ReplyFn, peerId: number, biz: Business, text: string): void {
  const textLower = text.toLowerCase();

  if (textLower === '/info') {
    const allBiz = getBusinessesByOwner(biz.ownerChatId);
    return handleInfo(reply, allBiz.length > 0 ? allBiz : [biz]);
  }

  if (textLower === '/settings') {
    return handleSettings(reply, biz);
  }

  if (textLower.startsWith('/schedule')) {
    const arg = textLower.replace(/^\/schedule\s*/i, '').trim();
    return handleDaySchedule(reply, biz, arg || 'сегодня');
  }

  const scheduleMatch = textLower.match(/расписание\s+на\s+(\S+)/);
  if (scheduleMatch) {
    return handleDaySchedule(reply, biz, scheduleMatch[1]);
  }

  if (textLower.includes('покажи') && textLower.includes('расписание')) {
    return handleShowSchedule(reply, biz);
  }

  const flexCmd = parseFlexibleSchedule(textLower);
  if (flexCmd) {
    return handleFlexibleSchedule(reply, biz, flexCmd);
  }

  const cancelCmd = parseCancelCommand(textLower);
  if (cancelCmd) {
    return handleCancelCommand(reply, biz, cancelCmd);
  }

  const bookingRangeCmd = parseBookingRange(textLower);
  if (bookingRangeCmd) {
    return handleBookingCommand(reply, peerId, biz, bookingRangeCmd);
  }

  const bookingCmd = parseBookingCommand(textLower);
  if (bookingCmd) {
    return handleBookingCommand(reply, peerId, biz, bookingCmd);
  }

  trackUnrecognizedCommand();
  reply('Не понял команду. Отправьте /info для списка возможностей.');
}

export function registerHandlers(vk: VK): void {

  function showAgreement(reply: ReplyFn): void {
    const text =
      `📜 Пользовательское соглашение\n\n` +
      `Используя данный сервис, вы соглашаетесь со следующими условиями:\n\n` +
      `1. Вы предоставляете достоверные данные о себе и своём заведении.\n` +
      `2. Вы даёте согласие на обработку персональных данных (имя, VK ID) в целях функционирования сервиса.\n` +
      `3. Сервис предоставляется «как есть» без каких-либо гарантий.\n` +
      `4. Администрация сервиса может связаться с вами через VK для решения вопросов, связанных с использованием сервиса.\n` +
      `5. Вы можете прекратить использование сервиса в любой момент, удалив своё заведение.\n\n` +
      `Нажмите «Принимаю» для продолжения или «Отклоняю» для отказа.`;

    reply(text, buildKeyboard([
      [{ label: '✅ Принимаю', action: 'agree_accept' }],
      [{ label: '❌ Отклоняю', action: 'agree_decline' }],
    ]));
  }

  function makeReply(ctx: any): ReplyFn {
    return (text: string, keyboard?: string) =>
      ctx.send(text, keyboard ? { keyboard } : {});
  }

  function makeEventReply(peerId: number): ReplyFn {
    return (text: string, keyboard?: string) =>
      vk.api.messages.send({
        peer_id: peerId,
        message: text,
        random_id: Math.floor(Math.random() * 1e9),
        ...(keyboard ? { keyboard } : {}),
      });
  }

  // ---- Text messages ----

  vk.updates.on('message_new', async (ctx) => {
    if (ctx.isOutbox) return;

    const peerId = ctx.peerId;
    const text = (ctx.text || '').trim();
    if (!text) return;

    const reply = makeReply(ctx);
    const ownerId = vkOwnerId(peerId);

    // Active conversation
    const conv = conversations.get(peerId);
    if (conv) {
      handleConversation(reply, peerId, conv, text);
      return;
    }

    const businesses = getBusinessesByOwner(ownerId);
    const textLower = text.toLowerCase();

    // /start or first message from VK
    if (textLower === '/start' || textLower === 'начать') {
      if (businesses.length > 0) {
        handleInfo(reply, businesses);
        return;
      }
      if (!hasAgreement(ownerId)) {
        showAgreement(reply);
        return;
      }
      conversations.set(peerId, { step: 'awaiting_name', data: {} });
      reply(
        'Привет! Давайте зарегистрируем ваше заведение.\n\n' +
        'Как оно называется?'
      );
      return;
    }

    // First-time user without businesses
    if (businesses.length === 0) {
      if (!hasAgreement(ownerId)) {
        showAgreement(reply);
        return;
      }
      conversations.set(peerId, { step: 'awaiting_name', data: {} });
      reply('У вас пока нет заведений. Давайте зарегистрируем.\n\nКак оно называется?');
      return;
    }

    // /info
    if (textLower === '/info') {
      handleInfo(reply, businesses);
      return;
    }

    // /list
    if (textLower === '/list') {
      let listText = `🏢 Ваши заведения (${businesses.length}):\n\n`;
      for (const b of businesses) {
        const url = getFrontendUrl(b.slug);
        listText += `• ${b.name} — ${b.slug}`;
        if (url) listText += `\n  🔗 ${url}`;
        listText += '\n';
      }
      reply(listText);
      return;
    }

    // /add
    if (textLower === '/add') {
      conversations.set(peerId, { step: 'awaiting_name', data: {} });
      reply('Как называется новое заведение?');
      return;
    }

    // /del
    if (textLower.startsWith('/del')) {
      const slug = text.replace(/^\/del\s*/i, '').trim();
      if (!slug) {
        reply('Укажите slug заведения: /del <slug>\n\nВаши заведения:\n' +
          businesses.map((b) => `• ${b.name} — ${b.slug}`).join('\n')
        );
        return;
      }

      const biz = getBusinessByOwnerAndSlug(ownerId, slug);
      if (!biz) {
        reply('Заведение не найдено. Проверьте slug командой /list');
        return;
      }

      if (businesses.length === 1) {
        reply('Нельзя удалить единственное заведение.');
        return;
      }

      deleteBusiness(biz.id);
      reply(`✅ «${biz.name}» (${biz.slug}) удалено вместе со всеми слотами.`);
      return;
    }

    // /link
    if (textLower === '/link') {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      createLinkCode(code, ownerId, expiresAt);

      const adminUrl = process.env.ADMIN_URL || 'https://admin.slotik.tech';
      reply(
        `🔗 Код для привязки веб-панели:\n\n` +
        `${code}\n\n` +
        `Введите этот код на ${adminUrl} в разделе привязки.\n` +
        `Код действителен 10 минут.`
      );
      return;
    }

    // /reset
    if (textLower === '/reset') {
      const adminUser = getAdminUserByOwnerChatId(ownerId);
      if (!adminUser) {
        reply('К вашему VK не привязан веб-аккаунт. Зарегистрируйтесь на admin.slotik.tech и привяжите аккаунт командой /link');
        return;
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      createResetToken(token, adminUser.id, expiresAt);

      const adminUrl = process.env.ADMIN_URL || 'https://admin.slotik.tech';
      reply(
        `🔑 Ссылка для сброса пароля:\n\n` +
        `${adminUrl}/reset?token=${token}\n\n` +
        `Ссылка действительна 30 минут.`
      );
      return;
    }

    // Commands requiring a specific business
    const biz = requireBusinessOrAsk(reply, peerId, text);
    if (!biz) return;

    executeCommand(reply, peerId, biz, text);
  });

  // ---- Callback button events ----

  vk.updates.on('message_event', async (ctx) => {
    const peerId = ctx.peerId;
    const action = (ctx.eventPayload as any)?.action as string;
    if (!action) return;

    const ownerId = vkOwnerId(peerId);
    const reply = makeEventReply(peerId);

    await ctx.answer({ type: 'show_snackbar', text: '⏳' });

    // Agreement
    if (action === 'agree_accept') {
      saveAgreement(ownerId);
      await reply('✅ Спасибо! Соглашение принято.');
      conversations.set(peerId, { step: 'awaiting_name', data: {} });
      await reply('Давайте зарегистрируем ваше заведение.\n\nКак оно называется?');
      return;
    }

    if (action === 'agree_decline') {
      reply(
        '❌ Без принятия пользовательского соглашения использование сервиса невозможно.\n\n' +
        'Если передумаете — отправьте /start'
      );
      return;
    }

    // Pick business
    const pickBizMatch = action.match(/^pick_biz:(\d+)$/);
    if (pickBizMatch) {
      const bizId = Number(pickBizMatch[1]);
      const biz = getBusinessById(bizId);
      if (!biz || biz.ownerChatId !== ownerId) {
        reply('Заведение не найдено.');
        return;
      }

      const pending = pendingCommands.get(peerId);
      pendingCommands.delete(peerId);

      if (!pending) {
        reply(`Выбрано «${biz.name}». Отправьте команду.`);
        return;
      }

      executeCommand(reply, peerId, biz, pending.text);
      return;
    }

    // Edit slots
    const editSlotsMatch = action.match(/^edit_slots:(\d+)$/);
    if (editSlotsMatch) {
      const biz = getBusinessById(Number(editSlotsMatch[1]));
      if (!biz) return;
      handleEditSlots(reply, biz);
      return;
    }

    if (action === 'edit_slots') {
      const biz = requireBusiness(reply, peerId);
      if (!biz) return;
      handleEditSlots(reply, biz);
      return;
    }

    // Cancel booking
    const cancelBookMatch = action.match(/^cancel_book:(\d+)$/);
    if (cancelBookMatch) {
      const slotId = Number(cancelBookMatch[1]);
      const result = cancelBookingById(slotId);
      if (result.cancelled === 0) {
        reply('Бронь не найдена или уже отменена.');
        return;
      }
      let text = '❌ Бронь отменена';
      if (result.dateKey) text += `: ${fmtDate(result.dateKey)} ${result.startTime}–${result.endTime}`;
      if (result.clientName) text += ` (${result.clientName})`;
      reply(text);
      return;
    }

    // Confirm/deny overlapping booking
    if (action === 'confirm_book') {
      const pending = pendingBookings.get(peerId);
      pendingBookings.delete(peerId);
      if (!pending) {
        reply('Бронирование не найдено. Попробуйте заново.');
        return;
      }
      doCreateBooking(reply, pending);
      return;
    }

    if (action === 'deny_book') {
      pendingBookings.delete(peerId);
      reply('Бронирование отменено.');
      return;
    }

    // Show schedule
    if (action === 'example_show') {
      const biz = requireBusiness(reply, peerId);
      if (!biz) return;
      handleShowSchedule(reply, biz);
      return;
    }

    // Settings: name
    const settingsNameMatch = action.match(/^settings_name:(\d+)$/);
    if (settingsNameMatch) {
      const bizId = Number(settingsNameMatch[1]);
      conversations.set(peerId, { step: 'awaiting_settings_name', data: { businessId: bizId } });
      reply('Введите новое название:');
      return;
    }

    // Settings: slug
    const settingsSlugMatch = action.match(/^settings_slug:(\d+)$/);
    if (settingsSlugMatch) {
      const bizId = Number(settingsSlugMatch[1]);
      conversations.set(peerId, { step: 'awaiting_settings_slug', data: { businessId: bizId } });
      reply('Введите новый slug (латиница, цифры, дефис, минимум 3 символа):');
      return;
    }

    // Contact links
    const contactLinksMatch = action.match(/^contact_links:(\d+)$/);
    if (contactLinksMatch) {
      const biz = getBusinessById(Number(contactLinksMatch[1]));
      if (!biz) return;
      handleContactLinks(reply, biz);
      return;
    }

    // Add contact
    const addContactMatch = action.match(/^add_contact:(telegram|vk|max):(\d+)$/);
    if (addContactMatch) {
      const type = addContactMatch[1] as ContactLinkType;
      const bizId = Number(addContactMatch[2]);
      conversations.set(peerId, {
        step: 'awaiting_contact_link',
        data: { businessId: bizId, linkType: type },
      });
      reply(`Отправьте ссылку для ${CONTACT_TYPE_LABELS[type]} (начинается с https://):`);
      return;
    }

    // Delete contact
    const delContactMatch = action.match(/^del_contact:(telegram|vk|max):(\d+)$/);
    if (delContactMatch) {
      const type = delContactMatch[1] as ContactLinkType;
      const bizId = Number(delContactMatch[2]);
      deleteContactLink(bizId, type);
      reply(`✅ Ссылка ${CONTACT_TYPE_LABELS[type]} удалена.`);
      return;
    }
  });
}
