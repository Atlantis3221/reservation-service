import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth';
import { api, type BusinessStatus } from '../api';
import { BusinessSwitcher } from '../components/BusinessSwitcher';
import { BurgerMenu } from '../components/BurgerMenu';
import { LinkTelegram } from '../components/LinkTelegram';
import { ShareLink } from '../components/ShareLink';
import { CalendarPage } from './CalendarPage';
import { RequestsPage } from './RequestsPage';
import { SettingsPage } from './SettingsPage';
import { ChatPage } from './ChatPage';
import { getPublicUrl } from '../lib/url';

type Tab = 'calendar' | 'requests' | 'settings' | 'chat';

const LOW_HORIZON_DAYS = 3;

function daysUntil(dateKey: string, todayKey: string): number {
  const a = new Date(`${dateKey}T00:00:00`).getTime();
  const b = new Date(`${todayKey}T00:00:00`).getTime();
  return Math.round((a - b) / 86_400_000);
}

export function DashboardPage() {
  const { user, businesses, setBusinesses, logout } = useAuth();
  const [selectedBizId, setSelectedBizId] = useState<number | null>(businesses[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<Tab>('calendar');
  const [status, setStatus] = useState<BusinessStatus | null>(null);
  const [burgerOpen, setBurgerOpen] = useState(false);
  const [showLink, setShowLink] = useState(false);

  const selectedBiz = businesses.find((b) => b.id === selectedBizId) ?? null;

  useEffect(() => {
    if (!selectedBizId && businesses.length > 0) setSelectedBizId(businesses[0].id);
  }, [businesses, selectedBizId]);

  const refreshStatus = useCallback(() => {
    if (!selectedBizId) return;
    api.getBusinessStatus(selectedBizId).then(setStatus).catch(() => setStatus(null));
  }, [selectedBizId]);

  useEffect(refreshStatus, [refreshStatus]);

  // Долгий поллинг новых заявок: владелец не должен обновлять страницу,
  // чтобы узнать о клиенте.
  useEffect(() => {
    if (!selectedBizId) return;

    let aborted = false;
    const controller = new AbortController();
    let lastCount = status?.pendingRequests ?? 0;

    async function poll() {
      while (!aborted) {
        try {
          const { pendingCount } = await api.pollBookingRequests(
            selectedBizId!, lastCount, controller.signal,
          );
          if (aborted) return;
          if (pendingCount !== lastCount) {
            lastCount = pendingCount;
            setStatus((s) => (s ? { ...s, pendingRequests: pendingCount } : s));
          }
        } catch {
          if (aborted) return;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    poll();
    return () => { aborted = true; controller.abort(); };
  }, [selectedBizId]);

  function handleLinked(bizs: typeof businesses) {
    setBusinesses(bizs);
    setShowLink(false);
    refreshStatus();
  }

  const publicUrl = selectedBiz ? getPublicUrl(selectedBiz.slug) : '';
  const banner = buildBanner(status);

  return (
    <div className="dash">
      <header className="dash-header">
        <button
          className="header-btn burger-btn"
          onClick={() => setBurgerOpen(true)}
          aria-label="Меню"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="header-center">
          <BusinessSwitcher
            businesses={businesses}
            selectedId={selectedBizId}
            onSelect={setSelectedBizId}
          />
        </div>
      </header>

      <BurgerMenu
        open={burgerOpen}
        onClose={() => setBurgerOpen(false)}
        email={user?.email || ''}
        ownerChatId={user?.ownerChatId ?? null}
        onLinkBot={() => setShowLink(true)}
        onLogout={logout}
      />

      {showLink && (
        <div className="link-banner">
          <LinkTelegram onLinked={handleLinked} onClose={() => setShowLink(false)} />
        </div>
      )}

      {selectedBiz && (
        <div className="dash-share">
          <ShareLink url={publicUrl} businessName={selectedBiz.name} compact />
        </div>
      )}

      {banner && (
        <div className={`dash-banner dash-banner--${banner.tone}`}>
          <div className="dash-banner-text">
            <strong>{banner.title}</strong>
            <span>{banner.hint}</span>
          </div>
          {banner.action && (
            <button
              className="dash-banner-btn"
              onClick={() => setActiveTab(banner.action!.tab)}
              type="button"
            >
              {banner.action.label}
            </button>
          )}
        </div>
      )}

      <main className="dash-main">
        {activeTab === 'calendar' && (
          <CalendarPage businessId={selectedBizId} onChanged={refreshStatus} />
        )}
        {activeTab === 'requests' && (
          <RequestsPage businessId={selectedBizId} onChanged={refreshStatus} />
        )}
        {activeTab === 'settings' && (
          <SettingsPage businessId={selectedBizId} onChanged={refreshStatus} />
        )}
        {activeTab === 'chat' && <ChatPage businessId={selectedBizId} />}
      </main>

      <nav className="tab-bar">
        <TabButton
          active={activeTab === 'calendar'}
          onClick={() => setActiveTab('calendar')}
          label="Календарь"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </TabButton>

        <TabButton
          active={activeTab === 'requests'}
          onClick={() => setActiveTab('requests')}
          label="Заявки"
          badge={status?.pendingRequests}
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </TabButton>

        <TabButton
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
          label="Настройки"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </TabButton>

        <TabButton
          active={activeTab === 'chat'}
          onClick={() => setActiveTab('chat')}
          label="Чат"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </TabButton>
      </nav>
    </div>
  );
}

function TabButton({
  active, onClick, label, badge, children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`tab-bar-item${active ? ' tab-bar-item--active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <svg className="tab-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span>{label}</span>
      {!!badge && badge > 0 && <span className="tab-bar-badge">{badge}</span>}
    </button>
  );
}

interface Banner {
  tone: 'warn' | 'info' | 'ok';
  title: string;
  hint: string;
  action?: { label: string; tab: Tab };
}

/**
 * Владелец должен с первого экрана понимать, работает его страница или нет.
 * Молчание — худший вариант: раньше пустой календарь выглядел так же,
 * как рабочий.
 */
function buildBanner(status: BusinessStatus | null): Banner | null {
  if (!status) return null;

  if (!status.publishedUntil) {
    return {
      tone: 'warn',
      title: 'Клиенты видят пустой календарь',
      hint: 'Запись ещё не открыта — укажите часы работы и опубликуйте расписание.',
      action: { label: 'Открыть запись', tab: 'settings' },
    };
  }

  const left = daysUntil(status.publishedUntil, status.today);

  if (status.freeSlots === 0) {
    return {
      tone: 'info',
      title: 'Свободного времени не осталось',
      hint: 'Всё занято или расписание закончилось. Продлите запись на следующие недели.',
      action: { label: 'Продлить', tab: 'settings' },
    };
  }

  if (left <= LOW_HORIZON_DAYS) {
    return {
      tone: 'warn',
      title: `Запись открыта только до ${formatShort(status.publishedUntil)}`,
      hint: 'Дальше клиенты не смогут записаться. Продлите расписание.',
      action: { label: 'Продлить', tab: 'settings' },
    };
  }

  return null;
}

function formatShort(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long',
  });
}
