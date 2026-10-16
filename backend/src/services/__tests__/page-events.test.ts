import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db')>()),
  getDb: () => testDb,
}));

import { migrations } from '../db';
import {
  getBusinessPageFunnels, isBotUserAgent, isValidEvent, recordPageEvent, referrerSource,
} from '../page-events';

const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

beforeEach(() => {
  testDb = new Database(':memory:');
  // Таблица событий — ровно из миграции v4, чтобы тест ловил расхождение схемы.
  migrations[3](testDb);
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
