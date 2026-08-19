import { useState } from 'react';
import { publicApi, ApiError, type BusinessInfo, type FreeSlot } from '../api';
import { ConsentField } from './ConsentField';

interface Props {
  business: BusinessInfo;
  date: string;
  /** Выбранный свободный интервал; null — заявка на своё время */
  slot: FreeSlot | null;
  onClose: () => void;
  onBooked: () => void;
}

function formatDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', weekday: 'long',
  });
}

/**
 * Одна форма на два случая: занять конкретный свободный интервал (мгновенно)
 * или попросить своё время (заявка). Раньше клиенту в обоих случаях
 * приходилось вписывать время руками.
 */
export function BookingSheet({ business, date, slot, onClose, onBooked }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [consent, setConsent] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'booked' | 'requested' | null>(null);

  const isRequest = slot === null;
  const canSubmit = name.trim().length >= 2
    && phone.replace(/\D/g, '').length >= 10
    && consent
    && (!isRequest || (!!customStart && !!customEnd))
    && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError('');

    try {
      if (slot) {
        await publicApi.book(business.slug, {
          date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          clientName: name.trim(),
          clientPhone: phone.trim(),
          comment: comment.trim() || undefined,
          consent: true,
        });
        setDone('booked');
      } else {
        await publicApi.createRequest(business.slug, {
          preferredDate: date,
          preferredStartTime: customStart,
          preferredEndTime: customEnd,
          clientName: name.trim(),
          clientPhone: phone.trim(),
          description: comment.trim() || undefined,
          consent: true,
        });
        setDone('requested');
      }
      onBooked();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Не удалось отправить';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        {done ? (
          <div className="sheet-done">
            <div className="sheet-done-icon">✓</div>
            <h3>{done === 'booked' ? 'Готово, вы записаны' : 'Заявка отправлена'}</h3>
            <p>
              {done === 'booked'
                ? slot?.fullDay
                  ? `${formatDate(date)}, сутки с ${slot.startTime}. Мы передали вашу запись «${business.name}».`
                  : `${formatDate(date)}, ${slot?.startTime}–${slot?.endTime}. Мы передали вашу запись «${business.name}».`
                : 'Владелец свяжется с вами, чтобы подтвердить время.'}
            </p>
            <button className="sheet-btn" onClick={onClose} type="button">Закрыть</button>
          </div>
        ) : (
          <form className="sheet-form" onSubmit={handleSubmit}>
            <h3 className="sheet-title">
              {isRequest ? 'Своё время' : 'Забронировать'}
            </h3>
            <p className="sheet-sub">
              {isRequest
                ? `${formatDate(date)} — укажите удобное время, владелец подтвердит`
                : slot!.fullDay
                  ? `${formatDate(date)} — сутки, заезд ${slot!.startTime}, выезд ${slot!.endTime}`
                  : `${formatDate(date)}, ${slot!.startTime}–${slot!.endTime}`}
            </p>

            {isRequest && (
              <div className="sheet-row">
                <label className="sheet-field sheet-field--half">
                  <span>Начало</span>
                  <input
                    type="time"
                    value={customStart}
                    step={900}
                    onChange={(e) => setCustomStart(e.target.value)}
                    required
                  />
                </label>
                <label className="sheet-field sheet-field--half">
                  <span>Конец</span>
                  <input
                    type="time"
                    value={customEnd}
                    step={900}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    required
                  />
                </label>
              </div>
            )}

            <label className="sheet-field">
              <span>Как вас зовут</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Имя"
                autoComplete="name"
                maxLength={100}
                required
                autoFocus
              />
            </label>

            <label className="sheet-field">
              <span>Телефон</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+7 999 123-45-67"
                autoComplete="tel"
                required
              />
            </label>

            <label className="sheet-field">
              <span>Комментарий <em>— необязательно</em></span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Сколько человек, пожелания"
                maxLength={500}
                rows={2}
              />
            </label>

            <ConsentField checked={consent} onChange={setConsent} />

            {error && <div className="sheet-error">{error}</div>}

            <button className="sheet-btn" type="submit" disabled={!canSubmit}>
              {submitting
                ? 'Отправляем…'
                : isRequest ? 'Отправить заявку' : 'Забронировать'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
