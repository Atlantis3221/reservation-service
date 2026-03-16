import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  createAdminUser,
  getAdminUserByEmail,
  getAdminUserById,
  updatePassword,
} from '../repositories/admin-user.repository';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

export interface AuthResult {
  token: string;
  user: { id: number; email: string; ownerChatId: string | null };
}

export function register(email: string, password: string): AuthResult {
  if (!email || !isValidEmail(email)) {
    throw new AuthError('Некорректный email');
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов`);
  }

  const existing = getAdminUserByEmail(email.toLowerCase());
  if (existing) {
    throw new AuthError('Email уже зарегистрирован');
  }

  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = createAdminUser(email.toLowerCase(), hash);

  const token = signToken(user.id);
  return {
    token,
    user: { id: user.id, email: user.email, ownerChatId: user.owner_chat_id },
  };
}

export function login(email: string, password: string): AuthResult {
  if (!email || !password) {
    throw new AuthError('Неверный email или пароль');
  }

  const user = getAdminUserByEmail(email.toLowerCase());
  if (!user) {
    throw new AuthError('Неверный email или пароль');
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    throw new AuthError('Неверный email или пароль');
  }

  const token = signToken(user.id);
  return {
    token,
    user: { id: user.id, email: user.email, ownerChatId: user.owner_chat_id },
  };
}

export function verifyToken(token: string): { userId: number } {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number };
    return { userId: payload.sub };
  } catch {
    throw new AuthError('Невалидный токен');
  }
}

export function resetPassword(adminUserId: number, newPassword: string): void {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов`);
  }
  const hash = bcrypt.hashSync(newPassword, SALT_ROUNDS);
  updatePassword(adminUserId, hash);
}

export function getAuthUser(userId: number) {
  const user = getAdminUserById(userId);
  if (!user) throw new AuthError('Пользователь не найден');
  return { id: user.id, email: user.email, ownerChatId: user.owner_chat_id };
}

function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
