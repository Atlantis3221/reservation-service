import type { FreeSlot, BusinessInfo, ContactLink } from '../api';
import { ContactIcon, CONTACT_LABELS } from './ContactIcon';

interface Props {
  slots: FreeSlot[];
  loading: boolean;
  business: BusinessInfo;
  onPick: (slot: FreeSlot) => void;
  onRequestOwnTime: () => void;
}

function durationLabel(minutes: number): string {
  if (minutes >= 24 * 60) return 'сутки';
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 час' : `${h} ${h < 5 ? 'часа' : 'часов'}`;
  }
  return `${minutes} мин`;
}

function ContactButtons({ links, businessName }: { links: ContactLink[]; businessName: string }) {
  if (links.length === 0) return null;
  return (
    <div className="picker-contacts">
      <span className="picker-contacts-label">Или напишите напрямую</span>
      <div className="picker-contacts-row">
        {links.map((link) => (
          <a
            key={link.type}
            className={`picker-contact picker-contact--${link.type}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${CONTACT_LABELS[link.type]} — ${businessName}`}
          >
            <ContactIcon type={link.type} />
            {CONTACT_LABELS[link.type]}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * Список свободных интервалов — то, ради чего клиент пришёл на страницу.
 * До этого свободное время нигде не отображалось и клиенту приходилось
 * угадывать время в форме.
 */
export function FreeSlotPicker({ slots, loading, business, onPick, onRequestOwnTime }: Props) {
  if (loading) {
    return <div className="picker picker--loading">Смотрим свободное время…</div>;
  }

  const links = business.contactLinks || [];

  if (slots.length === 0) {
    return (
      <div className="picker">
        <div className="picker-empty">
          <strong>
            {business.slotDurationMinutes >= 24 * 60
              ? 'Этот день уже занят'
              : 'Свободного времени на этот день нет'}
          </strong>
          <span>Выберите другую дату или предложите своё время.</span>
        </div>
        {business.bookingRequestsEnabled && (
          <button className="picker-own" onClick={onRequestOwnTime} type="button">
            Предложить своё время
          </button>
        )}
        <ContactButtons links={links} businessName={business.name} />
      </div>
    );
  }

  return (
    <div className="picker">
      <div className="picker-head">
        <span className="picker-title">
          {slots[0]?.fullDay ? 'День свободен' : 'Свободное время'}
        </span>
        <span className="picker-meta">
          {slots[0]?.fullDay
            ? 'бронируется целиком'
            : `сеанс ${durationLabel(business.slotDurationMinutes)}`}
        </span>
      </div>

      <div className={`picker-grid${slots[0]?.fullDay ? ' picker-grid--day' : ''}`}>
        {slots.map((slot) => (
          <button
            key={`${slot.startTime}-${slot.endTime}`}
            className={`picker-slot${slot.fullDay ? ' picker-slot--day' : ''}`}
            onClick={() => onPick(slot)}
            type="button"
          >
            {slot.fullDay ? (
              <>
                <span className="picker-slot-start">Забронировать сутки</span>
                <span className="picker-slot-end">
                  заезд {slot.startTime}, выезд {slot.endTime}
                </span>
              </>
            ) : (
              <>
                <span className="picker-slot-start">{slot.startTime}</span>
                <span className="picker-slot-end">
                  до {slot.endTime}
                  {slot.crossesMidnight && <em className="picker-slot-night"> ночь</em>}
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      {business.bookingRequestsEnabled && (
        <button className="picker-own picker-own--quiet" onClick={onRequestOwnTime} type="button">
          Нужно другое время
        </button>
      )}

      <ContactButtons links={links} businessName={business.name} />
    </div>
  );
}
