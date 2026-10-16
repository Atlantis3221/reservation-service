import cron from 'node-cron';
import { getDb } from './db';
import { addDaySlotRange } from '../repositories/slot.repository';
import { toDateKey } from '../utils/date';
import type { WorkingHoursConfig } from '../types';

/** Опубликованное расписание всегда открыто хотя бы на столько дней вперёд */
export const AUTO_EXTEND_DAYS = 28;

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Индекс дня недели в DAY_KEYS: 0 = понедельник */
function weekdayIndex(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Дописывает рабочие дни по часам работы, чтобы запись не кончалась сама.
 *
 * Раньше расписание публиковалось только кнопкой: онбординг открывал 28 дней,
 * и через четыре недели страница заведения пустела, хотя владелец ничего не
 * выключал (у Ярвелле запись кончилась 06.10).
 *
 * Трогаем только заведения, которые уже публиковали расписание (есть хоть один
 * слот) и у которых заданы часы работы. Дописываем лишь дни после последнего
 * опубликованного: что владелец поменял внутри уже открытого периода, остаётся
 * как есть, брони не затрагиваются. Выключил все дни в часах работы — продление
 * останавливается. Повторный запуск ничего не дублирует.
 */
export function extendSchedules(now: Date = new Date()): { businesses: number; days: number } {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT b.id, b.working_hours, MAX(s.date_key) AS last_date
         FROM businesses b
         JOIN slots s ON s.business_id = b.id
        WHERE b.working_hours IS NOT NULL
          AND b.owner_chat_id <> 'demo'
        GROUP BY b.id`,
    )
    .all() as { id: number; working_hours: string; last_date: string }[];

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let businesses = 0;
  let days = 0;

  d.transaction(() => {
    for (const row of rows) {
      let wh: WorkingHoursConfig;
      try {
        wh = JSON.parse(row.working_hours);
      } catch {
        continue;
      }

      let added = 0;
      for (let i = 0; i < AUTO_EXTEND_DAYS; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateKey = toDateKey(date);
        if (dateKey <= row.last_date) continue;

        const day = wh?.[DAY_KEYS[weekdayIndex(date)]];
        if (!day?.enabled || !TIME_RE.test(day.start) || !TIME_RE.test(day.end)) continue;

        addDaySlotRange(row.id, dateKey, day.start, day.end);
        added++;
      }

      if (added > 0) {
        businesses++;
        days += added;
      }
    }
  })();

  return { businesses, days };
}

function runExtension(): void {
  try {
    const { businesses, days } = extendSchedules();
    if (days > 0) {
      console.log(`[schedule] Продлено расписание: ${businesses} заведений, ${days} дн.`);
    }
  } catch (err) {
    console.error('[schedule] Продление расписания упало:', err);
  }
}

export function initScheduleExtension(): void {
  runExtension();

  // 00:20 по Москве — после ночной очистки старых слотов (00:10)
  cron.schedule('20 0 * * *', () => {
    console.log('[schedule] Daily extension triggered');
    runExtension();
  });

  console.log(`[schedule] Автопродление на ${AUTO_EXTEND_DAYS} дн. вперёд, ежедневно в 00:20`);
}
