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

/** Высота дорожки: весь день влезает в экран при любой длине смены */
const TRACK_HEIGHT = 300;
const MIN_BLOCK = 22;

/**
 * Рабочий день одной дорожкой: сверху открытие, снизу закрытие, внутри —
 * брони плотными блоками, свободное — пустая дорожка.
 *
 * Раньше свободное время показывалось зелёной штриховкой на бесконечной
 * часовой сетке: непонятно, где кончается рабочий день, и 16-часовая смена
 * занимала 960px. Здесь границы смены подписаны явно, а масштаб
 * подстраивается под её длину — прокрутки нет вообще.
 */
export function DayTrack({ daySlots, nowMinutes }: Props) {
  const model = useMemo(() => {
    const available = daySlots.filter((s) => s.status === 'available');
    if (available.length === 0) return null;

    const starts = available.map((s) => timeToMinutes(timeOfDay(s.startDatetime)));
    const dayStart = Math.min(...starts);
    const crossesMidnight = available.some(
      (s) => timeToMinutes(timeOfDay(s.endDatetime)) <= timeToMinutes(timeOfDay(s.startDatetime)),
    );

    const absolute = (minutes: number): number =>
      crossesMidnight && minutes < dayStart ? minutes + MINUTES_IN_DAY : minutes;

    const dayEnd = Math.max(...available.map((s) => {
      const end = timeToMinutes(timeOfDay(s.endDatetime));
      return end <= timeToMinutes(timeOfDay(s.startDatetime)) ? end + MINUTES_IN_DAY : end;
    }));

    const span = dayEnd - dayStart;
    if (span <= 0) return null;

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

    // Часовые отметки — только круглые часы, и не чаще, чем читаемо:
    // на смене 10:00–02:00 подпись каждый час превращается в лапшу.
    const everyHours = span > 10 * 60 ? 3 : span > 6 * 60 ? 2 : 1;
    const ticks: number[] = [];
    const firstHour = Math.ceil(dayStart / 60) * 60;
    for (let m = firstHour; m < dayEnd; m += 60 * everyHours) {
      // Слишком близко к подписанным границам смены — подписи сольются
      if (m - dayStart > 40 && dayEnd - m > 40) ticks.push(m);
    }

    return { dayStart, dayEnd, span, busy, ticks };
  }, [daySlots]);

  if (!model) return null;

  const { dayStart, dayEnd, span, busy, ticks } = model;
  const y = (minutes: number): number => ((minutes - dayStart) / span) * TRACK_HEIGHT;

  const busyMinutes = busy.reduce(
    (sum, b) => sum + (Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)),
    0,
  );

  return (
    <section className="track-wrap">
      <div className="track-head">
        <h3>Как занят день</h3>
        <span>{Math.round((busyMinutes / span) * 100)}% занято</span>
      </div>

      <div className="track-body">
        <div className="track-cap">
          <span className="track-cap-time">{minutesToTime(dayStart)}</span>
          <span className="track-cap-word">открытие</span>
        </div>

        {/* Часы отдельной колонкой, а не поверх дорожки: подписи, нарисованные
            внутри, прятались под бронями и читались как зачёркнутые. */}
        <div className="track-hours">
          {ticks.map((m) => (
            <span key={m} style={{ top: y(m) }}>{minutesToTime(m)}</span>
          ))}
        </div>

        <div className="track" style={{ height: TRACK_HEIGHT }}>
          {ticks.map((m) => (
            <div key={m} className="track-tick" style={{ top: y(m) }} aria-hidden="true" />
          ))}

          {busy.map((b) => {
            const top = y(Math.max(b.start, dayStart));
            const height = Math.max(y(Math.min(b.end, dayEnd)) - top, MIN_BLOCK);
            return (
              <div key={b.id} className="track-busy" style={{ top, height }}>
                <span>{minutesToTime(b.start)}–{minutesToTime(b.end)}</span>
              </div>
            );
          })}

          {nowMinutes !== null && nowMinutes > dayStart && nowMinutes < dayEnd && (
            <div className="track-now" style={{ top: y(nowMinutes) }} aria-hidden="true" />
          )}
        </div>

        <div className="track-cap">
          <span className="track-cap-time">{minutesToTime(dayEnd)}</span>
          <span className="track-cap-word">закрытие</span>
        </div>
      </div>

      <p className="track-legend">
        <span className="track-legend-free" /> свободно
        <span className="track-legend-busy" /> занято
      </p>
    </section>
  );
}
