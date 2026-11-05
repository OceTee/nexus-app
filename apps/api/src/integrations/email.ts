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
  constructor(private readonly logger: Logger) {}

  async send(email: OutgoingEmail): Promise<void> {
    const link = /https?:\/\/\S+/.exec(email.text)?.[0];
    this.logger.info({ subject: email.subject, link }, 'email (not sent: RESEND_API_KEY unset)');
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
