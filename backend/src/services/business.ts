import { getDb } from './db';
import type { Business } from '../types';

const TRANSLIT: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
  'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
  'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
  'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
}

export function generateSlug(name: string): string {
  let slug = transliterate(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  if (slug.length < 3) slug = slug + '-banya';

  const existing = getDb()
    .prepare('SELECT slug FROM businesses WHERE slug = ?')
    .get(slug);

  if (!existing) return slug;

  for (let i = 2; i <= 100; i++) {
    const candidate = `${slug}-${i}`;
    const found = getDb()
      .prepare('SELECT slug FROM businesses WHERE slug = ?')
      .get(candidate);
    if (!found) return candidate;
  }

  return `${slug}-${Date.now()}`;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,}[a-z0-9]$/.test(slug) && slug.length >= 3;
}

export function isSlugTaken(slug: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM businesses WHERE slug = ?')
    .get(slug);
}

function rowToBusiness(row: any): Business {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerChatId: row.owner_chat_id,
    telegramUsername: row.telegram_username,
    createdAt: row.created_at,
  };
}

export function createBusiness(
  slug: string,
  name: string,
  ownerChatId: string,
  telegramUsername?: string
): Business {
  const result = getDb()
    .prepare(
      `INSERT INTO businesses (slug, name, owner_chat_id, telegram_username)
       VALUES (?, ?, ?, ?)`
    )
    .run(slug, name, ownerChatId, telegramUsername ?? null);

  return {
    id: result.lastInsertRowid as number,
    slug,
    name,
    ownerChatId,
    telegramUsername: telegramUsername ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function getBusinessesByOwner(chatId: string | number): Business[] {
  const rows = getDb()
    .prepare('SELECT * FROM businesses WHERE owner_chat_id = ? ORDER BY id')
    .all(String(chatId));
  return rows.map(rowToBusiness);
}

export function getBusinessByOwner(chatId: string | number): Business | null {
  const rows = getBusinessesByOwner(chatId);
  return rows.length > 0 ? rows[0] : null;
}

export function getBusinessBySlug(slug: string): Business | null {
  const row = getDb()
    .prepare('SELECT * FROM businesses WHERE slug = ?')
    .get(slug);
  return row ? rowToBusiness(row) : null;
}

export function getBusinessById(id: number): Business | null {
  const row = getDb()
    .prepare('SELECT * FROM businesses WHERE id = ?')
    .get(id);
  return row ? rowToBusiness(row) : null;
}

export function updateBusinessName(id: number, name: string): void {
  getDb()
    .prepare('UPDATE businesses SET name = ? WHERE id = ?')
    .run(name, id);
}

export function updateBusinessSlug(id: number, slug: string): void {
  getDb()
    .prepare('UPDATE businesses SET slug = ? WHERE id = ?')
    .run(slug, id);
}

export function updateTelegramUsername(chatId: string | number, username: string): void {
  getDb()
    .prepare('UPDATE businesses SET telegram_username = ? WHERE owner_chat_id = ?')
    .run(username, String(chatId));
}

export function deleteBusiness(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM slots WHERE business_id = ?').run(id);
  db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
}

export function getBusinessByOwnerAndSlug(chatId: string | number, slug: string): Business | null {
  const row = getDb()
    .prepare('SELECT * FROM businesses WHERE owner_chat_id = ? AND slug = ?')
    .get(String(chatId), slug);
  return row ? rowToBusiness(row) : null;
}
