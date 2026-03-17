import type { TimeSlot, SlotStatus } from '../types';
import { getDb } from '../services/db';
import { pad2, toDateKey, nextDateKey } from '../utils/date';

function rowToSlot(row: any): TimeSlot {
  const crossesMidnight = row.end_time < row.start_time;
  const endDateKey = crossesMidnight ? nextDateKey(row.date_key) : row.date_key;
  return {
    id: row.id,
    startDatetime: `${row.date_key}T${row.start_time}:00`,
    endDatetime: `${endDateKey}T${row.end_time}:00`,
    status: row.status as SlotStatus,
    note: row.note ?? undefined,
    clientName: row.client_name ?? undefined,
  };
}

export function getSlotsForDate(businessId: number, dateKey: string): TimeSlot[] {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY start_time')
    .all(businessId, dateKey);
  return rows.map(rowToSlot);
}

export function getAvailableDateKeys(businessId: number): string[] {
  const now = new Date();
  const nowKey = toDateKey(now);
  const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ?
         AND status = 'available'
         AND (date_key > ? OR (date_key = ? AND end_time > ?))
       ORDER BY date_key`
    )
    .all(businessId, nowKey, nowKey, nowTime) as { date_key: string }[];
  return rows.map((r) => r.date_key);
}

export function getSlotsForDateFull(businessId: number, dateKey: string): Array<{
  id: number;
  startDatetime: string;
  endDatetime: string;
  status: SlotStatus;
  note?: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY start_time')
    .all(businessId, dateKey);
  return rows.map((row: any) => {
    const crossesMidnight = row.end_time < row.start_time;
    const endDK = crossesMidnight ? nextDateKey(row.date_key) : row.date_key;
    return {
      id: row.id,
      startDatetime: `${row.date_key}T${row.start_time}:00`,
      endDatetime: `${endDK}T${row.end_time}:00`,
      status: row.status as SlotStatus,
      note: row.note ?? undefined,
    };
  });
}

export function getAllSlots(businessId: number): Array<{ dateKey: string; slots: TimeSlot[] }> {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? ORDER BY date_key, start_time')
    .all(businessId);

  const grouped = new Map<string, TimeSlot[]>();
  for (const row of rows) {
    const slot = rowToSlot(row);
    const dk = (row as any).date_key;
    if (!grouped.has(dk)) grouped.set(dk, []);
    grouped.get(dk)!.push(slot);
  }

  return [...grouped.entries()]
    .map(([dateKey, slots]) => ({ dateKey, slots }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function addDaySlots(businessId: number, dateKey: string, startHour: number, endHour: number): TimeSlot[] {
  const startTime = `${pad2(startHour)}:00`;
  const endTime = endHour === 24 ? '00:00' : `${pad2(endHour)}:00`;

  const result = getDb()
    .prepare(
      `INSERT INTO slots (business_id, date_key, start_time, end_time, status)
       VALUES (?, ?, ?, ?, 'available')`
    )
    .run(businessId, dateKey, startTime, endTime);

  const id = Number(result.lastInsertRowid);
  const crossesMidnight = endTime < startTime;
  const endDK = crossesMidnight ? nextDateKey(dateKey) : dateKey;

  return [{
    id,
    startDatetime: `${dateKey}T${startTime}:00`,
    endDatetime: `${endDK}T${endTime}:00`,
    status: 'available',
  }];
}

export function findOverlappingBookings(
  businessId: number,
  dateKey: string,
  startTime: string,
  endTime: string,
): Array<{ id: number; startTime: string; endTime: string; clientName?: string }> {
  const rows = getDb()
    .prepare(
      `SELECT id, start_time, end_time, client_name FROM slots
       WHERE business_id = ? AND date_key = ? AND status = 'booked'
         AND start_time < ? AND end_time > ?`
    )
    .all(businessId, dateKey, endTime, startTime) as any[];

  return rows.map((r) => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    clientName: r.client_name ?? undefined,
  }));
}

export function bookRange(
  businessId: number,
  dateKey: string,
  startTime: string,
  endTime: string,
  note?: string,
  clientName?: string,
  clientPhone?: string,
): { id: number; count: number } {
  const result = getDb()
    .prepare(
      `INSERT INTO slots (business_id, date_key, start_time, end_time, status, note, client_name, client_phone)
       VALUES (?, ?, ?, ?, 'booked', ?, ?, ?)`
    )
    .run(businessId, dateKey, startTime, endTime, note ?? null, clientName ?? null, clientPhone ?? null);

  return { id: Number(result.lastInsertRowid), count: 1 };
}

export function cancelBookingById(slotId: number): {
  cancelled: number;
  clientName?: string;
  dateKey?: string;
  startTime?: string;
  endTime?: string;
} {
  const row = getDb()
    .prepare("SELECT * FROM slots WHERE id = ? AND status = 'booked'")
    .get(slotId) as any;

  if (!row) return { cancelled: 0 };

  getDb().prepare('DELETE FROM slots WHERE id = ?').run(slotId);

  return {
    cancelled: 1,
    clientName: row.client_name ?? undefined,
    dateKey: row.date_key,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

export function cancelBooking(
  businessId: number,
  dateKey: string,
  startTime: string,
): { cancelled: number; clientName?: string } {
  const row = getDb()
    .prepare(
      "SELECT * FROM slots WHERE business_id = ? AND date_key = ? AND start_time = ? AND status = 'booked'"
    )
    .get(businessId, dateKey, startTime) as any;

  if (!row) return { cancelled: 0 };

  getDb().prepare('DELETE FROM slots WHERE id = ?').run(row.id);

  return {
    cancelled: 1,
    clientName: row.client_name ?? undefined,
  };
}

export function clearDay(businessId: number, dateKey: string): number {
  const result = getDb()
    .prepare('DELETE FROM slots WHERE business_id = ? AND date_key = ?')
    .run(businessId, dateKey);
  return result.changes;
}

export function getScheduledDays(businessId: number, limit = 14): string[] {
  const today = toDateKey(new Date());
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ? AND date_key >= ?
       ORDER BY date_key
       LIMIT ?`
    )
    .all(businessId, today, limit) as { date_key: string }[];
  return rows.map((r) => r.date_key);
}

