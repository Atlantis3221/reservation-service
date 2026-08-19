interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
}

/**
 * Согласие на обработку персональных данных. Сервис собирает имя и телефон
 * физического лица, поэтому галочка обязательна, а не «для галочки».
 */
export function ConsentField({ checked, onChange }: Props) {
  return (
    <label className="consent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Согласен с обработкой персональных данных согласно{' '}
        <a href="/privacy" target="_blank" rel="noopener">политике</a>
      </span>
    </label>
  );
}
