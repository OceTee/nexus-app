import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrevoSender,
  LogSender,
  MemorySender,
  parseMailFrom,
  ResendSender,
} from '../../src/integrations/email';

// The push SDK talks to Expo's servers; a stand-in records chunks and replies
// with scripted tickets.
const tickets: { status: string; details?: { error?: string } }[][] = [];
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken(t: string) {
      return t.startsWith('ExponentPushToken[');
    }
    chunkPushNotifications<T>(messages: T[]): T[][] {
      return messages.length ? [messages] : [];
    }
    async sendPushNotificationsAsync() {
      return tickets.shift() ?? [];
    }
  }
  return { Expo };
});
const { ExpoPushSender, MemoryPushSender } = await import('../../src/integrations/push');

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
const mail = {
  to: 'Amara@Example.com',
  subject: 'Confirm your email',
  text: 'Open https://nexus.example/verify?token=abc123 to confirm.',
  html: '<p>Confirm</p>',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('parseMailFrom', () => {
  it('splits a display name from the address', () => {
    expect(parseMailFrom('NEXUS <hi@nexus.example>')).toEqual({
      name: 'NEXUS',
      email: 'hi@nexus.example',
    });
    expect(parseMailFrom('<hi@nexus.example>')).toEqual({ email: 'hi@nexus.example' });
    expect(parseMailFrom(' hi@nexus.example ')).toEqual({ email: 'hi@nexus.example' });
  });
});

describe('BrevoSender', () => {
  it('posts the message to Brevo with the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await new BrevoSender('xkeysib-key', 'NEXUS <me@gmail.com>').send(mail);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('xkeysib-key');
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: 'NEXUS', email: 'me@gmail.com' },
      to: [{ email: 'Amara@Example.com' }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    });
  });

  it('throws with the status so the job retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('sender not verified', { status: 400 })),
    );
    await expect(new BrevoSender('k', 'me@gmail.com').send(mail)).rejects.toThrow(
      'Brevo responded 400: sender not verified',
    );
  });
});

describe('ResendSender', () => {
  it('posts the message to Resend with the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendSender('re_key', 'NEXUS <hi@nexus.example>').send(mail);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'NEXUS <hi@nexus.example>',
      to: ['Amara@Example.com'],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  });

  it('throws with the status so the job retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })),
    );
    await expect(new ResendSender('k', 'f').send(mail)).rejects.toThrow(
      'Resend responded 429: rate limited',
    );
  });
});

describe('LogSender', () => {
  it('logs instead of sending and remembers the last link per address', async () => {
    const s = new LogSender(logger);
    await s.send(mail);
    await s.send({ ...mail, text: 'No link here' });
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(s.last('amara@example.com')).toEqual({ subject: mail.subject, link: undefined });
    expect(s.last('nobody@example.com')).toBeUndefined();
  });

  it('keeps only the 50 most recent messages', async () => {
    const s = new LogSender(logger);
    await s.send({ ...mail, to: 'first@example.com' });
    for (let i = 0; i < 50; i += 1) await s.send({ ...mail, to: `u${i}@example.com` });
    expect(s.last('first@example.com')).toBeUndefined();
    expect(s.last('u49@example.com')?.link).toBe('https://nexus.example/verify?token=abc123');
  });
});

describe('MemorySender', () => {
  it('extracts the token from the last email to an address', async () => {
    const s = new MemorySender();
    expect(s.lastToken(mail.to)).toBeUndefined();
    await s.send(mail);
    expect(s.lastToken(mail.to)).toBe('abc123');
    await s.send({ ...mail, text: 'No link' });
    expect(s.lastToken(mail.to)).toBeUndefined();
  });
});

describe('ExpoPushSender', () => {
  const good = 'ExponentPushToken[aaa]';
  const gone = 'ExponentPushToken[bbb]';

  it('reports malformed tokens and devices Expo no longer knows', async () => {
    tickets.push([
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);
    const invalid = await new ExpoPushSender('token', logger).send([good, gone, 'not-a-token'], {
      title: 'New device signed in',
      body: 'Pixel 8',
      data: { event: 'security.new-device' },
    });
    expect(invalid.sort()).toEqual([gone, 'not-a-token'].sort());
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs other ticket errors without dropping the token', async () => {
    tickets.push([{ status: 'error', details: { error: 'MessageRateExceeded' } }]);
    const invalid = await new ExpoPushSender(undefined, logger).send([good], { data: {} });
    expect(invalid).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when there are no valid tokens', async () => {
    expect(await new ExpoPushSender(undefined, logger).send([], { data: {} })).toEqual([]);
  });
});

describe('MemoryPushSender', () => {
  it('records what was sent', async () => {
    const s = new MemoryPushSender();
    await s.send(['t'], { data: { a: 1 } });
    expect(s.sent).toEqual([{ tokens: ['t'], message: { data: { a: 1 } } }]);
  });
});
