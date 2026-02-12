import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  initBot();
});
