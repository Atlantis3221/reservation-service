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
} from './schedule';
import {
  getBusinessesByOwner,
  getBusinessById,
  getBusinessByOwnerAndSlug,
  createBusiness,
  deleteBusiness,
  generateSlug,
  isValidSlug,
  isSlugTaken,
  updateBusinessName,
  updateBusinessSlug,
  getContactLinks,
  upsertContactLink,
  deleteContactLink,
} from './business';
import { toDateKey, fmtDate, getMondayOfWeek, getNextWeekday, resolveDay } from '../utils/date';
import type { Business, ContactLinkType } from '../types';

export interface CommandButton {
  label: string;
  action: string;
}

export interface CommandMessage {
  text: string;
  buttons?: CommandButton[];
}

export interface CommandResult {
  messages: CommandMessage[];
}

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
const pendingBookings = new Map<number, PendingBooking>();

function getFrontendUrl(slug?: string): string {
  const base = process.env.FRONTEND_URL || '';
  if (!base) return '';
  if (!slug) return base;
  const clean = base.replace(/\/+$/, '');
  return `${clean}/${slug}`;
}

export function executeCommand(
  adminUserId: number,
  text: string,
  business: Business | null,
  ownerChatId: string | null,
): CommandResult {
  const conv = conversations.get(adminUserId);
  if (conv) {
    return handleConversation(adminUserId, conv, text);
  }

  if (!business && !ownerChatId) {
    conversations.set(adminUserId, { step: 'awaiting_name', data: {} });
    return {
      messages: [{
        text: 'Привет! Давайте зарегистрируем ваше заведение.\n\nКак оно называется?',
      }],
    };
  }

  if (!business) {
    const businesses = ownerChatId ? getBusinessesByOwner(ownerChatId) : [];
    if (businesses.length === 0) {
      conversations.set(adminUserId, { step: 'awaiting_name', data: {} });
      return {
        messages: [{
          text: 'У вас пока нет заведений. Давайте создадим первое.\n\nКак оно называется?',
        }],
      };
    }
    return {
      messages: [{ text: 'Выберите заведение в переключателе вверху экрана.' }],
    };
  }

  return executeBusinessCommand(adminUserId, text, business);
}

export function executeAction(
  adminUserId: number,
  action: string,
  business: Business | null,
): CommandResult {
  if (action === 'confirm_book') {
    const pending = pendingBookings.get(adminUserId);
    pendingBookings.delete(adminUserId);
    if (!pending) {
      return { messages: [{ text: 'Бронирование не найдено. Попробуйте заново.' }] };
    }
    return doBooking(pending);
  }

  if (action === 'deny_book') {
    pendingBookings.delete(adminUserId);
    return { messages: [{ text: 'Бронирование отменено.' }] };
  }

  const cancelMatch = action.match(/^cancel_book:(\d+)$/);
  if (cancelMatch) {
    const slotId = Number(cancelMatch[1]);
    const result = cancelBookingById(slotId);
    if (result.cancelled === 0) {
      return { messages: [{ text: 'Бронь не найдена или уже отменена.' }] };
    }
    let text = '❌ Бронь отменена';
    if (result.dateKey) text += `: ${fmtDate(result.dateKey)} ${result.startTime}–${result.endTime}`;
    if (result.clientName) text += ` (${result.clientName})`;
    return { messages: [{ text }] };
  }

  const editMatch = action.match(/^edit_slots:(\d+)$/);
  if (editMatch) {
    const biz = getBusinessById(Number(editMatch[1]));
    if (!biz) return { messages: [{ text: 'Заведение не найдено.' }] };
    return handleEditSlots(biz);
  }

  const settingsNameMatch = action.match(/^settings_name:(\d+)$/);
  if (settingsNameMatch) {
    const bizId = Number(settingsNameMatch[1]);
    conversations.set(adminUserId, { step: 'awaiting_settings_name', data: { businessId: bizId } });
    return { messages: [{ text: 'Введите новое название:' }] };
  }

  const settingsSlugMatch = action.match(/^settings_slug:(\d+)$/);
  if (settingsSlugMatch) {
    const bizId = Number(settingsSlugMatch[1]);
    conversations.set(adminUserId, { step: 'awaiting_settings_slug', data: { businessId: bizId } });
    return { messages: [{ text: 'Введите новый slug (латиница, цифры, дефис, минимум 3 символа):' }] };
  }

  const contactLinksMatch = action.match(/^contact_links:(\d+)$/);
  if (contactLinksMatch) {
    const biz = getBusinessById(Number(contactLinksMatch[1]));
    if (!biz) return { messages: [{ text: 'Заведение не найдено.' }] };
    return handleContactLinks(biz);
  }

  const addContactMatch = action.match(/^add_contact:(telegram|vk|max):(\d+)$/);
  if (addContactMatch) {
    const type = addContactMatch[1] as ContactLinkType;
    const bizId = Number(addContactMatch[2]);
    conversations.set(adminUserId, {
      step: 'awaiting_contact_link',
      data: { businessId: bizId, linkType: type },
    });
    return { messages: [{ text: `Отправьте ссылку для ${CONTACT_TYPE_LABELS[type]} (начинается с https://):` }] };
  }

  const delContactMatch = action.match(/^del_contact:(telegram|vk|max):(\d+)$/);
  if (delContactMatch) {
    const type = delContactMatch[1] as ContactLinkType;
    const bizId = Number(delContactMatch[2]);
    deleteContactLink(bizId, type);
    return { messages: [{ text: `✅ Ссылка ${CONTACT_TYPE_LABELS[type]} удалена.` }] };
  }

  return { messages: [{ text: 'Неизвестное действие.' }] };
}

