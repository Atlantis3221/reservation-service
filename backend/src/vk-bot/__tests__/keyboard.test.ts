import { describe, it, expect } from 'vitest';
import { buildKeyboard, stripFormatting } from '../keyboard';

describe('buildKeyboard', () => {
  it('creates inline keyboard with single button', () => {
    const result = buildKeyboard([
      [{ label: 'Test', action: 'test_action' }],
    ]);
    const parsed = JSON.parse(result);

    expect(parsed.inline).toBe(true);
    expect(parsed.buttons).toHaveLength(1);
    expect(parsed.buttons[0]).toHaveLength(1);
    expect(parsed.buttons[0][0].action.payload).toEqual(
      JSON.stringify({ action: 'test_action' }),
    );
  });

  it('creates keyboard with multiple rows', () => {
    const result = buildKeyboard([
      [{ label: 'Row 1', action: 'a1' }],
      [{ label: 'Row 2', action: 'a2' }],
    ]);
    const parsed = JSON.parse(result);

    expect(parsed.buttons).toHaveLength(2);
    expect(parsed.buttons[0][0].action.label).toBe('Row 1');
    expect(parsed.buttons[1][0].action.label).toBe('Row 2');
  });

  it('creates keyboard with multiple buttons per row', () => {
    const result = buildKeyboard([
      [
        { label: 'Yes', action: 'confirm' },
        { label: 'No', action: 'deny' },
      ],
    ]);
    const parsed = JSON.parse(result);

    expect(parsed.buttons).toHaveLength(1);
    expect(parsed.buttons[0]).toHaveLength(2);
  });

  it('truncates labels over 40 characters', () => {
    const longLabel = 'A'.repeat(50);
    const result = buildKeyboard([
      [{ label: longLabel, action: 'test' }],
    ]);
    const parsed = JSON.parse(result);

    expect(parsed.buttons[0][0].action.label).toBe('A'.repeat(40));
  });
});

describe('stripFormatting', () => {
  it('removes HTML bold tags', () => {
    expect(stripFormatting('<b>Bold</b>')).toBe('Bold');
  });

  it('removes HTML code tags', () => {
    expect(stripFormatting('<code>slug-name</code>')).toBe('slug-name');
  });

  it('removes Markdown bold markers', () => {
    expect(stripFormatting('*Статистика:*')).toBe('Статистика:');
  });

  it('handles mixed HTML and Markdown', () => {
    const input = '📊 *Статистика:*\n\n<b>Всего:</b> 10';
    const expected = '📊 Статистика:\n\nВсего: 10';
    expect(stripFormatting(input)).toBe(expected);
  });

  it('preserves plain text and emojis', () => {
    const input = '🟢 14:00–15:00 — Свободно';
    expect(stripFormatting(input)).toBe(input);
  });

  it('removes nested HTML tags', () => {
    expect(stripFormatting('<pre><code>test</code></pre>')).toBe('test');
  });
});
