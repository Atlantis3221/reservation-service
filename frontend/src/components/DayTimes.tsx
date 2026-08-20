import { useMemo } from 'react';
import type { BusinessInfo, DaySlot, FreeSlot } from '../api';
import {
  MINUTES_IN_DAY, addDays, dateLong, dayTitle, durationRules,
  nowInBusinessTz, slotsCountLabel, timeToMinutes,
} from '../lib/day';

interface Props {
  dateKey: string;
  todayKey: string;
  business: BusinessInfo;
  freeSlots: FreeSlot[];
  /** Все слоты дня, включая брони: из них берётся занятое время */
  daySlots: DaySlot[];
  loading: boolean;
  nextFreeDate: string | null;
  onPick: (slot: FreeSlot) => void;
  onGoToDate: (dateKey: string) => void;
}

type Entry =
  | { kind: 'free'; start: number; slot: FreeSlot }
  | { kind: 'busy'; start: number; time: string };

function timeOfDay(datetime: string): string {
  return datetime.split('T')[1].slice(0, 5);
}

/**
 * Время дня одной сеткой: свободное — заливкой и нажимается, занятое —
 * зачёркнутым и нет. Так клиент видит загрузку дня, не переключая режим,
 * и весь день влезает в экран — таймлайн на смену 10:00–02:00 занимал
 * 960 px и требовал трёх экранов прокрутки.
 */
export function DayTimes({
  dateKey, todayKey, business, freeSlots, daySlots, loading,
  nextFreeDate, onPick, onGoToDate,
}: Props) {
  const entries = useMemo<Entry[]>(() => {
    const available = daySlots.filter((s) => s.status === 'available');
    if (available.length === 0) return freeSlots.map((slot) => ({ kind: 'free', start: slot.startMinutes, slot }));

    // Та же нормализация, что на сервере: смена может уходить за полночь,
    // и бронь, начавшаяся после неё, лежит в тех же сутках расписания.
    const dayStart = Math.min(...available.map((s) => timeToMinutes(timeOfDay(s.startDatetime))));
    const crossesMidnight = available.some(
      (s) => timeToMinutes(timeOfDay(s.endDatetime)) <= timeToMinutes(timeOfDay(s.startDatetime)),
    );

    function absolute(minutes: number): number {
      return crossesMidnight && minutes < dayStart ? minutes + MINUTES_IN_DAY : minutes;
    }

    // Часы заведения, а не зрителя: свободное время сервер отсекает по ним же,
    // и две половины экрана обязаны сходиться.
    const { minutes: nowMinutes } = nowInBusinessTz();
    const cutoff =
      dateKey === todayKey ? nowMinutes
      : addDays(dateKey, 1) === todayKey ? nowMinutes + MINUTES_IN_DAY
      : -Infinity;

    const busy: Entry[] = daySlots
      .filter((s) => s.status !== 'available')
      .map((s) => {
        const startTod = timeToMinutes(timeOfDay(s.startDatetime));
        let end = timeToMinutes(timeOfDay(s.endDatetime));
        const start = absolute(startTod);
        if (end <= startTod) end += MINUTES_IN_DAY;
        else end = absolute(end);
        return { kind: 'busy' as const, start, time: timeOfDay(s.startDatetime), end };
      })
      // Прошедшее не показываем совсем: свободные слоты сервер уже отсекает
      // по «сейчас», и раньше две половины экрана расходились между собой.
      .filter((b) => b.end > cutoff)
      .map(({ kind, start, time }) => ({ kind, start, time }));

    const free: Entry[] = freeSlots.map((slot) => ({ kind: 'free', start: slot.startMinutes, slot }));

    return [...free, ...busy].sort((a, b) => a.start - b.start);
  }, [daySlots, freeSlots, dateKey, todayKey]);

  const title = dateKey === todayKey || dateKey === addDays(todayKey, 1)
    ? `${dayTitle(dateKey, todayKey)}, ${dateLong(dateKey)}`
    : dayTitle(dateKey, todayKey);

  const rules = durationRules(business);
  const fullDay = rules.min >= MINUTES_IN_DAY;
  const beforeMidnight = entries.filter((e) => e.start < MINUTES_IN_DAY);
  const afterMidnight = entries.filter((e) => e.start >= MINUTES_IN_DAY);

  return (
    <section className="day">
      <div className="day-head">
        <h2 className="day-title">{title}</h2>
        <p className="day-meta">
          {loading ? 'смотрим свободное время…'
            : freeSlots.length === 0 ? (daySlots.length === 0 ? 'записи нет' : 'всё занято')
            : fullDay ? 'день свободен целиком'
            : `свободно ${slotsCountLabel(freeSlots.length)}`}
        </p>
      </div>

      {loading ? (
        <div className="day-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
        </div>
      ) : fullDay && freeSlots.length > 0 ? (
        <button className="slot slot--day" type="button" onClick={() => onPick(freeSlots[0])}>
          <span className="slot-label">Забронировать сутки</span>
          <span className="slot-hint">
            заезд {freeSlots[0].startTime}, выезд {freeSlots[0].endTime}
          </span>
        </button>
      ) : entries.length === 0 ? (
        // Подзаголовок уже сказал «записи нет» — здесь либо ведём дальше,
        // либо объясняем, если вести некуда.
        !nextFreeDate && (
          <p className="day-empty">
            {daySlots.length === 0
              ? 'Расписание на этот день ещё не опубликовано.'
              : 'Этот день занят полностью.'}
          </p>
        )
      ) : (
        <>
          <TimeGrid entries={beforeMidnight} onPick={onPick} />
          {afterMidnight.length > 0 && (
            <>
              <p className="day-split">После полуночи</p>
              <TimeGrid entries={afterMidnight} onPick={onPick} />
            </>
          )}
        </>
      )}

      {!loading && freeSlots.length === 0 && nextFreeDate && (
        <button className="day-next" type="button" onClick={() => onGoToDate(nextFreeDate)}>
          Ближайшее свободное — {dateLong(nextFreeDate)}
        </button>
      )}

    </section>
  );
}

function TimeGrid({ entries, onPick }: { entries: Entry[]; onPick: (slot: FreeSlot) => void }) {
  return (
    <div className="slots">
      {entries.map((entry) =>
        entry.kind === 'free' ? (
          <button
            key={`free-${entry.start}`}
            className="slot"
            type="button"
            onClick={() => onPick(entry.slot)}
          >
            <span className="slot-time">{entry.slot.startTime}</span>
          </button>
        ) : (
          <span key={`busy-${entry.start}`} className="slot slot--busy" title="Занято">
            <span className="slot-time">{entry.time}</span>
            <span className="sr-only">занято</span>
          </span>
        ),
      )}
    </div>
  );
}