export function getInitialMessages(
  adminUserId: number,
  ownerChatId: string | null,
): CommandResult {
  const businesses = ownerChatId ? getBusinessesByOwner(ownerChatId) : [];

  if (businesses.length === 0) {
    conversations.set(adminUserId, { step: 'awaiting_name', data: {} });
    return {
      messages: [{
        text: 'Привет! Давайте зарегистрируем ваше заведение.\n\nКак оно называется?',
      }],
    };
  }

  return { messages: [] };
}

function executeBusinessCommand(
  adminUserId: number,
  text: string,
  biz: Business,
): CommandResult {
  const textLower = text.toLowerCase().trim();

  if (textLower === '/info' || textLower === 'info') {
    return handleInfo(biz);
  }

  if (textLower === '/settings' || textLower === 'настройки') {
    return handleSettings(biz);
  }

  if (textLower.startsWith('/schedule')) {
    const arg = textLower.replace(/^\/schedule\s*/i, '').trim();
    return handleDaySchedule(biz, arg || 'сегодня');
  }

  const scheduleMatch = textLower.match(/расписание\s+на\s+(\S+)/);
  if (scheduleMatch) {
    return handleDaySchedule(biz, scheduleMatch[1]);
  }

  if (textLower.includes('покажи') && textLower.includes('расписание')) {
    return handleShowSchedule(biz);
  }

  const flexCmd = parseFlexibleSchedule(textLower);
  if (flexCmd) {
    return handleFlexibleSchedule(biz, flexCmd);
  }

  const cancelCmd = parseCancelCommand(textLower);
  if (cancelCmd) {
    return handleCancelCommand(biz, cancelCmd);
  }

  const bookingRangeCmd = parseBookingRange(textLower);
  if (bookingRangeCmd) {
    return handleBookingCmd(adminUserId, biz, bookingRangeCmd);
  }

  const bookingCmd = parseBookingCommand(textLower);
  if (bookingCmd) {
    return handleBookingCmd(adminUserId, biz, bookingCmd);
  }

  if (textLower === '/add' || textLower === 'добавить заведение') {
    conversations.set(adminUserId, { step: 'awaiting_name', data: {} });
    return { messages: [{ text: 'Как называется новое заведение?' }] };
  }

  if (textLower.startsWith('/del') || textLower.startsWith('удалить ')) {
    return handleDelete(biz, textLower);
  }

  if (textLower === '/list' || textLower === 'список') {
    return handleList(biz.ownerChatId);
  }

  return {
    messages: [{
      text: 'Не понял команду. Нажмите кнопку «Команды» для списка доступных команд.',
    }],
  };
}

