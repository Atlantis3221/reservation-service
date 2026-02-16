import { useState, useEffect, useMemo } from 'react';
import './Calendar.css';

interface CalendarProps {
  onSelectSlot: (dateTime: string) => void;
  selectedSlot: string | null;
}

interface DaySlot {
  datetime: string;
  duration: number;
  status: 'available' | 'booked' | 'blocked';
  note?: string;
}

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD
  ? 'https://your-finnish-server.example.com/api'
  : '/api');

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const START_HOUR = 10;
const END_HOUR = 22;

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTime(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export default function Calendar({ onSelectSlot, selectedSlot }: CalendarProps) {
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [daySlots, setDaySlots] = useState<DaySlot[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayKey = useMemo(() => toDateKey(today), [today]);

  useEffect(() => {
    fetchAvailableDates();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchDaySlots(selectedDate);
    }
  }, [selectedDate]);

  async function fetchAvailableDates(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/available-dates`);
      const data = await res.json();
      setAvailableDates(data.dates || []);
    } catch (err) {
      console.error('Ошибка загрузки дат:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDaySlots(dateKey: string): Promise<void> {
    setLoadingDay(true);
    try {
      const res = await fetch(`${API_URL}/day-slots?date=${dateKey}`);
      const data = await res.json();
      setDaySlots(data.slots || []);
    } catch (err) {
      console.error('Ошибка загрузки слотов:', err);
    } finally {
      setLoadingDay(false);
    }
  }

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
  }

  function handleDayClick(dateKey: string): void {
    if (!availableDates.includes(dateKey)) return;
    setSelectedDate(dateKey);
    onSelectSlot('');
  }

  function handleHourClick(hour: number): void {
    if (!selectedDate) return;
    // Локальное время без UTC-сдвига
    const datetime = `${selectedDate}T${String(hour).padStart(2, '0')}:00:00`;
    onSelectSlot(datetime);
  }

  function handleBackToCalendar(): void {
    setSelectedDate(null);
    onSelectSlot('');
  }

  function formatSelectedDate(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  // Проверяем, занят ли час
  function isHourBooked(hour: number): DaySlot | null {
    for (const slot of daySlots) {
      const slotHour = new Date(slot.datetime).getHours();
      if (slotHour === hour && slot.status !== 'available') {
        return slot;
      }
    }
    return null;
  }

  // Проверяем, свободен ли час
  function isHourAvailable(hour: number): boolean {
    for (const slot of daySlots) {
      const slotHour = new Date(slot.datetime).getHours();
      if (slotHour === hour && slot.status === 'available') {
        return true;
      }
    }
    return false;
  }

  // Выбран ли час
  function isHourSelected(hour: number): boolean {
    if (!selectedSlot) return false;
    const selectedHour = new Date(selectedSlot).getHours();
    return selectedHour === hour && selectedDate === toDateKey(new Date(selectedSlot));
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

  // Показываем таймлайн дня
  if (selectedDate) {
    return (
      <div className="gcal">
        <div className="gcal-toolbar">
          <button className="gcal-today-btn" onClick={handleBackToCalendar}>
            ← К календарю
          </button>
          <h2 className="gcal-title">{formatSelectedDate(selectedDate)}</h2>
        </div>

        {loadingDay ? (
          <div className="gcal-loading">
            <div className="gcal-spinner" />
            <span>Загрузка...</span>
          </div>
        ) : (
          <div className="gcal-timeline">
            <div className="gcal-tl-hours">
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i).map((hour) => (
                <div key={hour} className="gcal-tl-hour">
                  {formatTime(hour)}
                </div>
              ))}
            </div>
            <div className="gcal-tl-cells-wrap">
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i).map((hour) => {
                const booked = isHourBooked(hour);
                const available = isHourAvailable(hour);
                const selected = isHourSelected(hour);
                const isPast = selectedDate === todayKey && hour < new Date().getHours();

                let cellClass = 'gcal-tl-cell';
                if (booked) {
                  cellClass += booked.status === 'booked' ? ' gcal-tl-cell--booked' : ' gcal-tl-cell--blocked';
                } else if (available && !isPast) {
                  cellClass += ' gcal-tl-cell--available';
                }
                if (selected) cellClass += ' gcal-tl-cell--selected';
                if (isPast) cellClass += ' gcal-tl-cell--past';

                return (
                  <div
                    key={hour}
                    className={cellClass}
                    onClick={() => available && !isPast && handleHourClick(hour)}
                  >
                    {booked && (
                      <div
                        className="gcal-tl-block"
                        style={{
                          height: `${booked.duration * 60}px`,
                        }}
                      >
                        {booked.note && <span className="gcal-tl-block-note">{booked.note}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Показываем месячную сетку
  return (
    <div className="gcal">
      <div className="gcal-toolbar">
        <button className="gcal-today-btn" onClick={goToday}>Сегодня</button>
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
              if (hasSlots && !isPast) cls += ' gcal-day--available';

              return (
                <button
                  key={dateKey}
                  className={cls}
                  disabled={!hasSlots || isPast}
                  onClick={() => handleDayClick(dateKey)}
                >
                  <span className="gcal-day-number">{day}</span>
                  {hasSlots && !isPast && (
                    <span className="gcal-day-dot" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
