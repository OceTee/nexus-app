import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../db/client';
import { seedDemo } from '../db/seed/seedDemo';
import { devices } from '../db/schema';
import { withUser } from '../db/withUser';
import type { Limiters } from '../http/middleware/rateLimit';
import type { EmailSender } from '../integrations/email';
import { renderEmail } from '../integrations/emailTemplates';
import type { PushSender } from '../integrations/push';
import type { JobHandlers } from './queue';
import type { ExportsService } from '../modules/exports/exports.service';
import { hashPassword } from '../modules/auth/password';
import {
  backupDatabase,
  compactChanges,
  expireExports,
  purgeAccounts,
  pruneAudit,
  pruneTokens,
  pruneVersions,
  remindPendingDeletions,
  sweepAttachments,
  type MaintenanceDeps,
} from './maintenance';

export interface JobDeps {
  db: Db;
  logger: Logger;
  email: EmailSender;
  push: PushSender;
  limiters: Limiters;
  /** Cross-user connection and storage for scheduled maintenance. */
  maintenance: MaintenanceDeps;
  exports: ExportsService;
  /**
   * Password of the public demo account (demo@nexus.example). When set, the
   * `demo.reset` job restores the account and its sample notes every night;
   * when unset, the job does nothing.
   */
  demoPassword?: string;
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
  'account.deletion-reminder': (vars) => ({
    title: 'Account deletion in 7 days',
    body: `Your NEXUS account will be deleted on ${vars.purgeDate ?? 'the scheduled date'}.`,
  }),
};

/** Handlers for every queue: on-demand (email, push, exports) and scheduled maintenance. */
export function createJobHandlers({
  db,
  logger,
  email,
  push,
  limiters,
  maintenance,
  exports,
  demoPassword,
}: JobDeps): JobHandlers {
  const log = (job: string) => (result: unknown) => logger.info({ job, result }, 'job finished');
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

    async 'exports.generate'({ userId, exportId }) {
      await exports.generate(userId, exportId);
    },
    'versions.prune': async () => log('versions.prune')(await pruneVersions(maintenance.db)),
    'changes.compact': async () => log('changes.compact')(await compactChanges(maintenance)),
    'attachments.orphan-sweep': async () =>
      log('attachments.orphan-sweep')(await sweepAttachments(maintenance)),
    'accounts.purge': async () => log('accounts.purge')(await purgeAccounts(maintenance)),
    'account.deletion-reminder': async () =>
      log('account.deletion-reminder')(await remindPendingDeletions(maintenance)),
    'tokens.prune': async () => log('tokens.prune')(await pruneTokens(maintenance)),
    'audit.prune': async () => log('audit.prune')(await pruneAudit(maintenance)),
    'exports.expire': async () => log('exports.expire')(await expireExports(maintenance)),
    'backup.dump': async () => log('backup.dump')(await backupDatabase(maintenance)),
    async 'demo.reset'() {
      if (!demoPassword) {
        logger.info('demo.reset skipped: DEMO_PASSWORD is not set');
        return;
      }
      log('demo.reset')(await seedDemo(maintenance.db, await hashPassword(demoPassword)));
    },
  };
}
