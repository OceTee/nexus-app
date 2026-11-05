import { z } from 'zod';

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
    ROLE: z.enum(['all', 'api', 'worker']).default('all'),
    /** Pooled connection for the API, as the `nexus_api` role (RLS applies). */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
    /** Direct connection as the schema owner, for migrations. */
    DATABASE_URL_DIRECT: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.DATABASE_URL !== undefined, {
    message: 'DATABASE_URL is required in production',
    path: ['DATABASE_URL'],
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
