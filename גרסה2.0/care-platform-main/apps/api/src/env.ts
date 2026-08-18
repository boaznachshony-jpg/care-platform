import { z } from 'zod';
import { nodeEnvSchema, parseEnv } from '@caredesk/config';

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORRELATION_HEADER: z.string().min(1).default('x-correlation-id'),
  // Comma-separated origin allowlist for CORS. Dev default is the local web
  // shell only; production values come from environment, never a wildcard.
  CORS_ORIGINS: z.string().default('http://localhost:5173,https://care-platform-web.vercel.app'),
  // Optional: when set, the case repository is Postgres-backed; when absent,
  // the API falls back to the in-memory repository so tests and a bare
  // `pnpm dev:api` run without any database.
  //
  // This must be the least-privilege `caredesk_app` login, never the owner
  // (ADR-002): an administrative connection carries BYPASSRLS, so any query
  // that forgets `withTenant()` would escape tenant isolation entirely. The
  // owner connection lives in DATABASE_ADMIN_URL and is deliberately absent
  // from this schema — migrations and provisioning read it directly, and the
  // application process should never hold an administrative credential.
  DATABASE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
