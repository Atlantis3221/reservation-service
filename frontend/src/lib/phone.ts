/**
 * Мягкое форматирование телефона. «Мягкое» — потому что маска, которая
 * дописывает символы за пользователя, ломает ввод зарубежных номеров и не
 * даёт нормально стирать. Здесь три правила:
 *   — если человек явно начал с «+» и это не «+7», не трогаем вообще;
 *   — форматируем только то, что похоже на российский номер;
 *   — при стирании не переформатируем (это делает вызывающий код).
 */

export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Отбрасывает код страны или восьмёрку, оставляя 10 цифр номера.
 * `null` — «это не российский номер, не вмешиваемся».
 */
function nationalPart(digits: string): string | null {
  if (digits.length === 0) return '';
  if (digits[0] === '7') return digits.slice(1);
  // Восьмёрку срезаем только перед мобильной девяткой: иначе +81 (Япония)
  // превратился бы в «+7 1…».
  if (digits[0] === '8') return digits.length === 1 || digits[1] === '9' ? digits.slice(1) : null;
  if (digits[0] === '9') return digits;
  return null;
}

export function formatPhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('+') && !trimmed.startsWith('+7')) return value;

  const body = nationalPart(digitsOf(value));
  if (body === null || body.length > 10) return value;
  if (body.length === 0) return trimmed === '' ? '' : '+7 ';

  let out = '+7';
  for (const [from, to, sep] of [[0, 3, ' '], [3, 6, ' '], [6, 8, '-'], [8, 10, '-']] as const) {
    const part = body.slice(from, to);
    if (!part) break;
    out += sep + part;
  }
  return out;
}

export function isPhoneComplete(value: string): boolean {
  return digitsOf(value).length >= 10;
}
