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

export function getHealthInfo(): {
  uptime: string;
  memoryMb: { rss: number; heapUsed: number; heapTotal: number };
  users: number;
  businesses: number;
  dbSizeMb: number;
  unrecognizedCommands: number;
  recentUsers: { email: string; created_at: string }[];
} {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  const uptime = `${hours}h ${minutes}m ${seconds}s`;

  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 10) / 10;

  let businesses = 0;
  let users = 0;
  let recentUsers: { email: string; created_at: string }[] = [];
  try {
    const db = getDb();
    const bizRow = db.prepare('SELECT COUNT(*) as cnt FROM businesses').get() as any;
    businesses = bizRow?.cnt ?? 0;
    const usersRow = db.prepare('SELECT COUNT(DISTINCT owner_chat_id) as cnt FROM businesses').get() as any;
    users = usersRow?.cnt ?? 0;
    recentUsers = db.prepare(
      'SELECT email, created_at FROM admin_users ORDER BY created_at DESC LIMIT 10'
    ).all() as { email: string; created_at: string }[];
  } catch {}

  return {
    uptime,
    memoryMb: {
      rss: toMb(mem.rss),
      heapUsed: toMb(mem.heapUsed),
      heapTotal: toMb(mem.heapTotal),
    },
    users,
    businesses,
    dbSizeMb: getDbSizeMb(),
    unrecognizedCommands,
    recentUsers,
  };
}

function formatHealthMessage(info: ReturnType<typeof getHealthInfo>): string {
  const dockerPs = getDockerPs();

  const recentList = info.recentUsers.length
    ? info.recentUsers.map((u, i) => `  ${i + 1}. ${escapeHtml(u.email)} (${u.created_at})`).join('\n')
    : '  нет';

  return (
    `📊 <b>Server Health</b>\n\n` +
    `⏱ Uptime: ${info.uptime}\n` +
    `💾 RAM: ${info.memoryMb.rss} MB (heap ${info.memoryMb.heapUsed}/${info.memoryMb.heapTotal} MB)\n` +
    `👤 Users: ${info.users}\n` +
    `🏢 Businesses: ${info.businesses}\n` +
    `🗄 DB: ${info.dbSizeMb} MB\n` +
    `❓ Unrecognized: ${info.unrecognizedCommands}\n\n` +
    `📋 <b>Последние регистрации:</b>\n${recentList}\n\n` +
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
