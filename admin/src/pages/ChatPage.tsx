import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { api, type CommandMessage, type Business, type CommandCategory } from '../api';
import { ChatMessageBubble } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { BusinessSwitcher } from '../components/BusinessSwitcher';
import { CommandList } from '../components/CommandList';
import { LinkTelegram } from '../components/LinkTelegram';
import { BurgerMenu } from '../components/BurgerMenu';
import { CalendarPage } from './CalendarPage';
import { RequestsPage } from './RequestsPage';
import { SettingsPage } from './SettingsPage';

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  content: CommandMessage;
}

let msgId = 0;

function getScheduleBaseUrl(): string {
  const env = import.meta.env.VITE_FRONTEND_URL;
  if (env) return env.replace(/\/+$/, '');
  const { protocol, hostname } = window.location;
  if (hostname.startsWith('admin.')) {
    return `${protocol}//${hostname.replace('admin.', '')}`;
  }
  return `${protocol}//${hostname}`;
}

export function ChatPage() {
  const { user, businesses, setBusinesses, logout } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandCategory[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'calendar' | 'requests' | 'settings'>('chat');
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [burgerOpen, setBurgerOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedBiz = businesses.find((b) => b.id === selectedBizId) ?? null;

  useEffect(() => {
    api.getCommands().then(({ commands: cmds }) => setCommands(cmds)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedBizId) return;

    let aborted = false;
    const controller = new AbortController();
    let currentCount = pendingRequestsCount;

    api.getBookingRequests(selectedBizId, 'pending')
      .then(({ pendingCount }) => {
        if (aborted) return;
        setPendingRequestsCount(pendingCount);
        currentCount = pendingCount;
      })
      .catch(() => {});

    async function poll() {
      while (!aborted) {
        try {
          const { pendingCount } = await api.pollBookingRequests(
            selectedBizId!, currentCount, controller.signal,
          );
          if (aborted) return;
          if (pendingCount !== currentCount) {
            currentCount = pendingCount;
            setPendingRequestsCount(pendingCount);
          }
        } catch {
          if (aborted) return;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }

    poll();

    return () => {
      aborted = true;
      controller.abort();
    };
  }, [selectedBizId]);

  useEffect(() => {
    api.init().then(({ messages: msgs, businesses: bizs }) => {
      if (bizs.length > 0) {
        setBusinesses(bizs);
        setSelectedBizId(bizs[0].id);
      }
      if (msgs.length > 0) {
        setMessages(msgs.map((m) => ({ id: ++msgId, role: 'assistant', content: m })));
      }
    }).catch(() => {});
  }, [setBusinesses]);

  useEffect(() => {
    if (businesses.length > 0 && !selectedBizId) {
      setSelectedBizId(businesses[0].id);
    }
  }, [businesses, selectedBizId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addAssistantMessages = useCallback((msgs: CommandMessage[]) => {
    setMessages((prev) => [
      ...prev,
      ...msgs.map((m) => ({ id: ++msgId, role: 'assistant' as const, content: m })),
    ]);
  }, []);

  async function handleSend(text: string) {
    setMessages((prev) => [
      ...prev,
      { id: ++msgId, role: 'user', content: { text } },
    ]);
    setSending(true);
    try {
      const result = await api.sendCommand(text, selectedBizId ?? undefined);
      addAssistantMessages(result.messages);
    } catch (err: any) {
      addAssistantMessages([{ text: `Ошибка: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(action: string) {
    setSending(true);
    try {
      const result = await api.sendAction(action, selectedBizId ?? undefined);
      addAssistantMessages(result.messages);
    } catch (err: any) {
      addAssistantMessages([{ text: `Ошибка: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  function handleLinked(bizs: Business[]) {
    setBusinesses(bizs);
    if (bizs.length > 0 && !selectedBizId) {
      setSelectedBizId(bizs[0].id);
    }
    setShowLink(false);
    addAssistantMessages([{ text: `✅ Бот привязан! Найдено заведений: ${bizs.length}` }]);
  }

  return (
    <div className="chat-layout">
      <header className="chat-header">
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
          {businesses.length > 0 && (
            <>
              <BusinessSwitcher
                businesses={businesses}
                selectedId={selectedBizId}
                onSelect={setSelectedBizId}
              />
              {selectedBiz && (
                <a
                  className="schedule-link"
                  href={`${getScheduleBaseUrl()}/${selectedBiz.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Открыть расписание для клиентов"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span className="schedule-link-text">Расписание</span>
                </a>
              )}
            </>
          )}
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

      {activeTab === 'chat' && (
        <>
          <main className="chat-main">
            <div className="chat-messages">
              {messages.length === 0 && (
                <div className="empty-chat">
                  <div className="empty-icon">💬</div>
                  <p>Отправьте команду для управления расписанием</p>
                  <button className="btn-secondary" onClick={() => setShowCommands(true)}>
                    Посмотреть команды
                  </button>
                </div>
              )}
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  role={msg.role}
                  message={msg.content}
                  onAction={handleAction}
                  disabled={sending}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          </main>

          <footer className="chat-footer">
            <ChatInput
              onSend={handleSend}
              disabled={sending}
              onCommandsClick={() => setShowCommands(!showCommands)}
              externalText={inputText}
              onExternalTextConsumed={() => setInputText('')}
            />
          </footer>
        </>
      )}
      {activeTab === 'calendar' && (
        <main className="calendar-main">
          <CalendarPage businessId={selectedBizId} />
        </main>
      )}
      {activeTab === 'requests' && (
        <main className="calendar-main">
          <RequestsPage businessId={selectedBizId} />
        </main>
      )}
      {activeTab === 'settings' && (
        <main className="calendar-main">
          <SettingsPage businessId={selectedBizId} />
        </main>
      )}

      <nav className="tab-bar">
        <button
          className={`tab-bar-item${activeTab === 'chat' ? ' tab-bar-item--active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <svg className="tab-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>Чат</span>
        </button>
        <button
          className={`tab-bar-item${activeTab === 'calendar' ? ' tab-bar-item--active' : ''}`}
          onClick={() => setActiveTab('calendar')}
        >
          <svg className="tab-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>Календарь</span>
        </button>
        <button
          className={`tab-bar-item${activeTab === 'requests' ? ' tab-bar-item--active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          <svg className="tab-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span>Заявки</span>
          {pendingRequestsCount > 0 && (
            <span className="tab-bar-badge">{pendingRequestsCount}</span>
          )}
        </button>
        <button
          className={`tab-bar-item${activeTab === 'settings' ? ' tab-bar-item--active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <svg className="tab-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          <span>Настройки</span>
        </button>
      </nav>

      {showCommands && (
        <CommandList
          commands={commands}
          onSelect={(cmd) => {
            setShowCommands(false);
            setInputText(cmd);
          }}
          onClose={() => setShowCommands(false)}
        />
      )}
    </div>
  );
}
