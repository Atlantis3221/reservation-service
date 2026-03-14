import { Router, Request, Response } from 'express';
import { getAvailableDateKeys, getSlotsForDateFull, bookRange, setSlotStatus } from '../services/schedule';

export const apiRouter = Router();

// ---- Расписание ----

apiRouter.get('/available-dates', (_req: Request, res: Response) => {
  res.json({ dates: getAvailableDateKeys() });
});

apiRouter.get('/day-slots', (req: Request, res: Response) => {
  const date = req.query.date as string;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getSlotsForDateFull(date) });
});
