import { useState, useEffect, useMemo, useCallback } from 'react';
import { publicApi, type BusinessInfo, type DaySlot, type FreeSlot } from './api';
import { MonthCalendar } from './components/MonthCalendar';
import { DayTimes } from './components/DayTimes';
import { BookingAlt } from './components/BookingAlt';
import { MyBooking } from './components/MyBooking';
import { BookingSheet, type BookingDraft } from './components/BookingSheet';
import { Sheet } from './components/Sheet';
import { trackBusiness } from './lib/track';
import { PrivacyPage } from './pages/PrivacyPage';
import { useKeyboardInset } from './hooks/useKeyboardInset';
import { durationRules, durationSummary, nowInBusinessTz } from './lib/day';
import './App.css';

const LANDING_URL = 'https://slotik.tech';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function getPathSegment(): string | null {
  const base = import.meta.env.BASE_URL || '/';
  let path = window.location.pathname;
  if (path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/^\/+|\/+$/g, '');
  return path || null;
}

export default function App() {
  const segment = useMemo(() => getPathSegment(), []);
  useKeyboardInset();

  if (segment === 'privacy') return <PrivacyPage />;
  if (!segment) return <RootRedirect />;

  return <BusinessPage slug={segment} />;
}

/**
 * Корень домена отдаёт лендинг через nginx. Если сюда всё же попали
 * (например, из SPA-фолбэка), уводим на лендинг.
 */
function RootRedirect() {
  useEffect(() => {
    window.location.replace(LANDING_URL);
  }, []);

  return (
    <div className="boot">
      <span className="spinner" />
      <span>Переходим на slotik.tech…</span>
    </div>
  );
}

/** Личная ссылка клиента на его запись: slotik.tech/<место>?zapis=<токен> */
function readBookingParam(): string | null {
  return new URLSearchParams(window.location.search).get('zapis');
}

function readDateParam(): string | null {
  const value = new URLSearchParams(window.location.search).get('date');
  return value && DATE_RE.test(value) ? value : null;
}

