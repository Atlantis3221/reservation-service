import type { CommandMessage } from '../api';

interface Props {
  role: 'user' | 'assistant';
  message: CommandMessage;
  onAction: (action: string) => void;
  disabled: boolean;
}

export function ChatMessageBubble({ role, message, onAction, disabled }: Props) {
  return (
    <div className={`chat-msg ${role}`}>
      <div className="msg-avatar">
        {role === 'user' ? '👤' : 'S'}
      </div>
      <div className="msg-body">
        <div className="msg-text">{message.text}</div>
        {message.buttons && message.buttons.length > 0 && (
          <div className="msg-buttons">
            {message.buttons.map((btn) => (
              <button
                key={btn.action}
                className="action-btn"
                onClick={() => onAction(btn.action)}
                disabled={disabled}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
