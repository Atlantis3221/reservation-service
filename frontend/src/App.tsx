import { useState } from 'react';
import Calendar from './components/Calendar';
import ReservationList from './components/ReservationList';
import type { Reservation } from './types';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD
  ? 'https://your-finnish-server.example.com/api'
  : '/api');

// Telegram username (без @)
const TELEGRAM_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'stepa2tugarev';

export default function App() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(1);
  const [copied, setCopied] = useState(false);

  async function fetchReservations(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/reservations`);
      const data: Reservation[] = await res.json();
      setReservations(data);
    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function cancelReservation(id: number): Promise<void> {
    try {
      const res = await fetch(`${API_URL}/reservations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setReservations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' as const } : r))
        );
      }
    } catch (err) {
      console.error('Cancel error:', err);
    }
  }

  function buildMessage(): string {
    if (!selectedSlot) return '';
    const d = new Date(selectedSlot);
    const dateStr = d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeStr = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const hoursPart = duration === 1 ? 'на 1 час' : `на ${duration} часа`;
    return `Здравствуйте! Хочу забронировать баню на ${dateStr} с ${timeStr} ${hoursPart}.`;
  }

  function handleBook(): void {
    if (!selectedSlot) return;

    const message = buildMessage();

    // Синхронно копируем через execCommand (работает без HTTPS и async)
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

    // Открываем чат в Telegram (синхронно — не блокируется попап-блокером)
    window.open(`https://t.me/${TELEGRAM_USERNAME}`, '_blank');
  }

  function formatSelectedSlot(): string {
    if (!selectedSlot) return '';
    const d = new Date(selectedSlot);
    const date = d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
    });
    const time = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${date}, ${time}`;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Бронирование бани</h1>
        <p>Выберите удобную дату и время</p>
      </header>

      <main className="main">
        <Calendar onSelectSlot={setSelectedSlot} selectedSlot={selectedSlot} />

        {selectedSlot && (
          <div className="booking-bar">
            <div className="booking-bar-left">
              <div className="booking-bar-info">
                <svg className="booking-bar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span>{formatSelectedSlot()}</span>
              </div>
              <div className="booking-bar-message">{buildMessage()}</div>
              <div className="booking-duration">
                <span>Длительность:</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  <option value={1}>1 час</option>
                  <option value={2}>2 часа</option>
                  <option value={3}>3 часа</option>
                  <option value={4}>4 часа</option>
                </select>
              </div>
            </div>
            <div className="booking-bar-actions">
              <button className="booking-bar-btn" onClick={handleBook}>
                <svg width="18" height="18" viewBox="0 0 240 240"><path d="M120 0C53.7 0 0 53.7 0 120s53.7 120 120 120 120-53.7 120-120S186.3 0 120 0zm55.9 82.3l-19.6 92.4c-1.5 6.5-5.3 8.1-10.7 5l-29.6-21.8-14.3 13.7c-1.6 1.6-2.9 2.9-5.9 2.9l2.1-30.1 55.2-49.9c2.4-2.1-.5-3.3-3.7-1.2l-68.2 43-29.4-9.2c-6.4-2-6.5-6.4 1.3-9.5l114.8-44.3c5.3-2 10 1.3 8 9z" fill="currentColor"/></svg>
                {copied ? 'Скопировано! Откройте чат' : 'Забронировать в Telegram'}
              </button>
              <span className="booking-bar-hint">
                {copied
                  ? 'Вставьте сообщение в чат (Ctrl+V) и отправьте'
                  : 'Сообщение скопируется автоматически'}
              </span>
            </div>
          </div>
        )}

        <section className="section">
          <div className="section-header">
            <h2>Бронирования</h2>
            <button className="btn btn-outline" onClick={fetchReservations} disabled={loading}>
              {loading ? 'Загрузка...' : 'Обновить'}
            </button>
          </div>
          <ReservationList items={reservations} onCancel={cancelReservation} />
        </section>
      </main>
    </div>
  );
}
