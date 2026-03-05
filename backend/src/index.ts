import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { networkInterfaces } from 'os';
import { initBot } from './services/bot';
import { apiRouter } from './routes/api';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', apiRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
});
