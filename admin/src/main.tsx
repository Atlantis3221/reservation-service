import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { App } from './App';
import './styles.css';

const metrikaId = import.meta.env.VITE_METRIKA_COUNTER_ID;
if (metrikaId) {
  const id = Number(metrikaId);
  const w = window as any;
  w.ym = w.ym || function (...args: any[]) { (w.ym.a = w.ym.a || []).push(args); };
  w.ym.l = Date.now();
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  w.ym(id, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
