import { z } from 'zod';
import { nodeEnvSchema, parseEnv } from '@caredesk/config';

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORRELATION_HEADER: z.string().min(1).default('x-correlation-id'),
  // Comma-separated origin allowlist for CORS. Dev default is the local web
  // shell only; production values come from environment, never a wildcard.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Optional: when set, the case repository is Postgres-backed; when absent,
  // the API falls back to the in-memory repository so tests and a bare
  // `pnpm dev:api` run without any database.
  DATABASE_URL: z.string().optional(),
  AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
