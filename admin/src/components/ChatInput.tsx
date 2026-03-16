import { useState, useRef, useEffect, type KeyboardEvent, type FormEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  onCommandsClick: () => void;
  externalText?: string;
  onExternalTextConsumed?: () => void;
}

export function ChatInput({ onSend, disabled, onCommandsClick, externalText, onExternalTextConsumed }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (externalText) {
      setText(externalText);
      onExternalTextConsumed?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [externalText, onExternalTextConsumed]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  return (
    <form className="input-form" onSubmit={handleSubmit}>
      <button
        type="button"
        className="commands-btn"
        onClick={onCommandsClick}
        title="Команды"
      >
        /
      </button>
      <textarea
        ref={inputRef}
        className="chat-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Введите команду..."
        rows={1}
        disabled={disabled}
        autoFocus
      />
      <button
        type="submit"
        className="send-btn"
        disabled={disabled || !text.trim()}
        title="Отправить"
      >
        ↑
      </button>
    </form>
  );
}
