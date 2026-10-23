import type { BusinessInfo, FreeSlot } from '../api';
import { MINUTES_IN_DAY, dateWithWeekday, dateLong, durationRules } from '../lib/day';

interface Props {
  dateKey: string;
  business: BusinessInfo;
  freeSlots: FreeSlot[];
  /** Опубликовано ли расписание на день: «не опубликовано» и «всё занято» — разные ответы */
  hasSchedule: boolean;
  loading: boolean;
  nextFreeDate: string | null;
  onPick: (slot: FreeSlot) => void;
  onGoToDate: (dateKey: string) => void;
}

/**
 * Свободное время выбранного дня — только то, что можно нажать. Занятое
 * зачёркнутым и таймлайн дня рядом с ним путали больше, чем объясняли
 * (директор, M-0337): клиенту нужно одно — во сколько можно прийти.
 */
export function DayTimes({
  dateKey, business, freeSlots, hasSchedule, loading, nextFreeDate, onPick, onGoToDate,
}: Props) {
  const fullDay = durationRules(business).min >= MINUTES_IN_DAY;
  const beforeMidnight = freeSlots.filter((s) => s.startMinutes < MINUTES_IN_DAY);
  const afterMidnight = freeSlots.filter((s) => s.startMinutes >= MINUTES_IN_DAY);

  return (
    <section className="day">
      <h2 className="day-title">{dateWithWeekday(dateKey)}</h2>

      {loading ? (
        <div className="day-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
        </div>
      ) : freeSlots.length === 0 ? (
        <p className="day-empty">
          {hasSchedule ? 'Этот день занят полностью.' : 'На этот день записи нет.'}
        </p>
      ) : fullDay ? (
        <button className="slot slot--day" type="button" onClick={() => onPick(freeSlots[0])}>
          <span className="slot-label">Забронировать сутки</span>
          <span className="slot-hint">
            заезд {freeSlots[0].startTime}, выезд {freeSlots[0].endTime}
          </span>
        </button>
      ) : (
        <>
          <TimeGrid slots={beforeMidnight} onPick={onPick} />
          {afterMidnight.length > 0 && (
            <>
              <p className="day-split">После полуночи</p>
              <TimeGrid slots={afterMidnight} onPick={onPick} />
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

function TimeGrid({ slots, onPick }: { slots: FreeSlot[]; onPick: (slot: FreeSlot) => void }) {
  return (
    <div className="slots">
      {slots.map((slot) => (
        <button key={slot.startMinutes} className="slot" type="button" onClick={() => onPick(slot)}>
          <span className="slot-time">{slot.startTime}</span>
        </button>
      ))}
    </div>
  );
}
