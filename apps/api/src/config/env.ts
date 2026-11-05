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
    MAIL_FROM: z.string().min(3).default('NEXUS <no-reply@nexus.example>'),
    /** Expo access token for push with enhanced security. */
    EXPO_ACCESS_TOKEN: z.string().min(1).optional(),

    /** `postgres` in deployed environments; `memory` for local experiments and tests. */
    RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).default('postgres'),
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
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
