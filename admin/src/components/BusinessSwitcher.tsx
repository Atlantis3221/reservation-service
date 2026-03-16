import { useState, useRef, useEffect } from 'react';
import type { Business } from '../api';

interface Props {
  businesses: Business[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function BusinessSwitcher({ businesses, selectedId, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = businesses.find((b) => b.id === selectedId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (businesses.length <= 1) {
    return <span className="biz-name">{selected?.name || 'Нет заведения'}</span>;
  }

  return (
    <div className="biz-switcher" ref={ref}>
      <button className="biz-switcher-btn" onClick={() => setOpen(!open)}>
        {selected?.name || 'Выбрать заведение'}
        <span className="chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="biz-dropdown">
          {businesses.map((biz) => (
            <button
              key={biz.id}
              className={`biz-option ${biz.id === selectedId ? 'active' : ''}`}
              onClick={() => {
                onSelect(biz.id);
                setOpen(false);
              }}
            >
              {biz.name}
              <span className="biz-slug">{biz.slug}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
