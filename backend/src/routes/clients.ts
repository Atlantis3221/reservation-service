import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { getClientsReport, type ClientsReport, type ClientBusiness } from '../services/clients-report';

export const clientsRouter = Router();

/**
 * Страница со всеми зарегистрированными клиентами. Здесь персональные данные
 * (email, телефоны), поэтому доступ только по паролю из CLIENTS_PASSWORD.
 * Пароль не хранится в репозитории — репозиторий публичный.
 */
const CLIENTS_PASSWORD = process.env.CLIENTS_PASSWORD;

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Сравнение постоянного времени: хешируем, чтобы не зависеть от длины. */
function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function requirePassword(req: Request, res: Response, next: NextFunction): void {
  if (!CLIENTS_PASSWORD) {
    res
      .status(503)
      .type('text/plain; charset=utf-8')
      .send('CLIENTS_PASSWORD не задан на сервере — страница отключена.');
    return;
  }

  const header = req.headers.authorization;
  const challenge = (): void => {
    // Браузер сам покажет окно ввода пароля.
    res.set('WWW-Authenticate', 'Basic realm="Slotik — клиенты", charset="UTF-8"');
    res.status(401).type('text/plain; charset=utf-8').send('Требуется пароль');
  };

  if (!header?.startsWith('Basic ')) {
    challenge();
    return;
  }

  let password = '';
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    // Логин не проверяем — нужен только пароль, можно вводить любое имя.
    password = sep >= 0 ? decoded.slice(sep + 1) : decoded;
  } catch {
    challenge();
    return;
  }

  if (!passwordMatches(password, CLIENTS_PASSWORD)) {
    challenge();
    return;
  }

  next();
}

clientsRouter.use(requirePassword);

clientsRouter.get('/', (req: Request, res: Response) => {
  const report = getClientsReport();

  if (req.query.format === 'json') {
    res.json(report);
    return;
  }

  res.type('text/html; charset=utf-8').send(renderPage(report));
});

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return value.replace('T', ' ').replace(/\..*$/, '').replace(/Z$/, '');
}

function renderContactLinks(b: ClientBusiness): string {
  if (!b.contactLinks.length) return '<span class="muted">—</span>';
  return b.contactLinks
    .map(
      (l) =>
        `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.type)}</a>`
    )
    .join(' ');
}

function renderBusinessRow(b: ClientBusiness): string {
  const state = b.slotsBooked > 0
    ? '<span class="badge badge--good">есть брони</span>'
    : b.activated
      ? '<span class="badge badge--warn">слоты есть, броней нет</span>'
      : '<span class="badge badge--bad">не активирован</span>';

  return `
    <tr>
      <td>
        <div class="biz-name">${escapeHtml(b.name)}</div>
        <div class="muted mono">
          <a href="https://slotik.tech/${escapeHtml(b.slug)}" target="_blank" rel="noopener noreferrer">/${escapeHtml(b.slug)}</a>
        </div>
      </td>
      <td>${state}</td>
      <td class="mono">${escapeHtml(fmtDateTime(b.createdAt))}</td>
      <td>
        ${b.adminEmail ? `<div class="mono">${escapeHtml(b.adminEmail)}</div>` : '<span class="muted">нет админ-аккаунта</span>'}
        ${b.telegramUsername ? `<div class="muted">@${escapeHtml(b.telegramUsername)}</div>` : ''}
        ${b.phone ? `<div class="muted mono">${escapeHtml(b.phone)}</div>` : ''}
      </td>
      <td class="num">${b.slotsTotal}</td>
      <td class="num">${b.slotsBooked}</td>
      <td class="num">${b.slotsFuture}</td>
      <td class="mono">${escapeHtml(b.firstSlotDate ?? '—')} → ${escapeHtml(b.lastSlotDate ?? '—')}</td>
      <td class="num">${b.requestsTotal}${b.requestsPending ? ` <span class="pending">(${b.requestsPending})</span>` : ''}</td>
      <td>${b.bookingRequestsEnabled ? 'вкл' : '<span class="muted">выкл</span>'}</td>
      <td class="num">${b.botMsgCount}</td>
      <td>${renderContactLinks(b)}</td>
      <td class="mono muted">${escapeHtml(b.ownerChatId)}</td>
    </tr>`;
}

