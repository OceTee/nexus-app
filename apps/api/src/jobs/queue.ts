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
  'verify-email' | 'reset-password' | 'password-changed' | 'new-device' | 'deletion-requested';

export interface PushJob {
  userId: string;
  event: 'security.new-device';
  /** Device that triggered the event; it is not notified. */
  excludeDeviceId?: string;
  vars: Record<string, string>;
}

export interface JobPayloads {
  'email.send': EmailJob;
  'push.send': PushJob;
}

export type JobName = keyof JobPayloads;
export type JobHandler<K extends JobName> = (data: JobPayloads[K]) => Promise<void>;
export type JobHandlers = { [K in JobName]: JobHandler<K> };

/** Retry policy per queue (TDD table: email 5 × exponential, push 3 ×). */
export const QUEUE_POLICIES: Record<JobName, { retryLimit: number; retryDelay: number }> = {
  'email.send': { retryLimit: 5, retryDelay: 30 },
  'push.send': { retryLimit: 3, retryDelay: 30 },
};

export interface JobQueue {
  send<K extends JobName>(name: K, data: JobPayloads[K]): Promise<void>;
  /** Registers handlers and starts processing (no-op where not applicable). */
  work(handlers: JobHandlers): Promise<void>;
  stop(): Promise<void>;
}

/** In-memory queue for tests: records jobs; `drain()` runs them through the handlers. */
export class MemoryQueue implements JobQueue {
  readonly sent: { name: JobName; data: JobPayloads[JobName] }[] = [];
  private handlers: JobHandlers | undefined;

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
      await this.boss.work<JobPayloads[JobName]>(name, { batchSize: 2 }, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true });
  }
}
