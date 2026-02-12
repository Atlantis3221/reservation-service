import { useState, useEffect, useMemo } from 'react';
import './Calendar.css';

interface CalendarProps {
  onSelectSlot: (dateTime: string) => void;
  selectedSlot: string | null;
}

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD
  ? 'https://your-finnish-server.example.com/api'
  : '/api');

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Calendar({ onSelectSlot, selectedSlot }: CalendarProps) {
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const todayKey = useMemo(() => toDateKey(today), [today]);

  useEffect(() => {
    fetchAvailableSlots();
  }, []);

  async function fetchAvailableSlots(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/available-slots`);
      const data = await res.json();
      setAvailableSlots(data.slots || []);
    } catch (err) {
      console.error('Ошибка загрузки слотов:', err);
    } finally {
      setLoading(false);
    }
  }

  // Группируем слоты по датам
  const slotsByDate = useMemo(() => {
    return availableSlots.reduce((acc, slot) => {
      const date = new Date(slot);
      const dateKey = toDateKey(date);
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(slot);
      return acc;
    }, {} as Record<string, string[]>);
  }, [availableSlots]);

  // Слоты для выбранного дня
  const daySlots = useMemo(() => {
    if (!selectedDate) return [];
    return (slotsByDate[selectedDate] || []).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    );
  }, [selectedDate, slotsByDate]);

  // Генерируем ячейки календарной сетки
  const calendarCells = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // Понедельник = 0, Воскресенье = 6
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;

    const cells: Array<{ date: Date; dateKey: string; currentMonth: boolean }> = [];

    // Дни предыдущего месяца
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, dateKey: toDateKey(d), currentMonth: false });
    }

    // Дни текущего месяца
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      cells.push({ date, dateKey: toDateKey(date), currentMonth: true });
    }

    // Дни следующего месяца (чтобы заполнить последнюю неделю)
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
    if (!slotsByDate[dateKey]) return;
    setSelectedDate(dateKey);
    // Снимаем выбранное время при смене дня
    onSelectSlot('');
  }

  function handleTimeClick(slot: string): void {
    onSelectSlot(slot);
  }

  function formatTime(slot: string): string {
    const d = new Date(slot);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function formatSelectedDate(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  const selectedDateKey = selectedSlot
    ? toDateKey(new Date(selectedSlot))
    : selectedDate;

  return (
    <div className="gcal">
      {/* ---- Toolbar ---- */}
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

      {loading ? (
        <div className="gcal-loading">
          <div className="gcal-spinner" />
          <span>Загрузка...</span>
        </div>
      ) : (
        <div className="gcal-body">
          {/* ---- Month grid ---- */}
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
                const hasSlots = Boolean(slotsByDate[dateKey]);
                const isSelected = dateKey === selectedDateKey;
                const isPast = new Date(dateKey + 'T23:59:59') < today;

                let cls = 'gcal-day';
                if (!isCurrent) cls += ' gcal-day--other';
                if (isPast && !isToday) cls += ' gcal-day--past';
                if (isToday) cls += ' gcal-day--today';
                if (hasSlots && !isPast) cls += ' gcal-day--available';
                if (isSelected) cls += ' gcal-day--selected';

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

          {/* ---- Time slots panel ---- */}
          {selectedDate && daySlots.length > 0 && (
            <div className="gcal-times">
              <div className="gcal-times-header">
                <span className="gcal-times-date">{formatSelectedDate(selectedDate)}</span>
                <span className="gcal-times-count">{daySlots.length} свободно</span>
              </div>
              <div className="gcal-times-list">
                {daySlots.map((slot) => {
                  const active = selectedSlot === slot;
                  return (
                    <button
                      key={slot}
                      className={`gcal-time-chip${active ? ' gcal-time-chip--active' : ''}`}
                      onClick={() => handleTimeClick(slot)}
                    >
                      {formatTime(slot)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
