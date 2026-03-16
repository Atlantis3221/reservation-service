import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Сброс пароля</h1>
          <p className="auth-subtitle">
            Чтобы сбросить пароль, отправьте команду <code>/reset</code> Telegram-боту.
            Бот пришлёт ссылку для сброса.
          </p>
          <p className="auth-footer">
            <Link to="/login">Вернуться к входу</Link>
          </p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Пароль обновлён</h1>
          <p className="auth-subtitle">Теперь вы можете войти с новым паролем.</p>
          <Link to="/login" className="btn-primary" style={{ display: 'block', textAlign: 'center' }}>
            Войти
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.resetPassword(token!, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Новый пароль</h1>
        <p className="auth-subtitle">Введите новый пароль для вашего аккаунта</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="password">Новый пароль</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 8 символов"
              required
              minLength={8}
              autoFocus
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
        </form>
      </div>
    </div>
  );
}
