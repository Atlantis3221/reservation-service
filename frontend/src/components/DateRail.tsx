import { useEffect, useMemo, useRef } from 'react';
import { addDays, fromDateKey, isWeekend, weekdayShort } from '../lib/day';

interface Props {
  todayKey: string;
  /** Даты, в которые реально есть что забронировать */
  freeDates: Set<string>;
  selected: string | null;
  onSelect: (dateKey: string) => void;
  onOpenMonth: () => void;
  /** Сколько дней показывать в полосе */
  days?: number;
}

/**
 * Полоса ближайших дней вместо сетки месяца на первом экране.
 *
 * Прошедших дней в ней нет — на телефоне сетка месяца отдавала им три с
 * половиной строки, по которым нельзя нажать. Высота полосы одинаковая для
 * любого выбранного дня: кнопка «Сегодня», которая появлялась и исчезала,
 * двигала всю страницу на 38 px, а вести ей было некуда — сегодня всегда
 * первый день полосы.
 */
export function DateRail({
  todayKey, freeDates, selected, onSelect, onOpenMonth, days = 21,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => Array.from({ length: days }, (_, i) => addDays(todayKey, i)),
    [todayKey, days],
  );

  // Доводим выбранный день до видимой части — но только если он из неё
  // выпал. Центрирование выглядело поломкой: полоса вставала так, что
  // крайний день обрезался ровно посередине. scrollIntoView не годится
  // вовсе — он таскает за собой всю страницу.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !selected) return;
    const btn = el.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    if (!btn) return;

    const pad = 40; // с запасом на растворённый край полосы

    // Считаем через прямоугольники, а не offsetLeft: у полосы нет своего
    // position, поэтому offsetLeft мерился от страницы и уезжал на её
    // отступы — день просто не доезжал до экрана.
    const box = el.getBoundingClientRect();
    const item = btn.getBoundingClientRect();
    const left = item.left - box.left + el.scrollLeft;
    const right = left + item.width;

    let target: number | null = null;
    if (left < el.scrollLeft + pad) target = left - pad;
    else if (right > el.scrollLeft + el.clientWidth - pad) target = right - el.clientWidth + pad;
    if (target === null) return;

    const max = el.scrollWidth - el.clientWidth;
    // Без плавности намеренно: smooth-прокрутка этого контейнера в части
    // браузеров молча не срабатывает, и выбранный день просто не доезжал
    // до экрана. Мгновенный доводчик полосы дат никто не замечает.
    el.scrollLeft = Math.max(0, Math.min(target, max));
  }, [selected]);

  return (
    <div className="rail">
      <div className="rail-track" ref={scroller}>
        {items.map((dateKey) => {
          const date = fromDateKey(dateKey);
          const free = freeDates.has(dateKey);
          const isFirstOfMonth = date.getDate() === 1;

          let cls = 'rail-day';
          if (dateKey === selected) cls += ' rail-day--on';
          if (!free) cls += ' rail-day--busy';
          if (isWeekend(dateKey)) cls += ' rail-day--weekend';

          return (
            <button
              key={dateKey}
              type="button"
              data-date={dateKey}
              className={cls}
              aria-pressed={dateKey === selected}
              aria-label={`${date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}${free ? '' : ', свободного времени нет'}`}
              onClick={() => onSelect(dateKey)}
            >
              <span className="rail-dow">
                {isFirstOfMonth
                  ? date.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')
                  : weekdayShort(dateKey)}
              </span>
              <span className="rail-num">{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="rail-more"
        onClick={onOpenMonth}
        aria-label="Выбрать дату в календаре"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
    </div>
  );
}
