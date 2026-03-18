import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import './Calendar.css';

export interface DaySlot {
  id: number;
  startDatetime: string;
  endDatetime: string;
  status: 'available' | 'booked' | 'blocked';
  note?: string;
  clientName?: string;
  clientPhone?: string;
}

export interface PendingSlot {
  startTime: string;
  endTime: string;
}

export interface CalendarProps {
  fetchAvailableDates: () => Promise<string[]>;
  fetchDaySlots: (date: string) => Promise<DaySlot[]>;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onBack?: () => void;
  onSlotClick?: (slot: DaySlot) => void;
  onTimeClick?: (date: string, minutes: number) => void;
  showClientInfo?: boolean;
  emptyDayContent?: ReactNode;
  refreshTrigger?: unknown;
  pendingSlot?: PendingSlot | null;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DEFAULT_START_HOUR = 10;
const DEFAULT_END_HOUR = 22;

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export default function Calendar({
  fetchAvailableDates,
  fetchDaySlots,
  selectedDate,
  onSelectDate,
  onBack,
  onSlotClick,
  onTimeClick,
  showClientInfo,
  emptyDayContent,
  refreshTrigger,
  pendingSlot,
}: CalendarProps) {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    if (dateParam) {
      const d = new Date(dateParam + 'T00:00:00');
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [daySlots, setDaySlots] = useState<DaySlot[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchDatesRef = useRef(fetchAvailableDates);
  const fetchSlotsRef = useRef(fetchDaySlots);
  fetchDatesRef.current = fetchAvailableDates;
  fetchSlotsRef.current = fetchDaySlots;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayKey = useMemo(() => toDateKey(today), [today]);

  const weekDays = useMemo(() => {
    if (!selectedDate) return [];
    const d = new Date(selectedDate + 'T00:00:00');
    let dow = d.getDay() - 1;
    if (dow < 0) dow = 6;
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    const days: Array<{ date: Date; dateKey: string; label: string }> = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      days.push({
        date: day,
        dateKey: toDateKey(day),
        label: WEEKDAYS_SHORT[i],
      });
    }
    return days;
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDatesRef.current()
      .then((dates) => {
        if (!cancelled) setAvailableDates(dates);
      })
      .catch((err) => console.error('Ошибка загрузки дат:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshTrigger]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setLoadingDay(true);
    fetchSlotsRef.current(selectedDate)
      .then((slots) => {
        if (!cancelled) setDaySlots(slots);
      })
      .catch((err) => console.error('Ошибка загрузки слотов:', err))
      .finally(() => {
        if (!cancelled) setLoadingDay(false);
      });
    return () => { cancelled = true; };
  }, [selectedDate, refreshTrigger]);

  const calendarCells = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;

    const cells: Array<{ date: Date; dateKey: string; currentMonth: boolean }> = [];

    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, dateKey: toDateKey(d), currentMonth: false });
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      cells.push({ date, dateKey: toDateKey(date), currentMonth: true });
    }

    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const date = new Date(year, month + 1, d);
        cells.push({ date, dateKey: toDateKey(date), currentMonth: false });
      }
    }

    return cells;
  }, [currentMonth]);

  function prevMonth(): void {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function nextMonth(): void {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function goToday(): void {
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    onSelectDate(todayKey);
  }

  function handleDayClick(dateKey: string): void {
    onSelectDate(dateKey);
  }

  if (loading) {
    return (
      <div className="gcal">
        <div className="gcal-loading">
          <div className="gcal-spinner" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  if (selectedDate) {
    const availableSlots = daySlots.filter((s) => s.status === 'available');
    const bookedSlots = daySlots.filter((s) => s.status !== 'available');

    let rangeStartMin = DEFAULT_START_HOUR * 60;
    let rangeEndMin = DEFAULT_END_HOUR * 60;

    if (availableSlots.length > 0) {
      const starts = availableSlots.map((s) =>
        timeToMinutes(s.startDatetime.split('T')[1].substring(0, 5))
      );
      const ends = availableSlots.map((s) => {
        const m = timeToMinutes(s.endDatetime.split('T')[1].substring(0, 5));
        return m === 0 ? 24 * 60 : m;
      });
      rangeStartMin = Math.min(...starts);
      rangeEndMin = Math.max(...ends);
    }

    const rangeStartHour = Math.floor(rangeStartMin / 60);
    const rangeEndHour = Math.ceil(rangeEndMin / 60);
    const totalMinutes = rangeEndMin - rangeStartMin;

    const hours: number[] = [];
    for (let h = rangeStartHour; h <= rangeEndHour; h++) {
      hours.push(h >= 24 ? h - 24 : h);
    }

    function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
      if (!onTimeClick || !selectedDate) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const minutesInRange = (y / rect.height) * totalMinutes;
      const absMinutes = Math.round((minutesInRange + rangeStartMin) / 5) * 5;
      onTimeClick(selectedDate, absMinutes);
    }

    return (
      <div className="gcal gcal--day">
        <div className="gcal-weeknav-row">
          {onBack && (
            <button className="gcal-back-btn" onClick={onBack} aria-label="К календарю">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <div className="gcal-weeknav">
            {weekDays.map(({ dateKey, date, label }) => {
              const isSelected = dateKey === selectedDate;
              const isToday = dateKey === todayKey;
              const isPast = date < today && !isToday;
              const hasSlots = availableDates.includes(dateKey);
              let cls = 'gcal-weeknav-day';
              if (isSelected) cls += ' gcal-weeknav-day--selected';
              if (isToday) cls += ' gcal-weeknav-day--today';
              if (isPast) cls += ' gcal-weeknav-day--past';
              if (!hasSlots && !isPast) cls += ' gcal-weeknav-day--no-slots';
              return (
                <button
                  key={dateKey}
                  className={cls}
                  onClick={() => onSelectDate(dateKey)}
                >
                  <span className="gcal-weeknav-label">{label}</span>
                  <span className="gcal-weeknav-num">{date.getDate()}</span>
                </button>
              );
            })}
          </div>
          {selectedDate !== todayKey && (
            <button className="gcal-today-btn gcal-today-btn--day" onClick={goToday}>Сегодня</button>
          )}
        </div>

        {loadingDay ? (
          <div className="gcal-loading">
            <div className="gcal-spinner" />
            <span>Загрузка...</span>
          </div>
        ) : daySlots.length === 0 ? (
          emptyDayContent || <div className="gcal-empty">Расписание на этот день не задано</div>
        ) : (
          <div className="gcal-timeline-wrap">
            <div className="gcal-timeline">
              <div className="gcal-tl-hours">
                {hours.map((hour, i) => (
                  <div
                    key={i}
                    className="gcal-tl-hour"
                    style={{ top: (i === 0 ? 0 : (hour * 60 + (hour < rangeStartHour ? 24 * 60 : 0) - rangeStartMin)) }}
                  >
                    {formatTime(hour)}
                  </div>
                ))}
              </div>
              <div
                className={`gcal-tl-grid${onTimeClick ? ' gcal-tl-grid--interactive' : ''}`}
                style={{ height: totalMinutes }}
                onClick={handleGridClick}
              >
                {hours.slice(0, -1).map((hour, i) => (
                  <div
                    key={i}
                    className="gcal-tl-gridline"
                    style={{ top: hour * 60 + (hour < rangeStartHour ? 24 * 60 : 0) - rangeStartMin }}
                  />
                ))}

                {(() => {
                  const parsed = bookedSlots.map((slot) => {
                    let startMin = timeToMinutes(slot.startDatetime.split('T')[1].substring(0, 5));
                    let endMin = timeToMinutes(slot.endDatetime.split('T')[1].substring(0, 5));
                    if (endMin === 0) endMin = 24 * 60;
                    if (endMin <= startMin) endMin += 24 * 60;
                    return { slot, startMin, endMin };
                  });

                  const sorted = [...parsed].sort((a, b) => a.startMin - b.startMin);
                  const columnOf = new Map<number, number>();
                  const active: Array<{ id: number; endMin: number; col: number }> = [];

                  for (const { slot, startMin, endMin } of sorted) {
                    const still = active.filter((a) => a.endMin > startMin);
                    const used = new Set(still.map((a) => a.col));
                    let col = 0;
                    while (used.has(col)) col++;
                    columnOf.set(slot.id, col);
                    active.length = 0;
                    active.push(...still, { id: slot.id, endMin, col });
                  }

                  const interactive = !!onSlotClick;

                  return parsed.map(({ slot, startMin, endMin }) => {
                    const top = Math.max(0, startMin - rangeStartMin);
                    const bottom = Math.min(totalMinutes, endMin - rangeStartMin);
                    const height = Math.max(bottom - top, 20);
                    const col = columnOf.get(slot.id) || 0;

                    const startTimeStr = slot.startDatetime.split('T')[1].substring(0, 5);
                    const endTimeStr = slot.endDatetime.split('T')[1].substring(0, 5);

                    return (
                      <div
                        key={slot.id}
                        className={`gcal-tl-block gcal-tl-block--${slot.status}${interactive ? ' gcal-tl-block--interactive' : ''}`}
                        style={{ top, height, left: 6 + col * 16 }}
                        onClick={interactive ? (e) => { e.stopPropagation(); onSlotClick!(slot); } : undefined}
                      >
                        <span className="gcal-tl-block-time">
                          {startTimeStr}–{endTimeStr}
                        </span>
                        {slot.note && <span className="gcal-tl-block-note">{slot.note}</span>}
                        {showClientInfo && slot.clientName && (
                          <span className="gcal-tl-block-client">{slot.clientName}</span>
                        )}
                        {showClientInfo && slot.clientPhone && (
                          <span className="gcal-tl-block-phone">{slot.clientPhone}</span>
                        )}
                      </div>
                    );
                  });
                })()}

                {pendingSlot && (() => {
                  const pStart = timeToMinutes(pendingSlot.startTime);
                  const pEnd = timeToMinutes(pendingSlot.endTime);
                  const pTop = Math.max(0, pStart - rangeStartMin);
                  const pBottom = Math.min(totalMinutes, pEnd - rangeStartMin);
                  const pHeight = Math.max(pBottom - pTop, 20);
                  return (
                    <div
                      className="gcal-tl-block gcal-tl-block--pending"
                      style={{ top: pTop, height: pHeight }}
                    >
                      <span className="gcal-tl-block-time">
                        {pendingSlot.startTime}–{pendingSlot.endTime}
                      </span>
                      <span className="gcal-tl-block-note">Новая запись</span>
                    </div>
                  );
                })()}

                {selectedDate === todayKey && nowMinutes >= rangeStartMin && nowMinutes <= rangeEndMin && (
                  <div
                    className="gcal-tl-now"
                    style={{ top: nowMinutes - rangeStartMin }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="gcal">
      <div className="gcal-toolbar">
        <div className="gcal-nav">
          <button className="gcal-nav-btn" onClick={prevMonth} aria-label="Предыдущий месяц">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button className="gcal-nav-btn" onClick={nextMonth} aria-label="Следующий месяц">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
          </button>
        </div>
        <h2 className="gcal-title">
          {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </h2>
        <button className="gcal-today-btn" onClick={goToday}>Сегодня</button>
      </div>

      <div className="gcal-body">
        <div className="gcal-grid-wrap">
          <div className="gcal-weekdays">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="gcal-weekday">{wd}</div>
            ))}
          </div>

          <div className="gcal-grid">
            {calendarCells.map(({ dateKey, currentMonth: isCurrent }) => {
              const day = Number(dateKey.split('-')[2]);
              const isToday = dateKey === todayKey;
              const hasSlots = availableDates.includes(dateKey);
              const isPast = new Date(dateKey + 'T23:59:59') < today;

              let cls = 'gcal-day';
              if (!isCurrent) cls += ' gcal-day--other';
              if (isPast && !isToday) cls += ' gcal-day--past';
              if (isToday) cls += ' gcal-day--today';
              if (!isPast || isToday) cls += ' gcal-day--clickable';
              if (!hasSlots && isCurrent && !isPast) cls += ' gcal-day--no-slots';

              return (
                <button
                  key={dateKey}
                  className={cls}
                  disabled={isPast && !isToday}
                  onClick={() => handleDayClick(dateKey)}
                >
                  <span className="gcal-day-number">{day}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
