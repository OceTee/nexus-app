import type { Logger } from 'pino';
import type { RenderedEmail } from './emailTemplates';

export interface OutgoingEmail extends RenderedEmail {
  to: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/** Sends through Resend's REST API (TDD Section D, Third-party integrations). */
export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!res.ok) {
      // The job retries with backoff; the body never contains secrets.
      throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
}

/** Development sender: logs the subject and any link instead of sending. */
export class LogSender implements EmailSender {
  /** The most recent messages, for the development outbox route (E2E flows). */
  private readonly recent: { to: string; subject: string; link: string | undefined }[] = [];

  constructor(private readonly logger: Logger) {}

  async send(email: OutgoingEmail): Promise<void> {
    const link = /https?:\/\/\S+/.exec(email.text)?.[0];
    this.recent.push({ to: email.to.toLowerCase(), subject: email.subject, link });
    if (this.recent.length > 50) this.recent.shift();
    this.logger.info({ subject: email.subject, link }, 'email (not sent: RESEND_API_KEY unset)');
  }

  /** The last message sent to `to`, if any. */
  last(to: string): { subject: string; link: string | undefined } | undefined {
    const m = [...this.recent].reverse().find((r) => r.to === to.toLowerCase());
    return m ? { subject: m.subject, link: m.link } : undefined;
  }
}

/** Test sender: keeps every message. */
export class MemorySender implements EmailSender {
  readonly outbox: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.outbox.push(email);
  }

  /** Extracts the `token` query parameter from the last email to `to`. */
  lastToken(to: string): string | undefined {
    const mail = [...this.outbox].reverse().find((m) => m.to === to);
    const url = mail ? /https?:\/\/\S+/.exec(mail.text)?.[0] : undefined;
    return url ? (new URL(url).searchParams.get('token') ?? undefined) : undefined;
  }
}
