import { Telegraf } from 'telegraf';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';

const MONITOR_BOT_TOKEN = process.env.MONITOR_BOT_TOKEN;
const RATE_LIMIT_MS = 60_000;
const MAX_STACKTRACE_LEN = 1000;
let monitorBot: Telegraf | null = null;
let monitorChatId: string | null = null;
let lastAlertAt = 0;
const startedAt = Date.now();
let unrecognizedCommands = 0;

export function trackUnrecognizedCommand(): void {
  unrecognizedCommands++;
}

let trackStmt: ReturnType<ReturnType<typeof getDb>['prepare']> | null = null;

export function trackBotMessage(chatId: string | number): void {
  try {
    if (!trackStmt) {
      trackStmt = getDb().prepare(`
        INSERT INTO bot_message_counts (chat_id, msg_count, last_msg_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(chat_id) DO UPDATE SET
          msg_count = msg_count + 1,
          last_msg_at = datetime('now')
      `);
    }
    trackStmt.run(String(chatId));
  } catch {}
}

export function getUnrecognizedCount(): number {
  return unrecognizedCommands;
}

function isEnabled(): boolean {
  return !!monitorBot && !!monitorChatId;
}

async function sendTelegram(text: string): Promise<void> {
  try {
    if (!monitorBot || !monitorChatId) return;
    await monitorBot.telegram.sendMessage(monitorChatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[monitor] Failed to send Telegram message:', err);
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function notifyNewBusiness(name: string, slug: string): void {
  if (!isEnabled()) return;

  const text =
    `🏢 <b>Новый клиент</b>\n\n` +
    `Название: ${escapeHtml(name)}\n` +
    `Slug: <code>${escapeHtml(slug)}</code>`;

  sendTelegram(text);
}

export function notifyError(error: unknown, context?: string): void {
  if (!isEnabled()) return;

  const now = Date.now();
  if (now - lastAlertAt < RATE_LIMIT_MS) return;
  lastAlertAt = now;

  const err = error instanceof Error ? error : new Error(String(error));
  const stack = truncate(err.stack || err.message, MAX_STACKTRACE_LEN);

  let text = `🚨 <b>Error</b>`;
  if (context) text += ` — ${escapeHtml(context)}`;
  text += `\n\n<pre>${escapeHtml(stack)}</pre>`;

  sendTelegram(text);
}

function getDockerPs(): string {
  try {
    return execSync('docker ps', { timeout: 5000, encoding: 'utf-8' }).trim();
  } catch {
    return 'unavailable';
  }
}

function getDbSizeMb(): number {
  try {
    const dbDir = process.env.DB_DIR || path.join(process.cwd(), 'data');
    const dbPath = path.join(dbDir, 'reservations.db');
    let totalBytes = 0;
    for (const file of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
      try { totalBytes += fs.statSync(file).size; } catch {}
    }
    return Math.round(totalBytes / 1024 / 1024 * 100) / 100;
  } catch {
    return 0;
  }
}

interface TelegramUser {
  chatId: string;
  username: string | null;
  phone: string | null;
  businessCount: number;
  msgCount: number;
  createdAt: string;
}

interface AdminUser {
  email: string;
  createdAt: string;
  linked: boolean;
}

export function getHealthInfo(): {
  uptime: string;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  businesses: number;
  dbSizeMb: number;
  unrecognizedCommands: number;
  telegramUsers: TelegramUser[];
  adminUsers: AdminUser[];
} {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  const uptime = `${hours}h ${minutes}m ${seconds}s`;

  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 10) / 10;

  let businesses = 0;
  let telegramUsers: TelegramUser[] = [];
  let adminUsers: AdminUser[] = [];
  try {
    const db = getDb();
    const bizRow = db.prepare('SELECT COUNT(*) as cnt FROM businesses').get() as any;
    businesses = bizRow?.cnt ?? 0;

    telegramUsers = db.prepare(`
      SELECT
        b.owner_chat_id   AS chatId,
        b.telegram_username AS username,
        COALESCE(b.owner_phone, oa.phone) AS phone,
        COUNT(DISTINCT b.id) AS businessCount,
        COALESCE(mc.msg_count, 0) AS msgCount,
        MIN(b.created_at)  AS createdAt
      FROM businesses b
      LEFT JOIN owner_agreements oa ON oa.owner_chat_id = b.owner_chat_id
      LEFT JOIN bot_message_counts mc ON mc.chat_id = b.owner_chat_id
      GROUP BY b.owner_chat_id
      ORDER BY MIN(b.created_at) DESC
    `).all() as TelegramUser[];

    adminUsers = db.prepare(`
      SELECT email, created_at AS createdAt,
        CASE WHEN owner_chat_id IS NOT NULL THEN 1 ELSE 0 END AS linked
      FROM admin_users ORDER BY created_at DESC LIMIT 10
    `).all() as any[];
    adminUsers = adminUsers.map((u: any) => ({ ...u, linked: !!u.linked }));
  } catch {}

  return {
    uptime,
    memoryMb: {
      rss: toMb(mem.rss),
      heapUsed: toMb(mem.heapUsed),
      heapTotal: toMb(mem.heapTotal),
    },
    businesses,
    dbSizeMb: getDbSizeMb(),
    unrecognizedCommands,
    telegramUsers,
    adminUsers,
  };
}

function formatHealthMessage(info: ReturnType<typeof getHealthInfo>): string {
  const dockerPs = getDockerPs();

  const tgTable = info.telegramUsers.length
    ? info.telegramUsers.map((u, i) => {
        const name = u.username ? `@${escapeHtml(u.username)}` : u.chatId;
        const phone = u.phone || '—';
        return `  ${i + 1}. ${name} | ${phone} | ${u.businessCount} точ. | ${u.msgCount} сообщ. | ${u.createdAt}`;
      }).join('\n')
    : '  нет';

  const adminList = info.adminUsers.length
    ? info.adminUsers.map((u, i) => {
        const link = u.linked ? ' ✅' : '';
        return `  ${i + 1}. ${escapeHtml(u.email)}${link} (${u.createdAt})`;
      }).join('\n')
    : '  нет';

  return (
    `📊 <b>Server Health</b>\n\n` +
    `⏱ Uptime: ${info.uptime}\n` +
    `💾 RAM: ${info.memoryMb.rss} MB (heap ${info.memoryMb.heapUsed}/${info.memoryMb.heapTotal} MB)\n` +
    `🏢 Businesses: ${info.businesses}\n` +
    `🗄 DB: ${info.dbSizeMb} MB\n` +
    `❓ Unrecognized: ${info.unrecognizedCommands}\n\n` +
    `🤖 <b>Telegram-пользователи (${info.telegramUsers.length}):</b>\n${tgTable}\n\n` +
    `🌐 <b>Админ-панель (${info.adminUsers.length}):</b>\n${adminList}\n\n` +
    `🐳 <b>Docker:</b>\n<pre>${escapeHtml(dockerPs)}</pre>`
  );
}

export function initMonitor(): void {
  if (!MONITOR_BOT_TOKEN) {
    console.log('[monitor] MONITOR_BOT_TOKEN not set, skipping monitor init');
    return;
  }

  monitorBot = new Telegraf(MONITOR_BOT_TOKEN);

  monitorBot.command('health', (ctx) => {
    const info = getHealthInfo();
    const text = formatHealthMessage(info);
    ctx.reply(text, { parse_mode: 'HTML' });
  });

  monitorBot.command('start', (ctx) => {
    ctx.reply(
      `🤖 Monitor bot active.\n\n` +
      `Your chat ID: <code>${ctx.chat.id}</code>\n\n` +
      `Commands:\n/health — server status`,
      { parse_mode: 'HTML' }
    );
  });

  monitorBot.launch()
    .then(() => console.log('[monitor] Monitor bot started'))
    .catch((err: Error) => console.error('[monitor] Failed to start:', err.message));

  monitorBot.on('message', (ctx) => {
    if (!monitorChatId) {
      monitorChatId = String(ctx.chat.id);
      console.log(`[monitor] Chat ID set: ${monitorChatId}`);
      ctx.reply(`✅ Monitoring activated for this chat.\nChat ID: <code>${monitorChatId}</code>`, { parse_mode: 'HTML' });
    }
  });

  process.once('SIGINT', () => monitorBot?.stop('SIGINT'));
  process.once('SIGTERM', () => monitorBot?.stop('SIGTERM'));
}

export function stopMonitor(): void {
  monitorBot?.stop();
}
