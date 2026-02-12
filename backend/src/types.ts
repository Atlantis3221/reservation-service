// ---- Бронирования ----

export interface Reservation {
  id: number;
  name: string;
  date: string;
  guests: number;
  comment: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
}

export interface CreateReservationBody {
  name: string;
  date: string;
  guests?: number;
  comment?: string;
}

// ---- Расписание (управляется администратором) ----

export type SlotStatus = 'available' | 'booked' | 'blocked';

export interface TimeSlot {
  /** ISO datetime строка (2026-03-15T14:00:00.000Z) */
  datetime: string;
  status: SlotStatus;
  /** Кем/чем занято (если booked/blocked) */
  note?: string;
}

/**
 * Расписание хранится как Map<dateKey, TimeSlot[]>
 * dateKey = "2026-03-15"
 */
export type Schedule = Map<string, TimeSlot[]>;
