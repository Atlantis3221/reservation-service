/**
 * Свой замер воронки сайта (T-017): визит на лендинг → открыл регистрацию →
 * зарегистрировался. Лендинг передаёт в ссылку на регистрацию свой visitId
 * (`sv`) и метки, чтобы регистрация досталась тому источнику, откуда человек
 * пришёл на сайт. Без персональных данных; саму регистрацию пишет сервер.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/admin';
const NOSTAT_COOKIE = 'slotik_nostat';
const VISIT_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface SignupVisit {
  visitId: string;
  referrer: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  yclid: string | null;
}

function makeVisitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isNoStat(): boolean {
  return document.cookie.split('; ').some((c) => c === `${NOSTAT_COOKIE}=1`);
}

let current: SignupVisit | null = null;

/** Визит, с которым человек открыл регистрацию; один на вкладку. */
export function signupVisit(): SignupVisit {
  if (current) return current;
  const params = new URLSearchParams(location.search);
  const sv = params.get('sv');
  current = {
    visitId: sv && VISIT_ID_RE.test(sv) ? sv : makeVisitId(),
    referrer: document.referrer || '',
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmContent: params.get('utm_content'),
    yclid: params.get('yclid'),
  };
  return current;
}

export function trackSignupOpen(): void {
  try {
    if (isNoStat()) return;
    fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ page: 'site', event: 'signup_open', ...signupVisit() }),
    }).catch(() => {});
  } catch {
    // Замер не должен мешать регистрации.
  }
}
