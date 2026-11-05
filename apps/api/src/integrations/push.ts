import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import type { Logger } from 'pino';

export interface PushMessage {
  title?: string;
  body?: string;
  data: Record<string, unknown>;
}

export interface PushSender {
  /** Sends to the given Expo push tokens; returns tokens Expo reported as invalid. */
  send(tokens: string[], message: PushMessage): Promise<string[]>;
}

/** Expo push service (TDD Section F, Notifications). Chunks to 100 per request. */
export class ExpoPushSender implements PushSender {
  private expo: Expo;

  constructor(
    accessToken: string | undefined,
    private readonly logger: Logger,
  ) {
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  async send(tokens: string[], message: PushMessage): Promise<string[]> {
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    const invalid: string[] = tokens.filter((t) => !Expo.isExpoPushToken(t));
    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      ...(message.title ? { title: message.title } : {}),
      ...(message.body ? { body: message.body } : {}),
      data: message.data,
    }));
    for (const chunk of this.expo.chunkPushNotifications(messages)) {
      const tickets = await this.expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'error') {
          this.logger.warn({ error: ticket.details?.error }, 'push ticket error');
          if (ticket.details?.error === 'DeviceNotRegistered') {
            const to = chunk[i]?.to;
            if (typeof to === 'string') invalid.push(to);
          }
        }
      });
    }
    return invalid;
  }
}

/** Test sender: records messages. */
export class MemoryPushSender implements PushSender {
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];

  async send(tokens: string[], message: PushMessage): Promise<string[]> {
    this.sent.push({ tokens, message });
    return [];
  }
}
