import { getBot } from '../bot/index';
import { getVkBot } from '../vk-bot/index';
import { fmtDate } from '../utils/date';
import { WEB_OWNER_PREFIX } from './db';
import { sendOwnerEmail } from './mailer';
import { getAdminUserByOwnerChatId } from '../repositories/admin-user.repository';
import type { Business, BookingRequest } from '../types';
import { buildKeyboard } from '../vk-bot/keyboard';

export interface NewBooking {
  date: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientPhone: string;
  comment?: string;
}

export function notifyBookingRequest(biz: Business, request: BookingRequest): void {
  const text = formatRequestNotification(biz.name, request);
  const ownerChatId = biz.ownerChatId;
  if (!ownerChatId) return;

  if (ownerChatId.startsWith(WEB_OWNER_PREFIX)) {
    notifyByEmail(ownerChatId, `Новая заявка — ${biz.name}`, text);
    return;
  }

  if (ownerChatId.startsWith('vk:')) {
    notifyVk(Number(ownerChatId.slice(3)), text, request.id);
  } else {
    notifyTelegram(Number(ownerChatId), text, request.id);
  }
}

/**
 * Клиент сам занял свободный слот. Подтверждать нечего — владельцу нужно
 * только узнать об этом, поэтому сообщение идёт без кнопок.
 */
export function notifyNewBooking(biz: Business, booking: NewBooking): void {
  const text = formatBookingNotification(biz.name, booking);
  const ownerChatId = biz.ownerChatId;
  if (!ownerChatId) return;

  if (ownerChatId.startsWith(WEB_OWNER_PREFIX)) {
    notifyByEmail(ownerChatId, `Новая бронь — ${biz.name}`, text);
    return;
  }

  if (ownerChatId.startsWith('vk:')) {
    sendVkText(Number(ownerChatId.slice(3)), text);
  } else {
    sendTelegramText(Number(ownerChatId), text);
  }
}

function formatBookingNotification(bizName: string, b: NewBooking): string {
  let text = '🎉 Новая бронь\n\n';
  text += `Заведение: ${bizName}\n`;
  text += `Клиент: ${b.clientName}\n`;
  text += `Телефон: ${b.clientPhone}\n`;
  text += `Дата: ${fmtDate(b.date)}\n`;
  text += `Время: ${b.startTime}–${b.endTime}\n`;
  if (b.comment) text += `Комментарий: ${b.comment}\n`;
  return text;
}

function formatRequestNotification(bizName: string, r: BookingRequest): string {
  let text = `📋 Новая заявка на бронирование\n\n`;
  text += `Заведение: ${bizName}\n`;
  text += `Клиент: ${r.clientName}\n`;
  text += `Телефон: ${r.clientPhone}\n`;
  text += `Дата: ${fmtDate(r.preferredDate)}\n`;
  text += `Время: ${r.preferredStartTime}–${r.preferredEndTime}\n`;
  if (r.description) text += `Описание: ${r.description}\n`;
  return text;
}

function notifyByEmail(ownerChatId: string, subject: string, text: string): void {
  const user = getAdminUserByOwnerChatId(ownerChatId);
  if (!user?.email) return;
  sendOwnerEmail(user.email, subject, text);
}

function notifyTelegram(chatId: number, text: string, requestId: number): void {
  const bot = getBot();
  if (!bot) return;

  bot.telegram.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Подтвердить', callback_data: `approve_request:${requestId}` },
          { text: '❌ Отклонить', callback_data: `reject_request:${requestId}` },
        ],
      ],
    },
  }).catch((err) => console.error('[booking-notify] TG error:', err.message));
}

function sendTelegramText(chatId: number, text: string): void {
  const bot = getBot();
  if (!bot) return;
  bot.telegram.sendMessage(chatId, text)
    .catch((err) => console.error('[booking-notify] TG error:', err.message));
}

function notifyVk(peerId: number, text: string, requestId: number): void {
  const vk = getVkBot();
  if (!vk) return;

  const keyboard = buildKeyboard([[
    { label: '✅ Подтвердить', action: `approve_request:${requestId}` },
    { label: '❌ Отклонить', action: `reject_request:${requestId}` },
  ]]);

  vk.api.messages.send({
    peer_id: peerId,
    message: text,
    random_id: Math.floor(Math.random() * 1e9),
    keyboard,
  }).catch((err: Error) => console.error('[booking-notify] VK error:', err.message));
}

function sendVkText(peerId: number, text: string): void {
  const vk = getVkBot();
  if (!vk) return;
  vk.api.messages.send({
    peer_id: peerId,
    message: text,
    random_id: Math.floor(Math.random() * 1e9),
  }).catch((err: Error) => console.error('[booking-notify] VK error:', err.message));
}
