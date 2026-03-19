import { getBot } from '../bot/index';
import { getVkBot } from '../vk-bot/index';
import { fmtDate } from '../utils/date';
import type { Business, BookingRequest } from '../types';
import { buildKeyboard } from '../vk-bot/keyboard';

export function notifyBookingRequest(biz: Business, request: BookingRequest): void {
  const text = formatRequestNotification(biz.name, request);
  const ownerChatId = biz.ownerChatId;
  if (!ownerChatId) return;

  if (ownerChatId.startsWith('vk:')) {
    notifyVk(Number(ownerChatId.slice(3)), text, request.id);
  } else {
    notifyTelegram(Number(ownerChatId), text, request.id);
  }
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
