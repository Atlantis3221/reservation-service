import { getDb } from '../services/db';
import type { BookingRequest, BookingRequestStatus } from '../types';

function rowToBookingRequest(row: any): BookingRequest {
  return {
    id: row.id,
    businessId: row.business_id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    description: row.description ?? null,
    preferredDate: row.preferred_date,
    preferredStartTime: row.preferred_time,
    preferredEndTime: row.preferred_end_time ?? row.preferred_time,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBookingRequest(
  businessId: number,
  clientName: string,
  clientPhone: string,
  preferredDate: string,
  preferredStartTime: string,
  preferredEndTime: string,
  description?: string,
): BookingRequest {
  const result = getDb()
    .prepare(
      `INSERT INTO booking_requests (business_id, client_name, client_phone, description, preferred_date, preferred_time, preferred_end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(businessId, clientName, clientPhone, description ?? null, preferredDate, preferredStartTime, preferredEndTime);

  return getBookingRequestById(result.lastInsertRowid as number)!;
}

export function getBookingRequestById(id: number): BookingRequest | null {
  const row = getDb()
    .prepare('SELECT * FROM booking_requests WHERE id = ?')
    .get(id);
  return row ? rowToBookingRequest(row) : null;
}

export function getBookingRequestsByBusiness(
  businessId: number,
  status?: BookingRequestStatus,
): BookingRequest[] {
  if (status) {
    const rows = getDb()
      .prepare('SELECT * FROM booking_requests WHERE business_id = ? AND status = ? ORDER BY created_at DESC')
      .all(businessId, status);
    return rows.map(rowToBookingRequest);
  }
  const rows = getDb()
    .prepare('SELECT * FROM booking_requests WHERE business_id = ? ORDER BY created_at DESC')
    .all(businessId);
  return rows.map(rowToBookingRequest);
}

export function getBookingRequestsByDate(
  businessId: number,
  date: string,
): BookingRequest[] {
  const rows = getDb()
    .prepare("SELECT * FROM booking_requests WHERE business_id = ? AND preferred_date = ? AND status IN ('pending', 'approved') ORDER BY preferred_time")
    .all(businessId, date);
  return rows.map(rowToBookingRequest);
}

export function updateBookingRequestStatus(id: number, status: BookingRequestStatus): boolean {
  const result = getDb()
    .prepare("UPDATE booking_requests SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, id);
  return result.changes > 0;
}

export function updateBookingRequestDateTime(
  id: number,
  preferredDate: string,
  preferredStartTime: string,
  preferredEndTime: string,
): boolean {
  const result = getDb()
    .prepare("UPDATE booking_requests SET preferred_date = ?, preferred_time = ?, preferred_end_time = ?, updated_at = datetime('now') WHERE id = ?")
    .run(preferredDate, preferredStartTime, preferredEndTime, id);
  return result.changes > 0;
}

export function countPendingRequests(businessId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as cnt FROM booking_requests WHERE business_id = ? AND status = 'pending'")
    .get(businessId) as any;
  return row?.cnt ?? 0;
}
