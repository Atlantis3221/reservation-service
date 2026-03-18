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
import {
  getAllDateKeys,
  getSlotsForDateAdmin,
  findOverlappingBookings,
  bookRange,
  updateBooking,
  getBookingById,
  cancelBookingById,
  addDaySlots,
  getSlotBusinessId,
} from '../services/schedule';

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

// ---- Calendar API ----

function verifyBusinessAccess(req: AuthRequest, businessId: number): { ok: boolean; error?: string } {
  const user = getAuthUser(req.adminUserId!);
  const business = getBusinessById(businessId);
  if (!business) return { ok: false, error: 'Заведение не найдено' };
  if (business.ownerChatId !== user.ownerChatId && business.ownerChatId !== String(req.adminUserId)) {
    return { ok: false, error: 'Нет доступа к этому заведению' };
  }
  return { ok: true };
}

adminRouter.get('/calendar/dates', (req: AuthRequest, res: Response) => {
  const businessId = Number(req.query.businessId);
  if (!businessId) {
    res.status(400).json({ error: 'businessId обязателен' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }
  const dates = getAllDateKeys(businessId);
  res.json({ dates });
});

adminRouter.get('/calendar/slots', (req: AuthRequest, res: Response) => {
  const businessId = Number(req.query.businessId);
  const date = req.query.date as string;
  if (!businessId || !date) {
    res.status(400).json({ error: 'businessId и date обязательны' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }
  const slots = getSlotsForDateAdmin(businessId, date);
  res.json({ slots });
});

adminRouter.post('/calendar/booking', (req: AuthRequest, res: Response) => {
  const { businessId, date, startTime, endTime, clientName, clientPhone, note, force } = req.body;
  if (!businessId || !date || !startTime || !endTime) {
    res.status(400).json({ error: 'Обязательные поля: businessId, date, startTime, endTime' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  const overlaps = findOverlappingBookings(businessId, date, startTime, endTime);
  if (overlaps.length > 0 && !force) {
    res.json({ conflict: true, overlaps });
    return;
  }

  const result = bookRange(businessId, date, startTime, endTime, note, clientName, clientPhone);
  res.json({ ok: true, id: result.id });
});

adminRouter.put('/calendar/booking/:id', (req: AuthRequest, res: Response) => {
  const slotId = Number(req.params.id);
  const booking = getBookingById(slotId);
  if (!booking) {
    res.status(404).json({ error: 'Запись не найдена' });
    return;
  }
  const access = verifyBusinessAccess(req, booking.businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  const { date, startTime, endTime, clientName, clientPhone, note, force } = req.body;
  if (clientName !== undefined && !clientName.trim()) {
    res.status(400).json({ error: 'Имя клиента обязательно' });
    return;
  }

  const newDateKey = date || booking.dateKey;
  const newStartTime = startTime || booking.startTime;
  const newEndTime = endTime || booking.endTime;

  const timeChanged = newDateKey !== booking.dateKey
    || newStartTime !== booking.startTime
    || newEndTime !== booking.endTime;

  if (timeChanged && !force) {
    const overlaps = findOverlappingBookings(booking.businessId, newDateKey, newStartTime, newEndTime)
      .filter((o) => o.id !== slotId);
    if (overlaps.length > 0) {
      res.json({ conflict: true, overlaps });
      return;
    }
  }

  const fields: Record<string, any> = {};
  if (date !== undefined) fields.dateKey = date;
  if (startTime !== undefined) fields.startTime = startTime;
  if (endTime !== undefined) fields.endTime = endTime;
  if (clientName !== undefined) fields.clientName = clientName.trim();
  if (clientPhone !== undefined) fields.clientPhone = clientPhone || null;
  if (note !== undefined) fields.note = note || null;

  const updated = updateBooking(slotId, fields);
  if (!updated) {
    res.status(404).json({ error: 'Запись не найдена или уже отменена' });
    return;
  }
  res.json({ ok: true });
});

adminRouter.delete('/calendar/booking/:id', (req: AuthRequest, res: Response) => {
  const slotId = Number(req.params.id);
  const slotBusinessId = getSlotBusinessId(slotId);
  if (!slotBusinessId) {
    res.status(404).json({ error: 'Запись не найдена' });
    return;
  }
  const access = verifyBusinessAccess(req, slotBusinessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }
  const result = cancelBookingById(slotId);
  if (result.cancelled === 0) {
    res.status(404).json({ error: 'Запись не найдена или уже отменена' });
    return;
  }
  res.json({ ok: true });
});

adminRouter.post('/calendar/schedule', (req: AuthRequest, res: Response) => {
  const { businessId, date, startHour, endHour } = req.body;
  if (!businessId || !date || startHour == null || endHour == null) {
    res.status(400).json({ error: 'Обязательные поля: businessId, date, startHour, endHour' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }
  const slots = addDaySlots(businessId, date, startHour, endHour);
  res.json({ ok: true, slots });
});
