import { useMemo, useState } from 'react';
import { Sheet } from './Sheet';
import { fromDateKey, pad2 } from '../lib/day';

interface Props {
  todayKey: string;
  freeDates: Set<string>;
  selected: string | null;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/**
 * Месяц на случай «а что через три недели». В первый экран он не выведен:
 * на телефоне сетка занимала две трети высоты и всё равно не отвечала на
 * главный вопрос — в какое время можно прийти.
 */
export function MonthSheet({ todayKey, freeDates, selected, onSelect, onClose }: Props) {
  const [month, setMonth] = useState(() => {
    const d = fromDateKey(selected || todayKey);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const cells = useMemo(() => {
    const first = new Date(month.year, month.month, 1);
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    let lead = first.getDay() - 1;
    if (lead < 0) lead = 6;

    const out: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(`${month.year}-${pad2(month.month + 1)}-${pad2(d)}`);
    }
    return out;
  }, [month]);

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
    <Sheet onClose={onClose} label="Выбор даты">
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

          const past = dateKey < todayKey;
          const free = freeDates.has(dateKey);

          let cls = 'month-cell';
          if (past) cls += ' month-cell--past';
          if (dateKey === selected) cls += ' month-cell--on';
          if (dateKey === todayKey) cls += ' month-cell--today';
          if (free && !past) cls += ' month-cell--free';

          return (
            <button
              key={dateKey}
              type="button"
              className={cls}
              disabled={past}
              onClick={() => { onSelect(dateKey); onClose(); }}
            >
              {Number(dateKey.slice(8))}
            </button>
          );
        })}
      </div>

      <p className="month-legend">
        <span className="month-legend-dot" /> есть свободное время
      </p>
    </Sheet>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={dir === 'left' ? '15 18 9 12 15 6' : '9 6 15 12 9 18'} />
    </svg>
  );
}
