/**
 * Цели активации. Регистрации самих по себе недостаточно: воронка ломалась
 * между «создал заведение» и «опубликовал расписание», и это было не видно
 * в аналитике вообще — приходилось смотреть SQL на проде.
 */
export type Goal =
  | 'signup'
  | 'business_created'
  | 'schedule_published'
  | 'link_copied'
  | 'link_shared'
  | 'onboarding_completed';

export function reachGoal(goal: Goal, params?: Record<string, unknown>): void {
  const id = import.meta.env.VITE_METRIKA_COUNTER_ID;
  if (!id) return;

  const ym = (window as any).ym;
  if (typeof ym !== 'function') return;

  try {
    ym(Number(id), 'reachGoal', goal, params);
  } catch {
    // Аналитика не должна ломать основной сценарий
  }
}
