import type { TimeSlot } from '../types';
import { fmtDate } from '../utils/date';

export function formatDayScheduleText(dateKey: string, slots: TimeSlot[], frontendUrl?: string): string {
  let text = `📅 Расписание на ${fmtDate(dateKey)}:\n\n`;

  for (const slot of slots) {
    const startTime = slot.startDatetime.split('T')[1].substring(0, 5);
    const endTime = slot.endDatetime.split('T')[1].substring(0, 5);
    const emoji = slot.status === 'available' ? '🟢' : slot.status === 'booked' ? '🔴' : '⛔';
    const note = slot.note ? ` — ${slot.note}` : '';
    const client = slot.clientName ? ` (${slot.clientName})` : '';
    text += `${emoji} ${startTime}–${endTime}${note}${client}\n`;
  }

  if (frontendUrl) {
    text += `\n🔗 ${frontendUrl}?date=${dateKey}`;
  }

  return text;
}

export function formatStatsText(
  stats: { total: number; available: number; booked: number; blocked: number },
  daySlots: Array<{ dateKey: string; available: number; booked: number }>,
): string {
  let text = `📊 *Статистика:*\n\n`;
  text += `• Всего слотов: ${stats.total}\n`;
  text += `• 🟢 Свободно: ${stats.available}\n`;
  text += `• 🔴 Забронировано: ${stats.booked}\n`;
  text += `• ⛔ Заблокировано: ${stats.blocked}\n\n`;

  if (daySlots.length === 0) {
    text += `Расписание пусто. Создайте расписание командой:\n"на этой неделе с пн по пт с 12 до 23, с пт по вс с 12 до 03"`;
  } else {
    text += `📅 *Ближайшие дни:*\n\n`;
    for (const { dateKey, available, booked } of daySlots) {
      text += `${fmtDate(dateKey)} — 🟢 ${available} / 🔴 ${booked}\n`;
    }
  }

  return text;
}

export function formatScheduleCreated(weekLabel: string, daysInfo: Map<string, string>): string {
  let text = `✅ Расписание создано на ${weekLabel} неделю!\n\n`;

  const sortedDays = [...daysInfo.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dateKey, timeRange] of sortedDays) {
    text += `${fmtDate(dateKey)} — ${timeRange}\n`;
  }

  return text;
}

export function formatBookingConfirmation(
  dateKey: string,
  startTime: string,
  endTime: string,
  clientName?: string,
  frontendUrl?: string,
): string {
  let text =
    `✅ Бронь создана!\n\n` +
    `Дата: ${fmtDate(dateKey)}\n` +
    `Время: ${startTime} – ${endTime}`;

  if (clientName) {
    text += `\nКлиент: ${clientName}`;
  }

  if (frontendUrl) {
    text += `\n\n🔗 ${frontendUrl}?date=${dateKey}`;
  }

  return text;
}
