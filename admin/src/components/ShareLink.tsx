import { useState } from 'react';
import { copyToClipboard } from '../lib/clipboard';
import { reachGoal } from '../lib/metrika';

interface Props {
  url: string;
  businessName: string;
  /** Компактный вид — для шапки панели, без кнопок «поделиться» */
  compact?: boolean;
}

function shareText(businessName: string, url: string): string {
  return `Записаться в «${businessName}» онлайн: ${url}`;
}

export function ShareLink({ url, businessName, compact }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(url);
    if (!ok) return;
    reachGoal('link_copied', { compact: !!compact });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const text = encodeURIComponent(shareText(businessName, url));

  return (
    <div className={`share-link${compact ? ' share-link--compact' : ''}`}>
      <div className="share-link-row">
        <span className="share-link-url" title={url}>{url.replace(/^https?:\/\//, '')}</span>
        <button className="share-link-copy" onClick={handleCopy} type="button">
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>

      {!compact && (
        <div className="share-link-actions">
          <a
            className="share-btn"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть страницу
          </a>
          <a
            className="share-btn share-btn--wa"
            href={`https://wa.me/?text=${text}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => reachGoal('link_shared', { channel: 'whatsapp' })}
          >
            WhatsApp
          </a>
          <a
            className="share-btn share-btn--tg"
            href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Записаться в «${businessName}» онлайн`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => reachGoal('link_shared', { channel: 'telegram' })}
          >
            Telegram
          </a>
        </div>
      )}
    </div>
  );
}
