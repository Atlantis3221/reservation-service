import type { Reservation } from '../types';

interface Props {
  items: Reservation[];
  onCancel: (id: number) => Promise<void>;
}

export default function ReservationList({ items, onCancel }: Props) {
  if (!items.length) {
    return <p className="empty">Нажмите «Обновить» чтобы загрузить бронирования</p>;
  }

  return (
    <div className="reservation-list">
      {items.map((r) => (
        <div
          key={r.id}
          className={`reservation-card ${r.status === 'cancelled' ? 'cancelled' : ''}`}
        >
          <div className="reservation-info">
            <strong>
              {r.name}
              <span className={`badge badge-${r.status}`}>{r.status}</span>
            </strong>
            <span>
              {new Date(r.date).toLocaleString('ru-RU')} · {r.guests} гост.
              {r.comment ? ` · ${r.comment}` : ''}
            </span>
          </div>
          {r.status === 'confirmed' && (
            <button className="btn btn-danger" onClick={() => onCancel(r.id)}>
              Отменить
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
