import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  email: string;
  telegramLinked: boolean;
  onLinkTelegram: () => void;
  onLogout: () => void;
}

export function BurgerMenu({
  open,
  onClose,
  email,
  telegramLinked,
  onLinkTelegram,
  onLogout,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="burger-overlay" onClick={onClose}>
      <aside
        className="burger-panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="burger-header">
          <span className="burger-logo">Slotik</span>
          <button className="burger-close" onClick={onClose} aria-label="Закрыть">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="burger-nav">
          <button className="burger-item" onClick={() => { onLinkTelegram(); onClose(); }}>
            <span className="burger-item-icon">🔗</span>
            <div className="burger-item-content">
              <span className="burger-item-label">Привязать Telegram</span>
              <span className="burger-item-hint">
                {telegramLinked ? '✅ Привязан' : 'Не привязан'}
              </span>
            </div>
          </button>
        </nav>

        <div className="burger-footer">
          <div className="burger-email">{email}</div>
          <button className="burger-item burger-item--danger" onClick={onLogout}>
            <span className="burger-item-icon">
              <svg className="burger-logout-icon" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </span>
            <span className="burger-item-label">Выйти</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
