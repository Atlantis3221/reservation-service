import { Router, Request, Response } from 'express';
import type { Reservation, CreateReservationBody } from '../types';
import { getAvailableDateKeys, getSlotsForDateFull, bookRange, setSlotStatus } from '../services/schedule';

export const apiRouter = Router();

const reservations: Reservation[] = [];
let nextId = 1;

// ---- Бронирования ----

apiRouter.get('/reservations', (_req: Request, res: Response) => {
  res.json(reservations);
});

apiRouter.post('/reservations', (req: Request<{}, {}, CreateReservationBody>, res: Response) => {
  const { name, date, guests, comment } = req.body;

  if (!name || !date) {
    res.status(400).json({ error: 'name и date обязательны' });
    return;
  }

  const reservation: Reservation = {
    id: nextId++,
    name,
    date,
    guests: guests ?? 1,
    comment: comment ?? '',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };

  setSlotStatus(date, 'booked', name);

  reservations.push(reservation);
  res.status(201).json(reservation);
});

apiRouter.get('/reservations/:id', (req: Request, res: Response) => {
  const item = reservations.find((r) => r.id === Number(req.params.id));
  if (!item) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(item);
});

apiRouter.delete('/reservations/:id', (req: Request, res: Response) => {
  const idx = reservations.findIndex((r) => r.id === Number(req.params.id));
  if (idx === -1) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }

  reservations[idx].status = 'cancelled';
  setSlotStatus(reservations[idx].date, 'available');
  res.json(reservations[idx]);
});

// ---- Расписание ----

// Даты, на которых есть свободные слоты (для месячной сетки)
apiRouter.get('/available-dates', (_req: Request, res: Response) => {
  res.json({ dates: getAvailableDateKeys() });
});

// Все слоты на конкретную дату (для таймлайна дня)
apiRouter.get('/day-slots', (req: Request, res: Response) => {
  const date = req.query.date as string;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Параметр date обязателен (YYYY-MM-DD)' });
    return;
  }
  res.json({ slots: getSlotsForDateFull(date) });
});
