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

/** Получить все свободные слоты (для фронтенда) */
export function getAvailableSlots(): string[] {
  const now = new Date();
  const result: string[] = [];

  for (const [, slots] of schedule) {
    for (const slot of slots) {
      if (slot.status === 'available' && new Date(slot.datetime) > now) {
        result.push(slot.datetime);
      }
    }
  }

  return result.sort();
}

/** Получить все слоты всех дат (для админки) */
export function getAllSlots(): Array<{ dateKey: string; slots: TimeSlot[] }> {
  const result: Array<{ dateKey: string; slots: TimeSlot[] }> = [];

  for (const [dateKey, slots] of schedule) {
    result.push({ dateKey, slots: [...slots] });
  }

  return result.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/** Добавить слот */
export function addSlot(datetime: string, status: SlotStatus = 'available', note?: string): TimeSlot {
  const dateKey = toDateKeyFromISO(datetime);
  const slots = schedule.get(dateKey) || [];

  // Проверяем дубликат
  const existing = slots.find((s) => s.datetime === datetime);
  if (existing) {
    existing.status = status;
    if (note !== undefined) existing.note = note;
    return existing;
  }

  const slot: TimeSlot = { datetime, status, note };
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

/** Массово добавить слоты на дату (часы) */
export function addDaySlots(dateKey: string, hours: number[]): TimeSlot[] {
  const added: TimeSlot[] = [];
  for (const hour of hours) {
    const dt = `${dateKey}T${String(hour).padStart(2, '0')}:00:00.000Z`;
    added.push(addSlot(dt));
  }
  return added;
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
