import { DAY_ABBREV, pad2 } from '../utils/date';

export interface DayTimeRange {
  startDay: number;
  endDay: number;
  startHour: number;
  endHour: number;
}

export interface FlexibleScheduleCommand {
  week: 'this' | 'next';
  ranges: DayTimeRange[];
}

export function parseFlexibleSchedule(text: string): FlexibleScheduleCommand | null {
  const lower = text.toLowerCase();

  let week: 'this' | 'next';
  if (/эт(?:ой|у|а)\s+недел/.test(lower)) {
    week = 'this';
  } else if (/следующ\S*\s+недел/.test(lower)) {
    week = 'next';
  } else {
    return null;
  }

  const rangeRegex = /(?:с\s+)?(пн|вт|ср|чт|пт|сб|вс)\s*(?:[-–]\s*|\s+по\s+)(пн|вт|ср|чт|пт|сб|вс)\s+[сc]\s+(\d{1,2})(?::00)?\s+до\s+(\d{1,2})(?::00)?/g;

  const ranges: DayTimeRange[] = [];
  let match;
  while ((match = rangeRegex.exec(lower)) !== null) {
    const startDay = DAY_ABBREV[match[1]];
    const endDay = DAY_ABBREV[match[2]];
    const startHour = Number(match[3]);
    const endHour = Number(match[4]);

    if (startDay === undefined || endDay === undefined) continue;
    if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) continue;

    ranges.push({ startDay, endDay, startHour, endHour });
  }

  if (ranges.length === 0) return null;

  return { week, ranges };
}

export function parseBookingCommand(text: string): { dayName: string; startTime: string; endTime: string; clientName?: string } | null {
  const match = text.match(/(?:в|на)\s+([а-яё]+)\s+бронь\s+на\s+(\d+):(\d+)\s+на\s+(\d+)\s+час\S*\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const hour = Number(match[2]);
  const minutes = Number(match[3]);
  const duration = Number(match[4]);
  const rawName = match[5]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (hour < 0 || hour >= 24 || minutes < 0 || minutes >= 60 || duration < 1) {
    return null;
  }

  const startTime = `${pad2(hour)}:${pad2(minutes)}`;
  const endHour = (hour + duration) % 24;
  const endTime = `${pad2(endHour)}:${pad2(minutes)}`;

  return { dayName, startTime, endTime, clientName };
}

export function parseBookingRange(text: string): { dayName: string; startTime: string; endTime: string; clientName?: string } | null {
  const match = text.match(/(?:(?:в|на)\s+)?(\S+)\s+бронь\s+[сc]\s+(\d{1,2})(?::(\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?::(\d{2}))?\s*(.*)?/i);
  if (!match) return null;

  const dayName = match[1];
  const startHour = Number(match[2]);
  const startMin = Number(match[3] || '0');
  const endHour = Number(match[4]);
  const endMin = Number(match[5] || '0');
  const rawName = match[6]?.trim() || undefined;
  const clientName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : undefined;

  if (startHour < 0 || startHour >= 24 || endHour < 0 || endHour > 24) return null;
  if (startMin < 0 || startMin >= 60 || endMin < 0 || endMin >= 60) return null;

  const startTime = `${pad2(startHour)}:${pad2(startMin)}`;
  const endTime = endHour === 24 ? '00:00' : `${pad2(endHour)}:${pad2(endMin)}`;

  if (startTime === endTime) return null;

  return { dayName, startTime, endTime, clientName };
}

export function parseCancelCommand(text: string): { dayName: string; startTime: string } | null {
  const match = text.match(/отмени\s+бронь\s+(?:на\s+)?(\S+)\s+(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hour = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return { dayName: match[1], startTime: `${pad2(hour)}:${pad2(minutes)}` };
}
