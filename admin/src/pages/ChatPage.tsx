import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { api, type CommandMessage, type Business, type CommandCategory } from '../api';
import { ChatMessageBubble } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { BusinessSwitcher } from '../components/BusinessSwitcher';
import { CommandList } from '../components/CommandList';
import { LinkTelegram } from '../components/LinkTelegram';

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  content: CommandMessage;
}

let msgId = 0;

export function ChatPage() {
  const { user, businesses, setBusinesses, logout } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandCategory[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [inputText, setInputText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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
            <BusinessSwitcher
              businesses={businesses}
              selectedId={selectedBizId}
              onSelect={setSelectedBizId}
            />
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
