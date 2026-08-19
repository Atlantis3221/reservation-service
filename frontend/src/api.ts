const API_URL = import.meta.env.VITE_API_URL || '/api';

export interface ContactLink {
  type: 'telegram' | 'vk' | 'max';
  url: string;
}

export interface BusinessInfo {
  name: string;
  slug: string;
  telegramUsername: string | null;
  contactLinks: ContactLink[];
  bookingRequestsEnabled: boolean;
  slotDurationMinutes: number;
}

export interface FreeSlot {
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
}

export interface DaySlot {
  id: number;
  startDatetime: string;
  endDatetime: string;
  status: 'available' | 'booked' | 'blocked';
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    });
  } catch {
    throw new ApiError('Нет соединения. Проверьте интернет.', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as any).error || 'Что-то пошло не так', res.status);
  }
  return data as T;
}

export interface BookingPayload {
  date: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientPhone: string;
  comment?: string;
  consent: true;
}

export interface RequestPayload {
  preferredDate: string;
  preferredStartTime: string;
  preferredEndTime: string;
  clientName: string;
  clientPhone: string;
  description?: string;
  consent: true;
}

export const publicApi = {
  getBusiness: (slug: string) => request<BusinessInfo>(`/business/${slug}`),

  getAvailableDates: (slug: string) =>
    request<{ dates: string[] }>(`/business/${slug}/available-dates`).then((r) => r.dates || []),

  getDaySlots: (slug: string, date: string) =>
    request<{ slots: DaySlot[] }>(`/business/${slug}/day-slots?date=${date}`).then((r) => r.slots || []),

  getFreeSlots: (slug: string, date: string) =>
    request<{ slots: FreeSlot[] }>(`/business/${slug}/free-slots?date=${date}`).then((r) => r.slots || []),

  book: (slug: string, payload: BookingPayload) =>
    request<{ ok: boolean; id: number }>(`/business/${slug}/book`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createRequest: (slug: string, payload: RequestPayload) =>
    request<{ ok: boolean; id: number }>(`/business/${slug}/booking-requests`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
