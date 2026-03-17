import { Router, Request, Response } from 'express';
import { getAvailableDateKeys, getSlotsForDateFull } from '../services/schedule';
import { getBusinessBySlug, getContactLinksWithFallback } from '../services/business';

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
  });
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
