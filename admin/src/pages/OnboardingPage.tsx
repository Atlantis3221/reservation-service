import { useState } from 'react';
import { api, type WorkingHoursConfig } from '../api';
import { useAuth } from '../auth';
import { getPublicUrl } from '../lib/url';
import { reachGoal } from '../lib/metrika';
import { ShareLink } from '../components/ShareLink';
import {
  WorkingHoursForm,
  defaultWorkingHours,
  durationHint,
  DAY_KEYS,
  SLOT_DURATIONS,
} from '../components/WorkingHoursForm';

const HORIZON_DAYS = 28;

type Step = 'name' | 'hours' | 'done';

/**
 * Путь от регистрации до опубликованной ссылки. Раньше единственным способом
 * создать заведение был чат, и до первого слота не доходил никто.
 */
export function OnboardingPage() {
  const { logout, reload } = useAuth();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [workingHours, setWorkingHours] = useState<WorkingHoursConfig>(defaultWorkingHours());
  const [duration, setDuration] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ slug: string; name: string; freeSlots: number } | null>(null);

  const hasWorkingDay = DAY_KEYS.some((k) => workingHours[k]?.enabled);

  async function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Введите название — его увидят клиенты');
      return;
    }
    setError('');
    setStep('hours');
  }

  async function handlePublish() {
    if (!hasWorkingDay) {
      setError('Выберите хотя бы один рабочий день');
      return;
    }

    setBusy(true);
    setError('');
    try {
      // Список заведений в контексте намеренно не обновляем: как только он
      // непустой, Home переключается на панель и владелец не увидит экран
      // со ссылкой — самый важный шаг онбординга.
      const { business } = await api.createBusiness(name.trim());
      reachGoal('business_created', { source: 'onboarding' });

      await api.updateSettings({
        businessId: business.id,
        workingHours,
        slotDurationMinutes: duration,
        bookingRequestsEnabled: true,
      });

      const published = await api.applySchedule(business.id, HORIZON_DAYS);
      reachGoal('schedule_published', { source: 'onboarding', freeSlots: published.freeSlots });
      reachGoal('onboarding_completed');

      setResult({ slug: business.slug, name: business.name, freeSlots: published.freeSlots });
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Не удалось создать заведение');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <header className="onb-header">
        <span className="onb-logo">slotik<span>.tech</span></span>
        <button className="onb-logout" onClick={logout} type="button">Выйти</button>
      </header>

      <main className="onb-main">
        <div className="onb-progress">
          <span className={`onb-dot${step === 'name' ? ' onb-dot--active' : ' onb-dot--done'}`} />
          <span className={`onb-dot${step === 'hours' ? ' onb-dot--active' : step === 'done' ? ' onb-dot--done' : ''}`} />
          <span className={`onb-dot${step === 'done' ? ' onb-dot--active' : ''}`} />
        </div>

        {step === 'name' && (
          <section className="onb-card">
            <h1>Как называется ваше заведение?</h1>
            <p className="onb-sub">
              Это название клиенты увидят на странице записи. Можно поменять позже.
            </p>
            <input
              className="onb-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="Например, Баня на Пруду"
              maxLength={100}
              autoFocus
            />
            {error && <div className="onb-error">{error}</div>}
            <button className="onb-btn" onClick={handleCreate} type="button">
              Дальше
            </button>
          </section>
        )}

        {step === 'hours' && (
          <section className="onb-card">
            <h1>Когда вы работаете?</h1>
            <p className="onb-sub">
              Из этого сложится расписание, которое увидят клиенты. Отдельные дни
              можно будет закрыть или изменить в календаре.
            </p>

            <WorkingHoursForm value={workingHours} onChange={setWorkingHours} />

            <div className="onb-field">
              <label htmlFor="onb-duration">Длительность одного сеанса</label>
              <select
                id="onb-duration"
                className="onb-select"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              >
                {SLOT_DURATIONS.map((d) => (
                  <option key={d.minutes} value={d.minutes}>{d.label}</option>
                ))}
              </select>
              <span className="onb-hint">{durationHint(duration)}</span>
            </div>

            {error && <div className="onb-error">{error}</div>}

            <button className="onb-btn" onClick={handlePublish} disabled={busy} type="button">
              {busy ? 'Открываем запись…' : 'Открыть запись'}
            </button>
            <button className="onb-back" onClick={() => setStep('name')} type="button">
              Назад
            </button>
          </section>
        )}

        {step === 'done' && result && (
          <section className="onb-card onb-card--done">
            <div className="onb-check">✓</div>
            <h1>Запись открыта</h1>
            <p className="onb-sub">
              {result.freeSlots > 0
                ? `На ${HORIZON_DAYS} дней вперёд доступно ${result.freeSlots} ${plural(result.freeSlots)}.`
                : `Расписание опубликовано на ${HORIZON_DAYS} дней вперёд.`}
              {' '}Отправьте ссылку клиентам — и они начнут бронировать сами.
            </p>

            <ShareLink url={getPublicUrl(result.slug)} businessName={result.name} />

            <button
              className="onb-btn onb-btn--secondary"
              onClick={reload}
              type="button"
            >
              Перейти в панель
            </button>
          </section>
        )}
      </main>
    </div>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'свободное время';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'свободных интервала';
  return 'свободных интервалов';
}
