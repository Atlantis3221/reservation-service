// ---- Бизнесы (мультитенант) ----

export interface DayWorkingHours {
  enabled: boolean;
  start: string;
  end: string;
}

export type WorkingHoursConfig = Record<string, DayWorkingHours>;

export interface Business {
  id: number;
  slug: string;
  name: string;
  ownerChatId: string;
  telegramUsername: string | null;
  ownerPhone: string | null;
  bookingRequestsEnabled: boolean;
  workingHours: WorkingHoursConfig | null;
  /** Длительность одного сеанса в минутах — шаг сетки бронирования */
  slotDurationMinutes: number;
  createdAt: string;
}

// ---- Расписание (управляется владельцем бани) ----

export type SlotStatus = 'available' | 'booked' | 'blocked';

/** Свободный интервал, который клиент может забронировать одним нажатием */
export interface FreeSlot {
  /** HH:MM начала */
  startTime: string;
  /** HH:MM конца (может быть на следующий день) */
  endTime: string;
  /** true, если интервал заканчивается после полуночи */
  crossesMidnight: boolean;
  /** true, если бронируется весь день целиком (длительность сеанса — сутки) */
  fullDay?: boolean;
  /**
   * Абсолютные минуты от полуночи дня расписания. Для смен через полночь
   * могут быть больше 1440 (02:00 следующего дня — это 1560).
   * Отдаём готовыми, чтобы клиенту не пришлось повторять эту арифметику.
   */
  startMinutes: number;
  endMinutes: number;
}

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

// ---- Контактные ссылки ----

export type ContactLinkType = 'telegram' | 'vk' | 'max';

export interface ContactLink {
  type: ContactLinkType;
  url: string;
}

// ---- Заявки на бронирование ----

export type BookingRequestStatus = 'pending' | 'approved' | 'rejected';

export interface BookingRequest {
  id: number;
  businessId: number;
  clientName: string;
  clientPhone: string;
  description: string | null;
  preferredDate: string;
  preferredStartTime: string;
  preferredEndTime: string;
  status: BookingRequestStatus;
  createdAt: string;
  updatedAt: string;
}