function renderPage(report: ClientsReport): string {
  const t = report.totals;

  const businessRows = report.businesses.length
    ? report.businesses.map(renderBusinessRow).join('')
    : '<tr><td colspan="13" class="muted">Пока нет ни одного бизнеса</td></tr>';

  const orphanRows = report.orphanAdmins.length
    ? report.orphanAdmins
        .map(
          (u) => `
      <tr>
        <td class="mono">${escapeHtml(u.email)}</td>
        <td class="mono">${escapeHtml(fmtDateTime(u.createdAt))}</td>
        <td>${u.linkedToTelegram ? 'Telegram привязан' : '<span class="muted">нет</span>'}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="muted">Нет — все зарегистрированные завели бизнес</td></tr>';

  const requestRows = report.recentRequests.length
    ? report.recentRequests
        .map(
          (r) => `
      <tr>
        <td>${escapeHtml(r.businessName)}</td>
        <td>${escapeHtml(r.clientName)}</td>
        <td class="mono">${escapeHtml(r.clientPhone)}</td>
        <td class="mono">${escapeHtml(r.preferredDate)} ${escapeHtml(r.preferredTime)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.description ?? '')}</td>
        <td class="mono">${escapeHtml(fmtDateTime(r.createdAt))}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="muted">Заявок пока не было</td></tr>';

  const activationPct = t.businesses ? Math.round((t.activated / t.businesses) * 100) : 0;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Slotik — клиенты</title>
<style>
  :root {
    --bg: #f6f7f9;
    --panel: #ffffff;
    --border: #e3e6ea;
    --text: #1a1d21;
    --muted: #6b7280;
    --accent: #2563eb;
    --good-bg: #dcfce7; --good-fg: #166534;
    --warn-bg: #fef3c7; --warn-fg: #92400e;
    --bad-bg: #fee2e2;  --bad-fg: #991b1b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171a;
      --panel: #1c2024;
      --border: #2d3238;
      --text: #e8eaed;
      --muted: #9aa4b2;
      --accent: #7aa2f7;
      --good-bg: #12351f; --good-fg: #6ee7a0;
      --warn-bg: #3a2d10; --warn-fg: #fcd34d;
      --bad-bg: #3a1618;  --bad-fg: #fca5a5;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px 64px;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1400px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  .sub { color: var(--muted); margin: 0 0 24px; font-size: 13px; }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 8px; }
  .stat {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px 16px; min-width: 128px;
  }
  .stat .v { font-size: 22px; font-weight: 600; }
  .stat .k { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .panel {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; overflow-x: auto;
  }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .muted { color: var(--muted); }
  .biz-name { font-weight: 600; }
  a { color: var(--accent); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
  .badge--good { background: var(--good-bg); color: var(--good-fg); }
  .badge--warn { background: var(--warn-bg); color: var(--warn-fg); }
  .badge--bad  { background: var(--bad-bg);  color: var(--bad-fg); }
  .pending { color: var(--warn-fg); }
  .note {
    margin: 12px 0 0; padding: 12px 14px; border-radius: 10px;
    background: var(--panel); border: 1px solid var(--border); color: var(--muted); font-size: 13px;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Зарегистрированные клиенты</h1>
  <p class="sub">Снято ${escapeHtml(fmtDateTime(report.generatedAt))} UTC · <a href="?format=json">JSON</a></p>

  <div class="stats">
    <div class="stat"><div class="v">${t.businesses}</div><div class="k">бизнесов</div></div>
    <div class="stat"><div class="v">${t.activated}</div><div class="k">опубликовали слоты</div></div>
    <div class="stat"><div class="v">${activationPct}%</div><div class="k">активация</div></div>
    <div class="stat"><div class="v">${t.withBookings}</div><div class="k">с бронями</div></div>
    <div class="stat"><div class="v">${t.adminUsers}</div><div class="k">админ-аккаунтов</div></div>
    <div class="stat"><div class="v">${t.orphanAdmins}</div><div class="k">без бизнеса</div></div>
    <div class="stat"><div class="v">${t.bookingRequests}</div><div class="k">заявок</div></div>
  </div>

  <p class="note">
    «Активация» — опубликован хотя бы один слот. Бизнес без слотов означает, что владелец
    зарегистрировался, завёл заведение и ушёл, не дойдя до расписания.
  </p>

  <h2>Бизнесы (${report.businesses.length})</h2>
  <div class="panel">
    <table>
      <thead>
        <tr>
          <th>Заведение</th>
          <th>Состояние</th>
          <th>Регистрация</th>
          <th>Владелец</th>
          <th>Слотов</th>
          <th>Броней</th>
          <th>Будущих</th>
          <th>Период расписания</th>
          <th>Заявок</th>
          <th>Форма заявок</th>
          <th>Сообщ. боту</th>
          <th>Контакты</th>
          <th>chat_id</th>
        </tr>
      </thead>
      <tbody>${businessRows}</tbody>
    </table>
  </div>

  <h2>Зарегистрировались, но бизнес не завели (${report.orphanAdmins.length})</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Email</th><th>Регистрация</th><th>Telegram</th></tr></thead>
      <tbody>${orphanRows}</tbody>
    </table>
  </div>

  <h2>Последние заявки (${report.recentRequests.length})</h2>
  <div class="panel">
    <table>
      <thead>
        <tr><th>Заведение</th><th>Клиент</th><th>Телефон</th><th>Желаемое время</th><th>Статус</th><th>Комментарий</th><th>Создана</th></tr>
      </thead>
      <tbody>${requestRows}</tbody>
    </table>
  </div>
</div>
</body>
</html>`;
}
