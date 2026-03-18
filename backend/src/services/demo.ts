import cron from 'node-cron';
import { getDb } from './db';
import { getBusinessBySlug, upsertContactLink } from './business';
import { bookRange } from '../repositories/slot.repository';
import { toDateKey } from '../utils/date';

const DEMO_SLUG = 'demo-banya';
const DEMO_NAME = 'Демо Баня';
const DEMO_OWNER_CHAT_ID = 'demo';

const DEMO_CONTACTS = [
  { type: 'telegram' as const, url: 'https://t.me/ndrwbv' },
  { type: 'vk' as const, url: 'https://vk.com/ndrwbv' },
];

const DEMO_BOOKINGS = [
  { start: '10:00', end: '12:00', clientName: 'Иван Петров', note: 'Постоянный клиент' },
  { start: '13:00', end: '15:00', clientName: 'Анна Смирнова', note: 'День рождения, компания 6 человек' },
  { start: '16:00', end: '18:00', clientName: 'Дмитрий Козлов', note: 'С вениками' },
  { start: '19:00', end: '21:00', clientName: 'Елена Волкова', note: 'Корпоратив' },
  { start: '22:00', end: '00:00', clientName: 'Сергей Морозов', note: null },
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

function hasTodayBookings(businessId: number, dateKey: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM slots WHERE business_id = ? AND date_key = ? AND status = 'booked' LIMIT 1`
    )
    .get(businessId, dateKey);
  return !!row;
}

function cleanOldBookings(businessId: number, todayKey: string): void {
  const result = getDb()
    .prepare('DELETE FROM slots WHERE business_id = ? AND date_key < ?')
    .run(businessId, todayKey);
  if (result.changes > 0) {
    console.log(`[demo] Cleaned ${result.changes} old slot(s)`);
  }
}

function seedTodayBookings(businessId: number, dateKey: string): void {
  for (const b of DEMO_BOOKINGS) {
    bookRange(businessId, dateKey, b.start, b.end, b.note ?? undefined, b.clientName);
  }
  console.log(`[demo] Created ${DEMO_BOOKINGS.length} bookings for ${dateKey}`);
}

function refreshDemo(): void {
  const businessId = ensureDemoBusiness();
  const todayKey = toDateKey(new Date());

  cleanOldBookings(businessId, todayKey);

  if (!hasTodayBookings(businessId, todayKey)) {
    seedTodayBookings(businessId, todayKey);
  }
}

export function initDemo(): void {
  refreshDemo();

  // 00:05 MSK (UTC+3) = 21:05 UTC
  cron.schedule('5 21 * * *', () => {
    console.log('[demo] Daily cron triggered');
    refreshDemo();
  });

  console.log('[demo] Initialized, cron scheduled at 00:05 MSK');
}
