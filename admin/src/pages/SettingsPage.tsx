import { useState, useEffect, useCallback } from 'react';
import { api, type BusinessSettings, type WorkingHoursConfig, type DayWorkingHours } from '../api';
import {
  DAY_KEYS,
  DAY_LABELS_FULL as DAY_LABELS,
  SLOT_DURATIONS,
  defaultWorkingHours,
} from '../components/WorkingHoursForm';
import { reachGoal } from '../lib/metrika';

type ContactLinkType = 'telegram' | 'vk' | 'max';

const CONTACT_TYPE_LABELS: Record<ContactLinkType, string> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

interface Props {
  businessId: number | null;
  /** Дёргаем после публикации расписания, чтобы обновился баннер в панели */
  onChanged?: () => void;
}

export function SettingsPage({ businessId, onChanged }: Props) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [bookingRequestsEnabled, setBookingRequestsEnabled] = useState(false);
  const [slotDuration, setSlotDuration] = useState(120);
  const [horizonDays, setHorizonDays] = useState(28);
  const [workingHours, setWorkingHours] = useState<WorkingHoursConfig>(defaultWorkingHours());
  const [applyingSchedule, setApplyingSchedule] = useState(false);
  const [links, setLinks] = useState<Record<ContactLinkType, string>>({
    telegram: '',
    vk: '',
    max: '',
  });

  const loadSettings = useCallback(() => {
    if (!businessId) return;
    setLoading(true);
    api.getSettings(businessId)
      .then((s) => {
        setSettings(s);
        setName(s.name);
        setSlug(s.slug);
        setBookingRequestsEnabled(s.bookingRequestsEnabled);
        setSlotDuration(s.slotDurationMinutes ?? 120);
        setWorkingHours(s.workingHours || defaultWorkingHours());
        const newLinks: Record<ContactLinkType, string> = { telegram: '', vk: '', max: '' };
        for (const l of s.contactLinks) {
          newLinks[l.type as ContactLinkType] = l.url;
        }
        setLinks(newLinks);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  function updateDayHours(day: string, updates: Partial<DayWorkingHours>) {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], ...updates },
    }));
  }

  async function handlePublish() {
    if (!businessId) return;
    if (!DAY_KEYS.some((d) => workingHours[d]?.enabled)) {
      setMessage('Ошибка: выберите хотя бы один рабочий день');
      return;
    }

    setApplyingSchedule(true);
    setMessage('');
    try {
      await api.updateSettings({ businessId, workingHours, slotDurationMinutes: slotDuration });
      const result = await api.applySchedule(businessId, horizonDays);
      reachGoal('schedule_published', { source: 'settings', freeSlots: result.freeSlots });
      setMessage(
        `Запись открыта на ${result.daysCreated} дн. — свободных интервалов: ${result.freeSlots}`,
      );
      setTimeout(() => setMessage(''), 5000);
      onChanged?.();
    } catch (err: any) {
      setMessage(`Ошибка: ${err.message}`);
    }
    setApplyingSchedule(false);
  }

  async function handleSave() {
    if (!businessId) return;
    setSaving(true);
    setMessage('');
    try {
      const contactLinksUpdate = (['telegram', 'vk', 'max'] as ContactLinkType[]).map((type) => ({
        type,
        url: links[type].trim() || null,
      }));

      await api.updateSettings({
        businessId,
        name: name.trim(),
        slug: slug.trim(),
        bookingRequestsEnabled,
        workingHours,
        slotDurationMinutes: slotDuration,
        contactLinks: contactLinksUpdate,
      });
      setMessage('Настройки сохранены');
      setTimeout(() => setMessage(''), 3000);
      loadSettings();
      onChanged?.();
    } catch (err: any) {
      setMessage(`Ошибка: ${err.message}`);
    }
    setSaving(false);
  }

  if (!businessId) {
    return (
      <div className="settings-page">
        <div className="settings-empty">Выберите заведение</div>
      </div>
    );
  }

  if (loading || !settings) {
    return (
      <div className="settings-page">
        <div className="settings-empty">Загрузка...</div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="settings-title">Настройки</h2>
      </div>

      <div className="settings-sections">
        <div className="settings-section">
          <h3 className="settings-section-title">Основные</h3>
          <div className="settings-field">
            <label>Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label>Slug (адрес)</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
          </div>
        </div>

        <div className="settings-section">
          <h3 className="settings-section-title">Форма заявок</h3>
          <div className="settings-toggle-row">
            <div className="settings-toggle-info">
              <span className="settings-toggle-label">Приём заявок на сайте</span>
              <span className="settings-toggle-hint">
                Клиенты смогут оставить заявку прямо на странице расписания
              </span>
            </div>
            <button
              className={`settings-toggle${bookingRequestsEnabled ? ' settings-toggle--on' : ''}`}
              onClick={() => setBookingRequestsEnabled(!bookingRequestsEnabled)}
              role="switch"
              aria-checked={bookingRequestsEnabled}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3 className="settings-section-title">Время работы</h3>
          <div className="settings-working-hours">
            {DAY_KEYS.map((day) => {
              const dayConfig = workingHours[day] || { enabled: false, start: '10:00', end: '22:00' };
              return (
                <div key={day} className={`settings-wh-row${dayConfig.enabled ? '' : ' settings-wh-row--disabled'}`}>
                  <button
                    className={`settings-toggle settings-toggle--sm${dayConfig.enabled ? ' settings-toggle--on' : ''}`}
                    onClick={() => updateDayHours(day, { enabled: !dayConfig.enabled })}
                    role="switch"
                    aria-checked={dayConfig.enabled}
                  >
                    <span className="settings-toggle-thumb" />
                  </button>
                  <span className="settings-wh-day">{DAY_LABELS[day]}</span>
                  {dayConfig.enabled && (
                    <div className="settings-wh-times">
                      <input
                        type="time"
                        value={dayConfig.start}
                        onChange={(e) => updateDayHours(day, { start: e.target.value })}
                      />
                      <span className="settings-wh-sep">–</span>
                      <input
                        type="time"
                        value={dayConfig.end}
                        onChange={(e) => updateDayHours(day, { end: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="settings-section settings-section--publish">
          <h3 className="settings-section-title">Открыть запись</h3>
          <p className="settings-section-hint">
            Публикует расписание из часов работы выше. Существующие брони клиентов
            сохранятся.
          </p>

          <div className="settings-field">
            <label htmlFor="slot-duration">Длительность сеанса</label>
            <select
              id="slot-duration"
              value={slotDuration}
              onChange={(e) => setSlotDuration(Number(e.target.value))}
            >
              {SLOT_DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>{d.label}</option>
              ))}
            </select>
            <span className="settings-field-hint">
              На такие интервалы разбивается день — клиент выбирает один из них
            </span>
          </div>

          <div className="settings-field">
            <label htmlFor="horizon">На сколько дней вперёд</label>
            <select
              id="horizon"
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
            >
              <option value={7}>7 дней</option>
              <option value={14}>14 дней</option>
              <option value={28}>28 дней</option>
              <option value={60}>60 дней</option>
            </select>
          </div>

          <button
            className="btn-primary"
            onClick={handlePublish}
            disabled={applyingSchedule}
            type="button"
          >
            {applyingSchedule ? 'Открываем запись…' : 'Открыть запись'}
          </button>
        </div>

        <div className="settings-section">
          <h3 className="settings-section-title">Ссылки для связи</h3>
          {(['telegram', 'vk', 'max'] as ContactLinkType[]).map((type) => (
            <div key={type} className="settings-field">
              <label>{CONTACT_TYPE_LABELS[type]}</label>
              <input
                type="url"
                value={links[type]}
                onChange={(e) => setLinks({ ...links, [type]: e.target.value })}
                placeholder={`https://${type === 'telegram' ? 't.me/username' : type === 'vk' ? 'vk.com/id' : 'max.me/id'}`}
              />
            </div>
          ))}
        </div>
      </div>

      {message && (
        <div className={`settings-message${message.startsWith('Ошибка') ? ' settings-message--error' : ''}`}>
          {message}
        </div>
      )}

      <button
        className="btn-primary settings-save"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  );
}