export function getSlotsForDateAdmin(businessId: number, dateKey: string): Array<{
  id: number;
  startDatetime: string;
  endDatetime: string;
  status: SlotStatus;
  note?: string;
  clientName?: string;
  clientPhone?: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY start_time')
    .all(businessId, dateKey);
  return rows.map((row: any) => {
    const crossesMidnight = row.end_time < row.start_time;
    const endDK = crossesMidnight ? nextDateKey(row.date_key) : row.date_key;
    return {
      id: row.id,
      startDatetime: `${row.date_key}T${row.start_time}:00`,
      endDatetime: `${endDK}T${row.end_time}:00`,
      status: row.status as SlotStatus,
      note: row.note ?? undefined,
      clientName: row.client_name ?? undefined,
      clientPhone: row.client_phone ?? undefined,
    };
  });
}

export function getAllDateKeys(businessId: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ?
       ORDER BY date_key`
    )
    .all(businessId) as { date_key: string }[];
  return rows.map((r) => r.date_key);
}

export function getSlotBusinessId(slotId: number): number | null {
  const row = getDb()
    .prepare('SELECT business_id FROM slots WHERE id = ?')
    .get(slotId) as any;
  return row ? row.business_id : null;
}

export function getStats(businessId: number): { total: number; available: number; booked: number; blocked: number } {
  const now = new Date();
  const nowKey = toDateKey(now);
  const nowTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM slots
       WHERE business_id = ?
         AND (date_key > ? OR (date_key = ? AND end_time > ?))
       GROUP BY status`
    )
    .all(businessId, nowKey, nowKey, nowTime) as { status: string; cnt: number }[];

  let total = 0, available = 0, booked = 0, blocked = 0;
  for (const row of rows) {
    total += row.cnt;
    if (row.status === 'available') available = row.cnt;
    else if (row.status === 'booked') booked = row.cnt;
    else if (row.status === 'blocked') blocked = row.cnt;
  }

  return { total, available, booked, blocked };
}
