import { useMemo, useRef, useState } from 'react';
import { publicApi, ApiError, type BusinessInfo, type FreeSlot } from '../api';
import { Sheet } from './Sheet';
import {
  dateWithWeekday, durationChoices, durationRules, durationShort, shiftTime,
} from '../lib/day';
import { digitsOf, formatPhone, isPhoneComplete } from '../lib/phone';

export interface BookingDraft {
  name: string;
  phone: string;
  comment: string;
}

interface Props {
  business: BusinessInfo;
  date: string;
  /** Выбранный свободный интервал; null — заявка на своё время */
  slot: FreeSlot | null;
  draft: BookingDraft;
  onDraftChange: (draft: BookingDraft) => void;
  onClose: () => void;
  onBooked: () => void;
}

type Field = 'name' | 'phone' | 'time' | 'consent';

/**
 * Одна форма на два случая: занять свободный интервал (сразу) или попросить
 * своё время (заявка).
 *
 * Обязательного здесь два поля. Кнопка всегда активна: раньше она молча
 * блокировалась до «имя + 10 цифр + согласие», и человек жал мёртвую кнопку,
 * не понимая, чего не хватает. Теперь проверка на отправке, с текстом у поля.
 */
export function BookingSheet({
  business, date, slot, draft, onDraftChange, onClose, onBooked,
}: Props) {
  const [consent, setConsent] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showComment, setShowComment] = useState(() => draft.comment.length > 0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<Partial<Record<Field, string>>>({});
  const [done, setDone] = useState<'booked' | 'requested' | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const prevDigits = useRef(digitsOf(draft.phone).length);

  const isRequest = slot === null;
  const rules = useMemo(() => durationRules(business), [business]);

  // Сколько можно занять с выбранного начала: сервер присылает остаток окна,
  // уже обрезанный максимумом заведения.
  const choices = useMemo(() => {
    if (!slot || slot.fullDay) return [];
    const room = slot.maxMinutes ?? (slot.endMinutes - slot.startMinutes);
    return durationChoices(rules, room);
  }, [slot, rules]);

  const [duration, setDuration] = useState<number>(() => rules.min);

  // Начало сменилось — длительность может уже не влезать в новое окно
  const picked = choices.includes(duration) ? duration : (choices[0] ?? rules.min);
  const endTime = slot ? shiftTime(slot.startTime, picked) : '';

  function patch(part: Partial<BookingDraft>): void {
    onDraftChange({ ...draft, ...part });
  }

  function handlePhone(value: string): void {
    const digits = digitsOf(value);
    // При стирании не переформатируем: иначе маска возвращает символы назад
    // и каретка прыгает.
    const next = digits.length >= prevDigits.current ? formatPhone(value) : value;
    prevDigits.current = digits.length;
    patch({ phone: next });
    if (invalid.phone) setInvalid((s) => ({ ...s, phone: undefined }));
  }

  function validate(): Partial<Record<Field, string>> {
    const found: Partial<Record<Field, string>> = {};
    if (draft.name.trim().length < 2) found.name = 'Как к вам обращаться?';
    if (!isPhoneComplete(draft.phone)) found.phone = 'Нужен номер, чтобы подтвердить запись';
    if (isRequest && (!customStart || !customEnd)) found.time = 'Укажите, с какого по какое время';
    if (!consent) found.consent = 'Без согласия мы не можем принять запись';
    return found;
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;

    const found = validate();
    setInvalid(found);
    if (Object.keys(found).length > 0) {
      if (found.time) startRef.current?.focus();
      else if (found.name) nameRef.current?.focus();
      else if (found.phone) phoneRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      if (slot) {
        await publicApi.book(business.slug, {
          date,
          startTime: slot.startTime,
          endTime: slot.fullDay ? slot.endTime : endTime,
          clientName: draft.name.trim(),
          clientPhone: draft.phone.trim(),
          comment: draft.comment.trim() || undefined,
          consent: true,
        });
        setDone('booked');
      } else {
        await publicApi.createRequest(business.slug, {
          preferredDate: date,
          preferredStartTime: customStart,
          preferredEndTime: customEnd,
          clientName: draft.name.trim(),
          clientPhone: draft.phone.trim(),
          description: draft.comment.trim() || undefined,
          consent: true,
        });
        setDone('requested');
      }
      onBooked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Sheet onClose={onClose} label="Запись оформлена">
        <div className="done">
          <div className="done-mark" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 11" />
            </svg>
          </div>
          <h3>{done === 'booked' ? 'Вы записаны' : 'Заявка отправлена'}</h3>
          <p>
            {done === 'booked'
              ? slot?.fullDay
                ? `${dateWithWeekday(date)}, сутки с ${slot.startTime}. «${business.name}» получил вашу запись.`
                : `${dateWithWeekday(date)}, ${slot?.startTime}–${endTime}. «${business.name}» получил вашу запись.`
              : 'Владелец свяжется с вами, чтобы подтвердить время.'}
          </p>
          <button className="btn" onClick={onClose} type="button">Готово</button>
        </div>
      </Sheet>
    );
  }

  const summary = isRequest
    ? `${dateWithWeekday(date)} — своё время`
    : slot!.fullDay
      ? `${dateWithWeekday(date)} · заезд ${slot!.startTime}, выезд ${slot!.endTime}`
      : `${dateWithWeekday(date)} · ${slot!.startTime}–${endTime}`;

  return (
    <Sheet
      onClose={onClose}
      label={isRequest ? 'Заявка на своё время' : 'Бронирование'}
      footer={
        <>
          <label className={`consent${invalid.consent ? ' consent--bad' : ''}`}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (e.target.checked) setInvalid((s) => ({ ...s, consent: undefined }));
              }}
            />
            <span>
              Согласен с <a href="/privacy" target="_blank" rel="noopener">обработкой персональных данных</a>
              {invalid.consent && <em className="field-bad">{invalid.consent}</em>}
            </span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="btn" type="submit" form="booking-form" disabled={submitting}>
            {submitting ? 'Отправляем…' : isRequest ? 'Отправить заявку' : 'Забронировать'}
          </button>
        </>
      }
    >
      <h3 className="sheet-title">{isRequest ? 'Своё время' : 'Забронировать'}</h3>
      <p className="sheet-sub">{summary}</p>

      <form className="form" id="booking-form" onSubmit={handleSubmit} noValidate>
        {/* Длительность выбирается здесь, а не в сетке времени: в сетке она
            размножила бы каждое начало на десяток вариантов. */}
        {choices.length > 1 && (
          <div className="field">
            <span className="field-label">Сколько времени</span>
            <div className="durations" role="radiogroup" aria-label="Длительность">
              {choices.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  role="radio"
                  aria-checked={minutes === picked}
                  className={`duration${minutes === picked ? ' duration--on' : ''}`}
                  onClick={() => setDuration(minutes)}
                >
                  {durationShort(minutes)}
                </button>
              ))}
            </div>
          </div>
        )}

        {isRequest && (
          <div className="form-row">
            <label className="field">
              <span className="field-label">С какого</span>
              <input
                ref={startRef}
                type="time"
                value={customStart}
                step={900}
                onChange={(e) => { setCustomStart(e.target.value); setInvalid((s) => ({ ...s, time: undefined })); }}
              />
            </label>
            <label className="field">
              <span className="field-label">По какое</span>
              <input
                type="time"
                value={customEnd}
                step={900}
                onChange={(e) => { setCustomEnd(e.target.value); setInvalid((s) => ({ ...s, time: undefined })); }}
              />
            </label>
            {invalid.time && <p className="field-bad field-bad--row">{invalid.time}</p>}
          </div>
        )}

        <label className="field">
          <span className="field-label">Имя</span>
          <input
            ref={nameRef}
            type="text"
            value={draft.name}
            onChange={(e) => {
              patch({ name: e.target.value });
              if (invalid.name) setInvalid((s) => ({ ...s, name: undefined }));
            }}
            className={invalid.name ? 'bad' : undefined}
            placeholder="Как вас зовут"
            autoComplete="name"
            enterKeyHint="next"
            maxLength={100}
          />
          {invalid.name && <span className="field-bad">{invalid.name}</span>}
        </label>

        <label className="field">
          <span className="field-label">Телефон</span>
          <input
            ref={phoneRef}
            type="tel"
            inputMode="tel"
            value={draft.phone}
            onChange={(e) => handlePhone(e.target.value)}
            onBlur={(e) => patch({ phone: formatPhone(e.target.value) })}
            className={invalid.phone ? 'bad' : undefined}
            placeholder="+7 999 123-45-67"
            autoComplete="tel"
            enterKeyHint="done"
          />
          {invalid.phone && <span className="field-bad">{invalid.phone}</span>}
        </label>

        {showComment ? (
          <label className="field">
            <span className="field-label">Комментарий</span>
            <textarea
              value={draft.comment}
              onChange={(e) => patch({ comment: e.target.value })}
              placeholder="Сколько человек, пожелания"
              maxLength={500}
              rows={2}
              autoFocus
            />
          </label>
        ) : (
          <button className="link-btn link-btn--inline" type="button" onClick={() => setShowComment(true)}>
            Добавить комментарий
          </button>
        )}
      </form>
    </Sheet>
  );
}
