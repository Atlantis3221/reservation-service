import { useState, useEffect, useRef, useCallback } from 'react';
import { api, type CommandMessage, type CommandCategory } from '../api';
import { ChatMessageBubble } from '../components/ChatMessage';
import { ChatInput } from '../components/ChatInput';
import { CommandList } from '../components/CommandList';

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  content: CommandMessage;
}

let msgId = 0;

/**
 * Продвинутый режим: управление расписанием текстовыми командами.
 * Раньше это был первый экран после регистрации — и главная точка отвала,
 * потому что владелец не знал, что печатать.
 */
export function ChatPage({ businessId }: { businessId: number | null }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<CommandCategory[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [inputText, setInputText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getCommands().then(({ commands: cmds }) => setCommands(cmds)).catch(() => {});
  }, []);

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
    setMessages((prev) => [...prev, { id: ++msgId, role: 'user', content: { text } }]);
    setSending(true);
    try {
      const result = await api.sendCommand(text, businessId ?? undefined);
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
      const result = await api.sendAction(action, businessId ?? undefined);
      addAssistantMessages(result.messages);
    } catch (err: any) {
      addAssistantMessages([{ text: `Ошибка: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-tab">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="empty-chat">
            <div className="empty-icon">⌨️</div>
            <h3>Команды текстом</h3>
            <p>
              Быстрый способ, если удобнее печатать, а не тыкать в календарь.
              Например: <code>эту неделю пн-пт с 10 до 22</code>
            </p>
            <button className="btn-secondary" onClick={() => setShowCommands(true)} type="button">
              Показать все команды
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

      <div className="chat-footer">
        <ChatInput
          onSend={handleSend}
          disabled={sending}
          onCommandsClick={() => setShowCommands(!showCommands)}
          externalText={inputText}
          onExternalTextConsumed={() => setInputText('')}
        />
      </div>

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
