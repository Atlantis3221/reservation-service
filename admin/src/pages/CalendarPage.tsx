import { useState, useCallback, useMemo } from 'react';
import { Calendar, type DaySlot, type PendingSlot, type BookingRequestBlock } from '@shared/calendar';
import { api, type CalendarBookingRequest } from '../api';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function minutesToTime(m: number): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

function formatDateRu(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

type SheetState =
  | { type: 'none' }
  | { type: 'slot-detail'; slot: DaySlot }
  | { type: 'new-booking'; date: string }
  | { type: 'edit-booking'; slot: DaySlot; originalDate: string }
  | { type: 'set-schedule'; date: string };

const STORAGE_KEY = 'calendar_selected_date';

export function CalendarPage({ businessId }: { businessId: number | null }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY) || null;
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [sheet, setSheet] = useState<SheetState>({ type: 'none' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [note, setNote] = useState('');

  const [editDate, setEditDate] = useState('');

  const [scheduleStart, setScheduleStart] = useState('10:00');
  const [scheduleEnd, setScheduleEnd] = useState('22:00');
  const [calRequests, setCalRequests] = useState<BookingRequestBlock[]>([]);

  const fetchDates = useCallback(
    () => businessId ? api.getCalendarDates(businessId) : Promise.resolve([]),
    [businessId],
  );

  const fetchSlots = useCallback(
    (date: string) => {
      if (!businessId) return Promise.resolve([]);
      return api.getCalendarSlots(businessId, date).then((data) => {
        if (data.bookingRequests) {
          setCalRequests(data.bookingRequests.map((r: CalendarBookingRequest) => ({
            id: r.id,
            startTime: r.preferredStartTime,
            endTime: r.preferredEndTime,
            clientName: r.clientName,
            clientPhone: r.clientPhone,
            description: r.description,
            status: r.status,
          })));
        } else {
          setCalRequests([]);
        }
        return data.slots;
      });
    },
    [businessId],
  );

  const handleSelectDate = useCallback((date: string | null) => {
    setSelectedDate(date);
    if (date) {
      localStorage.setItem(STORAGE_KEY, date);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  function closeSheet() {
    setSheet({ type: 'none' });
    setError('');
    setShowConfirm(false);
    setConfirmCancel(false);
  }

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  function handleSlotClick(slot: DaySlot) {
    if (slot.status === 'booked' || slot.status === 'blocked') {
      setError('');
      setConfirmCancel(false);
      setSheet({ type: 'slot-detail', slot });
    }
  }

  function handleTimeClick(date: string, minutes: number) {
    setStartTime(minutesToTime(minutes));
    const endMins = Math.min(minutes + 60, 24 * 60);
    setEndTime(minutesToTime(endMins));
    setClientName('');
    setClientPhone('');
    setNote('');
    setError('');
    setShowConfirm(false);
    setSheet({ type: 'new-booking', date });
  }

  function handleEmptyDay() {
    if (!selectedDate) return;
    setScheduleStart('10:00');
    setScheduleEnd('22:00');
    setError('');
    setSheet({ type: 'set-schedule', date: selectedDate });
  }

  async function handleCreateBooking(force = false) {
    if (!businessId || sheet.type !== 'new-booking') return;
    if (!clientName.trim()) { setError('Укажите имя клиента'); return; }
    if (!startTime || !endTime) { setError('Укажите время'); return; }

    setSaving(true);
    setError('');
    try {
      const result = await api.createCalendarBooking({
        businessId,
        date: sheet.date,
        startTime,
        endTime,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || undefined,
        note: note.trim() || undefined,
        force,
      });
      if (result.conflict) {
        setShowConfirm(true);
        setError('На это время уже есть запись. Создать ещё одну?');
        return;
      }
      closeSheet();
      refresh();
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  }

  function handleStartEdit(slot: DaySlot) {
    const dateKey = slot.startDatetime.split('T')[0];
    setStartTime(slot.startDatetime.split('T')[1].substring(0, 5));
    setEndTime(slot.endDatetime.split('T')[1].substring(0, 5));
    setClientName(slot.clientName || '');
    setClientPhone(slot.clientPhone || '');
    setNote(slot.note || '');
    setEditDate(dateKey);
    setError('');
    setShowConfirm(false);
    setSheet({ type: 'edit-booking', slot, originalDate: dateKey });
  }

  async function handleSaveEdit(force = false) {
    if (sheet.type !== 'edit-booking') return;
    if (!clientName.trim()) { setError('Укажите имя клиента'); return; }
    if (!startTime || !endTime) { setError('Укажите время'); return; }

    const orig = sheet.slot;
    const origDate = sheet.originalDate;
    const origStart = orig.startDatetime.split('T')[1].substring(0, 5);
    const origEnd = orig.endDatetime.split('T')[1].substring(0, 5);

    const changes: Record<string, any> = {};
    if (editDate !== origDate) changes.date = editDate;
    if (startTime !== origStart) changes.startTime = startTime;
    if (endTime !== origEnd) changes.endTime = endTime;
    if (clientName.trim() !== (orig.clientName || '')) changes.clientName = clientName.trim();
    if (clientPhone.trim() !== (orig.clientPhone || '')) changes.clientPhone = clientPhone.trim();
    if (note.trim() !== (orig.note || '')) changes.note = note.trim();

    if (Object.keys(changes).length === 0) {
      closeSheet();
      return;
    }

    if (force) changes.force = true;

    setSaving(true);
    setError('');
    try {
      const result = await api.updateCalendarBooking(orig.id, changes);
      if (result.conflict) {
        setShowConfirm(true);
        setError('На это время уже есть запись. Сохранить всё равно?');
        return;
      }
      closeSheet();
      refresh();
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelBooking(slotId: number) {
    setSaving(true);
    setError('');
    try {
      await api.cancelCalendarBooking(slotId);
      closeSheet();
      refresh();
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetSchedule() {
    if (!businessId || sheet.type !== 'set-schedule') return;
    const startHour = parseInt(scheduleStart.split(':')[0]);
    const endHour = parseInt(scheduleEnd.split(':')[0]);
    if (startHour === endHour) {
      setError('Время начала не может совпадать с временем окончания');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.setCalendarSchedule({
        businessId,
        date: sheet.date,
        startHour,
        endHour: endHour === 0 ? 24 : endHour,
      });
      closeSheet();
      refresh();
    } catch (err: any) {
      setError(err.message || 'Ошибка');
    } finally {
      setSaving(false);
    }
  }

  const pendingSlot: PendingSlot | null = useMemo(() => {
    if (sheet.type !== 'new-booking' || !startTime || !endTime) return null;
    return { startTime, endTime };
  }, [sheet.type, startTime, endTime]);

  if (!businessId) {
    return (
      <div className="cal-placeholder">
        <p>Привяжите Telegram, чтобы увидеть расписание</p>
      </div>
    );
  }

  return (
    <div className="cal-page">
      <Calendar
        key={businessId}
        fetchAvailableDates={fetchDates}
        fetchDaySlots={fetchSlots}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
        onBack={() => handleSelectDate(null)}
        onSlotClick={handleSlotClick}
        onTimeClick={handleTimeClick}
        showClientInfo
        pendingSlot={pendingSlot}
        bookingRequests={calRequests}
        emptyDayContent={
          <div className="cal-empty-day">
            <p>Расписание на этот день не задано</p>
            <button className="btn-primary btn-sm" onClick={handleEmptyDay}>
              Задать расписание
            </button>
          </div>
        }
        refreshTrigger={refreshKey}
      />

      {sheet.type !== 'none' && (
        <div className="sheet-overlay" onClick={closeSheet}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />

            {sheet.type === 'new-booking' && (
              <div className="sheet-content">
                <h3 className="sheet-title">Новая запись</h3>
                <p className="sheet-subtitle">{formatDateRu(sheet.date)}</p>
                <div className="sheet-fields">
                  <div className="sheet-row">
                    <label>Начало</label>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Конец</label>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Имя клиента</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Иванов Иван"
                      autoFocus
                    />
                  </div>
                  <div className="sheet-row">
                    <label>Телефон</label>
                    <input
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="+7 900 123-45-67"
                    />
                  </div>
                  <div className="sheet-row">
                    <label>Описание</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Комментарий к записи"
                      rows={2}
                    />
                  </div>
                </div>
                {error && (
                  <div className={`sheet-error${showConfirm ? ' sheet-error--warning' : ''}`}>
                    {error}
                  </div>
                )}
                <div className="sheet-actions">
                  {showConfirm ? (
                    <>
                      <button className="btn-primary" onClick={() => handleCreateBooking(true)} disabled={saving}>
                        Создать всё равно
                      </button>
                      <button className="btn-secondary" onClick={closeSheet}>Отмена</button>
                    </>
                  ) : (
                    <button className="btn-primary" onClick={() => handleCreateBooking(false)} disabled={saving}>
                      {saving ? 'Создание...' : 'Создать запись'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {sheet.type === 'slot-detail' && (
              <div className="sheet-content">
                <h3 className="sheet-title">
                  {sheet.slot.status === 'booked' ? 'Запись' : 'Блок'}
                </h3>
                <div className="sheet-detail">
                  <div className="sheet-detail-row">
                    <span className="sheet-detail-label">Время</span>
                    <span>{sheet.slot.startDatetime.split('T')[1].substring(0, 5)} – {sheet.slot.endDatetime.split('T')[1].substring(0, 5)}</span>
                  </div>
                  {sheet.slot.clientName && (
                    <div className="sheet-detail-row">
                      <span className="sheet-detail-label">Клиент</span>
                      <span>{sheet.slot.clientName}</span>
                    </div>
                  )}
                  {sheet.slot.clientPhone && (
                    <div className="sheet-detail-row">
                      <span className="sheet-detail-label">Телефон</span>
                      <a href={`tel:${sheet.slot.clientPhone}`}>{sheet.slot.clientPhone}</a>
                    </div>
                  )}
                  {sheet.slot.note && (
                    <div className="sheet-detail-row">
                      <span className="sheet-detail-label">Заметка</span>
                      <span>{sheet.slot.note}</span>
                    </div>
                  )}
                </div>
                {error && <div className="sheet-error">{error}</div>}
                {sheet.slot.status === 'booked' && (
                  <div className="sheet-actions">
                    {confirmCancel ? (
                      <>
                        <p className="sheet-confirm-text">Отменить эту запись?</p>
                        <button className="btn-danger" onClick={() => handleCancelBooking(sheet.slot.id)} disabled={saving}>
                          {saving ? 'Отмена...' : 'Да, отменить'}
                        </button>
                        <button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Нет</button>
                      </>
                    ) : (
                      <>
                        <button className="btn-primary" onClick={() => handleStartEdit(sheet.slot)}>
                          Редактировать
                        </button>
                        <button className="btn-danger" onClick={() => setConfirmCancel(true)}>
                          Отменить запись
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {sheet.type === 'edit-booking' && (
              <div className="sheet-content">
                <h3 className="sheet-title">Редактирование записи</h3>
                <div className="sheet-fields">
                  <div className="sheet-row">
                    <label>Дата</label>
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Начало</label>
                    <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Конец</label>
                    <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Имя клиента</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Иванов Иван"
                    />
                  </div>
                  <div className="sheet-row">
                    <label>Телефон</label>
                    <input
                      type="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="+7 900 123-45-67"
                    />
                  </div>
                  <div className="sheet-row">
                    <label>Описание</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Комментарий к записи"
                      rows={2}
                    />
                  </div>
                </div>
                {error && (
                  <div className={`sheet-error${showConfirm ? ' sheet-error--warning' : ''}`}>
                    {error}
                  </div>
                )}
                <div className="sheet-actions">
                  {showConfirm ? (
                    <>
                      <button className="btn-primary" onClick={() => handleSaveEdit(true)} disabled={saving}>
                        Сохранить всё равно
                      </button>
                      <button className="btn-secondary" onClick={closeSheet}>Отмена</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-primary" onClick={() => handleSaveEdit(false)} disabled={saving}>
                        {saving ? 'Сохранение...' : 'Сохранить'}
                      </button>
                      <button className="btn-secondary" onClick={closeSheet}>Отмена</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {sheet.type === 'set-schedule' && (
              <div className="sheet-content">
                <h3 className="sheet-title">Задать расписание</h3>
                <p className="sheet-subtitle">{formatDateRu(sheet.date)}</p>
                <div className="sheet-fields">
                  <div className="sheet-row">
                    <label>Начало работы</label>
                    <input type="time" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} />
                  </div>
                  <div className="sheet-row">
                    <label>Конец работы</label>
                    <input type="time" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} />
                  </div>
                </div>
                {error && <div className="sheet-error">{error}</div>}
                <div className="sheet-actions">
                  <button className="btn-primary" onClick={handleSetSchedule} disabled={saving}>
                    {saving ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
