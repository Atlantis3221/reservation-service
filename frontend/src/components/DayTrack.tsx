import { useMemo } from 'react';
import type { DaySlot } from '../api';
import { MINUTES_IN_DAY, minutesToTime, timeToMinutes } from '../lib/day';

interface Props {
  daySlots: DaySlot[];
  /** Абсолютные минуты «сейчас» или null, если день не сегодняшний */
  nowMinutes: number | null;
}

interface Busy {
  id: number;
  start: number;
  end: number;
}

function timeOfDay(datetime: string): string {
  return datetime.split('T')[1].slice(0, 5);
}

/**
 * Сколько минут закрытого времени показать до открытия и после закрытия.
 * Без них границы смены оказывались на самом краю и не читались как границы.
 */
const CLOSED_PAD = 60;

/** Высота одного часа. Час — минимальная бронь, поэтому и линия на каждый час. */
const HOUR_PX = 30;
const MIN_BLOCK = 20;

/**
 * Календарь дня: часовая сетка, как в обычном расписании. Рабочее время
 * залито, закрытое — нет, границы смены нарисованы линиями с подписями.
 *
 * Раньше здесь была штриховка на сетке в три часа: где кончается рабочий
 * день, по ней прочитать было нельзя, а часовые подписи прятались под
 * бронями.
 */
export function DayTrack({ daySlots, nowMinutes }: Props) {
  const model = useMemo(() => {
    const available = daySlots.filter((s) => s.status === 'available');
    if (available.length === 0) return null;

    const dayStart = Math.min(
      ...available.map((s) => timeToMinutes(timeOfDay(s.startDatetime))),
    );
    const crossesMidnight = available.some(
      (s) => timeToMinutes(timeOfDay(s.endDatetime)) <= timeToMinutes(timeOfDay(s.startDatetime)),
    );

    const absolute = (minutes: number): number =>
      crossesMidnight && minutes < dayStart ? minutes + MINUTES_IN_DAY : minutes;

    const dayEnd = Math.max(...available.map((s) => {
      const end = timeToMinutes(timeOfDay(s.endDatetime));
      return end <= timeToMinutes(timeOfDay(s.startDatetime)) ? end + MINUTES_IN_DAY : end;
    }));

    if (dayEnd <= dayStart) return null;

    const busy: Busy[] = daySlots
      .filter((s) => s.status !== 'available')
      .map((s) => {
        const startTod = timeToMinutes(timeOfDay(s.startDatetime));
        let end = timeToMinutes(timeOfDay(s.endDatetime));
        if (end <= startTod) end += MINUTES_IN_DAY;
        else end = absolute(end);
        return { id: s.id, start: absolute(startTod), end };
      })
      .filter((b) => b.end > dayStart && b.start < dayEnd)
      .sort((a, b) => a.start - b.start);

    // Полотно шире смены: сверху и снизу видно закрытое время, поэтому
    // линии открытия и закрытия читаются как границы, а не как края картинки.
    const from = Math.floor((dayStart - CLOSED_PAD) / 60) * 60;
    const to = Math.ceil((dayEnd + CLOSED_PAD) / 60) * 60;

    const hours: number[] = [];
    for (let m = from; m <= to; m += 60) hours.push(m);

    return { dayStart, dayEnd, from, to, busy, hours };
  }, [daySlots]);

  if (!model) return null;

  const { dayStart, dayEnd, from, to, busy, hours } = model;
  const height = ((to - from) / 60) * HOUR_PX;
  const y = (minutes: number): number => ((minutes - from) / 60) * HOUR_PX;

  const span = dayEnd - dayStart;
  const busyMinutes = busy.reduce(
    (sum, b) => sum + (Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)),
    0,
  );

  return (
    <section className="cal">
      <div className="cal-head">
        <h3>Расписание дня</h3>
        <span>{Math.round((busyMinutes / span) * 100)}% занято</span>
      </div>

      <div className="cal-body" style={{ height }}>
        <div className="cal-hours">
          {hours.map((m) => (
            <span key={m} style={{ top: y(m) }}>{minutesToTime(m)}</span>
          ))}
        </div>

        <div className="cal-grid">
          {hours.map((m) => (
            <div key={m} className="cal-hourline" style={{ top: y(m) }} aria-hidden="true" />
          ))}

          {/* Рабочее время — заливка, закрытое остаётся фоном страницы */}
          <div
            className="cal-open"
            style={{ top: y(dayStart), height: y(dayEnd) - y(dayStart) }}
            aria-hidden="true"
          />

          <div className="cal-edge" style={{ top: y(dayStart) }}>
            <span>открытие {minutesToTime(dayStart)}</span>
          </div>
          <div className="cal-edge" style={{ top: y(dayEnd) }}>
            <span>закрытие {minutesToTime(dayEnd)}</span>
          </div>

          {busy.map((b) => {
            const top = y(Math.max(b.start, dayStart));
            const blockHeight = Math.max(y(Math.min(b.end, dayEnd)) - top, MIN_BLOCK);
            return (
              <div key={b.id} className="cal-busy" style={{ top, height: blockHeight }}>
                <span>занято {minutesToTime(b.start)}–{minutesToTime(b.end)}</span>
              </div>
            );
          })}

          {nowMinutes !== null && nowMinutes > from && nowMinutes < to && (
            <div className="cal-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
