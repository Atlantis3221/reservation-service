import { randomBytes } from 'crypto';
import { toDateKey, getMondayOfWeek } from '../utils/date';
import { Router, Request, Response, NextFunction } from 'express';
import { register, login, verifyToken, resetPassword, getAuthUser, AuthError } from '../services/auth';
import { executeCommand, executeAction, getInitialMessages, AVAILABLE_COMMANDS } from '../services/command';
import {
  consumeLinkCode,
  setOwnerChatId,
  getAdminUserByEmail,
  getAdminUserByOwnerChatId,
  consumeResetToken,
  createResetToken,
} from '../repositories/admin-user.repository';
import {
  getBusinessesByOwner,
  getBusinessById,
  getContactLinks,
  upsertContactLink,
  deleteContactLink,
  updateBusinessName,
  updateBusinessSlug,
  updateBookingRequestsEnabled,
  updateWorkingHours,
  updateSlotDuration,
  createBusiness,
  generateSlug,
  moveBusinessesToOwner,
  isValidSlug,
  isSlugTaken,
} from '../services/business';
import { sendPasswordResetEmail, isMailerConfigured } from '../services/mailer';
import { getFreeSlots } from '../services/free-slots';
import {
  getBookingRequestsByBusiness,
  getBookingRequestsByDate,
  getBookingRequestById,
  updateBookingRequestStatus,
  updateBookingRequestDateTime,
  countPendingRequests,
} from '../repositories/booking-request.repository';
import type { BookingRequestStatus } from '../types';
import { waitForBookingRequest } from '../services/booking-events';
import {
  getAllDateKeys,
  getSlotsForDateAdmin,
  findOverlappingBookings,
  bookRange,
  updateBooking,
  getBookingById,
  cancelBookingById,
  addDaySlots,
  addDaySlotRange,
  clearDay,
  clearAvailableSlots,
  getSlotBusinessId,
} from '../services/schedule';

export const adminRouter = Router();

interface AuthRequest extends Request {
  adminUserId?: number;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
// 1440 — сутки: день бронируется целиком (дома, глемпинги, бани с проживанием)
const ALLOWED_SLOT_DURATIONS = [30, 60, 90, 120, 180, 240, 1440];
const MAX_HORIZON_DAYS = 90;
const DEFAULT_HORIZON_DAYS = 28;

/** Индекс дня недели в DAY_KEYS: 0 = понедельник */
function weekdayIndex(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function isValidTime(value: unknown): boolean {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clampHorizon(days: unknown): number {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HORIZON_DAYS;
  return Math.min(Math.floor(n), MAX_HORIZON_DAYS);
}

function horizonDates(days: number): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function weekDates(week: 'this' | 'next'): Date[] {
  const monday = getMondayOfWeek(week);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function randomToken(): string {
  return randomBytes(24).toString('hex');
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

adminRouter.post('/auth/forgot-password', (req: Request, res: Response) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: 'Укажите email' });
    return;
  }

  if (!isMailerConfigured()) {
    res.status(503).json({
      error: 'Восстановление по email пока недоступно. Напишите нам, поможем вручную.',
    });
    return;
  }

  const user = getAdminUserByEmail(email);
  // Отвечаем одинаково независимо от того, есть аккаунт или нет:
  // иначе форма превращается в способ проверять чужие email.
  if (user) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    createResetToken(token, user.id, expiresAt);
    const adminUrl = (process.env.ADMIN_URL || '').replace(/\/+$/, '');
    sendPasswordResetEmail(user.email, `${adminUrl}/reset?token=${token}`);
  }

  res.json({ ok: true });
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

/**
 * Создание заведения из панели. До этого единственным способом был чат,
 * из-за чего холодный пользователь не мог начать пользоваться сервисом.
 */
adminRouter.post('/businesses', (req: AuthRequest, res: Response) => {
  const user = getAuthUser(req.adminUserId!);
  const name = String(req.body?.name ?? '').trim();

  if (name.length < 2) {
    res.status(400).json({ error: 'Название должно быть не короче 2 символов' });
    return;
  }
  if (name.length > 100) {
    res.status(400).json({ error: 'Название слишком длинное' });
    return;
  }

  const ownerChatId = user.ownerChatId;
  if (!ownerChatId) {
    res.status(500).json({ error: 'Аккаунт не инициализирован, войдите заново' });
    return;
  }

  const existing = getBusinessesByOwner(ownerChatId);
  if (existing.length >= 20) {
    res.status(400).json({ error: 'Достигнут лимит заведений' });
    return;
  }

  let slug = String(req.body?.slug ?? '').trim().toLowerCase();
  if (slug) {
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: 'Ссылка: только латиница, цифры и дефис (мин. 3 символа)' });
      return;
    }
    if (isSlugTaken(slug)) {
      res.status(400).json({ error: `Ссылка «${slug}» уже занята` });
      return;
    }
  } else {
    slug = generateSlug(name);
  }

