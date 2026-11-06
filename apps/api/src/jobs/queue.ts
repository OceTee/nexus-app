// Background job queue (TDD Section F, Background jobs; design decision D-07).
// Producers depend on the `JobQueue` interface; production uses pg-boss and
// tests use the in-memory queue, which records jobs and runs them on demand.

import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';

export interface EmailJob {
  template: EmailTemplateName;
  to: string;
  /** Owner, for the per-user daily email cap; absent for system mail. */
  userId?: string;
  vars: Record<string, string>;
}

export type EmailTemplateName =
  | 'verify-email'
  | 'reset-password'
  | 'password-changed'
  | 'new-device'
  | 'deletion-requested'
  | 'deletion-reminder'
  | 'account-deleted';

export interface PushJob {
  userId: string;
  event: 'security.new-device' | 'sync.nudge' | 'account.deletion-reminder';
  /** Device that triggered the event; it is not notified. */
  excludeDeviceId?: string;
  vars: Record<string, string>;
}

/** Scheduled maintenance jobs carry no data. */
type NoData = Record<string, never>;

export interface JobPayloads {
  'email.send': EmailJob;
  'push.send': PushJob;
  'exports.generate': { exportId: string; userId: string };
  'versions.prune': NoData;
  'changes.compact': NoData;
  'attachments.orphan-sweep': NoData;
  'accounts.purge': NoData;
  'account.deletion-reminder': NoData;
  'tokens.prune': NoData;
  'audit.prune': NoData;
  'exports.expire': NoData;
  'backup.dump': NoData;
}

export type JobName = keyof JobPayloads;
export type JobHandler<K extends JobName> = (data: JobPayloads[K]) => Promise<void>;
export type JobHandlers = { [K in JobName]: JobHandler<K> };

/** Retry policy per queue (TDD Section F, Background jobs). */
export const QUEUE_POLICIES: Record<JobName, { retryLimit: number; retryDelay: number }> = {
  'email.send': { retryLimit: 5, retryDelay: 30 },
  'push.send': { retryLimit: 3, retryDelay: 30 },
  'exports.generate': { retryLimit: 2, retryDelay: 60 },
  'versions.prune': { retryLimit: 1, retryDelay: 300 },
  'changes.compact': { retryLimit: 1, retryDelay: 300 },
  'attachments.orphan-sweep': { retryLimit: 3, retryDelay: 300 },
  'accounts.purge': { retryLimit: 3, retryDelay: 300 },
  'account.deletion-reminder': { retryLimit: 1, retryDelay: 300 },
  'tokens.prune': { retryLimit: 1, retryDelay: 300 },
  'audit.prune': { retryLimit: 1, retryDelay: 300 },
  'exports.expire': { retryLimit: 1, retryDelay: 300 },
  'backup.dump': { retryLimit: 2, retryDelay: 600 },
};

/** Cron schedules in UTC (TDD Section F, Background jobs). */
export const SCHEDULES: Partial<Record<JobName, string>> = {
  'backup.dump': '0 1 * * *',
  'accounts.purge': '0 2 * * *',
  'versions.prune': '0 3 * * *',
  'attachments.orphan-sweep': '30 3 * * *',
  'changes.compact': '0 4 * * 0',
  'tokens.prune': '0 5 * * *',
  'account.deletion-reminder': '0 9 * * *',
  'exports.expire': '15 * * * *',
  'audit.prune': '0 6 1 * *',
};

export interface JobQueue {
  send<K extends JobName>(name: K, data: JobPayloads[K]): Promise<void>;
  /** Registers handlers and starts processing (no-op where not applicable). */
  work(handlers: JobHandlers): Promise<void>;
  /** Registers the cron schedules (idempotent). */
  schedule(schedules: Partial<Record<JobName, string>>): Promise<void>;
  stop(): Promise<void>;
}

/** In-memory queue for tests: records jobs; `drain()` runs them through the handlers. */
export class MemoryQueue implements JobQueue {
  readonly sent: { name: JobName; data: JobPayloads[JobName] }[] = [];
  readonly schedules = new Map<JobName, string>();
  private handlers: JobHandlers | undefined;

  async schedule(schedules: Partial<Record<JobName, string>>): Promise<void> {
    for (const [name, cron] of Object.entries(schedules)) this.schedules.set(name as JobName, cron);
  }

  /** Runs one job immediately through its handler (tests). */
  async run<K extends JobName>(name: K, data: JobPayloads[K]): Promise<void> {
    if (!this.handlers) throw new Error('MemoryQueue.run: call work() first');
    await (this.handlers[name] as JobHandler<K>)(data);
  }

  async send<K extends JobName>(name: K, data: JobPayloads[K]): Promise<void> {
    this.sent.push({ name, data });
  }

  async work(handlers: JobHandlers): Promise<void> {
    this.handlers = handlers;
  }

  /** Runs every recorded job once, in order, and clears the queue. */
  async drain(): Promise<void> {
    if (!this.handlers) throw new Error('MemoryQueue.drain: call work() first');
    const jobs = this.sent.splice(0);
    for (const job of jobs) {
      const handler = this.handlers[job.name] as JobHandler<JobName>;
      await handler(job.data);
    }
  }

  async stop(): Promise<void> {}
}

/** pg-boss backed queue. `start()` installs the `pgboss` schema on first run. */
export class PgBossQueue implements JobQueue {
  private boss: PgBoss;
  private started: Promise<unknown> | undefined;

  constructor(
    connectionString: string,
    private readonly logger: Logger,
  ) {
    this.boss = new PgBoss({ connectionString, schema: 'pgboss', application_name: 'nexus-jobs' });
    this.boss.on('error', (err) => this.logger.error({ err }, 'pg-boss error'));
  }

  private async ready(): Promise<void> {
    this.started ??= this.boss.start().then(async () => {
      for (const [name, policy] of Object.entries(QUEUE_POLICIES)) {
        await this.boss.createQueue(name, { ...policy, retryBackoff: true });
      }
    });
    await this.started;
  }

  async send<K extends JobName>(name: K, data: JobPayloads[K]): Promise<void> {
    await this.ready();
    await this.boss.send(name, data as object);
  }

  async work(handlers: JobHandlers): Promise<void> {
    await this.ready();
    for (const name of Object.keys(handlers) as JobName[]) {
      const handler = handlers[name] as JobHandler<JobName>;
      await this.boss.work<JobPayloads[JobName]>(
        name,
        { batchSize: SCHEDULES[name] ? 1 : 2 },
        async (jobs) => {
          for (const job of jobs) await handler(job.data);
        },
      );
    }
  }

  async schedule(schedules: Partial<Record<JobName, string>>): Promise<void> {
    await this.ready();
    for (const [name, cron] of Object.entries(schedules)) {
      await this.boss.schedule(name, cron, {}, { tz: 'UTC' });
    }
  }

  async stop(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true });
  }
}
