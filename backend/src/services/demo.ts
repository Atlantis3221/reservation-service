import cron from 'node-cron';
import { getDb } from './db';
import { getBusinessBySlug, upsertContactLink } from './business';
import { addDaySlots, bookRange } from '../repositories/slot.repository';
import { toDateKey } from '../utils/date';

const DEMO_SLUG = 'demo-banya';
const DEMO_NAME = 'Демо Баня';
const DEMO_OWNER_CHAT_ID = 'demo';
const SCHEDULE_DAYS = 7;
const SCHEDULE_START_HOUR = 10;
const SCHEDULE_END_HOUR = 24;

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

function seedSchedule(businessId: number): void {
  let created = 0;
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const dk = dateKeyOffset(i);
    if (!hasSlots(businessId, dk, 'available')) {
      addDaySlots(businessId, dk, SCHEDULE_START_HOUR, SCHEDULE_END_HOUR);
      created++;
    }
  }
  if (created > 0) {
    console.log(`[demo] Created schedule for ${created} day(s)`);
  }
}

function seedBookings(businessId: number, dateKey: string): void {
  if (hasSlots(businessId, dateKey, 'booked')) return;
  for (const b of DEMO_BOOKINGS) {
    bookRange(businessId, dateKey, b.start, b.end, b.note ?? undefined, b.clientName);
  }
  console.log(`[demo] Created ${DEMO_BOOKINGS.length} bookings for ${dateKey}`);
}

function refreshDemo(): void {
  const businessId = ensureDemoBusiness();
  const yesterdayKey = dateKeyOffset(-1);
  const todayKey = toDateKey(new Date());

  cleanOldSlots(businessId, yesterdayKey);
  seedSchedule(businessId);
  seedBookings(businessId, yesterdayKey);
  seedBookings(businessId, todayKey);
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
