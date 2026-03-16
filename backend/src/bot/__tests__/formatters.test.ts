import { describe, it, expect } from 'vitest';
import { formatDayScheduleText, formatStatsText, formatScheduleCreated, formatBookingConfirmation } from '../formatters';
import type { TimeSlot } from '../../types';

describe('formatDayScheduleText', () => {
  const slots: TimeSlot[] = [
    { id: 1, startDatetime: '2026-03-16T10:00:00', endDatetime: '2026-03-16T14:00:00', status: 'available' },
    { id: 2, startDatetime: '2026-03-16T14:00:00', endDatetime: '2026-03-16T18:00:00', status: 'booked', note: 'Бронь', clientName: 'Иванов' },
    { id: 3, startDatetime: '2026-03-16T18:00:00', endDatetime: '2026-03-16T22:00:00', status: 'blocked' },
  ];

  it('formats day schedule with all slot types', () => {
    const result = formatDayScheduleText('2026-03-16', slots);
    expect(result).toContain('📅 Расписание на 16.03 (пн)');
    expect(result).toContain('🟢 10:00–14:00');
    expect(result).toContain('🔴 14:00–18:00 — Бронь (Иванов)');
    expect(result).toContain('⛔ 18:00–22:00');
  });

  it('appends frontend URL when provided', () => {
    const result = formatDayScheduleText('2026-03-16', slots, 'https://example.com/biz');
    expect(result).toContain('🔗 https://example.com/biz?date=2026-03-16');
  });

  it('does not append URL when not provided', () => {
    const result = formatDayScheduleText('2026-03-16', slots);
    expect(result).not.toContain('🔗');
  });
});

describe('formatStatsText', () => {
  const stats = { total: 10, available: 5, booked: 3, blocked: 2 };

  it('formats stats with days', () => {
    const daySlots = [
      { dateKey: '2026-03-16', available: 3, booked: 1 },
      { dateKey: '2026-03-17', available: 2, booked: 2 },
    ];
    const result = formatStatsText(stats, daySlots);
    expect(result).toContain('Всего слотов: 10');
    expect(result).toContain('🟢 Свободно: 5');
    expect(result).toContain('🔴 Забронировано: 3');
    expect(result).toContain('⛔ Заблокировано: 2');
    expect(result).toContain('Ближайшие дни');
    expect(result).toContain('16.03 (пн) — 🟢 3 / 🔴 1');
  });

  it('shows empty message when no days', () => {
    const result = formatStatsText(stats, []);
    expect(result).toContain('Расписание пусто');
  });
});

describe('formatScheduleCreated', () => {
  it('formats schedule created message', () => {
    const daysInfo = new Map<string, string>();
    daysInfo.set('2026-03-16', '10:00–22:00');
    daysInfo.set('2026-03-17', '12:00–20:00');

    const result = formatScheduleCreated('эту', daysInfo);
    expect(result).toContain('Расписание создано на эту неделю');
    expect(result).toContain('16.03 (пн) — 10:00–22:00');
    expect(result).toContain('17.03 (вт) — 12:00–20:00');
  });

  it('sorts days chronologically', () => {
    const daysInfo = new Map<string, string>();
    daysInfo.set('2026-03-18', '10:00–22:00');
    daysInfo.set('2026-03-16', '12:00–20:00');

    const result = formatScheduleCreated('следующую', daysInfo);
    const idx16 = result.indexOf('16.03');
    const idx18 = result.indexOf('18.03');
    expect(idx16).toBeLessThan(idx18);
  });
});

describe('formatBookingConfirmation', () => {
  it('formats basic booking', () => {
    const result = formatBookingConfirmation('2026-03-16', '14:00', '18:00');
    expect(result).toContain('Бронь создана');
    expect(result).toContain('Дата: 16.03 (пн)');
    expect(result).toContain('Время: 14:00 – 18:00');
    expect(result).not.toContain('Клиент');
  });

  it('includes client name when provided', () => {
    const result = formatBookingConfirmation('2026-03-16', '14:00', '18:00', 'Иванов');
    expect(result).toContain('Клиент: Иванов');
  });

  it('includes frontend URL when provided', () => {
    const result = formatBookingConfirmation('2026-03-16', '14:00', '18:00', undefined, 'https://example.com/biz');
    expect(result).toContain('🔗 https://example.com/biz?date=2026-03-16');
  });
});
