import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Почта нужна веб-владельцам, у которых нет Telegram: без неё они не узнают
 * о новой брони и не могут восстановить пароль. Настраивается через SMTP_*;
 * если переменные не заданы, письма не отправляются, а сервис работает как раньше.
 */

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;

let transporter: Transporter | null = null;
let warned = false;

export function isMailerConfigured(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter(): Transporter | null {
  if (!isMailerConfigured()) {
    if (!warned) {
      warned = true;
      console.warn(
        '[mailer] SMTP_HOST/SMTP_USER/SMTP_PASS не заданы — письма о бронях ' +
        'и сброс пароля по email отключены',
      );
    }
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  return transporter;
}

function send(to: string, subject: string, text: string): void {
  const tx = getTransporter();
  if (!tx) return;

  tx.sendMail({ from: MAIL_FROM, to, subject, text })
    .catch((err: Error) => console.error('[mailer] Не удалось отправить письмо:', err.message));
}

export function sendOwnerEmail(to: string, subject: string, text: string): void {
  send(to, subject, text);
}

export function sendPasswordResetEmail(to: string, resetUrl: string): void {
  send(
    to,
    'Сброс пароля — slotik.tech',
    'Вы запросили сброс пароля в slotik.tech.\n\n' +
    `Ссылка действует 1 час:\n${resetUrl}\n\n` +
    'Если вы не запрашивали сброс — просто проигнорируйте это письмо.',
  );
}