function handleConversation(adminUserId: number, conv: ConversationState, text: string): CommandResult {
  switch (conv.step) {
    case 'awaiting_name': {
      const name = text.trim();
      const slug = generateSlug(name);
      conversations.set(adminUserId, {
        step: 'awaiting_slug_confirm',
        data: { name, slug },
      });
      return {
        messages: [{
          text: `Отлично! Название: ${name}\nСсылка для клиентов: ${slug}\n\nОтправьте «да» чтобы подтвердить, или введите свой slug:`,
        }],
      };
    }

    case 'awaiting_slug_confirm': {
      const lower = text.toLowerCase().trim();
      if (lower === 'да' || lower === 'ok' || lower === 'ок') {
        const biz = createBusiness(conv.data.slug!, conv.data.name!, String(adminUserId));
        conversations.delete(adminUserId);
        const url = getFrontendUrl(biz.slug);
        let reply = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
        if (url) reply += `\n🔗 ${url}`;
        reply += '\n\nТеперь вы можете управлять расписанием.';
        return { messages: [{ text: reply }] };
      }

      const customSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!isValidSlug(customSlug)) {
        return { messages: [{ text: 'Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:' }] };
      }
      if (isSlugTaken(customSlug)) {
        return { messages: [{ text: `Slug «${customSlug}» уже занят. Попробуйте другой:` }] };
      }
      const biz = createBusiness(customSlug, conv.data.name!, String(adminUserId));
      conversations.delete(adminUserId);
      const url = getFrontendUrl(biz.slug);
      let reply = `✅ «${biz.name}» зарегистрировано!\n\nSlug: ${biz.slug}`;
      if (url) reply += `\n🔗 ${url}`;
      reply += '\n\nТеперь вы можете управлять расписанием.';
      return { messages: [{ text: reply }] };
    }

    case 'awaiting_settings_name': {
      const biz = conv.data.businessId ? getBusinessById(conv.data.businessId) : null;
      conversations.delete(adminUserId);
      if (!biz) return { messages: [{ text: 'Заведение не найдено.' }] };
      updateBusinessName(biz.id, text.trim());
      return { messages: [{ text: `✅ Название изменено на «${text.trim()}»` }] };
    }

    case 'awaiting_settings_slug': {
      const biz = conv.data.businessId ? getBusinessById(conv.data.businessId) : null;
      conversations.delete(adminUserId);
      if (!biz) return { messages: [{ text: 'Заведение не найдено.' }] };
      const newSlug = text.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (!isValidSlug(newSlug)) {
        return { messages: [{ text: 'Slug должен содержать только латиницу, цифры и дефис (минимум 3 символа). Попробуйте ещё раз:' }] };
      }
      if (isSlugTaken(newSlug) && newSlug !== biz.slug) {
        return { messages: [{ text: `Slug «${newSlug}» уже занят. Попробуйте другой:` }] };
      }
      updateBusinessSlug(biz.id, newSlug);
      const url = getFrontendUrl(newSlug);
      let reply = `✅ Slug изменён на «${newSlug}»`;
      if (url) reply += `\n🔗 Новая ссылка: ${url}`;
      return { messages: [{ text: reply }] };
    }

    case 'awaiting_contact_link': {
      const biz = conv.data.businessId ? getBusinessById(conv.data.businessId) : null;
      const linkType = conv.data.linkType;
      conversations.delete(adminUserId);
      if (!biz || !linkType) return { messages: [{ text: 'Заведение не найдено.' }] };

      const url = text.trim();
      if (!url.startsWith('https://')) {
        return { messages: [{ text: 'Ссылка должна начинаться с https://. Попробуйте ещё раз через настройки.' }] };
      }

      upsertContactLink(biz.id, linkType, url);
      return { messages: [{ text: `✅ Ссылка ${CONTACT_TYPE_LABELS[linkType]} сохранена: ${url}` }] };
    }
  }
}

function handleInfo(biz: Business): CommandResult {
  const url = getFrontendUrl(biz.slug);
  let text =
    `🏢 ${biz.name}\n\n` +
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
    `- настройки\n` +
    `- список\n` +
    `- добавить заведение\n`;

  if (url) {
    text += `\n🔗 Расписание для гостей: ${url}`;
  }

  return { messages: [{ text }] };
}

const CONTACT_TYPE_LABELS: Record<ContactLinkType, string> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

function handleSettings(biz: Business): CommandResult {
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

  return {
    messages: [{
      text,
      buttons: [
        { label: '✏️ Изменить название', action: `settings_name:${biz.id}` },
        { label: '🔗 Изменить slug', action: `settings_slug:${biz.id}` },
        { label: '📞 Ссылки для связи', action: `contact_links:${biz.id}` },
      ],
    }],
  };
}

function handleContactLinks(biz: Business): CommandResult {
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

  const buttons: CommandButton[] = [];
  for (const type of allTypes) {
    if (existingTypes.has(type)) {
      buttons.push({ label: `❌ Удалить ${CONTACT_TYPE_LABELS[type]}`, action: `del_contact:${type}:${biz.id}` });
    } else {
      buttons.push({ label: `➕ Добавить ${CONTACT_TYPE_LABELS[type]}`, action: `add_contact:${type}:${biz.id}` });
    }
  }

  return { messages: [{ text, buttons }] };
}

function handleDaySchedule(biz: Business, dayName: string): CommandResult {
  const targetDate = resolveDay(dayName);
  if (!targetDate) {
    return { messages: [{ text: `Не понял день: «${dayName}».` }] };
  }

  const dateKey = toDateKey(targetDate);
  const slots = getSlotsForDate(biz.id, dateKey);

  if (slots.length === 0) {
    return { messages: [{ text: `На ${fmtDate(dateKey)} расписание не задано.` }] };
  }

  const frontendUrl = getFrontendUrl(biz.slug);
  const text = formatDayScheduleText(dateKey, slots, frontendUrl);
  return { messages: [{ text }] };
}

