import { useEffect } from 'react';

/**
 * Кладёт высоту экранной клавиатуры в CSS-переменную `--kb` на <html>.
 *
 * Зачем: iOS Safari не сжимает layout viewport под клавиатуру, поэтому
 * `position: fixed` элемент, прижатый к низу, уезжает под неё вместе с
 * кнопкой отправки — форму нельзя было ни увидеть, ни отправить, не убрав
 * клавиатуру. `visualViewport` знает реальную видимую область, разница с
 * `innerHeight` и есть клавиатура.
 *
 * На Android и в новых Chromium то же самое делает
 * `interactive-widget=resizes-content` в мете вьюпорта — там разница выходит
 * нулевой, и переменная просто остаётся 0px.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;

    function apply(): void {
      const inset = Math.max(0, window.innerHeight - vv!.height - vv!.offsetTop);
      // Мелкие колебания (адресная строка, resize от скролла) не считаем
      // клавиатурой, иначе лист дёргается при обычной прокрутке.
      root.style.setProperty('--kb', `${inset > 80 ? Math.round(inset) : 0}px`);
    }

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);

    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--kb');
    };
  }, []);
}
