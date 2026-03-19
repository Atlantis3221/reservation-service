import { useState, useEffect, useCallback } from 'react';
import { api, type BusinessSettings, type WorkingHoursConfig, type DayWorkingHours } from '../api';

type ContactLinkType = 'telegram' | 'vk' | 'max';

const CONTACT_TYPE_LABELS: Record<ContactLinkType, string> = {
  telegram: 'Telegram',
  vk: 'VK',
  max: 'MAX',
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_LABELS: Record<string, string> = {
  mon: 'Понедельник',
  tue: 'Вторник',
  wed: 'Среда',
  thu: 'Четверг',
  fri: 'Пятница',
  sat: 'Суббота',
  sun: 'Воскресенье',
};

function defaultWorkingHours(): WorkingHoursConfig {
  const config: WorkingHoursConfig = {};
  for (const key of DAY_KEYS) {
    config[key] = { enabled: false, start: '10:00', end: '22:00' };
  }
  return config;
}

export function SettingsPage({ businessId }: { businessId: number | null }) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [bookingRequestsEnabled, setBookingRequestsEnabled] = useState(false);
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

  async function handleApplySchedule(week: 'this' | 'next') {
    if (!businessId) return;
    setApplyingSchedule(true);
    setMessage('');
    try {
      await api.updateSettings({
        businessId,
        workingHours,
      });
      const result = await api.applySchedule(businessId, week);
      const label = week === 'this' ? 'текущую' : 'следующую';
      setMessage(`Расписание применено на ${label} неделю (${result.daysCreated} дн.)`);
      setTimeout(() => setMessage(''), 4000);
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
        contactLinks: contactLinksUpdate,
      });
      setMessage('Настройки сохранены');
      setTimeout(() => setMessage(''), 3000);
      loadSettings();
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
          <div className="settings-wh-actions">
            <button
              className="btn-primary btn-sm"
              onClick={() => handleApplySchedule('this')}
              disabled={applyingSchedule}
            >
              Применить на эту неделю
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => handleApplySchedule('next')}
              disabled={applyingSchedule}
            >
              На следующую неделю
            </button>
          </div>
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
