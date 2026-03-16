import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toDateKey, fmtDate, pad2, nextDateKey, resolveDay, getNextWeekday, getMondayOfWeek, DAY_ABBREV, WEEKDAYS_SHORT } from '../date';

describe('pad2', () => {
  it('pads single digit', () => {
    expect(pad2(5)).toBe('05');
  });

  it('keeps double digit', () => {
    expect(pad2(12)).toBe('12');
  });

  it('pads zero', () => {
    expect(pad2(0)).toBe('00');
  });
});

describe('toDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const d = new Date(2026, 2, 15); // March 15, 2026
    expect(toDateKey(d)).toBe('2026-03-15');
  });

  it('pads month and day', () => {
    const d = new Date(2026, 0, 5); // January 5, 2026
    expect(toDateKey(d)).toBe('2026-01-05');
  });
});

describe('nextDateKey', () => {
  it('returns next day', () => {
    expect(nextDateKey('2026-03-15')).toBe('2026-03-16');
  });

  it('handles month boundary', () => {
    expect(nextDateKey('2026-03-31')).toBe('2026-04-01');
  });

  it('handles year boundary', () => {
    expect(nextDateKey('2026-12-31')).toBe('2027-01-01');
  });
});

describe('fmtDate', () => {
  it('formats date with weekday', () => {
    // 2026-03-16 is Monday
    const result = fmtDate('2026-03-16');
    expect(result).toBe('16.03 (пн)');
  });

  it('formats date with single-digit day', () => {
    // 2026-03-01 is Sunday
    const result = fmtDate('2026-03-01');
    expect(result).toBe('1.03 (вс)');
  });
});

describe('resolveDay', () => {
  const FIXED_DATE = new Date(2026, 2, 16); // Monday, March 16, 2026

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves "сегодня" to today', () => {
    const result = resolveDay('сегодня');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-16');
  });

  it('resolves "завтра" to tomorrow', () => {
    const result = resolveDay('завтра');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-17');
  });

  it('resolves weekday name (nominative)', () => {
    const result = resolveDay('среда');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-18');
  });

  it('resolves weekday name (accusative)', () => {
    const result = resolveDay('пятницу');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-20');
  });

  it('resolves same weekday to today (not next week)', () => {
    // Today is Monday, resolveDay("понедельник") should return today
    const result = resolveDay('понедельник');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-16');
  });

  it('returns null for unknown day', () => {
    expect(resolveDay('неизвестно')).toBeNull();
  });
});

describe('getNextWeekday', () => {
  const FIXED_DATE = new Date(2026, 2, 16); // Monday, March 16, 2026

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns next occurrence for nominative case', () => {
    const result = getNextWeekday('среда');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-18');
  });

  it('returns next week for same weekday', () => {
    // Today is Monday, getNextWeekday uses <= 0 check (strict: goes to next week)
    const result = getNextWeekday('понедельник');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-23');
  });

  it('handles accusative case (склонения)', () => {
    const result = getNextWeekday('пятницу');
    expect(result).not.toBeNull();
    expect(toDateKey(result!)).toBe('2026-03-20');
  });

  it('returns null for unknown day', () => {
    expect(getNextWeekday('неизвестно')).toBeNull();
  });
});

describe('getMondayOfWeek', () => {
  const FIXED_DATE = new Date(2026, 2, 18); // Wednesday, March 18, 2026

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns Monday of this week', () => {
    const monday = getMondayOfWeek('this');
    expect(toDateKey(monday)).toBe('2026-03-16');
  });

  it('returns Monday of next week', () => {
    const monday = getMondayOfWeek('next');
    expect(toDateKey(monday)).toBe('2026-03-23');
  });
});

describe('DAY_ABBREV', () => {
  it('maps пн to 1', () => {
    expect(DAY_ABBREV['пн']).toBe(1);
  });

  it('maps вс to 7', () => {
    expect(DAY_ABBREV['вс']).toBe(7);
  });
});
