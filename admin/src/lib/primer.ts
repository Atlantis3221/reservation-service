/**
 * Владелец пришёл со страницы-примера (H-008) по «Сделайте такую страницу
 * себе»: панель запоминает адрес примера, онбординг подставляет из него часы
 * и длительность. Хранится до публикации — переживает вход и перезагрузку.
 */

const KEY = 'slotik_primer';
const PRIMER_SLUG_RE = /^primer-[a-z0-9-]{1,80}$/;

export function rememberPrimerFromUrl(): string | null {
  const slug = new URLSearchParams(location.search).get('primer');
  if (!slug || !PRIMER_SLUG_RE.test(slug)) return null;
  try { localStorage.setItem(KEY, slug); } catch {}
  return slug;
}

export function rememberedPrimer(): string | null {
  try {
    const slug = localStorage.getItem(KEY);
    return slug && PRIMER_SLUG_RE.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function forgetPrimer(): void {
  try { localStorage.removeItem(KEY); } catch {}
}
