import { useState, type FormEvent, type ChangeEvent } from 'react';
import type { ReservationForm } from '../types';

interface Props {
  onCreate: (form: ReservationForm) => Promise<boolean>;
}

const initial: ReservationForm = { name: '', date: '', guests: 1, comment: '' };

export default function ReservationFormComponent({ onCreate }: Props) {
  const [form, setForm] = useState<ReservationForm>(initial);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: name === 'guests' ? Number(value) : value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await onCreate(form);
    if (ok) setForm(initial);
    setSubmitting(false);
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <h2>Новое бронирование</h2>
      <div className="form-row">
        <div className="field">
          <label>Имя</label>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Иван Иванов"
            required
          />
        </div>
        <div className="field">
          <label>Дата и время</label>
          <input
            name="date"
            type="datetime-local"
            value={form.date}
            onChange={handleChange}
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Гостей</label>
          <input
            name="guests"
            type="number"
            min="1"
            value={form.guests}
            onChange={handleChange}
          />
        </div>
        <div className="field">
          <label>Комментарий</label>
          <input
            name="comment"
            value={form.comment}
            onChange={handleChange}
            placeholder="Необязательно"
          />
        </div>
      </div>
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Отправка...' : 'Забронировать'}
      </button>
    </form>
  );
}
