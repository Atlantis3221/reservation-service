/**
 * Замер страницы записи по шагам: открыли → выбрали время → отправили.
 * Свой простой POST вместо счётчика Метрики: на странице с телефоном клиента
 * не должно быть вебвизора. Без персональных данных: visitId живёт только в
 * памяти вкладки, от реферера сервер оставляет домен.
 */

const API_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * Браузеры владельцев и команды не считаем. Панель ставит эту cookie при входе
 * (общая на *.slotik.tech), команда — открыв любую страницу с `?nostat`.
 */
const NOSTAT_COOKIE = 'slotik_nostat';

export type BusinessEvent = 'view' | 'pick' | 'request_open' | 'booked' | 'requested';

function makeVisitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const visitId = makeVisitId();

function markNoStat(): void {
  const domain = location.hostname.endsWith('slotik.tech') ? '; domain=.slotik.tech' : '';
  document.cookie = `${NOSTAT_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax${domain}`;
}

function isNoStat(): boolean {
  if (new URLSearchParams(location.search).has('nostat')) markNoStat();
  return document.cookie.split('; ').some((c) => c === `${NOSTAT_COOKIE}=1`);
}

export function trackBusiness(slug: string, event: BusinessEvent): void {
  try {
    if (isNoStat()) return;
    const params = new URLSearchParams(location.search);
    fetch(`${API_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // keepalive: событие «отправил» уходит прямо перед тем, как человек закрывает вкладку
      keepalive: true,
      body: JSON.stringify({
        page: 'business',
        slug,
        event,
        visitId,
        referrer: document.referrer || '',
        utmSource: params.get('utm_source'),
        utmMedium: params.get('utm_medium'),
        utmCampaign: params.get('utm_campaign'),
      }),
    }).catch(() => {});
  } catch {
    // Замер не должен ломать запись.
  }
}
