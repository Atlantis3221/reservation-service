import { Router, Request, Response } from 'express';
import type { Reservation, CreateReservationBody } from '../types';
import { getAvailableSlots, setSlotStatus } from '../services/schedule';

export const apiRouter = Router();

const reservations: Reservation[] = [];
let nextId = 1;

// ---- Бронирования ----

// Получить все бронирования
apiRouter.get('/reservations', (_req: Request, res: Response) => {
  res.json(reservations);
});

// Создать бронирование
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

  // Помечаем слот как забронированный
  setSlotStatus(date, 'booked', name);

  reservations.push(reservation);
  res.status(201).json(reservation);
});

// Получить бронирование по id
apiRouter.get('/reservations/:id', (req: Request, res: Response) => {
  const item = reservations.find((r) => r.id === Number(req.params.id));
  if (!item) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(item);
});

// Отменить бронирование
apiRouter.delete('/reservations/:id', (req: Request, res: Response) => {
  const idx = reservations.findIndex((r) => r.id === Number(req.params.id));
  if (idx === -1) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }

  reservations[idx].status = 'cancelled';

  // Освобождаем слот
  setSlotStatus(reservations[idx].date, 'available');

  res.json(reservations[idx]);
});

// ---- Расписание (читает фронтенд) ----

// Получить свободные слоты
apiRouter.get('/available-slots', (_req: Request, res: Response) => {
  const slots = getAvailableSlots();
  res.json({ slots });
});
