import { Telegraf } from 'telegraf';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';

const MONITOR_BOT_TOKEN = process.env.MONITOR_BOT_TOKEN;
const RATE_LIMIT_MS = 60_000;
const MAX_STACKTRACE_LEN = 1000;
const DIGEST_HOUR_MSK = 9;

let monitorBot: Telegraf | null = null;
let monitorChatId: string | null = null;
let lastAlertAt = 0;
let digestTimer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

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

interface DockerContainer {
  name: string;
  state: string;
  status: string;
}

function getDockerContainers(): Promise<DockerContainer[]> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: '/var/run/docker.sock', path: '/containers/json?all=true', method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const containers = JSON.parse(data) as any[];
            resolve(
              containers.map((c) => ({
                name: (c.Names?.[0] || '').replace(/^\//, ''),
                state: c.State,
                status: c.Status,
              }))
            );
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(3000, () => { req.destroy(); resolve([]); });
    req.end();
  });
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
  businesses: number;
  slots: number;
  dbSizeMb: number;
} {
  const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  const uptime = `${hours}h ${minutes}m ${seconds}s`;

  const mem = process.memoryUsage();
  const toMb = (bytes: number) => Math.round(bytes / 1024 / 1024 * 10) / 10;

  let businesses = 0;
  let slots = 0;
  try {
    const db = getDb();
    const bizRow = db.prepare('SELECT COUNT(*) as cnt FROM businesses').get() as any;
    businesses = bizRow?.cnt ?? 0;
    const slotRow = db.prepare('SELECT COUNT(*) as cnt FROM slots').get() as any;
    slots = slotRow?.cnt ?? 0;
  } catch {
    // DB may not be ready
  }

  return {
    uptime,
    memoryMb: {
      rss: toMb(mem.rss),
      heapUsed: toMb(mem.heapUsed),
      heapTotal: toMb(mem.heapTotal),
    },
    businesses,
    slots,
    dbSizeMb: getDbSizeMb(),
  };
}

function formatContainers(containers: DockerContainer[]): string {
  if (containers.length === 0) return '\n🐳 Docker: unavailable';
  let text = '\n🐳 <b>Docker:</b>\n';
  for (const c of containers) {
    const icon = c.state === 'running' ? '🟢' : '🔴';
    text += `${icon} ${c.name} — ${c.status}\n`;
  }
  return text;
}

async function formatHealthMessage(info: ReturnType<typeof getHealthInfo>): Promise<string> {
  const containers = await getDockerContainers();
  return (
    `📊 <b>Server Health</b>\n\n` +
    `⏱ Uptime: ${info.uptime}\n` +
    `💾 RAM: ${info.memoryMb.rss} MB (heap ${info.memoryMb.heapUsed}/${info.memoryMb.heapTotal} MB)\n` +
    `🏢 Businesses: ${info.businesses}\n` +
    `📅 Slots: ${info.slots}\n` +
    `🗄 DB: ${info.dbSizeMb} MB` +
    formatContainers(containers)
  );
}

function getBookingsLast24h(): number {
  try {
    const db = getDb();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateKey = yesterday.toISOString().split('T')[0];
    const row = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM slots
         WHERE status = 'booked' AND date_key >= ?`
      )
      .get(dateKey) as any;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

async function sendDailyDigest(): Promise<void> {
  const info = getHealthInfo();
  const bookings24h = getBookingsLast24h();
  const containers = await getDockerContainers();

  const text =
    `📋 <b>Daily Digest</b>\n\n` +
    `⏱ Uptime: ${info.uptime}\n` +
    `💾 RAM: ${info.memoryMb.rss} MB (heap ${info.memoryMb.heapUsed}/${info.memoryMb.heapTotal} MB)\n` +
    `🏢 Businesses: ${info.businesses}\n` +
    `📅 Slots: ${info.slots}\n` +
    `🗄 DB: ${info.dbSizeMb} MB\n` +
    `🔴 Bookings (24h): ${bookings24h}` +
    formatContainers(containers);

  sendTelegram(text);
}

function msUntilNextDigest(): number {
  const now = new Date();
  const mskOffset = 3 * 60;
  const mskMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + mskOffset;
  const targetMinutes = DIGEST_HOUR_MSK * 60;

  let diffMinutes = targetMinutes - mskMinutes;
  if (diffMinutes <= 0) diffMinutes += 24 * 60;

  return diffMinutes * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

function startDailyDigest(): void {
  function scheduleNext() {
    const ms = msUntilNextDigest();
    console.log(`[monitor] Next digest in ${Math.round(ms / 60_000)} minutes`);
    digestTimer = setTimeout(() => {
      sendDailyDigest();
      scheduleNext();
    }, ms);
  }

  scheduleNext();
}

export function initMonitor(): void {
  if (!MONITOR_BOT_TOKEN) {
    console.log('[monitor] MONITOR_BOT_TOKEN not set, skipping monitor init');
    return;
  }

  monitorBot = new Telegraf(MONITOR_BOT_TOKEN);

  monitorBot.command('health', async (ctx) => {
    const info = getHealthInfo();
    const text = await formatHealthMessage(info);
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
    .then(async () => {
      console.log('[monitor] Monitor bot started');

      const updates = await monitorBot!.telegram.getUpdates(0, 1, 0, []);
      if (updates.length > 0) {
        const chatId = (updates[0] as any).message?.chat?.id;
        if (chatId) {
          monitorChatId = String(chatId);
          console.log(`[monitor] Chat ID detected: ${monitorChatId}`);
        }
      }
    })
    .catch((err: Error) => console.error('[monitor] Failed to start:', err.message));

  monitorBot.on('message', (ctx) => {
    if (!monitorChatId) {
      monitorChatId = String(ctx.chat.id);
      console.log(`[monitor] Chat ID set: ${monitorChatId}`);
      ctx.reply(`✅ Monitoring activated for this chat.\nChat ID: <code>${monitorChatId}</code>`, { parse_mode: 'HTML' });
    }
  });

  startDailyDigest();

  process.once('SIGINT', () => monitorBot?.stop('SIGINT'));
  process.once('SIGTERM', () => monitorBot?.stop('SIGTERM'));
}

export function stopMonitor(): void {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = null;
  }
  monitorBot?.stop();
}
