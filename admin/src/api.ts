const API_BASE = import.meta.env.VITE_API_URL || '/admin';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('Нет соединения с сервером');
  }

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      res.status === 502 || res.status === 503
        ? 'Сервер временно недоступен'
        : `Ошибка сервера (${res.status})`,
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка сервера');
  }
  return data;
}

export interface AuthResult {
  token: string;
  user: { id: number; email: string; ownerChatId: string | null };
}

export interface Business {
  id: number;
  slug: string;
  name: string;
  ownerChatId: string;
}

export interface CommandButton {
  label: string;
  action: string;
}

export interface CommandMessage {
  text: string;
  buttons?: CommandButton[];
}

export interface CommandResult {
  messages: CommandMessage[];
}

export interface InitResult extends CommandResult {
  businesses: Business[];
}

export interface CommandInfo {
  command: string;
  description: string;
}

export interface CommandCategory {
  category: string;
  commands: CommandInfo[];
}

export interface CalendarSlot {
  id: number;
  startDatetime: string;
  endDatetime: string;
  status: 'available' | 'booked' | 'blocked';
  note?: string;
  clientName?: string;
  clientPhone?: string;
}

export const api = {
  register: (email: string, password: string) =>
    request<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  getMe: () =>
    request<{ user: AuthResult['user']; businesses: Business[] }>('/me'),

  getCommands: () =>
    request<{ commands: CommandCategory[] }>('/commands'),

  init: () =>
    request<InitResult>('/init', { method: 'POST' }),

  sendCommand: (text: string, businessId?: number) =>
    request<CommandResult>('/command', {
      method: 'POST',
      body: JSON.stringify({ text, businessId }),
    }),

  sendAction: (action: string, businessId?: number) =>
    request<CommandResult>('/command', {
      method: 'POST',
      body: JSON.stringify({ action, businessId }),
    }),

  linkTelegram: (code: string) =>
    request<{ ok: boolean; businesses: Business[] }>('/link-telegram', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getCalendarDates: (businessId: number) =>
    request<{ dates: string[] }>(`/calendar/dates?businessId=${businessId}`)
      .then((r) => r.dates),

  getCalendarSlots: (businessId: number, date: string) =>
    request<{ slots: CalendarSlot[] }>(`/calendar/slots?businessId=${businessId}&date=${date}`)
      .then((r) => r.slots),

  createCalendarBooking: (data: {
    businessId: number;
    date: string;
    startTime: string;
    endTime: string;
    clientName: string;
    clientPhone?: string;
    force?: boolean;
  }) =>
    request<{ ok?: boolean; conflict?: boolean; overlaps?: any[] }>('/calendar/booking', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancelCalendarBooking: (id: number) =>
    request<{ ok: boolean }>(`/calendar/booking/${id}`, { method: 'DELETE' }),

  setCalendarSchedule: (data: {
    businessId: number;
    date: string;
    startHour: number;
    endHour: number;
  }) =>
    request<{ ok: boolean }>('/calendar/schedule', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
