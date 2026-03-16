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

export function createLinkCode(code: string, ownerChatId: string, expiresAt: string): void {
  getDb()
    .prepare('INSERT INTO link_codes (code, owner_chat_id, expires_at) VALUES (?, ?, ?)')
    .run(code, ownerChatId, expiresAt);
}

export function consumeLinkCode(code: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM link_codes
       WHERE code = ? AND used = 0 AND expires_at > datetime('now')`
    )
    .get(code) as { owner_chat_id: string } | undefined;

  if (!row) return null;

  getDb()
    .prepare('UPDATE link_codes SET used = 1 WHERE code = ?')
    .run(code);

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
      `SELECT * FROM reset_tokens
       WHERE token = ? AND used = 0 AND expires_at > datetime('now')`
    )
    .get(token) as { admin_user_id: number } | undefined;

  if (!row) return null;

  getDb()
    .prepare('UPDATE reset_tokens SET used = 1 WHERE token = ?')
    .run(token);

  return row.admin_user_id;
}
