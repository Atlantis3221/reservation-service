import { getDb } from './db';

/**
 * Заходы владельца в панель: когда был последний раз и в сколько разных дней
 * заходил после дня регистрации. Пишем при авторизованном запросе, но не чаще
 * раза в 10 минут на владельца — панель шлёт десятки запросов за визит.
 */

const THROTTLE_MS = 10 * 60 * 1000;
const lastWrite = new Map<number, number>();

export function recordOwnerVisit(adminUserId: number, now: Date = new Date()): void {
  const prev = lastWrite.get(adminUserId);
  // Новые сутки пишем сразу, иначе заход в 00:05 после 23:58 не дал бы новый день.
  if (prev !== undefined && now.getTime() - prev < THROTTLE_MS && sameLocalDay(prev, now)) return;
  lastWrite.set(adminUserId, now.getTime());

  try {
    const db = getDb();
    const at = now.toISOString().replace('T', ' ').replace(/\..*$/, '');
    db.prepare('UPDATE admin_users SET last_seen_at = ? WHERE id = ?').run(at, adminUserId);
    db.prepare('INSERT OR IGNORE INTO owner_visit_days (admin_user_id, day) VALUES (?, ?)')
      .run(adminUserId, localDay(now));
  } catch (err) {
    // Замер не должен ломать вход в панель.
    console.error('[owner-visits] не записали заход:', err);
  }
}

export interface OwnerVisits {
  /** Последний авторизованный запрос в панель, UTC; null — с выкатки замера не заходил */
  lastSeenAt: string | null;
  /** Сколько разных дней заходил после дня регистрации (московское время) */
  activeDays: number;
}

/** По id владельца — заходы. Дни считаются строго после дня регистрации. */
export function getOwnerVisits(): Map<number, OwnerVisits> {
  const rows = getDb().prepare(`
    SELECT
      au.id,
      au.last_seen_at AS lastSeenAt,
      (SELECT COUNT(*) FROM owner_visit_days v
         WHERE v.admin_user_id = au.id
           AND v.day > date(au.created_at, 'localtime')) AS activeDays
    FROM admin_users au
  `).all() as { id: number; lastSeenAt: string | null; activeDays: number }[];

  return new Map(rows.map((r) => [r.id, { lastSeenAt: r.lastSeenAt ?? null, activeDays: r.activeDays ?? 0 }]));
}

/** Только для тестов */
export function resetOwnerVisitThrottle(): void {
  lastWrite.clear();
}

/** День по часам контейнера — у прода это Москва (TZ в docker-compose). */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sameLocalDay(ms: number, d: Date): boolean {
  return localDay(new Date(ms)) === localDay(d);
}
