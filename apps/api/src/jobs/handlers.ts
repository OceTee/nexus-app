import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client';
import { devices } from '../db/schema';
import { withUser } from '../db/withUser';
import type { Limiters } from '../http/middleware/rateLimit';
import type { EmailSender } from '../integrations/email';
import { renderEmail } from '../integrations/emailTemplates';
import type { PushSender } from '../integrations/push';
import type { JobHandlers } from './queue';

export interface JobDeps {
  db: Db;
  logger: Logger;
  email: EmailSender;
  push: PushSender;
  limiters: Limiters;
}

/** Alert copy per event; `sync.nudge` is data-only (no title or body). */
const PUSH_COPY: Record<
  string,
  (vars: Record<string, string>) => { title?: string; body?: string }
> = {
  'security.new-device': (vars) => ({
    title: 'New device signed in',
    body: `${vars.deviceName ?? 'A device'} signed in to your NEXUS account.`,
  }),
  'sync.nudge': () => ({}),
};

/** Handlers for the on-demand queues (`email.send`, `push.send`). */
export function createJobHandlers({ db, logger, email, push, limiters }: JobDeps): JobHandlers {
  return {
    async 'email.send'(job) {
      if (job.userId) {
        // Abuse cap: at most 20 emails per user per day across all templates.
        try {
          await limiters.emailsPerUserPerDay.consume(`user:${job.userId}`);
        } catch {
          logger.warn({ template: job.template }, 'email dropped: daily cap reached');
          return;
        }
      }
      await email.send({ to: job.to, ...renderEmail(job.template, job.vars) });
    },

    async 'push.send'(job) {
      const targets = await withUser(db, job.userId, (tx) =>
        tx
          .select({ id: devices.id, token: devices.pushToken })
          .from(devices)
          .where(
            and(
              eq(devices.userId, job.userId),
              isNull(devices.revokedAt),
              isNotNull(devices.pushToken),
              ...(job.excludeDeviceId ? [ne(devices.id, job.excludeDeviceId)] : []),
            ),
          ),
      );
      const tokens = targets.map((t) => t.token!).filter(Boolean);
      if (tokens.length === 0) return;
      const invalid = await push.send(tokens, {
        ...PUSH_COPY[job.event]!(job.vars),
        data: { type: job.event },
      });
      if (invalid.length > 0) {
        await withUser(db, job.userId, (tx) =>
          tx.update(devices).set({ pushToken: null }).where(inArray(devices.pushToken, invalid)),
        );
      }
    },
  };
}
