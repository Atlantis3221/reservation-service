import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../../services/clients-report', () => ({
  getClientsReport: () => ({
    generatedAt: '2026-08-18T12:00:00.000Z',
    totals: {
      businesses: 1,
      activated: 0,
      withBookings: 0,
      adminUsers: 2,
      orphanAdmins: 1,
      bookingRequests: 0,
    },
    businesses: [
      {
        id: 1,
        name: 'Баня «Тест» & <тег>',
        slug: 'test',
        createdAt: '2026-08-18 10:00:00',
        ownerChatId: '8',
        telegramUsername: null,
        phone: null,
        adminEmail: null,
        agreementAcceptedAt: null,
        bookingRequestsEnabled: false,
        workingHours: null,
        contactLinks: [],
        slotsTotal: 0,
        slotsBooked: 0,
        slotsFuture: 0,
        firstSlotDate: null,
        lastSlotDate: null,
        requestsTotal: 0,
        requestsPending: 0,
        botMsgCount: 0,
        lastBotMsgAt: null,
        activated: false,
        page7d: {
          visits: 12, picked: 3, requestOpened: 1, booked: 1, requested: 0,
          sources: { 'yandex.ru/maps': 7, '<vk>': 5 },
        },
        page30d: { visits: 0, picked: 0, requestOpened: 0, booked: 0, requested: 0, sources: {} },
        lastSeenAt: '2026-10-17 09:30:00',
        activeDays: 2,
        signupSource: 'utm:ads/A-003',
        signupCampaign: 'A-003',
      },
    ],
    orphanAdmins: [
      {
        email: 'orphan@example.com', createdAt: '2026-08-01 10:00:00', linkedToTelegram: false,
        lastSeenAt: null, activeDays: 0, signupSource: null, signupCampaign: null,
      },
    ],
    site7d: {
      visits: 40, signupOpened: 6, signups: 2, mobileVisits: 25, byDay: {},
      bySource: { 'utm:ads/A-003': { visits: 30, signupOpened: 5, signups: 2 }, '<ref>': { visits: 10, signupOpened: 1, signups: 0 } },
    },
    site30d: { visits: 0, signupOpened: 0, signups: 0, mobileVisits: 0, byDay: {}, bySource: {} },
    recentRequests: [],
  }),
}));

const PASSWORD = 'test-password';
const basic = (pw: string) => 'Basic ' + Buffer.from(`user:${pw}`).toString('base64');

let server: Server;
let base: string;

beforeAll(async () => {
  // Роут читает CLIENTS_PASSWORD при загрузке модуля, поэтому импорт — динамический.
  process.env.CLIENTS_PASSWORD = PASSWORD;
  const { clientsRouter } = await import('../clients');
  const app = express();
  app.use('/admin/clients', clientsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}/admin/clients`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('clients page — авторизация', () => {
  it('без пароля отдаёт 401 с ASCII-заголовком, а не 500', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(401);

    // Именно здесь была ошибка: не-ASCII realm заставлял Node бросить
    // ERR_INVALID_CHAR, браузер получал 500 и не показывал окно ввода пароля.
    const header = res.headers.get('www-authenticate') ?? '';
    expect(header).toMatch(/^Basic realm=/);
    expect(/^[\x20-\x7E]*$/.test(header)).toBe(true);
  });

  it('с неверным паролем отдаёт 401', async () => {
    const res = await fetch(base, { headers: { authorization: basic('wrong') } });
    expect(res.status).toBe(401);
  });

  it('с мусорным заголовком Authorization отдаёт 401', async () => {
    const res = await fetch(base, { headers: { authorization: 'Bearer nonsense' } });
    expect(res.status).toBe(401);
  });

  it('с верным паролем отдаёт страницу', async () => {
    const res = await fetch(base, { headers: { authorization: basic(PASSWORD) } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Зарегистрированные клиенты');
    expect(body).toContain('orphan@example.com');
  });

  it('экранирует данные клиентов в HTML', async () => {
    const res = await fetch(base, { headers: { authorization: basic(PASSWORD) } });
    const body = await res.text();
    expect(body).toContain('&lt;тег&gt;');
    expect(body).not.toContain('<тег>');
  });

  it('показывает шаги страницы записи и экранирует источники', async () => {
    const res = await fetch(base, { headers: { authorization: basic(PASSWORD) } });
    const body = await res.text();
    expect(body).toContain('12 → 4 → 1');
    expect(body).toContain('yandex.ru/maps 7');
    expect(body).toContain('&lt;vk&gt; 5');
  });

  it('показывает, когда владелец последний раз заходил в панель', async () => {
    const res = await fetch(base, { headers: { authorization: basic(PASSWORD) } });
    const body = await res.text();
    expect(body).toContain('Владелец заходил');
    expect(body).toContain('2026-10-17 09:30:00');
    expect(body).toContain('дней после регистрации: 2');
  });

  it('показывает воронку сайта по источникам и откуда пришёл владелец', async () => {
    const res = await fetch(base, { headers: { authorization: basic(PASSWORD) } });
    const body = await res.text();
    expect(body).toContain('Сайт за 7 дней: 40 → 6 → 2');
    expect(body).toContain('utm:ads/A-003');
    expect(body).toContain('&lt;ref&gt;');
    expect(body).not.toContain('<ref>');
    expect(body).toContain('Откуда пришёл');
  });

  it('отдаёт JSON по format=json', async () => {
    const res = await fetch(`${base}?format=json`, { headers: { authorization: basic(PASSWORD) } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { totals: { businesses: number } };
    expect(json.totals.businesses).toBe(1);
  });
});
