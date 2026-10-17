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
  /** Метка лида в письмах (L-…) */
  utmContent?: string | null;
  /** Пришёл по клику из Директа (в ссылке был yclid) */
  adClick?: boolean;
  /** mobile / desktop — из User-Agent, сам User-Agent не храним */
  device?: string | null;
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

export function deviceFromUserAgent(ua: string | undefined): 'mobile' | 'desktop' {
  return ua && /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop';
}

/**
 * Клик из Директа без utm (автотаргетинг, ручные объявления) иначе выглядел
 * бы как переход из поиска Яндекса — отделяем по yclid.
 */
export const AD_CLICK_SOURCE = 'yandex-ad';

function cleanUtm(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().slice(0, 100);
  return v || null;
}

export function recordPageEvent(input: PageEventInput): void {
  getDb()
    .prepare(
      `INSERT INTO page_events
           (page, business_id, event, visit_id, source,
          utm_source, utm_medium, utm_campaign, utm_content, device)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.page,
      input.businessId,
      input.event,
      input.visitId,
      input.adClick ? AD_CLICK_SOURCE : referrerSource(input.referrer),
      cleanUtm(input.utmSource),
      cleanUtm(input.utmMedium),
      cleanUtm(input.utmCampaign),
      cleanUtm(input.utmContent),
      input.device ?? null,
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

// ---- Воронка сайта: лендинг → регистрация (T-017) ----

/**
 * Источник визита одной строкой: «utm:ads/A-002», «utm:outreach/L-041»,
 * иначе домен реферера или «yandex-ad». Берётся с первого события визита —
 * на лендинге, если человек пришёл через него.
 */
const SITE_SOURCE_SQL = `
  CASE WHEN f.utm_source IS NOT NULL
    THEN 'utm:' || f.utm_source || COALESCE('/' || COALESCE(f.utm_campaign, f.utm_content), '')
    ELSE f.source END`;

export interface SiteSteps {
  /** Визитов на лендинг */
  visits: number;
  /** Визитов, где открыли регистрацию (в том числе прямо, минуя лендинг) */
  signupOpened: number;
  /** Визитов, закончившихся регистрацией */
  signups: number;
}

export interface SiteFunnel extends SiteSteps {
  bySource: Record<string, SiteSteps>;
  /** По московским дням первого события визита */
  byDay: Record<string, SiteSteps>;
  /** Визитов на лендинг с телефона */
  mobileVisits: number;
}

function emptySteps(): SiteSteps {
  return { visits: 0, signupOpened: 0, signups: 0 };
}

function addSteps(into: SiteSteps, r: SiteSteps): void {
  into.visits += r.visits;
  into.signupOpened += r.signupOpened;
  into.signups += r.signups;
}

/** Воронка сайта за последние `days` дней по уникальным визитам. */
export function getSiteFunnel(days: number): SiteFunnel {
  const since = `-${Math.max(1, Math.floor(days))} days`;
  const rows = getDb().prepare(`
    WITH v AS (
      SELECT
        visit_id,
        MIN(id)                                     AS firstId,
        MAX(event = 'view')                         AS viewed,
        MAX(event = 'signup_open')                  AS opened,
        MAX(event = 'signup')                       AS signed,
        MAX(event = 'view' AND device = 'mobile')   AS mobile
      FROM page_events
      WHERE page = 'site' AND created_at >= datetime('now', ?)
      GROUP BY visit_id
    )
    SELECT
      ${SITE_SOURCE_SQL}                  AS src,
      date(f.created_at, '+3 hours')      AS day,
      SUM(v.viewed)                       AS visits,
      SUM(v.opened)                       AS signupOpened,
      SUM(v.signed)                       AS signups,
      SUM(v.mobile)                       AS mobile
    FROM v JOIN page_events f ON f.id = v.firstId
    GROUP BY src, day
  `).all(since) as any[];

  const funnel: SiteFunnel = { ...emptySteps(), bySource: {}, byDay: {}, mobileVisits: 0 };
  for (const r of rows) {
    const steps: SiteSteps = { visits: r.visits ?? 0, signupOpened: r.signupOpened ?? 0, signups: r.signups ?? 0 };
    addSteps(funnel, steps);
    addSteps((funnel.bySource[r.src] ??= emptySteps()), steps);
    addSteps((funnel.byDay[r.day] ??= emptySteps()), steps);
    funnel.mobileVisits += r.mobile ?? 0;
  }
  return funnel;
}

/** Источник и кампания визита по его первому событию; null — визит не записан. */
export function getVisitSource(visitId: string): { source: string; campaign: string | null } | null {
  const row = getDb().prepare(`
    SELECT ${SITE_SOURCE_SQL} AS source, COALESCE(f.utm_campaign, f.utm_content) AS campaign
    FROM page_events f
    WHERE f.page = 'site' AND f.visit_id = ?
    ORDER BY f.id
    LIMIT 1
  `).get(visitId) as { source: string; campaign: string | null } | undefined;
  return row ?? null;
}

/** Метки визита, которые панель присылает вместе с регистрацией. */
export interface SignupVisit {
  visitId?: unknown;
  referrer?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  yclid?: unknown;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Регистрация — последний шаг воронки сайта. Пишем её на сервере, а не из
 * браузера: событие из браузера режут блокировщики и обрывает переход в
 * онбординг. Владельцу запоминаем источник визита, с которого он пришёл.
 * `counted` = false — робот или браузер команды (cookie slotik_nostat):
 * источник сохраняем, в воронку не пишем.
 */
export function recordSignup(adminUserId: number, visit: SignupVisit | undefined, counted: boolean, device: string): void {
  if (!visit || !isValidVisitId(visit.visitId)) return;
  const input: PageEventInput = {
    page: 'site',
    businessId: null,
    event: 'signup',
    visitId: visit.visitId,
    referrer: str(visit.referrer),
    utmSource: str(visit.utmSource),
    utmMedium: str(visit.utmMedium),
    utmCampaign: str(visit.utmCampaign),
    utmContent: str(visit.utmContent),
    adClick: !!str(visit.yclid),
    device,
  };
  if (counted) recordPageEvent(input);

  const own = (() => {
    const utm = cleanUtm(input.utmSource);
    if (!utm) return { source: input.adClick ? AD_CLICK_SOURCE : referrerSource(input.referrer), campaign: null };
    const campaign = cleanUtm(input.utmCampaign) ?? cleanUtm(input.utmContent);
    return { source: `utm:${utm}${campaign ? `/${campaign}` : ''}`, campaign };
  })();
  const { source, campaign } = getVisitSource(visit.visitId) ?? own;
  getDb()
    .prepare('UPDATE admin_users SET signup_source = ?, signup_campaign = ? WHERE id = ?')
    .run(source, campaign, adminUserId);
}
