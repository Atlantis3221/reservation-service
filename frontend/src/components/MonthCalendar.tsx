import { useEffect, useMemo, useState } from 'react';
import { fromDateKey, pad2 } from '../lib/day';

interface Props {
  todayKey: string;
  /** Даты, в которые реально есть что забронировать */
  freeDates: Set<string>;
  selected: string | null;
  onSelect: (dateKey: string) => void;
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/**
 * Месяц на всю ширину — первое, что видит клиент (директор, M-0337).
 * Полоса дат рядом с таймлайном дня читалась как «непонятно, куда жать»:
 * здесь нажимаются только дни со свободным временем, и они залиты цветом.
 */
export function MonthCalendar({ todayKey, freeDates, selected, onSelect }: Props) {
  const [month, setMonth] = useState(() => monthOf(selected || todayKey));

  // Выбранный день ушёл в другой месяц («Ближайшее свободное») — листаем за ним
  useEffect(() => {
    if (selected) setMonth(monthOf(selected));
  }, [selected]);

  const cells = useMemo(() => {
    const first = new Date(month.year, month.month, 1);
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    let lead = first.getDay() - 1;
    if (lead < 0) lead = 6;

    const out: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${month.year}-${pad2(month.month + 1)}-${pad2(d)}`);
    }
    // Прошедшие недели не показываем: на телефоне они занимали полкалендаря
    // серыми днями, по которым нельзя нажать
    const weeks: Array<string | null>[] = [];
    for (let i = 0; i < out.length; i += 7) weeks.push(out.slice(i, i + 7));
    return weeks.filter((week) => week.some((d) => d !== null && d >= todayKey)).flat();
  }, [month, todayKey]);

  // Назад в прошлое ходить некуда: забронировать вчерашний день нельзя.
  const atFirstMonth = useMemo(() => {
    const today = fromDateKey(todayKey);
    return month.year === today.getFullYear() && month.month === today.getMonth();
  }, [month, todayKey]);

  function shift(by: number): void {
    setMonth((prev) => {
      const d = new Date(prev.year, prev.month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <section className="month" aria-label="Выбор дня">
      <div className="month-head">
        <h2 className="month-title">{MONTHS[month.month]} {month.year}</h2>
        <div className="month-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => shift(-1)}
            disabled={atFirstMonth}
            aria-label="Предыдущий месяц"
          >
            <Chevron dir="left" />
          </button>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Следующий месяц">
            <Chevron dir="right" />
          </button>
        </div>
      </div>

      <div className="month-dows">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div className="month-grid">
        {cells.map((dateKey, i) => {
          if (!dateKey) return <span key={`pad-${i}`} className="month-cell month-cell--pad" />;

          const free = dateKey >= todayKey && freeDates.has(dateKey);

          let cls = 'month-cell';
          if (free) cls += ' month-cell--free';
          if (dateKey === selected) cls += ' month-cell--on';
          if (dateKey === todayKey) cls += ' month-cell--today';

          return (
            <button
              key={dateKey}
              type="button"
              className={cls}
              disabled={!free && dateKey !== selected}
              aria-pressed={dateKey === selected}
              aria-label={`${fromDateKey(dateKey).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}${free ? '' : ', записи нет'}`}
              onClick={() => onSelect(dateKey)}
            >
              {Number(dateKey.slice(8))}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function monthOf(dateKey: string): { year: number; month: number } {
  const d = fromDateKey(dateKey);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 6 15 12 9 18'} />
    </svg>
  );
}
