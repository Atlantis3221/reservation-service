import { getDb } from './db';

/**
 * Замер страниц по шагам. Брони и заявки прод считает и так, но не видно
 * шагов до них: заходит ли кто-то на страницу заведения и где отваливается.
 * Без этого «0 броней» не различает «ссылку никто не видит» и «страница
 * мешает записаться», а лечатся они по-разному.
 *
 * Персональных данных здесь нет: IP не пишем, от реферера оставляем домен.
 */

export const PAGE_EVENTS = {
  /** Страница заведения slotik.tech/<slug> */
  business: ['view', 'pick', 'request_open', 'booked', 'requested'],
  /** Лендинг и регистрация — под общий замер воронки (T-017) */
  site: ['view', 'signup_open', 'signup'],
} as const;

export type PageKind = keyof typeof PAGE_EVENTS;

export interface PageEventInput {
  page: PageKind;
  businessId: number | null;
  event: string;
  visitId: string;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

const VISIT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Роботы, превью ссылок и наши проверки curl'ом. JS они почти никогда не
 * исполняют, но если исполняют — в замер попадать не должны.
 */
const BOT_UA_RE =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|phantom|puppeteer|playwright|selenium|facebookexternalhit|vkshare|whatsapp|curl|wget|python|node-fetch|axios|go-http|java\//i;

export function isBotUserAgent(ua: string | undefined): boolean {
  if (!ua || ua.length < 10) return true;
  return BOT_UA_RE.test(ua);
}

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAGE_EVENTS, value);
}

export function isValidEvent(page: PageKind, event: unknown): boolean {
  return typeof event === 'string' && (PAGE_EVENTS[page] as readonly string[]).includes(event);
}

export function isValidVisitId(value: unknown): value is string {
  return typeof value === 'string' && VISIT_ID_RE.test(value);
}

/**
 * Откуда пришли: домен реферера без www. Для Яндекс Карт — отдельно, это
 * главный кандидат «где вас находят клиенты». Переходы внутри slotik.tech —
 * «slotik.tech» (например, с лендинга на демо), пустой реферер — «direct».
 */
export function referrerSource(referrer: string | null | undefined): string {
  if (!referrer) return 'direct';
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return 'other';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'other';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return 'direct';
  if (host === 'slotik.tech' || host.endsWith('.slotik.tech')) return 'slotik.tech';
  if (/^yandex\.[a-z.]+$/.test(host) && url.pathname.startsWith('/maps')) return `${host}/maps`;
  return host.slice(0, 100);
}

function cleanUtm(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, 100);
  return v || null;
}

export function recordPageEvent(input: PageEventInput): void {
  getDb()
    .prepare(
      `INSERT INTO page_events
         (page, business_id, event, visit_id, source, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.page,
      input.businessId,
      input.event,
      input.visitId,
      referrerSource(input.referrer),
      cleanUtm(input.utmSource),
      cleanUtm(input.utmMedium),
      cleanUtm(input.utmCampaign),
    );
}

/** Шаги страницы записи за период. Посещения и выбор — по уникальным визитам. */
export interface PageFunnel {
  /** Открытий страницы (уникальных визитов) */
  visits: number;
  /** Визитов, где выбрали время */
  picked: number;
  /** Визитов, где открыли заявку на своё время */
  requestOpened: number;
  /** Отправленных броней */
  booked: number;
  /** Отправленных заявок */
  requested: number;
  /** Откуда пришли: источник → визитов. utm_source, если есть, иначе домен реферера */
  sources: Record<string, number>;
}

export function emptyPageFunnel(): PageFunnel {
  return { visits: 0, picked: 0, requestOpened: 0, booked: 0, requested: 0, sources: {} };
}

/** Шаги по каждому заведению за последние `days` дней. */
export function getBusinessPageFunnels(days: number): Map<number, PageFunnel> {
  const db = getDb();
  const since = `-${Math.max(1, Math.floor(days))} days`;
  const result = new Map<number, PageFunnel>();

  const rows = db.prepare(`
    SELECT
      business_id AS businessId,
      COUNT(DISTINCT CASE WHEN event = 'view'         THEN visit_id END) AS visits,
      COUNT(DISTINCT CASE WHEN event = 'pick'         THEN visit_id END) AS picked,
      COUNT(DISTINCT CASE WHEN event = 'request_open' THEN visit_id END) AS requestOpened,
      SUM(CASE WHEN event = 'booked'    THEN 1 ELSE 0 END)               AS booked,
      SUM(CASE WHEN event = 'requested' THEN 1 ELSE 0 END)               AS requested
    FROM page_events
    WHERE page = 'business' AND business_id IS NOT NULL
      AND created_at >= datetime('now', ?)
    GROUP BY business_id
  `).all(since) as any[];

  for (const r of rows) {
    result.set(r.businessId, {
      visits: r.visits ?? 0,
      picked: r.picked ?? 0,
      requestOpened: r.requestOpened ?? 0,
      booked: r.booked ?? 0,
      requested: r.requested ?? 0,
      sources: {},
    });
  }

  const sourceRows = db.prepare(`
    SELECT
      business_id                            AS businessId,
      COALESCE('utm:' || utm_source, source) AS src,
      COUNT(DISTINCT visit_id)               AS n
    FROM page_events
    WHERE page = 'business' AND business_id IS NOT NULL AND event = 'view'
      AND created_at >= datetime('now', ?)
    GROUP BY business_id, src
    ORDER BY n DESC
  `).all(since) as any[];

  for (const r of sourceRows) {
    const funnel = result.get(r.businessId);
    if (funnel) funnel.sources[r.src] = r.n;
  }

  return result;
}
