import { useState, type FormEvent } from 'react';
import { api, type Business } from '../api';

interface Props {
  onLinked: (businesses: Business[]) => void;
  onClose: () => void;
}

export function LinkTelegram({ onLinked, onClose }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.linkTelegram(code.trim());
      onLinked(result.businesses);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="link-panel">
      <div className="link-content">
        <p>
          Отправьте <code>/link</code> Telegram-боту, чтобы получить 6-значный код.
          Введите его ниже для привязки заведений.
        </p>
        <form onSubmit={handleSubmit} className="link-form">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            className="link-input"
            autoFocus
          />
          <button type="submit" className="btn-primary btn-sm" disabled={loading || code.length < 6}>
            {loading ? '...' : 'Привязать'}
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            Отмена
          </button>
        </form>
        {error && <div className="error-msg">{error}</div>}
      </div>
    </div>
  );
}