  const business = createBusiness(slug, name, ownerChatId);
  res.json({ business, businesses: getBusinessesByOwner(ownerChatId) });
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
    res.status(400).json({ error: 'Этот аккаунт уже привязан к другому пользователю' });
    return;
  }

  // Заведения, созданные до привязки, лежат под веб-owner'ом. Переносим их,
  // иначе после привязки Telegram они исчезнут из панели.
  const previousOwner = getAuthUser(req.adminUserId!).ownerChatId;
  setOwnerChatId(req.adminUserId!, ownerChatId);
  if (previousOwner) moveBusinessesToOwner(previousOwner, ownerChatId);

  const businesses = getBusinessesByOwner(ownerChatId);
  res.json({ ok: true, businesses });
});

/**
 * Сводка состояния заведения для панели: до какой даты открыта запись,
 * сколько свободного времени осталось, есть ли новые заявки.
 * Нужна, чтобы владелец сразу видел, работает его страница или нет.
 */
adminRouter.get('/business-status', (req: AuthRequest, res: Response) => {
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

  const business = getBusinessById(businessId)!;
  const today = toDateKey(new Date());
  const horizon = horizonDates(MAX_HORIZON_DAYS).map(toDateKey);

  let publishedUntil: string | null = null;
  let freeSlots = 0;
  let upcomingBookings = 0;

  for (const dateKey of horizon) {
    const slots = getSlotsForDateAdmin(businessId, dateKey);
    if (slots.length === 0) continue;
    if (slots.some((slot) => slot.status === 'available')) publishedUntil = dateKey;
    freeSlots += getFreeSlots(businessId, dateKey, business.slotDurationMinutes).length;
    upcomingBookings += slots.filter((slot) => slot.status === 'booked').length;
  }

  res.json({
    slug: business.slug,
    name: business.name,
    slotDurationMinutes: business.slotDurationMinutes,
    hasWorkingHours: !!business.workingHours,
    bookingRequestsEnabled: business.bookingRequestsEnabled,
    publishedUntil,
    freeSlots,
    upcomingBookings,
    pendingRequests: countPendingRequests(businessId),
    today,
  });
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
  const bookingRequests = getBookingRequestsByDate(businessId, date).map((r) => ({
    id: r.id,
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    description: r.description,
    preferredStartTime: r.preferredStartTime,
    preferredEndTime: r.preferredEndTime,
    status: r.status,
  }));
  res.json({ slots, bookingRequests });
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

// ---- Booking Requests API ----

adminRouter.get('/booking-requests', (req: AuthRequest, res: Response) => {
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
  const status = req.query.status as BookingRequestStatus | undefined;
  const requests = getBookingRequestsByBusiness(businessId, status);
  const pendingCount = countPendingRequests(businessId);
  res.json({ requests, pendingCount });
});

adminRouter.get('/booking-requests/poll', async (req: AuthRequest, res: Response) => {
  const businessId = Number(req.query.businessId);
  const lastCount = Number(req.query.lastCount) || 0;
  if (!businessId) {
    res.status(400).json({ error: 'businessId обязателен' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  const currentCount = countPendingRequests(businessId);
  if (currentCount !== lastCount) {
    res.json({ pendingCount: currentCount });
    return;
  }

  const changed = await waitForBookingRequest(businessId, 30_000);
  const newCount = changed ? countPendingRequests(businessId) : currentCount;
  res.json({ pendingCount: newCount });
});

adminRouter.put('/booking-requests/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  const bookingReq = getBookingRequestById(id);
  if (!bookingReq) {
    res.status(404).json({ error: 'Заявка не найдена' });
    return;
  }
  const access = verifyBusinessAccess(req, bookingReq.businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  const { status, preferredDate, preferredStartTime, preferredEndTime } = req.body;

  if (preferredDate && preferredStartTime && preferredEndTime) {
    updateBookingRequestDateTime(id, preferredDate, preferredStartTime, preferredEndTime);
  }

  if (status) {
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Статус должен быть pending, approved или rejected' });
      return;
    }
    updateBookingRequestStatus(id, status);

    if (status === 'approved') {
      const fresh = getBookingRequestById(id)!;
      bookRange(
        fresh.businessId,
        fresh.preferredDate,
        fresh.preferredStartTime,
        fresh.preferredEndTime,
        fresh.description || 'Заявка с сайта',
        fresh.clientName,
        fresh.clientPhone,
      );
    }
  }

  res.json({ ok: true });
});

// ---- Settings API ----

adminRouter.get('/settings', (req: AuthRequest, res: Response) => {
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
  const business = getBusinessById(businessId)!;
  const contactLinksList = getContactLinks(businessId);
  res.json({
    name: business.name,
    slug: business.slug,
    bookingRequestsEnabled: business.bookingRequestsEnabled,
    workingHours: business.workingHours,
    slotDurationMinutes: business.slotDurationMinutes,
    contactLinks: contactLinksList,
  });
});

adminRouter.put('/settings', (req: AuthRequest, res: Response) => {
  const {
    businessId, name, slug, bookingRequestsEnabled,
    workingHours: whUpdate, contactLinks: linksUpdate, slotDurationMinutes,
  } = req.body;
  if (!businessId) {
    res.status(400).json({ error: 'businessId обязателен' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  if (name !== undefined) {
    if (!name.trim()) {
      res.status(400).json({ error: 'Название не может быть пустым' });
      return;
    }
    updateBusinessName(businessId, name.trim());
  }

  if (slug !== undefined) {
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: 'Slug: только латиница, цифры и дефис (мин. 3 символа)' });
      return;
    }
    if (isSlugTaken(slug) && getBusinessById(businessId)?.slug !== slug) {
      res.status(400).json({ error: `Slug «${slug}» уже занят` });
      return;
    }
    updateBusinessSlug(businessId, slug);
  }

  if (bookingRequestsEnabled !== undefined) {
    updateBookingRequestsEnabled(businessId, !!bookingRequestsEnabled);
  }

  if (whUpdate !== undefined) {
    updateWorkingHours(businessId, whUpdate);
  }

  if (slotDurationMinutes !== undefined) {
    const minutes = Number(slotDurationMinutes);
    if (!ALLOWED_SLOT_DURATIONS.includes(minutes)) {
      res.status(400).json({
        error: 'Недопустимая длительность сеанса',
      });
      return;
    }
    updateSlotDuration(businessId, minutes);
  }

  if (linksUpdate) {
    for (const link of linksUpdate) {
      if (link.url) {
        upsertContactLink(businessId, link.type, link.url);
      } else {
        deleteContactLink(businessId, link.type);
      }
    }
  }

  res.json({ ok: true });
});

adminRouter.post('/settings/apply-schedule', (req: AuthRequest, res: Response) => {
  const { businessId, week, days } = req.body;
  if (!businessId) {
    res.status(400).json({ error: 'businessId обязателен' });
    return;
  }
  const access = verifyBusinessAccess(req, businessId);
  if (!access.ok) {
    res.status(403).json({ error: access.error });
    return;
  }

  const business = getBusinessById(businessId)!;
  const wh = business.workingHours;
  if (!wh) {
    res.status(400).json({ error: 'Рабочие часы не настроены' });
    return;
  }

  const enabledDays = DAY_KEYS.filter((k) => wh[k]?.enabled);
  if (enabledDays.length === 0) {
    res.status(400).json({ error: 'Не выбран ни один рабочий день' });
    return;
  }

  // `days` — основной режим: открыть запись на N дней вперёд, начиная с сегодня.
  // `week` оставлен для обратной совместимости со старой кнопкой «эта/следующая неделя».
  const horizon = clampHorizon(days);
  const dates = week
    ? weekDates(week === 'next' ? 'next' : 'this')
    : horizonDates(horizon);

  let created = 0;
  for (const date of dates) {
    const dayConfig = wh[DAY_KEYS[weekdayIndex(date)]];
    if (!dayConfig?.enabled) continue;
    if (!isValidTime(dayConfig.start) || !isValidTime(dayConfig.end)) continue;

    const dateKey = toDateKey(date);
    // Стираем только свободное время: брони клиентов должны выжить.
    clearAvailableSlots(businessId, dateKey);
    addDaySlotRange(businessId, dateKey, dayConfig.start, dayConfig.end);
    created++;
  }

  res.json({
    ok: true,
    daysCreated: created,
    freeSlots: dates.reduce(
      (sum, date) => sum + getFreeSlots(businessId, toDateKey(date), business.slotDurationMinutes).length,
      0,
    ),
  });
});
