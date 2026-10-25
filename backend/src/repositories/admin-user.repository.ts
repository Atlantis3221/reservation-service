import { randomInt } from 'crypto';
import { getDb } from '../services/db';

export interface AdminUserRow {
  id: number;
  email: string;
  password_hash: string;
  owner_chat_id: string | null;
  created_at: string;
}

export function createAdminUser(email: string, passwordHash: string): AdminUserRow {
  const result = getDb()
    .prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)')
    .run(email, passwordHash);

  return {
    id: result.lastInsertRowid as number,
    email,
    password_hash: passwordHash,
    owner_chat_id: null,
    created_at: new Date().toISOString(),
  };
}

export function getAdminUserByEmail(email: string): AdminUserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM admin_users WHERE email = ?')
    .get(email) as AdminUserRow | undefined;
  return row ?? null;
}

export function getAdminUserById(id: number): AdminUserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM admin_users WHERE id = ?')
    .get(id) as AdminUserRow | undefined;
  return row ?? null;
}

export function setOwnerChatId(adminUserId: number, ownerChatId: string): void {
  getDb()
    .prepare('UPDATE admin_users SET owner_chat_id = ? WHERE id = ?')
    .run(ownerChatId, adminUserId);
}

export function getAdminUserByOwnerChatId(ownerChatId: string): AdminUserRow | null {
  const row = getDb()
    .prepare('SELECT * FROM admin_users WHERE owner_chat_id = ?')
    .get(ownerChatId) as AdminUserRow | undefined;
  return row ?? null;
}

export function updatePassword(adminUserId: number, passwordHash: string): void {
  getDb()
    .prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .run(passwordHash, adminUserId);
}

// ---- Link codes ----

// expires_at пишется ISO (`2026-10-24T00:09:25.000Z`), а datetime('now') —
// `2026-10-24 00:09:25`. Строками их сравнивать нельзя: «T» больше пробела,
// и истёкший код проходил до конца суток UTC. Поэтому — через datetime().
const LIVE = `used = 0 AND datetime(expires_at) > datetime('now')`;

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** Выдаёт шестизначный код привязки, не совпадающий ни с одним живым. */
export function issueLinkCode(ownerChatId: string): string {
  const db = getDb();
  const isLive = db.prepare(`SELECT 1 FROM link_codes WHERE code = ? AND ${LIVE}`);
  let code = '';
  do {
    code = String(randomInt(100000, 1000000));
  } while (isLive.get(code));

  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  db.prepare('INSERT INTO link_codes (code, owner_chat_id, expires_at) VALUES (?, ?, ?)')
    .run(code, ownerChatId, expiresAt);
  return code;
}

export function consumeLinkCode(code: string): string | null {
  const row = getDb()
    .prepare(`SELECT id, owner_chat_id FROM link_codes WHERE code = ? AND ${LIVE} ORDER BY id DESC`)
    .get(code) as { id: number; owner_chat_id: string } | undefined;

  if (!row) return null;

  getDb()
    .prepare('UPDATE link_codes SET used = 1 WHERE id = ?')
    .run(row.id);

  return row.owner_chat_id;
}

// ---- Reset tokens ----

export function createResetToken(token: string, adminUserId: number, expiresAt: string): void {
  getDb()
    .prepare('INSERT INTO reset_tokens (token, admin_user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, adminUserId, expiresAt);
}

export function consumeResetToken(token: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM reset_tokens WHERE token = ? AND ${LIVE}`
    )
    .get(token) as { admin_user_id: number } | undefined;

  if (!row) return null;

  getDb()
    .prepare('UPDATE reset_tokens SET used = 1 WHERE token = ?')
    .run(token);

  return row.admin_user_id;
}
