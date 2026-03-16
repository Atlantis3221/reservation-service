import { Telegraf } from 'telegraf';
import { registerHandlers } from './handlers';

let bot: Telegraf | null = null;

export function initBot(): void {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.warn('[bot] BOT_TOKEN not set, skipping bot init');
    return;
  }

  bot = new Telegraf(token);

  bot.use((ctx, next) => {
    const update = ctx.update as any;
    if (update.message) {
      const m = update.message;
      console.log(`[bot] << message from=${m.from?.username || m.from?.id} chat=${m.chat?.id} text="${m.text}"`);
    } else if (update.callback_query) {
      const cb = update.callback_query;
      console.log(`[bot] << callback from=${cb.from?.username || cb.from?.id} data="${cb.data}"`);
    }

    const origReply = ctx.reply?.bind(ctx);
    if (origReply) {
      (ctx as any).reply = (text: string, ...args: any[]) => {
        const preview = typeof text === 'string' ? text.slice(0, 120) : String(text);
        console.log(`[bot] >> reply: "${preview}${text.length > 120 ? '...' : ''}"`);
        return origReply(text, ...args);
      };
    }

    return next();
  });

  registerHandlers(bot);

  bot.telegram.setMyCommands([
    { command: 'info', description: 'Возможности бота' },
    { command: 'schedule', description: 'Показать расписание' },
    { command: 'settings', description: 'Настройки заведения' },
    { command: 'list', description: 'Список заведений' },
    { command: 'add', description: 'Добавить заведение' },
    { command: 'del', description: 'Удалить заведение' },
  ]);

  bot.launch()
    .then(() => console.log('[bot] Telegram bot started'))
    .catch((err: Error) => console.error('[bot] Failed to start:', err.message));

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

export function getBot(): Telegraf | null {
  return bot;
}
