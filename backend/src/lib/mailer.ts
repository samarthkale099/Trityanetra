import { env } from '../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

// In-memory record of mail "sent" without a configured SMTP server. Used by tests and dev to read the
// verification link. Never relied on in production (there SMTP_URL is set and mail really goes out).
export const devOutbox: OutgoingMail[] = [];

/**
 * Sends an email. With SMTP_URL set, uses nodemailer (loaded lazily so it is only required in production).
 * Without it, records the mail in devOutbox and, outside tests, logs it so a developer can click the link.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (env.SMTP_URL) {
    // Lazy import: nodemailer is only needed when a real SMTP server is configured. It is a declared
    // dependency (installed by npm install); the ts-ignore only covers environments where it is not yet on disk.
    // @ts-ignore - resolved at runtime once dependencies are installed
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from: env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    return;
  }

  devOutbox.push(mail);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[dev mail] To: ${mail.to} | ${mail.subject}\n${mail.text}`);
  }
}
