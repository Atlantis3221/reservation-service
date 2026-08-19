export type DayView = 'slots' | 'calendar';

interface Props {
  value: DayView;
  onChange: (view: DayView) => void;
  /** Сколько свободных интервалов — показываем рядом, чтобы переключатель что-то сообщал */
  freeCount: number;
}

/**
 * Клиент может смотреть день двумя способами: списком свободных интервалов
 * (быстро выбрать) и календарём (видно, как занят день целиком).
 * Список открыт по умолчанию: это то, зачем клиент пришёл, и он влезает
 * на первый экран, а таймлайн на смену в 12–16 часов — нет.
 */
export function DayViewToggle({ value, onChange, freeCount }: Props) {
  return (
    <div className="dayview" role="tablist" aria-label="Как показать день">
      <button
        role="tab"
        aria-selected={value === 'slots'}
        className={`dayview-btn${value === 'slots' ? ' dayview-btn--on' : ''}`}
        onClick={() => onChange('slots')}
        type="button"
      >
        Свободное время
        {freeCount > 0 && <span className="dayview-count">{freeCount}</span>}
      </button>
      <button
        role="tab"
        aria-selected={value === 'calendar'}
        className={`dayview-btn${value === 'calendar' ? ' dayview-btn--on' : ''}`}
        onClick={() => onChange('calendar')}
        type="button"
      >
        Календарь дня
      </button>
    </div>
  );
}
