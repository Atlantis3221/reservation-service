import { useEffect, useState } from 'react';
import { publicApi, ApiError, type BusinessInfo, type MyBookingInfo } from '../api';
import { ContactIcon, CONTACT_LABELS } from './ContactIcon';
import { dateWithWeekday } from '../lib/day';

interface Props {
  business: BusinessInfo;
  token: string;
}

/**
 * Запись клиента по его личной ссылке (директор, M-0337): куда и когда он
 * записан и как связаться с местом, если планы поменялись. Отменённая
 * владельцем бронь не находится — так и говорим.
 */
export function MyBooking({ business, token }: Props) {
  // failed — сеть или сервер (502 на минуту деплоя): это не «запись отменена»
  const [state, setState] = useState<{ booking: MyBookingInfo | null; loading: boolean; failed?: boolean }>({
    booking: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ booking: null, loading: true });
    publicApi.getMyBooking(business.slug, token)
      .then((booking) => { if (!cancelled) setState({ booking, loading: false }); })
      .catch((err) => {
        if (cancelled) return;
        const missing = err instanceof ApiError && err.status === 404;
        setState({ booking: null, loading: false, failed: !missing });
      });
    return () => { cancelled = true; };
  }, [business.slug, token]);

  if (state.loading) return null;
  const { booking } = state;
  const links = business.contactLinks || [];

  return (
    <section className="my" aria-label="Ваша запись">
      {booking ? (
        <>
          <p className="my-kicker">Ваша запись</p>
          <p className="my-when">
            {dateWithWeekday(booking.date)}, {booking.startTime}–{booking.endTime}
          </p>
          <p className="my-where">
            {business.name}{booking.clientName ? ` · на имя ${booking.clientName}` : ''}
          </p>
        </>
      ) : state.failed ? (
        <>
          <p className="my-kicker">Ваша запись</p>
          <p className="my-where">Не удалось загрузить запись. Обновите страницу через минуту.</p>
        </>
      ) : (
        <>
          <p className="my-kicker">Запись не найдена</p>
          <p className="my-where">Возможно, её отменили или перенесли. Уточните у места.</p>
        </>
      )}

      {links.length > 0 && (
        <p className="alt-contacts">
          <span>Перенести или отменить:</span>
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
