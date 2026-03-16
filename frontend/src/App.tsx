import { useState, useEffect, useMemo } from 'react';
import Calendar from './components/Calendar';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';

interface BusinessInfo {
  name: string;
  slug: string;
  telegramUsername: string | null;
}

function getSlugFromPath(): string | null {
  const base = import.meta.env.BASE_URL || '/';
  let path = window.location.pathname;
  if (path.startsWith(base)) {
    path = path.slice(base.length);
  }
  path = path.replace(/^\/+|\/+$/g, '');
  return path || null;
}

export default function App() {
  const slug = useMemo(() => getSlugFromPath(), []);

  if (!slug) {
    return <LandingPage />;
  }

  return <BusinessPage slug={slug} />;
}

function LandingPage() {
  return (
    <div className="app">
      <div className="landing">
        <h1 className="landing-title">Сервис бронирования</h1>
        <p className="landing-desc">
          Онлайн-расписание для вашего заведения. Клиенты видят свободные слоты
          и записываются через Telegram.
        </p>
        <div className="landing-steps">
          <div className="landing-step">
            <span className="landing-step-num">1</span>
            <div>
              <strong>Подключите бота</strong>
              <p>Найдите бота по имени <a href={`https://t.me/${TELEGRAM_BOT}`} target="_blank" rel="noopener">@{TELEGRAM_BOT}</a> в Telegram и отправьте /start</p>
            </div>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">2</span>
            <div>
              <strong>Зарегистрируйте заведение</strong>
              <p>Бот спросит название и создаст персональную ссылку</p>
            </div>
          </div>
          <div className="landing-step">
            <span className="landing-step-num">3</span>
            <div>
              <strong>Управляйте расписанием</strong>
              <p>Задавайте время работы и принимайте брони прямо в чате</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessPage({ slug }: { slug: string }) {
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('date') || null;
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedDate) {
      url.searchParams.set('date', selectedDate);
    } else {
      url.searchParams.delete('date');
    }
    window.history.pushState({}, '', url.toString());
  }, [selectedDate]);

  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      setSelectedDate(params.get('date') || null);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const apiBase = `${API_URL}/business/${slug}`;
  const telegramUsername = business?.telegramUsername || '';

  useEffect(() => {
    if (!business) return;
    const name = business.name;
    if (selectedDate) {
      const dateStr = formatDateStr(selectedDate);
      document.title = `${name} — ${dateStr}`;
    } else {
      document.title = `${name} — расписание и запись`;
    }
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute('content',
        `Онлайн-расписание ${name}. Выберите удобную дату и забронируйте через Telegram.`
      );
    }
  }, [business, selectedDate]);

  useEffect(() => {
    fetchBusiness();
  }, [slug]);

  async function fetchBusiness(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(apiBase);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setBusiness(data);
    } catch (err) {
      console.error('Ошибка загрузки бани:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  function formatDateStr(dateKey: string): string {
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  function buildMessage(): string {
    if (!selectedDate) return '';
    const dateStr = formatDateStr(selectedDate);
    return `Здравствуйте! Хочу забронировать баню на ${dateStr}.`;
  }

  function handleBook(): void {
    if (!selectedDate || !telegramUsername) return;

    const message = buildMessage();

    const textarea = document.createElement('textarea');
    textarea.value = message;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    setCopied(true);
    setTimeout(() => setCopied(false), 3000);

    window.open(`https://t.me/${telegramUsername}`, '_blank');
  }

  if (loading) {
    return (
      <div className="app">
        <div className="app-loading">
          <div className="app-spinner" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="app">
        <div className="not-found">
          <h1>Баня не найдена</h1>
          <p>Страница по адресу <code>/{slug}</code> не существует.</p>
          <p>Проверьте ссылку или свяжитесь с владельцем бани.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app${selectedDate ? ' app--day' : ''}`}>
      <header className="header">
        <h1>{business?.name}</h1>
        {!selectedDate && <p>Выберите удобную дату</p>}
      </header>

      <main className="main">
        <Calendar
          apiBase={apiBase}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onBack={() => setSelectedDate(null)}
        />
      </main>

      {selectedDate && telegramUsername && (
        <div className="booking-bar">
          <button
            className="booking-bar-btn"
            onClick={handleBook}
          >
            <svg width="18" height="18" viewBox="0 0 240 240"><path d="M120 0C53.7 0 0 53.7 0 120s53.7 120 120 120 120-53.7 120-120S186.3 0 120 0zm55.9 82.3l-19.6 92.4c-1.5 6.5-5.3 8.1-10.7 5l-29.6-21.8-14.3 13.7c-1.6 1.6-2.9 2.9-5.9 2.9l2.1-30.1 55.2-49.9c2.4-2.1-.5-3.3-3.7-1.2l-68.2 43-29.4-9.2c-6.4-2-6.5-6.4 1.3-9.5l114.8-44.3c5.3-2 10 1.3 8 9z" fill="currentColor"/></svg>
            {copied ? 'Скопировано! Откройте чат' : 'Забронировать в Telegram'}
          </button>
          <span className="booking-bar-hint">
            {copied
              ? 'Вставьте сообщение в чат и отправьте'
              : 'Сообщение скопируется автоматически'}
          </span>
        </div>
      )}
    </div>
  );
}
