import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db')>()),
  getDb: () => testDb,
}));

import { migrations } from '../db';
import {
  deviceFromUserAgent, getBusinessPageFunnels, getSiteFunnel, isBotUserAgent, isValidEvent,
  recordPageEvent, recordSignup, referrerSource,
} from '../page-events';

const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

beforeEach(() => {
  testDb = new Database(':memory:');
  // Таблица событий — ровно из миграций v4 и v6, чтобы тест ловил расхождение схемы.
  testDb.exec(`CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    owner_chat_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  migrations[3](testDb);
  migrations[5](testDb);
});

afterEach(() => {
  testDb.close();
});

describe('referrerSource', () => {
  it('оставляет только домен без www', () => {
    expect(referrerSource('https://www.vk.com/club123?w=wall-1_2')).toBe('vk.com');
    expect(referrerSource('https://t.me/somechannel/15')).toBe('t.me');
  });

  it('выделяет Яндекс Карты', () => {
    expect(referrerSource('https://yandex.ru/maps/org/123/')).toBe('yandex.ru/maps');
    expect(referrerSource('https://yandex.ru/search/?text=баня')).toBe('yandex.ru');
  });

  it('пустой реферер — прямой заход, свой сайт — slotik.tech', () => {
    expect(referrerSource('')).toBe('direct');
    expect(referrerSource(null)).toBe('direct');
    expect(referrerSource('https://slotik.tech/')).toBe('slotik.tech');
    expect(referrerSource('https://admin.slotik.tech/calendar')).toBe('slotik.tech');
    expect(referrerSource('не ссылка')).toBe('other');
  });
});

describe('фильтры', () => {
  it('отсекает роботов и пустой User-Agent', () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0')).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent(CHROME)).toBe(false);
  });

  it('принимает только известные события своей страницы', () => {
    expect(isValidEvent('business', 'booked')).toBe(true);
    expect(isValidEvent('business', 'signup')).toBe(false);
    expect(isValidEvent('site', 'signup')).toBe(true);
    expect(isValidEvent('business', 'drop table')).toBe(false);
  });
});

describe('getBusinessPageFunnels', () => {
  const ev = (businessId: number, event: string, visitId: string, extra: Record<string, string> = {}) =>
    recordPageEvent({ page: 'business', businessId, event, visitId, ...extra });

  it('считает шаги по уникальным визитам и источники по открытиям', () => {
    ev(1, 'view', 'visit-aaaa', { referrer: 'https://vk.com/club1' });
    ev(1, 'view', 'visit-aaaa', { referrer: 'https://vk.com/club1' }); // повтор того же визита
    ev(1, 'pick', 'visit-aaaa');
    ev(1, 'pick', 'visit-aaaa');
    ev(1, 'booked', 'visit-aaaa');
    ev(1, 'view', 'visit-bbbb', { utmSource: 'insta' });
    ev(1, 'request_open', 'visit-bbbb');
    ev(1, 'view', 'visit-cccc');
    ev(2, 'view', 'visit-dddd');

    const funnels = getBusinessPageFunnels(7);
    expect(funnels.get(1)).toEqual({
      visits: 3,
      picked: 1,
      requestOpened: 1,
      booked: 1,
      requested: 0,
      sources: { 'vk.com': 1, 'utm:insta': 1, direct: 1 },
    });
    expect(funnels.get(2)?.visits).toBe(1);
  });

  it('не берёт события старше периода и события сайта', () => {
    ev(1, 'view', 'visit-old1');
    testDb.prepare(`UPDATE page_events SET created_at = datetime('now', '-10 days')`).run();
    recordPageEvent({ page: 'site', businessId: null, event: 'view', visitId: 'visit-site' });
    ev(1, 'view', 'visit-new1');

    expect(getBusinessPageFunnels(7).get(1)?.visits).toBe(1);
    expect(getBusinessPageFunnels(30).get(1)?.visits).toBe(2);
  });
});

describe('воронка сайта (T-017)', () => {
  const site = (event: string, visitId: string, extra: Record<string, unknown> = {}) =>
    recordPageEvent({ page: 'site', businessId: null, event, visitId, ...extra });
  const addUser = (email: string) =>
    testDb.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)').run(email, 'x').lastInsertRowid as number;
  const sourceOf = (id: number) =>
    testDb.prepare('SELECT signup_source AS source, signup_campaign AS campaign FROM admin_users WHERE id = ?').get(id);

  it('считает визит → открыл регистрацию → зарегистрировался по источнику первого захода', () => {
    // Из рекламы: лендинг, потом регистрация (реферер уже slotik.tech, но источник — с лендинга)
    site('view', 'visit-ad01', { utmSource: 'ads', utmMedium: 'yandex', utmCampaign: 'A-002', device: 'mobile' });
    site('signup_open', 'visit-ad01', { referrer: 'https://slotik.tech/', utmSource: 'ads', utmCampaign: 'A-002' });
    const user = addUser('owner@example.com');
    recordSignup(user, { visitId: 'visit-ad01', referrer: 'https://slotik.tech/', utmSource: 'ads', utmCampaign: 'A-002' }, true, 'mobile');
    // Посмотрел и ушёл
    site('view', 'visit-vk01', { referrer: 'https://vk.com/wall-1', device: 'desktop' });
    // Сразу на регистрацию, минуя лендинг
    site('signup_open', 'visit-dir1');
    // Клик из Директа без utm
    site('view', 'visit-ycl1', { referrer: 'https://yandex.ru/search/', adClick: true });

    const f = getSiteFunnel(7);
    expect({ visits: f.visits, signupOpened: f.signupOpened, signups: f.signups }).toEqual({ visits: 3, signupOpened: 2, signups: 1 });
    expect(f.mobileVisits).toBe(1);
    expect(f.bySource).toEqual({
      'utm:ads/A-002': { visits: 1, signupOpened: 1, signups: 1 },
      'vk.com': { visits: 1, signupOpened: 0, signups: 0 },
      direct: { visits: 0, signupOpened: 1, signups: 0 },
      'yandex-ad': { visits: 1, signupOpened: 0, signups: 0 },
    });
    expect(Object.values(f.byDay)).toHaveLength(1);
    expect(sourceOf(user)).toEqual({ source: 'utm:ads/A-002', campaign: 'A-002' });
  });

  it('браузер команды: источник владельцу пишем, в воронку — нет', () => {
    const user = addUser('team@example.com');
    recordSignup(user, { visitId: 'visit-team', utmSource: 'outreach', utmContent: 'L-041' }, false, 'desktop');
    expect(getSiteFunnel(7).signups).toBe(0);
    expect(sourceOf(user)).toEqual({ source: 'utm:outreach/L-041', campaign: 'L-041' });
  });

  it('без визита (старая вкладка панели) ничего не пишет', () => {
    const user = addUser('old@example.com');
    recordSignup(user, undefined, true, 'desktop');
    recordSignup(user, { visitId: 'плохой id' }, true, 'desktop');
    expect(getSiteFunnel(7).signups).toBe(0);
    expect(sourceOf(user)).toEqual({ source: null, campaign: null });
  });

  it('не берёт визиты старше периода и страницы заведений', () => {
    site('view', 'visit-old2');
    testDb.prepare(`UPDATE page_events SET created_at = datetime('now', '-10 days')`).run();
    recordPageEvent({ page: 'business', businessId: 1, event: 'view', visitId: 'visit-biz1' });
    site('view', 'visit-new2');
    expect(getSiteFunnel(7).visits).toBe(1);
    expect(getSiteFunnel(30).visits).toBe(2);
  });

  it('устройство — по User-Agent', () => {
    expect(deviceFromUserAgent(CHROME)).toBe('mobile');
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe('desktop');
  });
});
