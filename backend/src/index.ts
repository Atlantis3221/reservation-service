import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { networkInterfaces } from 'os';
import { initDb, checkDbIntegrity, initCleanup } from './services/db';
import { isMailerConfigured } from './services/mailer';
import { initBot } from './bot';
import { initVkBot } from './vk-bot';
import { apiRouter } from './routes/api';
import { adminRouter } from './routes/admin';
import { notifyError, getPublicHealth, initMonitor } from './services/monitor';
import { clientsRouter } from './routes/clients';
import { initDemo } from './services/demo';

process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
  notifyError(err, 'uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled rejection:', reason);
  notifyError(reason, 'unhandledRejection');
});

initDb();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', apiRouter);
// Регистрируется до adminRouter: у того свой JWT-мидлвар, а этой странице нужен
// только пароль из CLIENTS_PASSWORD.
app.use('/admin/clients', clientsRouter);
app.use('/admin', adminRouter);

// Публичный health отдаёт только состояние процесса. До этого он без всякой
// авторизации возвращал email'ы всех клиентов, названия заведений и chat_id.
// Подробности теперь на /admin/clients под паролем и в /health монитор-бота.
app.get('/health', (_req, res) => {
  const info = getPublicHealth();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: info.uptime,
    memory: info.memoryMb,
  });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  notifyError(err, `${req.method} ${req.originalUrl}`);
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

function getLocalNetworkIP(): string | null {
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

app.listen(Number(PORT), '0.0.0.0', () => {
  const localIP = getLocalNetworkIP();
  console.log(`[server] Running on http://localhost:${PORT}`);
  if (localIP) {
    console.log(`[server] Network:  http://${localIP}:${PORT}`);
  }
  initBot();
  initVkBot();
  initMonitor();
  checkDbIntegrity();
  initDemo();
  initCleanup();

  // Пишем состояние почты при старте, а не при первой отправке: иначе
  // «почему владельцу не пришло письмо» выясняется задним числом.
  console.log(
    isMailerConfigured()
      ? '[mailer] SMTP настроен — письма о бронях и сброс пароля работают'
      : '[mailer] SMTP не настроен — письма отключены (см. SMTP_* в .env)',
  );
});
