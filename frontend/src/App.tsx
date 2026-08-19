import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar } from '@shared/calendar';
import { publicApi, ApiError, type BusinessInfo, type FreeSlot } from './api';
import { FreeSlotPicker } from './components/FreeSlotPicker';
import { DayViewToggle, type DayView } from './components/DayViewToggle';
import { BookingSheet } from './components/BookingSheet';
import { PrivacyPage } from './pages/PrivacyPage';
import './App.css';

const LANDING_URL = 'https://slotik.tech';

function getPathSegment(): string | null {
  const base = import.meta.env.BASE_URL || '/';
  let path = window.location.pathname;
  if (path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/^\/+|\/+$/g, '');
  return path || null;
}

export default function App() {
  const segment = useMemo(() => getPathSegment(), []);

  if (segment === 'privacy') return <PrivacyPage />;
  if (!segment) return <RootRedirect />;

  return <BusinessPage slug={segment} />;
}

/**
 * Корень домена отдаёт лендинг через nginx. Если сюда всё же попали
 * (например, из SPA-фолбэка), уводим на лендинг вместо старой заглушки
 * с инструкцией «подключите Telegram-бота».
 */
function RootRedirect() {
  useEffect(() => {
    window.location.replace(LANDING_URL);
  }, []);

  return (
    <div className="app-loading">
      <div className="app-spinner" />
      <span>Переходим на slotik.tech…</span>
    </div>
  );
}

const MINUTES_IN_DAY = 24 * 60;

/**
 * Находит свободный интервал, в который попала минута с таймлайна.
 * Границы приходят с сервера в абсолютных минутах (за полночь — больше 1440),
 * поэтому здесь не нужно повторять расчёт смены через полночь: одна ошибка
 * в этой арифметике уже приводила к тому, что тап по занятому времени
 * открывал форму на ночной слот.
 */
function findSlotAt(slots: FreeSlot[], minutes: number): FreeSlot | undefined {
  if (slots.length === 0) return undefined;

  const dayStart = slots[0].startMinutes;
  const point = minutes < dayStart % MINUTES_IN_DAY ? minutes + MINUTES_IN_DAY : minutes;

  return slots.find((slot) => point >= slot.startMinutes && point < slot.endMinutes);
}

function formatDateStr(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function BusinessPage({ slug }: { slug: string }) {
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('date'),
  );
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [sheet, setSheet] = useState<{ slot: FreeSlot | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dayView, setDayView] = useState<DayView>('slots');

  // ---- загрузка заведения ----
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    publicApi.getBusiness(slug)
      .then(setBusiness)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setNotFound(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [slug]);

  // ---- дата в адресной строке, чтобы ссылкой можно было делиться ----
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedDate) url.searchParams.set('date', selectedDate);
    else url.searchParams.delete('date');
    window.history.replaceState({}, '', url.toString());
  }, [selectedDate]);

  useEffect(() => {
    function onPopState() {
      setSelectedDate(new URLSearchParams(window.location.search).get('date'));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // ---- свободные интервалы выбранного дня ----
  useEffect(() => {
    if (!selectedDate) {
      setFreeSlots([]);
      return;
    }
    setLoadingSlots(true);
    publicApi.getFreeSlots(slug, selectedDate)
      .then(setFreeSlots)
      .catch(() => setFreeSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [slug, selectedDate, refreshKey]);

  // ---- title и описание ----
  useEffect(() => {
    if (!business) return;
    document.title = selectedDate
      ? `${business.name} — ${formatDateStr(selectedDate)}`
      : `${business.name} — онлайн-запись`;

    const meta = document.querySelector('meta[name="description"]');
    meta?.setAttribute(
      'content',
      `Онлайн-запись в «${business.name}». Выберите свободное время и забронируйте за минуту.`,
    );
  }, [business, selectedDate]);

  const fetchAvailableDates = useCallback(
    () => publicApi.getAvailableDates(slug),
    [slug],
  );
  const fetchDaySlots = useCallback(
    (date: string) => publicApi.getDaySlots(slug, date),
    [slug],
  );

  function handleBooked() {
    setRefreshKey((k) => k + 1);
  }

  /**
   * Нажатие по календарю дня: открываем тот свободный интервал, внутрь
   * которого попал тап. Если попали в занятое или закрытое время — молчим,
   * чтобы не открывать форму на время, которое всё равно нельзя занять.
   */
  function handleTimeClick(_date: string, minutes: number) {
    const slot = findSlotAt(freeSlots, minutes);
    if (slot) setSheet({ slot });
  }

  if (loading) {
    return (
      <div className="app">
        <div className="app-loading">
          <div className="app-spinner" />
          <span>Загрузка…</span>
        </div>
      </div>
    );
  }

  if (notFound || !business) {
    return (
      <div className="app">
        <div className="not-found">
          <h1>Страница не найдена</h1>
          <p>По адресу <code>/{slug}</code> ничего нет.</p>
          <p>Проверьте ссылку — возможно, в ней опечатка.</p>
          <a className="not-found-link" href={LANDING_URL}>Что такое slotik →</a>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${selectedDate ? ' app--day' : ''}`}>
      <header className="header">
        <h1>{business.name}</h1>
        <p>
          {selectedDate
            ? 'Выберите свободное время'
            : 'Онлайн-запись — выберите дату'}
        </p>
      </header>

      <main className="main">
        <Calendar
          fetchAvailableDates={fetchAvailableDates}
          fetchDaySlots={fetchDaySlots}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onBack={() => setSelectedDate(null)}
          variant={dayView === 'calendar' ? 'timeline' : 'compact'}
          showAvailable
          refreshTrigger={refreshKey}
          onTimeClick={dayView === 'calendar' ? handleTimeClick : undefined}
          emptyDayContent={
            <div className="day-empty">
              <strong>В этот день записи нет</strong>
              <span>Выберите другую дату выше.</span>
            </div>
          }
          dayHeader={
            selectedDate ? (
              <DayViewToggle value={dayView} onChange={setDayView} freeCount={freeSlots.length} />
            ) : null
          }
          dayFooter={
            selectedDate ? (
              <FreeSlotPicker
                slots={freeSlots}
                loading={loadingSlots}
                business={business}
                onPick={(slot) => setSheet({ slot })}
                onRequestOwnTime={() => setSheet({ slot: null })}
              />
            ) : null
          }
        />
      </main>

      {!selectedDate && (
        <footer className="page-footer">
          <a href="/privacy">Обработка персональных данных</a>
          <span className="page-footer-sep">·</span>
          <a href={LANDING_URL} target="_blank" rel="noopener">Работает на slotik.tech</a>
        </footer>
      )}

      {sheet && selectedDate && (
        <BookingSheet
          business={business}
          date={selectedDate}
          slot={sheet.slot}
          onClose={() => setSheet(null)}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
}
