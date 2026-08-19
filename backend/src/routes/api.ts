import { Router, Request, Response } from 'express';
import { getAvailableDateKeys, getSlotsForDateFull, bookRange } from '../services/schedule';
import { getBusinessBySlug, getContactLinksWithFallback } from '../services/business';
import { createBookingRequest } from '../repositories/booking-request.repository';
import { notifyBookingRequest, notifyNewBooking } from '../services/booking-notifications';
import { emitNewBookingRequest } from '../services/booking-events';
import { getFreeSlots, getBookableDateKeys, isRangeBookable } from '../services/free-slots';
import { checkRateLimit } from '../services/rate-limit';

export const apiRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Не больше 5 обращений с одного IP за 10 минут — с запасом для живого человека */
const WRITE_LIMIT = 5;
const WRITE_WINDOW_MS = 10 * 60 * 1000;

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

interface ClientContact {
  clientName: string;
  clientPhone: string;
  comment?: string;
}

/**
 * Валидирует контактные данные клиента и согласие на обработку.
 * Согласие обязательно: сервис собирает имя и телефон физлица.
 */
function parseClientContact(body: any): { data?: ClientContact; error?: string } {
  const clientName = String(body.clientName ?? '').trim();
  const clientPhone = String(body.clientPhone ?? '').trim();
  const comment = String(body.description ?? body.comment ?? '').trim();

  if (clientName.length < 2) return { error: 'Укажите имя' };
  if (clientName.length > 100) return { error: 'Имя слишком длинное' };

  const digits = clientPhone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return { error: 'Укажите телефон' };

  if (body.consent !== true) {
    return { error: 'Нужно согласие на обработку персональных данных' };
  }
  if (comment.length > 500) return { error: 'Комментарий слишком длинный' };

  return { data: { clientName, clientPhone, comment: comment || undefined } };
}

// ---- Slug-based routes (мультитенант) ----

apiRouter.get('/business/:slug', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  res.json({
    name: biz.name,
    slug: biz.slug,
    telegramUsername: biz.telegramUsername,
    contactLinks: getContactLinksWithFallback(biz.id, biz.telegramUsername),
    bookingRequestsEnabled: biz.bookingRequestsEnabled,
    slotDurationMinutes: biz.slotDurationMinutes,
  });
});

/**
 * Свободные интервалы дня — то, что клиент видит и нажимает.
 * Считается как опубликованная смена минус существующие брони.
 */
apiRouter.get('/business/:slug/free-slots', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  const date = req.query.date as string;
  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getFreeSlots(biz.id, date, biz.slotDurationMinutes) });
});

/** Мгновенная бронь свободного интервала — без звонка и без подтверждения */
apiRouter.post('/business/:slug/book', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }

  if (!checkRateLimit(`book:${clientIp(req)}`, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    res.status(429).json({ error: 'Слишком много попыток. Попробуйте через несколько минут.' });
    return;
  }

  const { date, startTime, endTime } = req.body;
  if (!date || !DATE_RE.test(date) || !TIME_RE.test(startTime ?? '') || !TIME_RE.test(endTime ?? '')) {
    res.status(400).json({ error: 'Некорректные дата или время' });
    return;
  }

  const contact = parseClientContact(req.body);
  if (!contact.data) {
    res.status(400).json({ error: contact.error });
    return;
  }

  if (!isRangeBookable(biz.id, date, startTime, endTime)) {
    res.status(409).json({ error: 'Это время только что заняли. Выберите другое.' });
    return;
  }

  const booking = bookRange(
    biz.id,
    date,
    startTime,
    endTime,
    contact.data.comment,
    contact.data.clientName,
    contact.data.clientPhone,
  );

  notifyNewBooking(biz, {
    date,
    startTime,
    endTime,
    clientName: contact.data.clientName,
    clientPhone: contact.data.clientPhone,
    comment: contact.data.comment,
  });
  emitNewBookingRequest(biz.id);

  res.json({ ok: true, id: booking.id });
});

/** Заявка на своё время — когда ни один свободный интервал не подошёл */
apiRouter.post('/business/:slug/booking-requests', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  if (!biz.bookingRequestsEnabled) {
    res.status(400).json({ error: 'Форма заявок отключена' });
    return;
  }

  if (!checkRateLimit(`request:${clientIp(req)}`, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    res.status(429).json({ error: 'Слишком много попыток. Попробуйте через несколько минут.' });
    return;
  }

  const { preferredDate, preferredStartTime, preferredEndTime } = req.body;
  if (!preferredDate || !DATE_RE.test(preferredDate)
      || !TIME_RE.test(preferredStartTime ?? '') || !TIME_RE.test(preferredEndTime ?? '')) {
    res.status(400).json({ error: 'Некорректные дата или время' });
    return;
  }

  const contact = parseClientContact(req.body);
  if (!contact.data) {
    res.status(400).json({ error: contact.error });
    return;
  }

  const request = createBookingRequest(
    biz.id,
    contact.data.clientName,
    contact.data.clientPhone,
    preferredDate,
    preferredStartTime,
    preferredEndTime,
    contact.data.comment,
  );

  notifyBookingRequest(biz, request);
  emitNewBookingRequest(biz.id);

  res.json({ ok: true, id: request.id });
});

apiRouter.get('/business/:slug/available-dates', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  res.json({ dates: getBookableDateKeys(biz.id, biz.slotDurationMinutes) });
});

apiRouter.get('/business/:slug/day-slots', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  const date = req.query.date as string;
  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getSlotsForDateFull(biz.id, date) });
});

// ---- Legacy routes (обратная совместимость, используют business_id=1) ----

apiRouter.get('/available-dates', (_req: Request, res: Response) => {
  res.json({ dates: getAvailableDateKeys(1) });
});

apiRouter.get('/day-slots', (req: Request, res: Response) => {
  const date = req.query.date as string;
  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getSlotsForDateFull(1, date) });
});
