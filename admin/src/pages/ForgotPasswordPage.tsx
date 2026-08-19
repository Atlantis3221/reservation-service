import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Восстановление доступа по email. Раньше единственным способом был Telegram-бот:
 * веб-пользователь, забывший пароль, терял аккаунт навсегда.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Проверьте почту</h1>
          <p className="auth-subtitle">
            Если аккаунт с адресом <strong>{email}</strong> существует, мы отправили
            на него ссылку для сброса пароля. Она действует один час.
          </p>
          <p className="auth-footer">
            <Link to="/login">Вернуться к входу</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Забыли пароль?</h1>
        <p className="auth-subtitle">
          Укажите email, на который зарегистрирован аккаунт — пришлём ссылку для сброса.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Отправляем…' : 'Отправить ссылку'}
          </button>
        </form>

        <p className="auth-footer">
          Не приходит письмо? Напишите на{' '}
          <a href="mailto:hello@slotik.tech">hello@slotik.tech</a> — восстановим вручную.
        </p>
        <p className="auth-footer">
          <Link to="/login">Вернуться к входу</Link>
        </p>
      </div>
    </div>
  );
}
