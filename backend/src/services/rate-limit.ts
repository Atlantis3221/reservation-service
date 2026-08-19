/**
 * Простой in-memory лимитер для публичных эндпоинтов записи.
 * Задача — не пустить бота, который забьёт календарь владельца мусорными бронями.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) pruneExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count++;
  return true;
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Если все живые — сбрасываем целиком, чтобы карта не росла бесконечно.
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

export function resetRateLimits(): void {
  buckets.clear();
}
