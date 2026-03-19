import { Router, Request, Response } from 'express';
import { getAvailableDateKeys, getSlotsForDateFull } from '../services/schedule';
import { getBusinessBySlug, getContactLinksWithFallback } from '../services/business';
import { createBookingRequest } from '../repositories/booking-request.repository';
import { notifyBookingRequest } from '../services/booking-notifications';
import { emitNewBookingRequest } from '../services/booking-events';

export const apiRouter = Router();

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
  });
});

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

  const { clientName, clientPhone, preferredDate, preferredStartTime, preferredEndTime, description } = req.body;
  if (!clientName?.trim() || !clientPhone?.trim() || !preferredDate || !preferredStartTime || !preferredEndTime) {
    res.status(400).json({ error: 'Обязательные поля: clientName, clientPhone, preferredDate, preferredStartTime, preferredEndTime' });
    return;
  }

  const request = createBookingRequest(
    biz.id,
    clientName.trim(),
    clientPhone.trim(),
    preferredDate,
    preferredStartTime,
    preferredEndTime,
    description?.trim() || undefined,
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
  res.json({ dates: getAvailableDateKeys(biz.id) });
});

apiRouter.get('/business/:slug/day-slots', (req: Request<{ slug: string }>, res: Response) => {
  const biz = getBusinessBySlug(req.params.slug);
  if (!biz) {
    res.status(404).json({ error: 'Заведение не найдено' });
    return;
  }
  const date = req.query.date as string;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getSlotsForDateFull(1, date) });
});
