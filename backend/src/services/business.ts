import { getDb } from './db';
import { notifyNewBusiness } from './monitor';
import type { Business, ContactLink, ContactLinkType } from '../types';

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
    ownerPhone: row.owner_phone ?? null,
    createdAt: row.created_at,
  };
}

export function createBusiness(
  slug: string,
  name: string,
  ownerChatId: string,
  telegramUsername?: string
): Business {
  const phone = getOwnerPhone(ownerChatId);

  const result = getDb()
    .prepare(
      `INSERT INTO businesses (slug, name, owner_chat_id, telegram_username, owner_phone)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(slug, name, ownerChatId, telegramUsername ?? null, phone);

  notifyNewBusiness(name, slug);

  return {
    id: result.lastInsertRowid as number,
    slug,
    name,
    ownerChatId,
    telegramUsername: telegramUsername ?? null,
    ownerPhone: phone,
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
  db.prepare('DELETE FROM contact_links WHERE business_id = ?').run(id);
  db.prepare('DELETE FROM slots WHERE business_id = ?').run(id);
  db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
}

// ---- Контактные ссылки ----

const CONTACT_LINK_ORDER: ContactLinkType[] = ['telegram', 'vk', 'max'];

export function getContactLinks(businessId: number): ContactLink[] {
  const rows = getDb()
    .prepare('SELECT type, url FROM contact_links WHERE business_id = ? ORDER BY id')
    .all(businessId) as ContactLink[];
  return rows.sort((a, b) =>
    CONTACT_LINK_ORDER.indexOf(a.type) - CONTACT_LINK_ORDER.indexOf(b.type)
  );
}

export function getContactLinksWithFallback(businessId: number, telegramUsername: string | null): ContactLink[] {
  const links = getContactLinks(businessId);
  if (links.length > 0) return links;
  if (telegramUsername) {
    return [{ type: 'telegram', url: `https://t.me/${telegramUsername}` }];
  }
  return [];
}

export function upsertContactLink(businessId: number, type: ContactLinkType, url: string): void {
  getDb()
    .prepare(
      `INSERT INTO contact_links (business_id, type, url) VALUES (?, ?, ?)
       ON CONFLICT(business_id, type) DO UPDATE SET url = excluded.url`
    )
    .run(businessId, type, url);
}

export function deleteContactLink(businessId: number, type: ContactLinkType): boolean {
  const result = getDb()
    .prepare('DELETE FROM contact_links WHERE business_id = ? AND type = ?')
    .run(businessId, type);
  return result.changes > 0;
}

export function getBusinessByOwnerAndSlug(chatId: string | number, slug: string): Business | null {
  const row = getDb()
    .prepare('SELECT * FROM businesses WHERE owner_chat_id = ? AND slug = ?')
    .get(String(chatId), slug);
  return row ? rowToBusiness(row) : null;
}

export function hasAgreement(chatId: string | number): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM owner_agreements WHERE owner_chat_id = ?')
    .get(String(chatId));
}

export function saveAgreement(chatId: string | number): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO owner_agreements (owner_chat_id) VALUES (?)')
    .run(String(chatId));
}

export function ownerHasPhone(chatId: string | number): boolean {
  const row = getDb()
    .prepare('SELECT phone FROM owner_agreements WHERE owner_chat_id = ? AND phone IS NOT NULL')
    .get(String(chatId)) as any;
  return !!row;
}

export function getOwnerPhone(chatId: string | number): string | null {
  const row = getDb()
    .prepare('SELECT phone FROM owner_agreements WHERE owner_chat_id = ?')
    .get(String(chatId)) as any;
  return row?.phone ?? null;
}

export function updateOwnerPhone(chatId: string | number, phone: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO owner_agreements (owner_chat_id) VALUES (?)')
    .run(String(chatId));
  db.prepare('UPDATE owner_agreements SET phone = ? WHERE owner_chat_id = ?')
    .run(phone, String(chatId));
  db.prepare('UPDATE businesses SET owner_phone = ? WHERE owner_chat_id = ?')
    .run(phone, String(chatId));
}
