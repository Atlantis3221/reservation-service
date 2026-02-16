import type { Schedule, TimeSlot, SlotStatus } from '../types';

/**
 * In-memory хранилище расписания.
 * Администратор управляет им через Telegram-бота.
 * Фронтенд читает через GET /api/available-slots.
 */

const schedule: Schedule = new Map();

// ---- Helpers ----

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateKeyFromISO(iso: string): string {
  return iso.split('T')[0];
}

// ---- Public API ----

/** Получить все слоты на конкретную дату */
export function getSlotsForDate(dateKey: string): TimeSlot[] {
  return schedule.get(dateKey) || [];
}

/** Получить все свободные даты (dateKey[]) для месячной сетки */
export function getAvailableDateKeys(): string[] {
  const now = new Date();
  const result = new Set<string>();

  for (const [dateKey, slots] of schedule) {
    for (const slot of slots) {
      if (slot.status === 'available' && new Date(slot.datetime) > now) {
        result.add(dateKey);
        break;
      }
    }
  }

  return [...result].sort();
}

/** Получить все слоты на дату (для фронтенда — включая booked/blocked) */
export function getSlotsForDateFull(dateKey: string): Array<{
  datetime: string;
  duration: number;
  status: SlotStatus;
  note?: string;
}> {
  const slots = schedule.get(dateKey) || [];
  return slots.map((s) => ({
    datetime: s.datetime,
    duration: s.duration,
    status: s.status,
    note: s.note,
  }));
}

/** Получить все слоты всех дат (для админки) */
export function getAllSlots(): Array<{ dateKey: string; slots: TimeSlot[] }> {
  const result: Array<{ dateKey: string; slots: TimeSlot[] }> = [];

  for (const [dateKey, slots] of schedule) {
    result.push({ dateKey, slots: [...slots] });
  }

  return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Добавить один слот */
export function addSlot(
  datetime: string,
  duration: number = 1,
  status: SlotStatus = 'available',
  note?: string
): TimeSlot {
  const dateKey = toDateKeyFromISO(datetime);
  const slots = schedule.get(dateKey) || [];

  const existing = slots.find((s) => s.datetime === datetime);
  if (existing) {
    existing.status = status;
    existing.duration = duration;
    if (note !== undefined) existing.note = note;
    return existing;
  }

  const slot: TimeSlot = { datetime, duration, status, note };
  slots.push(slot);
  slots.sort((a, b) => a.datetime.localeCompare(b.datetime));
  schedule.set(dateKey, slots);
  return slot;
}

/** Удалить слот */
export function removeSlot(datetime: string): boolean {
  const dateKey = toDateKeyFromISO(datetime);
  const slots = schedule.get(dateKey);
  if (!slots) return false;

  const idx = slots.findIndex((s) => s.datetime === datetime);
  if (idx === -1) return false;

  slots.splice(idx, 1);
  if (slots.length === 0) schedule.delete(dateKey);
  return true;
}

/** Изменить статус слота */
export function setSlotStatus(datetime: string, status: SlotStatus, note?: string): TimeSlot | null {
  const dateKey = toDateKeyFromISO(datetime);
  const slots = schedule.get(dateKey);
  if (!slots) return null;

  const slot = slots.find((s) => s.datetime === datetime);
  if (!slot) return null;

  slot.status = status;
  if (note !== undefined) slot.note = note;
  return slot;
}

/** Массово добавить часовые слоты на дату (с startHour до endHour) */
export function addDaySlots(dateKey: string, startHour: number, endHour: number): TimeSlot[] {
  const added: TimeSlot[] = [];
  for (let h = startHour; h < endHour; h++) {
    // Локальное время (без Z), чтобы часы совпадали с регионом сервера/браузера
    const dt = `${dateKey}T${String(h).padStart(2, '0')}:00:00`;
    added.push(addSlot(dt, 1));
  }
  return added;
}

/** Забронировать диапазон часов (пометить как booked) */
export function bookRange(dateKey: string, startHour: number, hours: number, note?: string): number {
  let count = 0;
  for (let h = startHour; h < startHour + hours; h++) {
    const dt = `${dateKey}T${String(h).padStart(2, '0')}:00:00`;
    const slot = setSlotStatus(dt, 'booked', note);
    if (slot) count++;
  }
  return count;
}

/** Удалить все слоты на дату */
export function clearDay(dateKey: string): number {
  const slots = schedule.get(dateKey);
  if (!slots) return 0;
  const count = slots.length;
  schedule.delete(dateKey);
  return count;
}

/** Получить ближайшие N дней с расписанием */
export function getScheduledDays(limit = 14): string[] {
  const today = toDateKey(new Date());
  return [...schedule.keys()]
    .filter((k) => k >= today)
    .sort()
    .slice(0, limit);
}

/** Статистика */
export function getStats(): { total: number; available: number; booked: number; blocked: number } {
  let total = 0, available = 0, booked = 0, blocked = 0;
  const now = new Date();

  for (const [, slots] of schedule) {
    for (const s of slots) {
      if (new Date(s.datetime) < now) continue;
      total++;
      if (s.status === 'available') available++;
      else if (s.status === 'booked') booked++;
      else if (s.status === 'blocked') blocked++;
    }
  }

  return { total, available, booked, blocked };
}
