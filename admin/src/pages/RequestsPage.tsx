import { useState, useEffect, useCallback } from 'react';
import { api, type BookingRequest } from '../api';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Новая',
  approved: 'Подтверждена',
  rejected: 'Отклонена',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
};

function formatDate(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatCreatedAt(dt: string): string {
  const d = new Date(dt);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function RequestsPage({ businessId }: { businessId: number | null }) {
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [reschedule, setReschedule] = useState<{
    id: number;
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  const loadRequests = useCallback(() => {
    if (!businessId) return;
    setLoading(true);
    api.getBookingRequests(businessId, filter || undefined)
      .then(({ requests: reqs }) => setRequests(reqs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, filter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  async function handleAction(id: number, status: 'approved' | 'rejected') {
    setActionLoading(id);
    try {
      await api.updateBookingRequest(id, { status });
      loadRequests();
    } catch {}
    setActionLoading(null);
  }

  async function handleReschedule() {
    if (!reschedule) return;
    setActionLoading(reschedule.id);
    try {
      await api.updateBookingRequest(reschedule.id, {
        preferredDate: reschedule.date,
        preferredStartTime: reschedule.startTime,
        preferredEndTime: reschedule.endTime,
      });
      setReschedule(null);
      loadRequests();
    } catch {}
    setActionLoading(null);
  }

  if (!businessId) {
    return (
      <div className="requests-page">
        <div className="requests-empty">Выберите заведение</div>
      </div>
    );
  }

  return (
    <div className="requests-page">
      <div className="requests-header">
        <h2 className="requests-title">Заявки</h2>
        <div className="requests-filters">
          {['', 'pending', 'approved', 'rejected'].map((s) => (
            <button
              key={s}
              className={`requests-filter-btn${filter === s ? ' requests-filter-btn--active' : ''}`}
              onClick={() => setFilter(s)}
            >
              {s ? STATUS_LABELS[s] : 'Все'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="requests-empty">Загрузка...</div>
      ) : requests.length === 0 ? (
        <div className="requests-empty">Заявок нет</div>
      ) : (
        <div className="requests-list">
          {requests.map((r) => (
            <div key={r.id} className="request-card">
              <div className="request-card-header">
                <span
                  className="request-status"
                  style={{ color: STATUS_COLORS[r.status], borderColor: STATUS_COLORS[r.status] }}
                >
                  {STATUS_LABELS[r.status]}
                </span>
                <span className="request-date">{formatCreatedAt(r.createdAt)}</span>
              </div>

              <div className="request-card-body">
                <div className="request-info-row">
                  <span className="request-info-label">Клиент</span>
                  <span>{r.clientName}</span>
                </div>
                <div className="request-info-row">
                  <span className="request-info-label">Телефон</span>
                  <a href={`tel:${r.clientPhone}`}>{r.clientPhone}</a>
                </div>
                <div className="request-info-row">
                  <span className="request-info-label">Дата</span>
                  <span>{formatDate(r.preferredDate)}, {r.preferredStartTime}–{r.preferredEndTime}</span>
                </div>
                {r.description && (
                  <div className="request-info-row">
                    <span className="request-info-label">Описание</span>
                    <span>{r.description}</span>
                  </div>
                )}
              </div>

              {r.status === 'pending' && (
                <div className="request-card-actions">
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => handleAction(r.id, 'approved')}
                    disabled={actionLoading === r.id}
                  >
                    Подтвердить
                  </button>
                  <button
                    className="btn-danger btn-sm"
                    onClick={() => handleAction(r.id, 'rejected')}
                    disabled={actionLoading === r.id}
                    style={{ width: 'auto' }}
                  >
                    Отклонить
                  </button>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setReschedule({
                      id: r.id,
                      date: r.preferredDate,
                      startTime: r.preferredStartTime,
                      endTime: r.preferredEndTime,
                    })}
                    disabled={actionLoading === r.id}
                  >
                    Перенести
                  </button>
                </div>
              )}
              {r.status === 'approved' && (
                <div className="request-card-actions">
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setReschedule({
                      id: r.id,
                      date: r.preferredDate,
                      startTime: r.preferredStartTime,
                      endTime: r.preferredEndTime,
                    })}
                    disabled={actionLoading === r.id}
                  >
                    Перенести
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {reschedule && (
        <div className="sheet-overlay" onClick={() => setReschedule(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-content">
              <h3 className="sheet-title">Перенести заявку</h3>
              <div className="sheet-fields">
                <div className="sheet-row">
                  <label>Дата</label>
                  <input
                    type="date"
                    value={reschedule.date}
                    onChange={(e) => setReschedule({ ...reschedule, date: e.target.value })}
                  />
                </div>
                <div className="sheet-row">
                  <label>Начало</label>
                  <input
                    type="time"
                    value={reschedule.startTime}
                    onChange={(e) => setReschedule({ ...reschedule, startTime: e.target.value })}
                  />
                </div>
                <div className="sheet-row">
                  <label>Конец</label>
                  <input
                    type="time"
                    value={reschedule.endTime}
                    onChange={(e) => setReschedule({ ...reschedule, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="sheet-actions">
                <button
                  className="btn-primary"
                  onClick={handleReschedule}
                  disabled={actionLoading === reschedule.id}
                >
                  Сохранить
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setReschedule(null)}
                  style={{ width: '100%' }}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
