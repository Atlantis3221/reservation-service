import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { api, type CommandMessage, type Business, type CommandCategory } from '../api';
import { ChatMessageBubble } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { BusinessSwitcher } from '../components/BusinessSwitcher';
import { CommandList } from '../components/CommandList';
import { LinkTelegram } from '../components/LinkTelegram';
import { CalendarPage } from './CalendarPage';

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
  const [activeTab, setActiveTab] = useState<'chat' | 'calendar'>('chat');
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedBiz = businesses.find((b) => b.id === selectedBizId) ?? null;

  useEffect(() => {
    api.getCommands().then(({ commands: cmds }) => setCommands(cmds)).catch(() => {});
  }, []);

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
    addAssistantMessages([{ text: `✅ Telegram привязан! Найдено заведений: ${bizs.length}` }]);
  }

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <div className="header-left">
          <span className="logo">Slotik</span>
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
        <div className="header-right">
          <button
            className="header-btn"
            onClick={() => setShowLink(!showLink)}
            title="Привязать Telegram"
          >
            🔗
          </button>
          <span className="user-email">{user?.email}</span>
          <button className="header-btn" onClick={logout} title="Выйти">
            <svg className="logout-icon" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {showLink && (
        <div className="link-banner">
          <LinkTelegram onLinked={handleLinked} onClose={() => setShowLink(false)} />
        </div>
      )}

      {activeTab === 'chat' ? (
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
      ) : (
        <main className="calendar-main">
          <CalendarPage businessId={selectedBizId} />
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
