import { z } from 'zod';

const PgUrl = z.url({ protocol: /^postgres(ql)?$/ });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    /** Comma-separated browser origins allowed by CORS. Native apps send no Origin. */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** `all` runs HTTP and job workers; `api` only HTTP; `worker` only jobs. */
    ROLE: z.enum(['all', 'api', 'worker']).default('all'),

    /** Pooled connection for the API, as the `nexus_api` role (RLS applies). */
    DATABASE_URL: PgUrl.optional(),
    /** Direct connection as the schema owner, for migrations. */
    DATABASE_URL_DIRECT: PgUrl.optional(),
    /** Connection for pg-boss (installs and owns the `pgboss` schema). */
    JOBS_DATABASE_URL: PgUrl.optional(),

    /** HS256 signing secret for access tokens (256-bit or longer). */
    JWT_SECRET: z.string().min(32).optional(),
    JWT_KID: z.string().min(1).default('k1'),
    /** Previous secret, accepted for verification during rotation. */
    JWT_SECRET_PREVIOUS: z.string().min(32).optional(),
    JWT_KID_PREVIOUS: z.string().min(1).optional(),

    /** Base URL for links in emails (verify, reset). */
    APP_URL: z.url().default('http://localhost:8081'),
    /** Resend API key; when missing, emails are logged instead of sent (development). */
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Brevo transactional email; preferred over Resend when set (free, no domain needed). */
    BREVO_API_KEY: z.string().min(1).optional(),
    /** Public demo account password; enables the nightly demo.reset job. */
    DEMO_PASSWORD: z.string().min(12).optional(),
    MAIL_FROM: z.string().min(3).default('NEXUS <no-reply@nexus.example>'),
    /** Expo access token for push with enhanced security. */
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),

    /** Attachment storage: R2 in staging/production, MinIO locally (S3 API). */
    R2_ENDPOINT: z.url().optional(),
    R2_ACCOUNT_ID: z.string().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(3).default('nexus-attachments-dev'),
    /**
     * Signing region. R2 and MinIO accept `auto`; other S3-compatible stores
     * (Backblaze B2, for one) need their real region, e.g. `us-west-004`.
     */
    R2_REGION: z.string().min(1).default('auto'),
    /** Cross-user maintenance jobs (nexus_maint, BYPASSRLS). */
    DATABASE_URL_MAINT: PgUrl.optional(),
    /** age recipient (public key) for encrypted nightly backups. */
    BACKUP_AGE_RECIPIENT: z.string().startsWith('age1').optional(),
    /** Server-side export generation (post-MVP; off by default). */
    FEATURE_SERVER_EXPORTS: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    /** Change-feed hold-back for late commits (risk R-02). */
    SYNC_VISIBILITY_LAG_MS: z.coerce.number().int().min(0).max(60_000).default(2000),
    /**
     * End-to-end test runs only (Maestro): exposes the last email sent to an
     * address at GET /v1/dev/emails/last (log sender only) and lifts the auth
     * burst limit so a suite can create accounts. Refused in production.
     */
    E2E_MODE: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    /** `postgres` in deployed environments; `memory` for local experiments and tests. */
    RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).default('postgres'),
    /**
     * Multiplies every rate limit. CI security scans only (ZAP sends thousands of
     * requests); must stay 1 in production.
     */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .refine((e) => e.NODE_ENV !== 'production' || !e.E2E_MODE, {
    message: 'E2E_MODE must not be enabled in production',
    path: ['E2E_MODE'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.RATE_LIMIT_MULTIPLIER === 1, {
    message: 'RATE_LIMIT_MULTIPLIER must be 1 in production',
    path: ['RATE_LIMIT_MULTIPLIER'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.DATABASE_URL !== undefined, {
    message: 'DATABASE_URL is required in production',
    path: ['DATABASE_URL'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.JWT_SECRET !== undefined, {
    message: 'JWT_SECRET is required in production',
    path: ['JWT_SECRET'],
  })
  .refine((e) => (e.JWT_SECRET_PREVIOUS === undefined) === (e.JWT_KID_PREVIOUS === undefined), {
    message: 'JWT_SECRET_PREVIOUS and JWT_KID_PREVIOUS must be set together',
    path: ['JWT_KID_PREVIOUS'],
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses and validates the environment; throws a readable error on bad config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Hosting dashboards (Render, Railway) can keep a variable with an empty
  // value; treat that as unset so defaults and optional settings still apply.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