function BusinessPage({ slug }: { slug: string }) {
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const [freeDates, setFreeDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(readDateParam);
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [daySlots, setDaySlots] = useState<DaySlot[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);

  const [sheet, setSheet] = useState<{ slot: FreeSlot | null } | null>(null);
  // На примере выбор времени не открывает бронь, а объясняет, что это пример
  const [exampleNote, setExampleNote] = useState(false);
  const [bookingToken, setBookingToken] = useState<string | null>(readBookingParam);
  const [refreshKey, setRefreshKey] = useState(0);

  // Черновик живёт на странице, а не в листе: случайный тап по фону больше
  // не стирает уже введённые имя и телефон.
  const [draft, setDraft] = useState<BookingDraft>({ name: '', phone: '', comment: '' });

  // «Сегодня» — по часам заведения, а не зрителя: иначе клиент из другого
  // часового пояса открывает страницу на дне, который для бани ещё не начался.
  const todayKey = useMemo(() => nowInBusinessTz().dateKey, []);
  const freeDateSet = useMemo(() => new Set(freeDates), [freeDates]);

  useEffect(() => {
    setLoading(true);
    publicApi.getBusiness(slug)
      .then((b) => {
        setBusiness(b);
        trackBusiness(slug, 'view');
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    publicApi.getAvailableDates(slug)
      .then(setFreeDates)
      .catch(() => setFreeDates([]));
  }, [slug, refreshKey]);

  // Открываем сразу на ближайшем дне со свободным временем: клиент пришёл
  // за временем, а не за календарём, и первый экран должен отвечать сразу.
  useEffect(() => {
    if (selectedDate) return;
    const nearest = freeDates.find((d) => d >= todayKey);
    setSelectedDate(nearest || todayKey);
  }, [freeDates, selectedDate, todayKey]);

  // Дата в адресной строке — чтобы ссылкой на конкретный день можно делиться
  useEffect(() => {
    if (!selectedDate) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('date') === selectedDate) return;
    url.searchParams.set('date', selectedDate);
    window.history.replaceState({}, '', url.toString());
  }, [selectedDate]);

  useEffect(() => {
    function onPopState(): void {
      setSelectedDate(readDateParam());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setLoadingDay(true);

    Promise.all([
      publicApi.getFreeSlots(slug, selectedDate).catch(() => [] as FreeSlot[]),
      publicApi.getDaySlots(slug, selectedDate).catch(() => [] as DaySlot[]),
    ]).then(([free, day]) => {
      if (cancelled) return;
      setFreeSlots(free);
      setDaySlots(day);
      setLoadingDay(false);
    });

    return () => { cancelled = true; };
  }, [slug, selectedDate, refreshKey]);

  useEffect(() => {
    if (!business) return;
    document.title = `${business.name} — онлайн-запись`;
    document.querySelector('meta[name="description"]')?.setAttribute(
      'content',
      `Онлайн-запись в «${business.name}». Выберите свободное время и забронируйте за минуту.`,
    );
    if (business.example && !document.querySelector('meta[name="robots"]')) {
      const robots = document.createElement('meta');
      robots.name = 'robots';
      robots.content = 'noindex, nofollow';
      document.head.appendChild(robots);
    }
  }, [business]);

  /**
   * Куда предложить пойти, если в выбранном дне записаться нельзя: сначала
   * ближайший свободный день после него, иначе — ближайший свободный вообще.
   * Второй случай — это когда человек ушёл далеко вперёд по календарю
   * и попал в даты, на которые расписание ещё не опубликовано.
   */
  const nextFreeDate = useMemo(() => {
    if (!selectedDate) return null;
    const after = freeDates.find((d) => d > selectedDate);
    if (after) return after;
    const upcoming = freeDates.find((d) => d >= todayKey && d !== selectedDate);
    return upcoming || null;
  }, [freeDates, selectedDate, todayKey]);

  const handleBooked = useCallback((clientToken?: string) => {
    setRefreshKey((k) => k + 1);
    setDraft({ name: '', phone: '', comment: '' });
    // Ссылка на запись сразу в адресной строке: обновил или сохранил
    // страницу — запись перед глазами
    if (!clientToken) return;
    setBookingToken(clientToken);
    const url = new URL(window.location.href);
    url.searchParams.set('zapis', clientToken);
    window.history.replaceState({}, '', url.toString());
  }, []);

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    );
  }

  if (notFound || !business) {
    return (
      <div className="page">
        <div className="miss">
          <h1>Страница не найдена</h1>
          <p>По адресу <code>/{slug}</code> ничего нет. Проверьте ссылку — возможно, в ней опечатка.</p>
          <a className="link" href={LANDING_URL}>Что такое slotik →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {business.example && (
        <p className="example-note" role="note">
          Это пример: Slotik собрал страницу по часам работы с сайта места. Само место
          Slotik не пользуется, запись отсюда не уходит. Удалим через 7 дней или по первому слову.
        </p>
      )}

      <header className="page-head">
        <h1>{business.name}</h1>
        <p>Онлайн-запись · {durationSummary(durationRules(business))}</p>
      </header>

      {bookingToken && <MyBooking business={business} token={bookingToken} />}

      <h2 className="step">Выберите день</h2>
      <MonthCalendar
        todayKey={todayKey}
        freeDates={freeDateSet}
        selected={selectedDate}
        onSelect={setSelectedDate}
      />

      {selectedDate && (
        <>
          <h2 className="step">Выберите время</h2>
          <DayTimes
            dateKey={selectedDate}
            business={business}
            freeSlots={freeSlots}
            hasSchedule={daySlots.length > 0}
            loading={loadingDay}
            nextFreeDate={nextFreeDate}
            onPick={(slot) => {
              trackBusiness(slug, 'pick');
              if (business.example) setExampleNote(true);
              else setSheet({ slot });
            }}
            onGoToDate={setSelectedDate}
          />
        </>
      )}

      <BookingAlt
        business={business}
        onRequestOwnTime={() => {
          trackBusiness(slug, 'request_open');
          if (business.example) setExampleNote(true);
          else setSheet({ slot: null });
        }}
      />

      <footer className="page-foot">
        <a href="/privacy">Обработка персональных данных</a>
        <a href={LANDING_URL} target="_blank" rel="noopener">Работает на slotik.tech</a>
      </footer>

      {exampleNote && (
        <Sheet
          label="Это пример"
          onClose={() => setExampleNote(false)}
          footer={<button className="btn" type="button" onClick={() => setExampleNote(false)}>Понятно</button>}
        >
          <h3 className="sheet-title">Это пример, запись не уходит</h3>
          <p className="sheet-sub">
            Так клиент выбирает время: дальше он оставляет имя и телефон, а бронь сразу приходит
            владельцу. С этой страницы запись никуда не отправится.
          </p>
        </Sheet>
      )}

      {sheet && selectedDate && (
        <BookingSheet
          business={business}
          date={selectedDate}
          slot={sheet.slot}
          draft={draft}
          onDraftChange={setDraft}
          onClose={() => setSheet(null)}
          onBooked={handleBooked}
        />
      )}
    </div>
  );
}