function handleShowSchedule(biz: Business): CommandResult {
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
  return { messages: [{ text }] };
}

function handleFlexibleSchedule(biz: Business, cmd: FlexibleScheduleCommand): CommandResult {
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

  return {
    messages: [{
      text,
      buttons: [
        { label: '✏️ Редактировать слоты', action: `edit_slots:${biz.id}` },
      ],
    }],
  };
}

function handleEditSlots(biz: Business): CommandResult {
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
  text += '«на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03»';
  return { messages: [{ text }] };
}

function handleCancelCommand(
  biz: Business,
  cmd: { dayName: string; startTime: string },
): CommandResult {
  const targetDate = resolveDay(cmd.dayName);
  if (!targetDate) {
    return { messages: [{ text: `Не понял день: «${cmd.dayName}»` }] };
  }

  const dateKey = toDateKey(targetDate);
  const result = cancelBooking(biz.id, dateKey, cmd.startTime);

  if (result.cancelled === 0) {
    return { messages: [{ text: `На ${fmtDate(dateKey)} ${cmd.startTime} нет брони.` }] };
  }

  let text = `❌ Бронь отменена: ${fmtDate(dateKey)} ${cmd.startTime}`;
  if (result.clientName) text += ` (${result.clientName})`;
  return { messages: [{ text }] };
}

function handleBookingCmd(
  adminUserId: number,
  biz: Business,
  cmd: { dayName: string; startTime: string; endTime: string; clientName?: string },
): CommandResult {
  const targetDate = resolveDay(cmd.dayName) || getNextWeekday(cmd.dayName);
  if (!targetDate) {
    return { messages: [{ text: `Не понял день: «${cmd.dayName}»` }] };
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
    pendingBookings.set(adminUserId, pending);
    const lines = overlaps.map((o) => {
      let line = `  • ${o.startTime}–${o.endTime}`;
      if (o.clientName) line += ` (${o.clientName})`;
      return line;
    });
    return {
      messages: [{
        text: `⚠️ На это время уже есть бронь:\n${lines.join('\n')}\n\nСоздать ещё одну?`,
        buttons: [
          { label: '✅ Да, создать', action: 'confirm_book' },
          { label: '❌ Нет', action: 'deny_book' },
        ],
      }],
    };
  }

  return doBooking(pending);
}

function doBooking(pending: PendingBooking): CommandResult {
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

  return {
    messages: [{
      text: replyText,
      buttons: [
        { label: '❌ Отменить бронь', action: `cancel_book:${result.id}` },
      ],
    }],
  };
}

function handleDelete(biz: Business, textLower: string): CommandResult {
  const slug = textLower.replace(/^\/del\s*/i, '').replace(/^удалить\s*/i, '').trim();
  const businesses = getBusinessesByOwner(biz.ownerChatId);

  if (!slug) {
    const list = businesses.map((b) => `• ${b.name} — ${b.slug}`).join('\n');
    return { messages: [{ text: `Укажите slug заведения для удаления:\n\n${list}` }] };
  }

  const target = getBusinessByOwnerAndSlug(biz.ownerChatId, slug);
  if (!target) {
    return { messages: [{ text: 'Заведение не найдено. Проверьте slug.' }] };
  }

  if (businesses.length === 1) {
    return { messages: [{ text: 'Нельзя удалить единственное заведение.' }] };
  }

  deleteBusiness(target.id);
  return { messages: [{ text: `✅ «${target.name}» (${target.slug}) удалено вместе со всеми слотами.` }] };
}

function handleList(ownerChatId: string): CommandResult {
  const businesses = getBusinessesByOwner(ownerChatId);
  if (businesses.length === 0) {
    return { messages: [{ text: 'У вас нет зарегистрированных заведений.' }] };
  }

  let text = `🏢 Ваши заведения (${businesses.length}):\n\n`;
  for (const b of businesses) {
    const url = getFrontendUrl(b.slug);
    text += `• ${b.name} — ${b.slug}`;
    if (url) text += `\n  🔗 ${url}`;
    text += '\n';
  }

  return { messages: [{ text }] };
}

export const AVAILABLE_COMMANDS = [
  {
    category: 'Время работы',
    commands: [
      { command: 'на этой неделе пн-пт с 10 до 23, пт-сб с 12 до 03', description: 'Задать расписание на неделю' },
    ],
  },
  {
    category: 'Управление',
    commands: [
      { command: 'настройки', description: 'Настройки заведения' },
      { command: 'список', description: 'Список заведений' },
      { command: 'добавить заведение', description: 'Создать новое заведение' },
    ],
  },
];
