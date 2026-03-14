import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { networkInterfaces } from 'os';
import { initDb } from './services/db';
import { initBot } from './services/bot';
import { apiRouter } from './routes/api';
import { notifyError, getHealthInfo, initMonitor } from './services/monitor';

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

app.get('/health', (_req, res) => {
  const info = getHealthInfo();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: info.uptime,
    memory: info.memoryMb,
    businesses: info.businesses,
    slots: info.slots,
    dbSizeMb: info.dbSizeMb,
  });
});

app.use((err: Error, req: Request, _res: Response, next: NextFunction) => {
  notifyError(err, `${req.method} ${req.originalUrl}`);
  next(err);
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
});
