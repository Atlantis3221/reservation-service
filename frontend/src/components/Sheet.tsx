import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Прилипший низ: кнопка отправки остаётся видимой при открытой клавиатуре */
  footer?: ReactNode;
  onClose: () => void;
  label: string;
}

/**
 * Нижний лист. Вся работа с клавиатурой — здесь.
 *
 * Лист прижат не к низу окна, а к границе видимой области (`--kb` из
 * useKeyboardInset). Раньше на iOS клавиатура накрывала галочку согласия и
 * кнопку «Забронировать»: дойти до отправки, не убрав клавиатуру, было нельзя.
 */
export function Sheet({ children, footer, onClose, label }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);

    // Фон под листом не должен скроллиться вместе с ним
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="sheet-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sheet" ref={panel} role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="sheet-x" onClick={onClose} aria-label="Закрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
