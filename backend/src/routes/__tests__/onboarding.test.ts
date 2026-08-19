import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Регрессия на главную поломку активации: до этого веб-пользователь создавал
 * заведение, а /init и /me возвращали пустой список — заведение исчезало
 * из панели навсегда, и опубликовать расписание было невозможно.
 */

// vi.hoisted выполняется до импортов: db.ts читает DB_DIR на этапе загрузки модуля
const { tmpDir } = vi.hoisted(() => {
  const fsSync = require('fs');
  const osSync = require('os');
  const pathSync = require('path');
  const dir = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'slotik-onb-'));
  process.env.DB_DIR = dir;
  process.env.JWT_SECRET = 'test-secret';
  process.env.FRONTEND_URL = 'https://slotik.tech';
  return { tmpDir: dir };
});

vi.mock('../../services/monitor', () => ({
  notifyNewBusiness: () => {},
  notifyError: () => {},
  trackBotMessage: () => {},
  trackUnrecognizedCommand: () => {},
}));

vi.mock('../../services/booking-notifications', () => ({
  notifyBookingRequest: () => {},
  notifyNewBooking: () => {},
}));

import { initDb, getDb } from '../../services/db';
import { adminRouter } from '../admin';
import { apiRouter } from '../api';
import { resetRateLimits } from '../../services/rate-limit';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  initDb();

  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use('/api', apiRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let token = '';
let emailSeq = 0;

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(baseUrl + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

async function registerFreshUser() {
  emailSeq++;
  const res = await call('POST', '/admin/auth/register', {
    email: `owner${emailSeq}@test.ru`,
    password: 'password123',
  });
  token = res.body.token;
  return res;
}

function allWeekHours(start = '10:00', end = '22:00') {
  const config: Record<string, unknown> = {};
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    config[day] = { enabled: true, start, end };
  }
  return config;
}

beforeEach(() => {
  token = '';
  resetRateLimits();
});

describe('путь холодного пользователя', () => {
  it('выдаёт аккаунту собственного владельца при регистрации', async () => {
    const res = await registerFreshUser();
    expect(res.status).toBe(200);
    expect(res.body.user.ownerChatId).toMatch(/^web:\d+$/);
  });

  it('заведение остаётся видимым после перезагрузки панели', async () => {
    await registerFreshUser();

    const created = await call('POST', '/admin/businesses', { name: 'Баня на Пруду' });
    expect(created.status).toBe(200);
    expect(created.body.business.slug).toBe('banya-na-prudu');

    // Это и ломалось: повторный /init возвращал пустой список
    const init = await call('POST', '/admin/init');
    expect(init.body.businesses.map((b: any) => b.slug)).toEqual(['banya-na-prudu']);

    const me = await call('GET', '/admin/me');
    expect(me.body.businesses).toHaveLength(1);
  });

  it('включает приём заявок у нового заведения по умолчанию', async () => {
    await registerFreshUser();
    const created = await call('POST', '/admin/businesses', { name: 'Корт' });
    expect(created.body.business.bookingRequestsEnabled).toBe(true);
  });

  it('не создаёт заведение с пустым названием', async () => {
    await registerFreshUser();
    expect((await call('POST', '/admin/businesses', { name: ' ' })).status).toBe(400);
  });

  it('доводит до опубликованного расписания и первой брони', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Глемпинг' });

    await call('PUT', '/admin/settings', {
      businessId: business.id,
      workingHours: allWeekHours('10:30', '20:30'),
      slotDurationMinutes: 90,
    });

    const published = await call('POST', '/admin/settings/apply-schedule', {
      businessId: business.id,
      days: 7,
    });
    expect(published.body.daysCreated).toBe(7);
    expect(published.body.freeSlots).toBeGreaterThan(0);

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    expect(dates.body.dates.length).toBeGreaterThan(0);

    const day = dates.body.dates[dates.body.dates.length - 1];
    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    // Получасовые границы должны сохраниться, а не округлиться до 10:00
    expect(free.body.slots[0].startTime).toBe('10:30');

    const slot = free.body.slots[0];
    const booked = await call('POST', `/api/business/${business.slug}/book`, {
      date: day,
      startTime: slot.startTime,
      endTime: slot.endTime,
      clientName: 'Пётр',
      clientPhone: '+7 900 111-22-33',
      consent: true,
    });
    expect(booked.status).toBe(200);

    const afterBooking = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    expect(afterBooking.body.slots.map((s: any) => s.startTime)).not.toContain(slot.startTime);

    const status = await call('GET', `/admin/business-status?businessId=${business.id}`);
    expect(status.body.publishedUntil).not.toBeNull();
    expect(status.body.upcomingBookings).toBe(1);
  });

  it('не отдаёт клиентские контакты в публичном API', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Студия' });
    await call('PUT', '/admin/settings', {
      businessId: business.id, workingHours: allWeekHours(), slotDurationMinutes: 120,
    });
    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 3 });

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    const day = dates.body.dates[dates.body.dates.length - 1];
    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);

    await call('POST', `/api/business/${business.slug}/book`, {
      date: day,
      startTime: free.body.slots[0].startTime,
      endTime: free.body.slots[0].endTime,
      clientName: 'Мария',
      clientPhone: '+7 900 555-11-22',
      comment: 'приватная заметка',
      consent: true,
    });

    const publicSlots = await call('GET', `/api/business/${business.slug}/day-slots?date=${day}`);
    const serialized = JSON.stringify(publicSlots.body);
    expect(serialized).not.toContain('Мария');
    expect(serialized).not.toContain('555-11-22');
    expect(serialized).not.toContain('приватная заметка');

    const ownerSlots = await call('GET', `/admin/calendar/slots?businessId=${business.id}&date=${day}`);
    expect(JSON.stringify(ownerSlots.body)).toContain('Мария');
  });

  it('не даёт занять одно время дважды', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Квест' });
    await call('PUT', '/admin/settings', {
      businessId: business.id, workingHours: allWeekHours(), slotDurationMinutes: 120,
    });
    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 3 });

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    const day = dates.body.dates[dates.body.dates.length - 1];
    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    const slot = free.body.slots[0];

    const payload = {
      date: day, startTime: slot.startTime, endTime: slot.endTime,
      clientName: 'Первый', clientPhone: '+7 900 000-00-01', consent: true,
    };

    expect((await call('POST', `/api/business/${business.slug}/book`, payload)).status).toBe(200);
    const second = await call('POST', `/api/business/${business.slug}/book`, {
      ...payload, clientName: 'Второй',
    });
    expect(second.status).toBe(409);
  });

  it('требует согласие на обработку персональных данных', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Прокат' });
    await call('PUT', '/admin/settings', {
      businessId: business.id, workingHours: allWeekHours(), slotDurationMinutes: 120,
    });
    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 3 });

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    const day = dates.body.dates[dates.body.dates.length - 1];
    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);

    const res = await call('POST', `/api/business/${business.slug}/book`, {
      date: day,
      startTime: free.body.slots[0].startTime,
      endTime: free.body.slots[0].endTime,
      clientName: 'Без согласия',
      clientPhone: '+7 900 000-00-02',
    });
    expect(res.status).toBe(400);
  });

  it('перепубликация расписания не удаляет брони клиентов', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Беседка' });
    await call('PUT', '/admin/settings', {
      businessId: business.id, workingHours: allWeekHours(), slotDurationMinutes: 120,
    });
    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 7 });

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    const day = dates.body.dates[dates.body.dates.length - 1];
    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);

    await call('POST', `/api/business/${business.slug}/book`, {
      date: day,
      startTime: free.body.slots[0].startTime,
      endTime: free.body.slots[0].endTime,
      clientName: 'Не потеряться',
      clientPhone: '+7 900 000-00-03',
      consent: true,
    });

    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 7 });

    const ownerSlots = await call('GET', `/admin/calendar/slots?businessId=${business.id}&date=${day}`);
    const booked = ownerSlots.body.slots.filter((s: any) => s.status === 'booked');
    expect(booked).toHaveLength(1);
    expect(booked[0].clientName).toBe('Не потеряться');
  });

  it('после привязки Telegram заведения не теряются', async () => {
    await registerFreshUser();
    await call('POST', '/admin/businesses', { name: 'Шале' });

    // Имитируем код привязки так же, как его выдаёт бот
    const db = getDb();
    const expires = new Date(Date.now() + 600_000).toISOString();
    db.prepare('INSERT INTO link_codes (code, owner_chat_id, expires_at) VALUES (?, ?, ?)')
      .run('123456', '555000111', expires);

    const linked = await call('POST', '/admin/link-telegram', { code: '123456' });
    expect(linked.status).toBe(200);
    expect(linked.body.businesses.map((b: any) => b.slug)).toEqual(['shale']);

    const init = await call('POST', '/admin/init');
    expect(init.body.businesses).toHaveLength(1);
  });
});
