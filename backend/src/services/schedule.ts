import type { TimeSlot, SlotStatus } from '../types';
import { getDb } from './db';

// ---- Helpers ----

function rowToSlot(row: any): TimeSlot {
  return {
    datetime: `${row.date_key}T${String(row.hour).padStart(2, '0')}:00:00`,
    duration: 1,
    status: row.status as SlotStatus,
    note: row.note ?? undefined,
    clientName: row.client_name ?? undefined,
  };
}

function toDateKeyFromISO(iso: string): string {
  return iso.split('T')[0];
}

function extractHour(datetime: string): number {
  return Number(datetime.split('T')[1].split(':')[0]);
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---- Public API ----

export function getSlotsForDate(businessId: number, dateKey: string): TimeSlot[] {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY hour')
    .all(businessId, dateKey);
  return rows.map(rowToSlot);
}

export function getAvailableDateKeys(businessId: number): string[] {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date_key FROM slots
       WHERE business_id = ?
         AND status = 'available'
         AND (date_key || 'T' || printf('%02d', hour) || ':00:00') > ?
       ORDER BY date_key`
    )
    .all(businessId, now) as { date_key: string }[];
  return rows.map((r) => r.date_key);
}

export function getSlotsForDateFull(businessId: number, dateKey: string): Array<{
  datetime: string;
  duration: number;
  status: SlotStatus;
  note?: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? ORDER BY hour')
    .all(businessId, dateKey);
  return rows.map((row: any) => ({
    datetime: `${row.date_key}T${String(row.hour).padStart(2, '0')}:00:00`,
    duration: 1,
    status: row.status as SlotStatus,
    note: row.note ?? undefined,
  }));
}

export function getAllSlots(businessId: number): Array<{ dateKey: string; slots: TimeSlot[] }> {
  const rows = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? ORDER BY date_key, hour')
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

export function addSlot(
  businessId: number,
  datetime: string,
  duration: number = 1,
  status: SlotStatus = 'available',
  note?: string
): TimeSlot {
  const dateKey = toDateKeyFromISO(datetime);
  const hour = extractHour(datetime);

  getDb()
    .prepare(
      `INSERT INTO slots (business_id, date_key, hour, status, note)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(business_id, date_key, hour) DO UPDATE SET
         status = excluded.status,
         note = excluded.note`
    )
    .run(businessId, dateKey, hour, status, note ?? null);

  return { datetime, duration: 1, status, note };
}

export function removeSlot(businessId: number, datetime: string): boolean {
  const dateKey = toDateKeyFromISO(datetime);
  const hour = extractHour(datetime);

  const result = getDb()
    .prepare('DELETE FROM slots WHERE business_id = ? AND date_key = ? AND hour = ?')
    .run(businessId, dateKey, hour);

  return result.changes > 0;
}

export function setSlotStatus(
  businessId: number,
  datetime: string,
  status: SlotStatus,
  note?: string,
  clientName?: string
): TimeSlot | null {
  const dateKey = toDateKeyFromISO(datetime);
  const hour = extractHour(datetime);

  const setClauses = ['status = ?'];
  const params: any[] = [status];

  if (note !== undefined) {
    setClauses.push('note = ?');
    params.push(note);
  }
  if (clientName !== undefined) {
    setClauses.push('client_name = ?');
    params.push(clientName);
  }

  params.push(businessId, dateKey, hour);

  const result = getDb()
    .prepare(`UPDATE slots SET ${setClauses.join(', ')} WHERE business_id = ? AND date_key = ? AND hour = ?`)
    .run(...params);

  if (result.changes === 0) return null;

  const row = getDb()
    .prepare('SELECT * FROM slots WHERE business_id = ? AND date_key = ? AND hour = ?')
    .get(businessId, dateKey, hour);

  return row ? rowToSlot(row) : null;
}

export function addDaySlots(businessId: number, dateKey: string, startHour: number, endHour: number): TimeSlot[] {
  const added: TimeSlot[] = [];
  const insert = getDb().prepare(
    `INSERT INTO slots (business_id, date_key, hour, status)
     VALUES (?, ?, ?, 'available')
     ON CONFLICT(business_id, date_key, hour) DO NOTHING`
  );

  const tx = getDb().transaction(() => {
    for (let h = startHour; h < endHour; h++) {
      insert.run(businessId, dateKey, h);
      const dt = `${dateKey}T${String(h).padStart(2, '0')}:00:00`;
      added.push({ datetime: dt, duration: 1, status: 'available' });
    }
  });

  tx();
  return added;
}

export function bookRange(
  businessId: number,
  dateKey: string,
  startHour: number,
  hours: number,
  note?: string,
  clientName?: string
): number {
  let count = 0;
  const tx = getDb().transaction(() => {
    for (let h = startHour; h < startHour + hours; h++) {
      const dt = `${dateKey}T${String(h).padStart(2, '0')}:00:00`;
      const slot = setSlotStatus(businessId, dt, 'booked', note, clientName);
      if (slot) count++;
    }
  });
  tx();
  return count;
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

export function getStats(businessId: number): { total: number; available: number; booked: number; blocked: number } {
  const now = new Date().toISOString();
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM slots
       WHERE business_id = ?
         AND (date_key || 'T' || printf('%02d', hour) || ':00:00') > ?
       GROUP BY status`
    )
    .all(businessId, now) as { status: string; cnt: number }[];

  let total = 0, available = 0, booked = 0, blocked = 0;
  for (const row of rows) {
    total += row.cnt;
    if (row.status === 'available') available = row.cnt;
    else if (row.status === 'booked') booked = row.cnt;
    else if (row.status === 'blocked') blocked = row.cnt;
  }

  return { total, available, booked, blocked };
}
