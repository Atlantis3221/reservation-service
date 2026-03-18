import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { networkInterfaces } from 'os';
import { initDb } from './services/db';
import { initBot } from './bot';
import { apiRouter } from './routes/api';
import { adminRouter } from './routes/admin';
import { notifyError, getHealthInfo, initMonitor } from './services/monitor';
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
app.use('/admin', adminRouter);

app.get('/health', (_req, res) => {
  const info = getHealthInfo();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: info.uptime,
    memory: info.memoryMb,
    users: info.users,
    businesses: info.businesses,
    dbSizeMb: info.dbSizeMb,
    unrecognizedCommands: info.unrecognizedCommands,
    recentUsers: info.recentUsers,
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
  initMonitor();
  initDemo();
});
