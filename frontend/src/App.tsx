import { useState, useEffect, useMemo } from 'react';
import { Calendar } from '@shared/calendar';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '';

interface ContactLink {
  type: 'telegram' | 'vk' | 'max';
  url: string;
}

interface BusinessInfo {
  name: string;
  slug: string;
  telegramUsername: string | null;
  contactLinks: ContactLink[];
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

const CONTACT_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

function ContactIcon({ type }: { type: string }) {
  if (type === 'telegram') {
    return <svg width="18" height="18" viewBox="0 0 240 240"><path d="M120 0C53.7 0 0 53.7 0 120s53.7 120 120 120 120-53.7 120-120S186.3 0 120 0zm55.9 82.3l-19.6 92.4c-1.5 6.5-5.3 8.1-10.7 5l-29.6-21.8-14.3 13.7c-1.6 1.6-2.9 2.9-5.9 2.9l2.1-30.1 55.2-49.9c2.4-2.1-.5-3.3-3.7-1.2l-68.2 43-29.4-9.2c-6.4-2-6.5-6.4 1.3-9.5l114.8-44.3c5.3-2 10 1.3 8 9z" fill="currentColor"/></svg>;
  }
  if (type === 'vk') {
    return <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 13.141c.46.449.946.87 1.357 1.368.182.222.354.451.48.71.18.365.017.766-.313.79l-2.114.001c-.546.044-1-.178-1.395-.558-.316-.304-.608-.63-.914-.944-.125-.128-.256-.249-.406-.346-.3-.194-.562-.138-.736.18-.178.323-.218.679-.234 1.038-.023.516-.18.649-.698.674-.928.048-1.81-.128-2.632-.6-1.38-.792-2.432-1.905-3.36-3.145C5.77 10.698 4.844 8.895 4.058 7.02c-.175-.418-.042-.642.413-.649.683-.013 1.365-.012 2.048 0 .258.005.432.158.537.401.505 1.171 1.12 2.286 1.877 3.322.2.275.404.548.694.727.318.198.554.118.693-.225.088-.22.125-.453.14-.688.048-.762.054-1.524-.036-2.283-.055-.473-.3-.778-.771-.875-.24-.05-.204-.148-.088-.24.2-.159.388-.258.763-.258h2.387c.376.074.46.244.51.623l.002 2.658c-.005.147.073.584.337.681.211.07.35-.1.476-.232.573-.6 .982-1.308 1.353-2.04.163-.323.304-.658.439-.993.1-.249.255-.372.535-.367l2.302.003c.068 0 .137 0 .204.015.39.073.498.256.379.636-.188.6-.56 1.096-.938 1.587l-1.04 1.345c-.094.123-.182.252-.257.387-.137.248-.104.47.092.687z" fill="currentColor"/></svg>;
  }
  if (type === 'max') {
    return <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14h-1.8l-2.7-4-2.7 4H7.5l3.6-5.3L7.8 6h1.8l2.4 3.6L14.4 6h1.8l-3.3 4.7L16.5 16z" fill="currentColor"/></svg>;
  }
  return null;
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
  const contactLinks = business?.contactLinks || [];

  useEffect(() => {
    if (!business) return;
    const name = business.name.replace(/\b\w/g, (c) => c.toUpperCase());
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
    const controller = new AbortController();
    setLoading(true);

    fetch(apiBase, { signal: controller.signal })
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        return res.json().then((data) => setBusiness(data));
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        console.error('Ошибка загрузки бани:', err);
        setNotFound(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [slug]);

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

  function copyToClipboard(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function handleBook(link: ContactLink): void {
    if (!selectedDate) return;

    const message = buildMessage();
    copyToClipboard(message);

    setCopied(true);
    setTimeout(() => setCopied(false), 3000);

    window.open(link.url, '_blank');
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
          <h1>Заведение не найдено</h1>
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
          fetchAvailableDates={() =>
            fetch(`${apiBase}/available-dates`).then((r) => r.json()).then((d) => d.dates || [])
          }
          fetchDaySlots={(date) =>
            fetch(`${apiBase}/day-slots?date=${date}`).then((r) => r.json()).then((d) => d.slots || [])
          }
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onBack={() => setSelectedDate(null)}
        />
      </main>

      {selectedDate && contactLinks.length > 0 && (
        <div className="booking-bar">
          {contactLinks.map((link) => (
            <button
              key={link.type}
              className={`booking-bar-btn booking-bar-btn--${link.type}`}
              onClick={() => handleBook(link)}
            >
              <ContactIcon type={link.type} />
              {copied ? 'Скопировано! Откройте чат' : `Забронировать в ${CONTACT_LABELS[link.type]}`}
            </button>
          ))}
          <span className="booking-bar-hint">
            {copied
              ? 'Вставьте сообщение в чат и отправьте'
              : 'Сообщение скопируется автоматически'}
          </span>
        </div>
      )}
      {selectedDate && contactLinks.length === 0 && (
        <div className="booking-bar">
          <span className="booking-bar-hint booking-bar-hint--no-links">
            Свяжитесь с владельцем бани для бронирования
          </span>
        </div>
      )}
    </div>
  );
}
