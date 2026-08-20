import {
  DURATION_OPTIONS, TIME_STEPS, FULL_DAY_MINUTES,
  bookingModeOf, durationHint, type BookingMode,
} from './WorkingHoursForm';

export interface DurationValue {
  /** Шаг сетки времени */
  step: number;
  min: number;
  /** null — без верхней границы */
  max: number | null;
}

interface Props {
  value: DurationValue;
  onChange: (value: DurationValue) => void;
}

const MODE_LABELS: Array<{ mode: BookingMode; label: string }> = [
  { mode: 'fixed', label: 'Сеанс фиксированной длины' },
  { mode: 'range', label: 'Клиент выбирает длительность' },
  { mode: 'day', label: 'Сутки целиком' },
];

/**
 * Настройка длительности брони. Три режима вместо одного select'а:
 * фиксированный сеанс был единственным вариантом, а баню сдают «от двух
 * часов», прокат — «от часа и без верхней границы».
 *
 * Наружу отдаётся только тройка step/min/max — сервер по ним сам понимает,
 * фиксированный это сеанс (min === max) или диапазон.
 */
export function DurationFields({ value, onChange }: Props) {
  const mode = bookingModeOf(value.min, value.max);

  function switchMode(next: BookingMode): void {
    if (next === mode) return;
    if (next === 'day') {
      onChange({ step: FULL_DAY_MINUTES, min: FULL_DAY_MINUTES, max: FULL_DAY_MINUTES });
      return;
    }
    if (next === 'fixed') {
      // Из суток и из диапазона возвращаемся к осмысленной длине сеанса
      const minutes = value.min >= FULL_DAY_MINUTES ? 120 : value.min;
      onChange({ step: minutes, min: minutes, max: minutes });
      return;
    }
    const min = value.min >= FULL_DAY_MINUTES ? 120 : value.min;
    onChange({ step: 30, min, max: null });
  }

  /** Максимум должен отличаться от минимума на целое число шагов — иначе
      сервер отвергнет бронь, которую клиент уже выбрал. */
  function maxOptions(): number[] {
    const out: number[] = [];
    for (let m = value.min; m <= FULL_DAY_MINUTES; m += Math.max(15, value.step)) out.push(m);
    return out.slice(0, 40);
  }

  function labelOf(minutes: number): string {
    const known = DURATION_OPTIONS.find((d) => d.minutes === minutes);
    if (known) return known.label;
    if (minutes >= FULL_DAY_MINUTES) return 'сутки';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} минут`;
    return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
  }

  return (
    <>
      <div className="settings-field">
        <label htmlFor="booking-mode">Как бронируется время</label>
        <select
          id="booking-mode"
          value={mode}
          onChange={(e) => switchMode(e.target.value as BookingMode)}
        >
          {MODE_LABELS.map((m) => (
            <option key={m.mode} value={m.mode}>{m.label}</option>
          ))}
        </select>
        <span className="settings-field-hint">{durationHint(mode)}</span>
      </div>

      {mode === 'fixed' && (
        <div className="settings-field">
          <label htmlFor="fixed-duration">Длительность сеанса</label>
          <select
            id="fixed-duration"
            value={value.min}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              onChange({ step: minutes, min: minutes, max: minutes });
            }}
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>{d.label}</option>
            ))}
          </select>
        </div>
      )}

      {mode === 'range' && (
        <>
          <div className="settings-field">
            <label htmlFor="min-duration">Минимум</label>
            <select
              id="min-duration"
              value={value.min}
              onChange={(e) => {
                const min = Number(e.target.value);
                // Максимум ниже нового минимума сделал бы заведение
                // незабронируемым — поднимаем вместе с ним
                const max = value.max !== null && value.max < min ? min : value.max;
                onChange({ ...value, min, max });
              }}
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>{d.label}</option>
              ))}
            </select>
            <span className="settings-field-hint">Меньше этого времени забронировать нельзя.</span>
          </div>

          <div className="settings-field">
            <label htmlFor="max-duration">Максимум</label>
            <select
              id="max-duration"
              value={value.max === null ? 'none' : String(value.max)}
              onChange={(e) => onChange({
                ...value,
                max: e.target.value === 'none' ? null : Number(e.target.value),
              })}
            >
              <option value="none">Без ограничения</option>
              {maxOptions().map((minutes) => (
                <option key={minutes} value={minutes}>{labelOf(minutes)}</option>
              ))}
            </select>
            <span className="settings-field-hint">
              {value.max === null
                ? 'Клиент может занять время до конца рабочего дня.'
                : 'Дольше этого времени бронь не примем.'}
            </span>
          </div>

          <div className="settings-field">
            <label htmlFor="time-step">Шаг времени</label>
            <select
              id="time-step"
              value={value.step}
              onChange={(e) => {
                const step = Number(e.target.value);
                // Максимум обязан лежать на новой сетке шагов
                const max = value.max === null
                  ? null
                  : value.min + Math.round((value.max - value.min) / step) * step;
                onChange({ ...value, step, max });
              }}
            >
              {TIME_STEPS.map((s) => (
                <option key={s.minutes} value={s.minutes}>{s.label}</option>
              ))}
            </select>
            <span className="settings-field-hint">
              Так часто клиент видит начало брони — и такими шагами растёт её длительность.
            </span>
          </div>
        </>
      )}
    </>
  );
}
