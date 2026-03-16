import { describe, it, expect } from 'vitest';
import { parseFlexibleSchedule, parseBookingCommand, parseBookingRange, parseCancelCommand } from '../parsers';

describe('parseFlexibleSchedule', () => {
  it('parses "this week" with single range', () => {
    const result = parseFlexibleSchedule('на этой неделе с пн по пт с 10 до 22');
    expect(result).not.toBeNull();
    expect(result!.week).toBe('this');
    expect(result!.ranges).toHaveLength(1);
    expect(result!.ranges[0]).toEqual({ startDay: 1, endDay: 5, startHour: 10, endHour: 22 });
  });

  it('parses "next week" with single range', () => {
    const result = parseFlexibleSchedule('на следующей неделе с пн по пт с 12 до 23');
    expect(result).not.toBeNull();
    expect(result!.week).toBe('next');
    expect(result!.ranges).toHaveLength(1);
  });

  it('parses multiple ranges', () => {
    const result = parseFlexibleSchedule('на этой неделе с пн по пт с 10 до 22, с сб по вс с 12 до 20');
    expect(result).not.toBeNull();
    expect(result!.ranges).toHaveLength(2);
    expect(result!.ranges[0]).toEqual({ startDay: 1, endDay: 5, startHour: 10, endHour: 22 });
    expect(result!.ranges[1]).toEqual({ startDay: 6, endDay: 7, startHour: 12, endHour: 20 });
  });

  it('parses night range (12→03)', () => {
    const result = parseFlexibleSchedule('на этой неделе с пт по сб с 12 до 03');
    expect(result).not.toBeNull();
    expect(result!.ranges[0]).toEqual({ startDay: 5, endDay: 6, startHour: 12, endHour: 3 });
  });

  it('returns null without week mention', () => {
    expect(parseFlexibleSchedule('с пн по пт с 10 до 22')).toBeNull();
  });

  it('returns null without time ranges', () => {
    expect(parseFlexibleSchedule('на этой неделе работаем')).toBeNull();
  });

  it('parses "эту неделю" variant', () => {
    const result = parseFlexibleSchedule('на эту неделю с пн по пт с 10 до 22');
    expect(result).not.toBeNull();
    expect(result!.week).toBe('this');
  });
});

describe('parseBookingCommand', () => {
  it('parses standard booking', () => {
    const result = parseBookingCommand('в пятницу бронь на 15:00 на 3 часа');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('пятницу');
    expect(result!.startTime).toBe('15:00');
    expect(result!.endTime).toBe('18:00');
    expect(result!.clientName).toBeUndefined();
  });

  it('parses booking with client name', () => {
    const result = parseBookingCommand('в пятницу бронь на 15:00 на 2 часа иванов');
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('Иванов');
  });

  it('parses "на" prefix', () => {
    const result = parseBookingCommand('на сегодня бронь на 10:00 на 2 часа');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('сегодня');
  });

  it('returns null for invalid hours', () => {
    expect(parseBookingCommand('в пятницу бронь на 25:00 на 2 часа')).toBeNull();
  });

  it('returns null for non-matching text', () => {
    expect(parseBookingCommand('привет')).toBeNull();
  });

  it('handles booking with minutes', () => {
    const result = parseBookingCommand('в пятницу бронь на 15:30 на 2 часа');
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe('15:30');
    expect(result!.endTime).toBe('17:30');
  });
});

describe('parseBookingRange', () => {
  it('parses standard range', () => {
    const result = parseBookingRange('сегодня бронь с 14 до 18');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('сегодня');
    expect(result!.startTime).toBe('14:00');
    expect(result!.endTime).toBe('18:00');
  });

  it('parses range with client name', () => {
    const result = parseBookingRange('сегодня бронь с 14:30 до 18:00 Петров');
    expect(result).not.toBeNull();
    expect(result!.clientName).toBe('Петров');
    expect(result!.startTime).toBe('14:30');
    expect(result!.endTime).toBe('18:00');
  });

  it('parses range with "на" prefix', () => {
    const result = parseBookingRange('на завтра бронь с 10 до 14');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('завтра');
  });

  it('returns null when startTime equals endTime', () => {
    expect(parseBookingRange('сегодня бронь с 14 до 14')).toBeNull();
  });

  it('returns null for invalid hours', () => {
    expect(parseBookingRange('сегодня бронь с 25 до 18')).toBeNull();
  });

  it('handles endHour = 24 as 00:00', () => {
    const result = parseBookingRange('сегодня бронь с 20 до 24');
    expect(result).not.toBeNull();
    expect(result!.endTime).toBe('00:00');
  });
});

describe('parseCancelCommand', () => {
  it('parses cancel command', () => {
    const result = parseCancelCommand('отмени бронь на сегодня 14');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('сегодня');
    expect(result!.startTime).toBe('14:00');
  });

  it('parses cancel command with minutes', () => {
    const result = parseCancelCommand('отмени бронь на завтра 16:30');
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe('завтра');
    expect(result!.startTime).toBe('16:30');
  });

  it('returns null for non-matching text', () => {
    expect(parseCancelCommand('привет')).toBeNull();
  });
});
