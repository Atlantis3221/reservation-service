import { Telegraf, Markup } from 'telegraf';
import {
  addDaySlots,
  clearDay,
  getScheduledDays,
  getSlotsForDate,
  getStats,
  removeSlot,
  setSlotStatus,
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
  // Если ADMIN_CHAT_ID не задан — первый пользователь считается админом (для демо)
  if (!adminId) return true;
  return chatId === adminId;
}

// ---- Форматирование ----

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function fmtDate(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const wd = WEEKDAYS_SHORT[d.getDay()];
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} (${wd})`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function statusEmoji(status: SlotStatus): string {
  if (status === 'available') return '🟢';
  if (status === 'booked') return '🔴';
  return '⛔';
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  //   /start — сразу открываем админку
  // ====================
  bot.start((ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ Этот бот только для администратора.');
    }
    return sendAdminMenu(ctx);
  });

  // ====================
  //   /admin — главное меню админки
  // ====================
  bot.command('admin', (ctx) => {
    if (!isAdmin(ctx.chat.id)) {
      return ctx.reply('⛔ У вас нет доступа к админке.');
    }
    return sendAdminMenu(ctx);
  });

  function sendAdminMenu(ctx: any) {
    const stats = getStats();
    const text =
      `🔧 *Панель администратора*\n\n` +
      `📊 Статистика:\n` +
      `• Всего слотов: ${stats.total}\n` +
      `• 🟢 Свободно: ${stats.available}\n` +
      `• 🔴 Забронировано: ${stats.booked}\n` +
      `• ⛔ Заблокировано: ${stats.blocked}`;

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📅 Расписание', 'schedule_list')],
        [Markup.button.callback('➕ Добавить день', 'schedule_add_day')],
        [Markup.button.callback('📋 Шаблон на неделю', 'schedule_week_template')],
        [Markup.button.callback('🔄 Обновить', 'admin_refresh')],
      ]),
    });
  }

  // ====================
  //   Callback queries (inline-кнопки)
  // ====================

  // Обновить меню
  bot.action('admin_refresh', (ctx) => {
    ctx.answerCbQuery('Обновлено');
    return sendAdminMenu(ctx);
  });

  // ---- Просмотр расписания ----
  bot.action('schedule_list', (ctx) => {
    ctx.answerCbQuery();
    const days = getScheduledDays(14);

    if (days.length === 0) {
      return ctx.reply(
        '📅 Расписание пусто.\n\nДобавьте слоты через кнопку «Добавить день» или «Шаблон на неделю».',
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Назад', 'admin_refresh')],
        ])
      );
    }

    const buttons = days.map((dateKey) => {
      const slots = getSlotsForDate(dateKey);
      const avail = slots.filter((s) => s.status === 'available').length;
      const total = slots.length;
      return [Markup.button.callback(
        `${fmtDate(dateKey)} — ${avail}/${total} свободно`,
        `day_${dateKey}`
      )];
    });

    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_refresh')]);

    return ctx.reply('📅 *Расписание по дням:*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ---- Просмотр дня ----
  bot.action(/^day_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    ctx.answerCbQuery();
    const dateKey = ctx.match[1];
    return sendDayView(ctx, dateKey);
  });

  function sendDayView(ctx: any, dateKey: string) {
    const slots = getSlotsForDate(dateKey);

    if (slots.length === 0) {
      return ctx.reply(
        `📅 ${fmtDate(dateKey)} — слотов нет.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('➕ Добавить слоты', `add_slots_${dateKey}`)],
          [Markup.button.callback('⬅️ К списку', 'schedule_list')],
        ])
      );
    }

    let text = `📅 *${fmtDate(dateKey)}*\n\n`;
    for (const slot of slots) {
      const note = slot.note ? ` (${slot.note})` : '';
      text += `${statusEmoji(slot.status)} ${fmtTime(slot.datetime)} — ${slot.status}${note}\n`;
    }

    const slotButtons = slots.map((slot) => {
      const label = `${statusEmoji(slot.status)} ${fmtTime(slot.datetime)}`;
      return [Markup.button.callback(label, `slot_${slot.datetime}`)];
    });

    slotButtons.push([Markup.button.callback('➕ Добавить слоты', `add_slots_${dateKey}`)]);
    slotButtons.push([Markup.button.callback('🗑 Очистить день', `clear_day_${dateKey}`)]);
    slotButtons.push([Markup.button.callback('⬅️ К списку', 'schedule_list')]);

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(slotButtons),
    });
  }

  // ---- Управление конкретным слотом ----
  bot.action(/^slot_(.+)$/, (ctx) => {
    ctx.answerCbQuery();
    const datetime = ctx.match[1];
    const dateKey = datetime.split('T')[0];
    const slots = getSlotsForDate(dateKey);
    const slot = slots.find((s) => s.datetime === datetime);

    if (!slot) {
      return ctx.reply('Слот не найден.');
    }

    const note = slot.note ? `\nПримечание: ${slot.note}` : '';
    const text = `⏰ *${fmtDate(dateKey)} ${fmtTime(datetime)}*\n\nСтатус: ${statusEmoji(slot.status)} ${slot.status}${note}`;

    const buttons: any[][] = [];

    if (slot.status !== 'available') {
      buttons.push([Markup.button.callback('🟢 Сделать свободным', `set_available_${datetime}`)]);
    }
    if (slot.status !== 'booked') {
      buttons.push([Markup.button.callback('🔴 Отметить занятым', `set_booked_${datetime}`)]);
    }
    if (slot.status !== 'blocked') {
      buttons.push([Markup.button.callback('⛔ Заблокировать', `set_blocked_${datetime}`)]);
    }
    buttons.push([Markup.button.callback('🗑 Удалить слот', `del_slot_${datetime}`)]);
    buttons.push([Markup.button.callback('⬅️ К дню', `day_${dateKey}`)]);

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ---- Смена статуса ----
  bot.action(/^set_(available|booked|blocked)_(.+)$/, (ctx) => {
    const status = ctx.match[1] as SlotStatus;
    const datetime = ctx.match[2];
    setSlotStatus(datetime, status);
    ctx.answerCbQuery(`Статус → ${status}`);

    const dateKey = datetime.split('T')[0];
    return sendDayView(ctx, dateKey);
  });

  // ---- Удалить слот ----
  bot.action(/^del_slot_(.+)$/, (ctx) => {
    const datetime = ctx.match[1];
    removeSlot(datetime);
    ctx.answerCbQuery('Слот удалён');

    const dateKey = datetime.split('T')[0];
    return sendDayView(ctx, dateKey);
  });

  // ---- Очистить день ----
  bot.action(/^clear_day_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    const dateKey = ctx.match[1];
    const count = clearDay(dateKey);
    ctx.answerCbQuery(`Удалено ${count} слотов`);
    return sendDayView(ctx, dateKey);
  });

  // ---- Добавить слоты на конкретную дату ----
  bot.action(/^add_slots_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    ctx.answerCbQuery();
    const dateKey = ctx.match[1];
    const existing = getSlotsForDate(dateKey);
    const existingHours = new Set(existing.map((s) => new Date(s.datetime).getUTCHours()));

    // Предлагаем часы 10-22 с шагом 2, которых ещё нет
    const hours = [10, 12, 14, 16, 18, 20];
    const availableHours = hours.filter((h) => !existingHours.has(h));

    if (availableHours.length === 0) {
      return ctx.reply(
        `На ${fmtDate(dateKey)} все стандартные слоты уже добавлены.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ К дню', `day_${dateKey}`)],
        ])
      );
    }

    const buttons = availableHours.map((h) => {
      const label = `${String(h).padStart(2, '0')}:00`;
      return Markup.button.callback(label, `add_hour_${dateKey}_${h}`);
    });

    // Разбиваем по 3 в ряд
    const rows: any[][] = [];
    for (let i = 0; i < buttons.length; i += 3) {
      rows.push(buttons.slice(i, i + 3));
    }
    rows.push([Markup.button.callback('✅ Добавить все', `add_all_hours_${dateKey}`)]);
    rows.push([Markup.button.callback('⬅️ К дню', `day_${dateKey}`)]);

    return ctx.reply(
      `Выберите время для добавления на *${fmtDate(dateKey)}*:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(rows),
      }
    );
  });

  // Добавить один час
  bot.action(/^add_hour_(\d{4}-\d{2}-\d{2})_(\d+)$/, (ctx) => {
    const dateKey = ctx.match[1];
    const hour = Number(ctx.match[2]);
    addDaySlots(dateKey, [hour]);
    ctx.answerCbQuery(`Добавлено ${hour}:00`);
    return sendDayView(ctx, dateKey);
  });

  // Добавить все стандартные часы
  bot.action(/^add_all_hours_(\d{4}-\d{2}-\d{2})$/, (ctx) => {
    const dateKey = ctx.match[1];
    const existing = getSlotsForDate(dateKey);
    const existingHours = new Set(existing.map((s) => new Date(s.datetime).getUTCHours()));
    const hours = [10, 12, 14, 16, 18, 20].filter((h) => !existingHours.has(h));
    addDaySlots(dateKey, hours);
    ctx.answerCbQuery(`Добавлено ${hours.length} слотов`);
    return sendDayView(ctx, dateKey);
  });

  // ---- Добавить день (показать ближайшие 7 дней) ----
  bot.action('schedule_add_day', (ctx) => {
    ctx.answerCbQuery();
    const today = new Date();
    const buttons: any[][] = [];

    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateKey = toDateKey(d);
      const existing = getSlotsForDate(dateKey).length;
      const label = existing > 0
        ? `${fmtDate(dateKey)} (${existing} слотов)`
        : `${fmtDate(dateKey)} — пусто`;
      buttons.push([Markup.button.callback(label, `add_slots_${dateKey}`)]);
    }

    buttons.push([Markup.button.callback('⬅️ Назад', 'admin_refresh')]);

    return ctx.reply('📅 *Выберите дату для добавления слотов:*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  // ---- Шаблон на неделю ----
  bot.action('schedule_week_template', (ctx) => {
    ctx.answerCbQuery();
    const today = new Date();
    const standardHours = [10, 12, 14, 16, 18, 20];
    let totalAdded = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      // Пропускаем воскресенье
      if (d.getDay() === 0) continue;

      const dateKey = toDateKey(d);
      const existing = getSlotsForDate(dateKey);
      const existingHours = new Set(existing.map((s) => new Date(s.datetime).getUTCHours()));
      const hoursToAdd = standardHours.filter((h) => !existingHours.has(h));

      if (hoursToAdd.length > 0) {
        addDaySlots(dateKey, hoursToAdd);
        totalAdded += hoursToAdd.length;
      }
    }

    ctx.reply(
      `✅ Шаблон применён!\n\nДобавлено *${totalAdded}* слотов на ближайшие 7 дней.\n(10:00, 12:00, 14:00, 16:00, 18:00, 20:00, кроме воскресенья)`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📅 Расписание', 'schedule_list')],
          [Markup.button.callback('⬅️ Назад', 'admin_refresh')],
        ]),
      }
    );
  });

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
