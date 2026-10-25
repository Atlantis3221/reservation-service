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
import { issueLinkCode } from '../../repositories/admin-user.repository';

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
    expect(booked.body.clientToken).toMatch(/^[a-f0-9]{32}$/);

    // Личная ссылка клиента открывает его запись — и только в своём заведении
    const mine = await call('GET', `/api/business/${business.slug}/booking/${booked.body.clientToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ date: day, startTime: slot.startTime, endTime: slot.endTime, clientName: 'Пётр' });
    expect(mine.body.clientPhone).toBeUndefined();
    expect((await call('GET', `/api/business/demo-other/booking/${booked.body.clientToken}`)).status).toBe(404);
    expect((await call('GET', `/api/business/${business.slug}/booking/${'0'.repeat(32)}`)).status).toBe(404);

    const afterBooking = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    expect(afterBooking.body.slots.map((s: any) => s.startTime)).not.toContain(slot.startTime);

    const status = await call('GET', `/admin/business-status?businessId=${business.id}`);
    expect(status.body.publishedUntil).not.toBeNull();
    expect(status.body.upcomingBookings).toBe(1);
  });

  it('пример (адрес primer-*) не принимает ни брони, ни заявки (H-008)', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Пример: корт', slug: 'primer-kort' });
    expect(business.slug).toBe('primer-kort');
    await call('PUT', '/admin/settings', { businessId: business.id, workingHours: allWeekHours() });
    await call('POST', '/admin/settings/apply-schedule', { businessId: business.id, days: 7 });

    const info = await call('GET', '/api/business/primer-kort');
    expect(info.body.example).toBe(true);

    // Время видно — пример показывает, как выглядит запись
    const dates = await call('GET', '/api/business/primer-kort/available-dates');
    const day = dates.body.dates[dates.body.dates.length - 1];
    const slot = (await call('GET', `/api/business/primer-kort/free-slots?date=${day}`)).body.slots[0];
    expect(slot).toBeDefined();

    const client = { clientName: 'Пётр', clientPhone: '+7 900 111-22-33', consent: true };
    const booked = await call('POST', '/api/business/primer-kort/book', {
      date: day, startTime: slot.startTime, endTime: slot.endTime, ...client,
    });
    expect(booked.status).toBe(403);
    expect(booked.body.error).toBe('Это пример, запись не уходит');

    const requested = await call('POST', '/api/business/primer-kort/booking-requests', {
      preferredDate: day, preferredStartTime: '12:00', preferredEndTime: '13:00', ...client,
    });
    expect(requested.status).toBe(403);

    const status = await call('GET', `/admin/business-status?businessId=${business.id}`);
    expect(status.body.upcomingBookings).toBe(0);
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM booking_requests WHERE business_id = ?').get(business.id) as any;
    expect(count.n).toBe(0);

    // «Пример: …» становится примером сам, а настоящая «Пример студии» — нет
    const named = await call('POST', '/admin/businesses', { name: 'Пример: бильярд' });
    expect(named.body.business.slug).toBe('primer-bilyard');
    const { body: { business: real } } = await call('POST', '/admin/businesses', { name: 'Пример студии' });
    expect(real.slug).toBe('mesto-primer-studii');
    expect((await call('GET', `/api/business/${real.slug}`)).body.example).toBe(false);
  });

  it('пример отдаёт заготовку для онбординга без входа, обычное заведение — нет (H-008)', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Пример: теннисный корт' });
    const hours = allWeekHours('08:00', '23:00');
    await call('PUT', '/admin/settings', { businessId: business.id, workingHours: hours, slotDurationMinutes: 60 });
    await call('POST', '/admin/businesses', { name: 'Баня Ромашка' });

    token = '';
    const tpl = await call('GET', `/admin/primer/${business.slug}`);
    expect(tpl.status).toBe(200);
    expect(tpl.body.name).toBe('теннисный корт');
    expect(tpl.body.workingHours.mon).toEqual({ enabled: true, start: '08:00', end: '23:00' });
    expect(tpl.body.slotDurationMinutes).toBe(60);
    expect(tpl.body).not.toHaveProperty('ownerChatId');

    expect((await call('GET', '/admin/primer/banya-romashka')).status).toBe(404);
    expect((await call('GET', '/admin/primer/primer-net-takogo')).status).toBe(404);
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

describe('сутки как длительность сеанса', () => {
  it('день продаётся целиком и исчезает после брони', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Глемпинг Сутки' });

    // Заезд 14:00, выезд 12:00 следующего дня — смена через полночь
    await call('PUT', '/admin/settings', {
      businessId: business.id,
      workingHours: allWeekHours('14:00', '12:00'),
      slotDurationMinutes: 1440,
    });
    const published = await call('POST', '/admin/settings/apply-schedule', {
      businessId: business.id,
      days: 5,
    });
    expect(published.body.daysCreated).toBe(5);

    const dates = await call('GET', `/api/business/${business.slug}/available-dates`);
    const day = dates.body.dates[dates.body.dates.length - 1];

    const free = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    expect(free.body.slots).toHaveLength(1);
    expect(free.body.slots[0]).toMatchObject({
      startTime: '14:00', endTime: '12:00', fullDay: true,
    });

    const booked = await call('POST', `/api/business/${business.slug}/book`, {
      date: day,
      startTime: '14:00',
      endTime: '12:00',
      clientName: 'Гость',
      clientPhone: '+7 900 000-00-77',
      consent: true,
    });
    expect(booked.status).toBe(200);

    // Занятый день больше не предлагается — «половины суток» не бывает
    const after = await call('GET', `/api/business/${business.slug}/free-slots?date=${day}`);
    expect(after.body.slots).toEqual([]);

    const stillListed = await call('GET', `/api/business/${business.slug}/available-dates`);
    expect(stillListed.body.dates).not.toContain(day);
  });

  it('принимает круглосуточную смену 00:00–00:00', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Дом Сутки' });
    await call('PUT', '/admin/settings', {
      businessId: business.id,
      workingHours: allWeekHours('00:00', '00:00'),
      slotDurationMinutes: 1440,
    });
    const published = await call('POST', '/admin/settings/apply-schedule', {
      businessId: business.id,
      days: 4,
    });
    expect(published.body.daysCreated).toBe(4);
    expect(published.body.freeSlots).toBeGreaterThan(0);
  });

  it('отклоняет длительность вне списка', async () => {
    await registerFreshUser();
    const { body: { business } } = await call('POST', '/admin/businesses', { name: 'Проверка' });
    const res = await call('PUT', '/admin/settings', {
      businessId: business.id,
      slotDurationMinutes: 777,
    });
    expect(res.status).toBe(400);
  });
});

describe('коды привязки мессенджера', () => {
  it('истёкший код не принимается, даже если истёк в те же сутки', async () => {
    await registerFreshUser();
    const expired = new Date(Date.now() - 60_000).toISOString();
    getDb()
      .prepare('INSERT INTO link_codes (code, owner_chat_id, expires_at) VALUES (?, ?, ?)')
      .run('654321', '555000222', expired);

    const res = await call('POST', '/admin/link-telegram', { code: '654321' });
    expect(res.status).toBe(400);
  });

  it('код из бота привязывается один раз', async () => {
    await registerFreshUser();
    const code = issueLinkCode('555000333');
    expect(code).toMatch(/^\d{6}$/);

    expect((await call('POST', '/admin/link-telegram', { code })).status).toBe(200);
    expect((await call('POST', '/admin/link-telegram', { code })).status).toBe(400);
  });

  it('перебор кодов упирается в лимит попыток', async () => {
    await registerFreshUser();
    const code = issueLinkCode('555000444');
    for (let i = 0; i < 10; i++) {
      const res = await call('POST', '/admin/link-telegram', { code: '000000' });
      expect(res.status).toBe(400);
    }
    // Даже верный код после лимита не проходит
    const blocked = await call('POST', '/admin/link-telegram', { code });
    expect(blocked.status).toBe(429);
  });

  it('лимит на адрес не обходится подменой X-Forwarded-For и новыми аккаунтами', async () => {
    const statuses: number[] = [];
    for (let user = 0; user < 4; user++) {
      await registerFreshUser();
      for (let i = 0; i < 8; i++) {
        const res = await fetch(baseUrl + '/admin/link-telegram', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Real-IP': '203.0.113.7',
            'X-Forwarded-For': `10.0.${user}.${i}, 203.0.113.7`,
          },
          body: JSON.stringify({ code: '000000' }),
        });
        statuses.push(res.status);
      }
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });

  it('истёкшая ссылка сброса пароля не принимается', async () => {
    const reg = await registerFreshUser();
    const userId = getDb().prepare('SELECT id FROM admin_users WHERE email = ?')
      .get(`owner${emailSeq}@test.ru`) as { id: number };
    expect(reg.status).toBe(200);
    getDb()
      .prepare('INSERT INTO reset_tokens (token, admin_user_id, expires_at) VALUES (?, ?, ?)')
      .run('expired-token', userId.id, new Date(Date.now() - 60_000).toISOString());

    const res = await call('POST', '/admin/auth/reset-password', {
      token: 'expired-token',
      newPassword: 'newpassword123',
    });
    expect(res.status).toBe(400);
  });
});
