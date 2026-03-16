// ---- Бизнесы (мультитенант) ----

export interface Business {
  id: number;
  slug: string;
  name: string;
  ownerChatId: string;
  telegramUsername: string | null;
  ownerPhone: string | null;
  createdAt: string;
}

// ---- Расписание (управляется владельцем бани) ----

export type SlotStatus = 'available' | 'booked' | 'blocked';

export interface TimeSlot {
  id: number;
  /** ISO datetime начала (2026-03-15T14:30:00) */
  startDatetime: string;
  /** ISO datetime конца (2026-03-15T16:00:00) */
  endDatetime: string;
  status: SlotStatus;
  /** Кем/чем занято (если booked/blocked) */
  note?: string;
  /** Имя клиента (не показывается на фронтенде) */
  clientName?: string;
}
