#!/usr/bin/env node
/**
 * Снимает кадры для лендинга с живого приложения.
 *
 * Кадры нельзя рисовать руками: один раз это уже привело к тому, что лендинг
 * обещал пустой календарь и ручной ввод времени, которых в продукте нет.
 * И после каждой правки интерфейса их надо переснимать, иначе лендинг
 * показывает прошлый дизайн.
 *
 * Снимает через CDP: у headless Chrome флаг --screenshot искажает вьюпорт и
 * обрезает правый край, поэтому нужен Emulation.setDeviceMetricsOverride.
 *
 * Запуск (бэкенд и приложения должны быть уже поднятыми):
 *   node scripts/shoot-landing-media.mjs \
 *     --client 'http://localhost:5173/demo-banya?date=2026-08-21' \
 *     --owner  'http://localhost:5174' \
 *     --token  '<JWT владельца>' \
 *     --owner-date 2026-08-21
 *
 * Любой кадр можно пропустить, не передав его флаг. Без --token панель
 * владельца снимется на экране входа: у свежего профиля Chrome нет сессии.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_BIN
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Свободный порт под отладку: 9222 обычно занят уже открытым Chrome. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = Number(process.env.CDP_PORT) || await freePort();
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'landing', 'media');

// 390×780 @2x — формат из landing/media/README.md
const VIEWPORT = { width: 390, height: 780, deviceScaleFactor: 2, mobile: true };
const SETTLE_MS = 2500;

const TARGETS = [
  { flag: '--client', file: 'screen-client.png' },
  { flag: '--owner', file: 'screen-owner.png' },
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* Chrome ещё поднимается */ }
    await sleep(250);
  }
  throw new Error(`Не дождались ${url}`);
}

/** Минимальный CDP-клиент: одна страница, запрос-ответ по id. */
async function openPage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;

  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    msg.error ? waiting.reject(new Error(msg.error.message)) : waiting.resolve(msg.result);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return {
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

const jobs = TARGETS
  .map((t) => ({ ...t, url: argValue(t.flag) }))
  .filter((t) => t.url);

if (jobs.length === 0) {
  console.error('Нечего снимать: передайте --client и/или --owner с адресом.');
  process.exit(1);
}

// На macOS $TMPDIR приватный для процесса, и Chrome — отдельное приложение —
// не может туда писать: порт отладки просто не открывается. Поэтому профиль
// кладём в общий /tmp.
const profileRoot = process.platform === 'darwin' ? '/tmp' : tmpdir();
const profile = await mkdtemp(path.join(profileRoot, 'slotik-shoot-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  // Без стартового адреса headless-Chrome закрывается сразу и порт отладки
  // никто не успевает открыть
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
  const tabs = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
  const tab = tabs.find((t) => t.type === 'page');
  if (!tab) throw new Error('Chrome не отдал ни одной страницы');

  const page = await openPage(tab.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', VIEWPORT);

  // Сессию владельца кладём до первой навигации: иначе панель успевает
  // отрисовать экран входа, и в кадр попадает он.
  const token = argValue('--token');
  const ownerDate = argValue('--owner-date');
  if (token) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        localStorage.setItem('token', ${JSON.stringify(token)});
        ${ownerDate ? `localStorage.setItem('calendar_selected_date', ${JSON.stringify(ownerDate)});` : ''}
      } catch {}`,
    });
  }

  console.log('Снимаем кадры:');
  for (const job of jobs) {
    await page.send('Page.navigate', { url: job.url });
    // Ждём данные и шрифты: сеть локальная, но кадр-два они всё равно берут
    await sleep(SETTLE_MS);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(data, 'base64');
    await writeFile(path.join(OUT_DIR, job.file), bytes);
    console.log(`  ${job.file} — ${(bytes.length / 1024).toFixed(0)} КБ`);
  }

  page.close();
} finally {
  chrome.kill();
  await rm(profile, { recursive: true, force: true });
}
