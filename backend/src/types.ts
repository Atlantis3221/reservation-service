// ---- Бизнесы (мультитенант) ----

export interface Business {
  id: number;
  slug: string;
  name: string;
  ownerChatId: string;
  telegramUsername: string | null;
  createdAt: string;
}

// ---- Расписание (управляется владельцем бани) ----

export type SlotStatus = 'available' | 'booked' | 'blocked';

export interface TimeSlot {
  /** ISO datetime строка (2026-03-15T14:00:00) */
  datetime: string;
  /** Длительность в часах (всегда 1) */
  duration: number;
  status: SlotStatus;
  /** Кем/чем занято (если booked/blocked) */
  note?: string;
  /** Имя клиента (не показывается на фронтенде) */
  clientName?: string;
}
