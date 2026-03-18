import { VK } from 'vk-io';
import { registerHandlers } from './handlers';
import { trackBotMessage } from '../services/monitor';

let vk: VK | null = null;

export function initVkBot(): void {
  const token = process.env.VK_BOT_TOKEN;

  if (!token) {
    console.warn('[vk-bot] VK_BOT_TOKEN not set, skipping VK bot init');
    return;
  }

  const groupId = process.env.VK_GROUP_ID;

  vk = new VK({
    token,
    ...(groupId ? { pollingGroupId: Number(groupId) } : {}),
  });

  vk.updates.on('message_new', (ctx, next) => {
    if (ctx.isOutbox) return next();
    const senderId = ctx.senderId;
    const text = ctx.text || '';
    console.log(`[vk-bot] << message from=${senderId} peer=${ctx.peerId} text="${text}"`);
    trackBotMessage(`vk:${ctx.peerId}`);
    return next();
  });

  registerHandlers(vk);

  vk.updates.start()
    .then(() => console.log('[vk-bot] VK bot started (Long Poll)'))
    .catch((err: Error) => console.error('[vk-bot] Failed to start:', err.message));
}

export function getVkBot(): VK | null {
  return vk;
}
