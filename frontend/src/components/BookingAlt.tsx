import type { BusinessInfo } from '../api';
import { ContactIcon, CONTACT_LABELS } from './ContactIcon';

interface Props {
  business: BusinessInfo;
  onRequestOwnTime: () => void;
}

/**
 * Что делать, если ни одно свободное время не подошло.
 *
 * Стоит после всего расписания, а не между сеткой времени и календарём:
 * посередине оно разрывало расписание на две части, и было непонятно,
 * к какой относится. И это кнопка, а не ссылка: это второй по важности
 * призыв к действию на странице, а выглядел он как сноска.
 */
export function BookingAlt({ business, onRequestOwnTime }: Props) {
  const links = business.contactLinks || [];
  if (!business.bookingRequestsEnabled && links.length === 0) return null;

  return (
    <section className="alt">
      {business.bookingRequestsEnabled && (
        <button className="btn-quiet" type="button" onClick={onRequestOwnTime}>
          Нужно другое время
        </button>
      )}

      {links.length > 0 && (
        <p className="alt-contacts">
          <span>Или напишите напрямую:</span>
          {links.map((link) => (
            <a
              key={link.type}
              className={`contact contact--${link.type}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ContactIcon type={link.type} />
              {CONTACT_LABELS[link.type]}
            </a>
          ))}
        </p>
      )}
    </section>
  );
}
