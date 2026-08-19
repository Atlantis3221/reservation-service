import type { WorkingHoursConfig } from '../api';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const DAY_LABELS: Record<string, string> = {
  mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс',
};

export const DAY_LABELS_FULL: Record<string, string> = {
  mon: 'Понедельник', tue: 'Вторник', wed: 'Среда', thu: 'Четверг',
  fri: 'Пятница', sat: 'Суббота', sun: 'Воскресенье',
};

export const SLOT_DURATIONS = [
  { minutes: 30, label: '30 минут' },
  { minutes: 60, label: '1 час' },
  { minutes: 90, label: '1,5 часа' },
  { minutes: 120, label: '2 часа' },
  { minutes: 180, label: '3 часа' },
  { minutes: 240, label: '4 часа' },
];

export function defaultWorkingHours(): WorkingHoursConfig {
  const config: WorkingHoursConfig = {};
  for (const key of DAY_KEYS) {
    config[key] = { enabled: true, start: '10:00', end: '22:00' };
  }
  return config;
}

interface Props {
  value: WorkingHoursConfig;
  onChange: (next: WorkingHoursConfig) => void;
}

/**
 * Часы работы одним экраном: сначала «во сколько», потом «в какие дни».
 * Владельцу почти всегда нужны одинаковые часы на все дни, поэтому общее
 * время сверху, а не отдельные поля у каждого дня.
 */
export function WorkingHoursForm({ value, onChange }: Props) {
  const enabledKeys = DAY_KEYS.filter((k) => value[k]?.enabled);
  const first = value[enabledKeys[0] ?? 'mon'] ?? { start: '10:00', end: '22:00' };

  const sameHours = enabledKeys.every(
    (k) => value[k].start === first.start && value[k].end === first.end,
  );

  function setAllHours(field: 'start' | 'end', time: string) {
    const next: WorkingHoursConfig = {};
    for (const key of DAY_KEYS) {
      next[key] = { ...value[key], [field]: time };
    }
    onChange(next);
  }

  function toggleDay(key: string) {
    onChange({
      ...value,
      [key]: { ...value[key], enabled: !value[key]?.enabled },
    });
  }

  return (
    <div className="wh-form">
      <div className="wh-times">
        <label className="wh-time">
          <span>Открытие</span>
          <input
            type="time"
            value={first.start}
            step={1800}
            onChange={(e) => setAllHours('start', e.target.value)}
          />
        </label>
        <span className="wh-dash">—</span>
        <label className="wh-time">
          <span>Закрытие</span>
          <input
            type="time"
            value={first.end}
            step={1800}
            onChange={(e) => setAllHours('end', e.target.value)}
          />
        </label>
      </div>

      {!sameHours && (
        <p className="wh-note">
          У дней разные часы. Изменение времени выше применится ко всем дням сразу.
        </p>
      )}

      <div className="wh-days-label">Рабочие дни</div>
      <div className="wh-days">
        {DAY_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`wh-day${value[key]?.enabled ? ' wh-day--on' : ''}`}
            onClick={() => toggleDay(key)}
            aria-pressed={!!value[key]?.enabled}
            aria-label={DAY_LABELS_FULL[key]}
          >
            {DAY_LABELS[key]}
          </button>
        ))}
      </div>

      {enabledKeys.length === 0 && (
        <p className="wh-error">Выберите хотя бы один рабочий день</p>
      )}
    </div>
  );
}
