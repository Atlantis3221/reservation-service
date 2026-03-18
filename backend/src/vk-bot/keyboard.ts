import { Keyboard } from 'vk-io';

export interface VkButton {
  label: string;
  action: string;
}

export function buildKeyboard(rows: VkButton[][]): string {
  const builder = Keyboard.builder();

  for (let i = 0; i < rows.length; i++) {
    for (const btn of rows[i]) {
      builder.callbackButton({
        label: btn.label.slice(0, 40),
        payload: { action: btn.action },
      });
    }
    if (i < rows.length - 1) {
      builder.row();
    }
  }

  return builder.inline().toString();
}

export function stripFormatting(text: string): string {
  return text
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\*([^*]+)\*/g, '$1');
}
