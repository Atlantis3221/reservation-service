import cron from 'node-cron';
import { getDb } from './db';
import {
  getBusinessBySlug,
  upsertContactLink,
  updateBookingRequestsEnabled,
  updateSlotDuration,
} from './business';
import { addDaySlotRange, bookRange, clearAvailableSlots } from '../repositories/slot.repository';
import { createBookingRequest } from '../repositories/booking-request.repository';
import { toDateKey } from '../utils/date';

const DEMO_SLUG = 'demo-banya';
const DEMO_NAME = 'Демо Баня';
const DEMO_OWNER_CHAT_ID = 'demo';
const SCHEDULE_DAYS = 14;
const SCHEDULE_START = '10:00';
const SCHEDULE_END = '02:00';
const SLOT_DURATION_MINUTES = 120;

const DEMO_CONTACTS = [
  { type: 'telegram' as const, url: 'https://t.me/ndrwbv' },
  { type: 'vk' as const, url: 'https://vk.com/ndrwbv' },
];

const DEMO_REQUESTS = [
  {
    clientName: 'Марина Ковалёва',
    clientPhone: '+7 916 402-18-77',
    start: '15:00',
    end: '17:00',
    description: 'Хотим на двоих, можно с вениками',
  },
];

/**
 * Демо должно выглядеть как живая баня: часть времени занята, часть свободна.
 * Занимаем разные интервалы в зависимости от дня, чтобы каждый день выглядел
 * по-своему и при этом всегда оставалось что забронировать.
 */
const BOOKING_PATTERNS: Array<Array<{ start: string; end: string; clientName: string; note: string | null }>> = [
  [
    { start: '12:00', end: '14:00', clientName: 'Иван Петров', note: 'Постоянный клиент' },
    { start: '18:00', end: '20:00', clientName: 'Анна Смирнова', note: 'День рождения, 6 человек' },
  ],
  [
    { start: '10:00', end: '12:00', clientName: 'Дмитрий Козлов', note: 'С вениками' },
    { start: '16:00', end: '18:00', clientName: 'Елена Волкова', note: 'Корпоратив' },
    { start: '22:00', end: '00:00', clientName: 'Сергей Морозов', note: null },
  ],
  [
    { start: '14:00', end: '16:00', clientName: 'Ольга Никитина', note: 'Семья с детьми' },
  ],
  [
    { start: '12:00', end: '14:00', clientName: 'Павел Ершов', note: null },
    { start: '20:00', end: '22:00', clientName: 'Марина Ковалёва', note: 'Двое, с вениками' },
  ],
];

function ensureDemoBusiness(): number {
  const existing = getBusinessBySlug(DEMO_SLUG);
  if (existing) return existing.id;

  const result = getDb()
    .prepare(
      `INSERT INTO businesses (slug, name, owner_chat_id, telegram_username)
       VALUES (?, ?, ?, NULL)`
    )
    .run(DEMO_SLUG, DEMO_NAME, DEMO_OWNER_CHAT_ID);

  const businessId = result.lastInsertRowid as number;

  for (const link of DEMO_CONTACTS) {
    upsertContactLink(businessId, link.type, link.url);
  }

  console.log(`[demo] Created demo business "${DEMO_NAME}" (id=${businessId})`);
  return businessId;
}

function dateKeyOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function hasSlots(businessId: number, dateKey: string, status?: string): boolean {
  const sql = status
    ? `SELECT 1 FROM slots WHERE business_id = ? AND date_key = ? AND status = ? LIMIT 1`
    : `SELECT 1 FROM slots WHERE business_id = ? AND date_key = ? LIMIT 1`;
  const params = status ? [businessId, dateKey, status] : [businessId, dateKey];
  return !!getDb().prepare(sql).get(...params);
}

function cleanOldSlots(businessId: number, yesterdayKey: string): void {
  const result = getDb()
    .prepare('DELETE FROM slots WHERE business_id = ? AND date_key < ?')
    .run(businessId, yesterdayKey);
  if (result.changes > 0) {
    console.log(`[demo] Cleaned ${result.changes} old slot(s)`);
  }
}

function hasRequests(businessId: number, dateKey: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM booking_requests WHERE business_id = ? AND preferred_date = ? LIMIT 1')
    .get(businessId, dateKey);
}

function cleanOldRequests(businessId: number, yesterdayKey: string): void {
  const result = getDb()
    .prepare('DELETE FROM booking_requests WHERE business_id = ? AND preferred_date < ?')
    .run(businessId, yesterdayKey);
  if (result.changes > 0) {
    console.log(`[demo] Cleaned ${result.changes} old request(s)`);
  }
}

function seedRequests(businessId: number, dateKey: string): void {
  if (hasRequests(businessId, dateKey)) return;
  for (const r of DEMO_REQUESTS) {
    createBookingRequest(
      businessId,
      r.clientName,
      r.clientPhone,
      dateKey,
      r.start,
      r.end,
      r.description,
    );
  }
  console.log(`[demo] Created ${DEMO_REQUESTS.length} booking request(s) for ${dateKey}`);
}

/**
 * Один день демо: смена на весь день плюс несколько броней.
 * Идемпотентно — повторный вызов ничего не дублирует.
 */
function seedDay(businessId: number, dayOffset: number): void {
  const dateKey = dateKeyOffset(dayOffset);

  if (!hasSlots(businessId, dateKey, 'available')) {
    clearAvailableSlots(businessId, dateKey);
    addDaySlotRange(businessId, dateKey, SCHEDULE_START, SCHEDULE_END);
  }

  if (hasSlots(businessId, dateKey, 'booked')) return;

  const pattern = BOOKING_PATTERNS[Math.abs(dayOffset) % BOOKING_PATTERNS.length];
  for (const b of pattern) {
    bookRange(businessId, dateKey, b.start, b.end, b.note ?? undefined, b.clientName);
  }
}

function refreshDemo(): void {
  const businessId = ensureDemoBusiness();
  const yesterdayKey = dateKeyOffset(-1);

  updateBookingRequestsEnabled(businessId, true);
  updateSlotDuration(businessId, SLOT_DURATION_MINUTES);

  cleanOldSlots(businessId, yesterdayKey);
  cleanOldRequests(businessId, yesterdayKey);

  // Сеем каждый день горизонта, а не только «вчера/сегодня»: иначе посетитель,
  // открывший демо, попадает на пустой день и не видит ничего.
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    seedDay(businessId, i);
  }

  seedRequests(businessId, dateKeyOffset(1));
}

export function initDemo(): void {
  refreshDemo();

  // Каждые 6 часов, а не раз в сутки: так демо не зависит от часового пояса
  // контейнера и восстанавливается само, если ночной запуск был пропущен.
  cron.schedule('7 */6 * * *', () => {
    console.log('[demo] Refresh triggered');
    refreshDemo();
  });

  console.log('[demo] Initialized, refresh every 6 hours');
}
