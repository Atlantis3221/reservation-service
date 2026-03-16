import { Router, Request, Response, NextFunction } from 'express';
import { register, login, verifyToken, resetPassword, getAuthUser, AuthError } from '../services/auth';
import { executeCommand, executeAction, getInitialMessages, AVAILABLE_COMMANDS } from '../services/command';
import {
  consumeLinkCode,
  setOwnerChatId,
  getAdminUserByOwnerChatId,
  consumeResetToken,
} from '../repositories/admin-user.repository';
import { getBusinessesByOwner, getBusinessById } from '../services/business';

export const adminRouter = Router();

interface AuthRequest extends Request {
  adminUserId?: number;
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  try {
    const { userId } = verifyToken(header.slice(7));
    req.adminUserId = userId;
    next();
  } catch {
    res.status(401).json({ error: 'Невалидный токен' });
  }
}

// ---- Auth (public) ----

adminRouter.post('/auth/register', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = register(email, password);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminRouter.post('/auth/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const result = login(email, password);
    res.json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminRouter.post('/auth/reset-password', (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    const adminUserId = consumeResetToken(token);
    if (!adminUserId) {
      res.status(400).json({ error: 'Ссылка для сброса недействительна или истекла' });
      return;
    }
    resetPassword(adminUserId, newPassword);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---- Protected ----

adminRouter.use(authMiddleware);

adminRouter.get('/me', (req: AuthRequest, res: Response) => {
  const user = getAuthUser(req.adminUserId!);
  const businesses = user.ownerChatId ? getBusinessesByOwner(user.ownerChatId) : [];
  res.json({ user, businesses });
});

adminRouter.get('/commands', (_req: AuthRequest, res: Response) => {
  res.json({ commands: AVAILABLE_COMMANDS });
});

adminRouter.post('/command', (req: AuthRequest, res: Response) => {
  const { text, businessId, action } = req.body;
  const user = getAuthUser(req.adminUserId!);

  let business = null;
  if (businessId) {
    business = getBusinessById(businessId);
    if (business && business.ownerChatId !== user.ownerChatId && business.ownerChatId !== String(req.adminUserId)) {
      res.status(403).json({ error: 'Нет доступа к этому заведению' });
      return;
    }
  }

  if (action) {
    const result = executeAction(req.adminUserId!, action, business);
    res.json(result);
    return;
  }

  if (!text) {
    res.status(400).json({ error: 'Текст команды обязателен' });
    return;
  }

  const result = executeCommand(req.adminUserId!, text, business, user.ownerChatId);
  res.json(result);
});

adminRouter.post('/init', (req: AuthRequest, res: Response) => {
  const user = getAuthUser(req.adminUserId!);
  const result = getInitialMessages(req.adminUserId!, user.ownerChatId);
  const businesses = user.ownerChatId ? getBusinessesByOwner(user.ownerChatId) : [];
  res.json({ ...result, businesses });
});

adminRouter.post('/link-telegram', (req: AuthRequest, res: Response) => {
  const { code } = req.body;
  if (!code) {
    res.status(400).json({ error: 'Код обязателен' });
    return;
  }

  const ownerChatId = consumeLinkCode(code);
  if (!ownerChatId) {
    res.status(400).json({ error: 'Код недействителен или истёк' });
    return;
  }

  const existing = getAdminUserByOwnerChatId(ownerChatId);
  if (existing && existing.id !== req.adminUserId!) {
    res.status(400).json({ error: 'Этот Telegram аккаунт уже привязан к другому пользователю' });
    return;
  }

  setOwnerChatId(req.adminUserId!, ownerChatId);
  const businesses = getBusinessesByOwner(ownerChatId);
  res.json({ ok: true, businesses });
});
