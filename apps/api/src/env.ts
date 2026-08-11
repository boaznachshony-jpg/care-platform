import { z } from 'zod';
import { nodeEnvSchema, parseEnv } from '@caredesk/config';

const envSchema = z
  .object({
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
    // AES-256-GCM key used to encrypt the complete tenant workspace before it
    // reaches Postgres. This must be a base64 encoded 32-byte random key and
    // must be managed by the deployment secret store.
    WORKSPACE_ENCRYPTION_KEY: z.string().optional(),
    // Supabase publishable credentials are safe to identify the Auth project;
    // they are not an administrative service key. Both are required together.
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
    FAMILY_INVITE_REDIRECT_URL: z.string().url().optional(),
    // Support delivery is server-only. The destination must never be exposed
    // through a VITE_ variable or rendered into the browser bundle.
    SUPPORT_DESTINATION_EMAIL: z.string().email().optional(),
    SUPPORT_FROM_EMAIL: z.string().email().optional(),
    RESEND_API_KEY: z.string().min(10).optional(),
    BILLING_PROVIDER: z.enum(['disabled', 'cardcom', 'mock']).default('disabled'),
    BILLING_PRICE_AGOROT: z.coerce.number().int().positive().default(3900),
    BILLING_VAT_RATE_BPS: z.coerce.number().int().min(0).max(10_000).default(1800),
    BILLING_LAUNCH_DISCOUNT_PERCENT: z.coerce.number().int().min(0).max(100).default(100),
    BILLING_SUCCESS_URL: z.string().url().optional(),
    BILLING_FAILURE_URL: z.string().url().optional(),
    BILLING_WEBHOOK_URL: z.string().url().optional(),
    CARDCOM_TERMINAL_NUMBER: z.coerce.number().int().positive().optional(),
    CARDCOM_API_NAME: z.string().min(1).optional(),
    CARDCOM_API_PASSWORD: z.string().min(1).optional(),
    CARDCOM_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    CARDCOM_MARK_AS_RECURRING: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CRON_SECRET: z.string().min(24).optional(),
    AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  })
  .superRefine((value, context) => {
    if (Boolean(value.SUPABASE_URL) !== Boolean(value.SUPABASE_PUBLISHABLE_KEY)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_URL'],
        message: 'SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured together',
      });
    }
    if (Boolean(value.SUPABASE_SERVICE_ROLE_KEY) !== Boolean(value.SUPABASE_STORAGE_BUCKET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPABASE_STORAGE_BUCKET'],
        message:
          'SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET must be configured together',
      });
    }
    const supportSettings = [
      value.SUPPORT_DESTINATION_EMAIL,
      value.SUPPORT_FROM_EMAIL,
      value.RESEND_API_KEY,
    ];
    if (supportSettings.some(Boolean) && !supportSettings.every(Boolean)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SUPPORT_DESTINATION_EMAIL'],
        message:
          'SUPPORT_DESTINATION_EMAIL, SUPPORT_FROM_EMAIL and RESEND_API_KEY must be configured together',
      });
    }
    if (value.BILLING_PROVIDER === 'cardcom') {
      const required = [
        'BILLING_SUCCESS_URL',
        'BILLING_FAILURE_URL',
        'BILLING_WEBHOOK_URL',
        'CARDCOM_TERMINAL_NUMBER',
        'CARDCOM_API_NAME',
        'CARDCOM_API_PASSWORD',
        'CARDCOM_TOKEN_ENCRYPTION_KEY',
        'CRON_SECRET',
      ] as const;
      for (const field of required) {
        if (!value[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when BILLING_PROVIDER=cardcom`,
          });
        }
      }
      if (value.CARDCOM_TOKEN_ENCRYPTION_KEY) {
        try {
          if (Buffer.from(value.CARDCOM_TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) {
            throw new Error('invalid length');
          }
        } catch {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CARDCOM_TOKEN_ENCRYPTION_KEY'],
            message: 'CARDCOM_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
          });
        }
      }
    }
    if (value.NODE_ENV === 'production' && value.BILLING_PROVIDER === 'mock') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_PROVIDER'],
        message: 'The mock billing provider is forbidden in production',
      });
    }
    if (value.WORKSPACE_ENCRYPTION_KEY) {
      try {
        if (Buffer.from(value.WORKSPACE_ENCRYPTION_KEY, 'base64').length !== 32) {
          throw new Error('invalid length');
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WORKSPACE_ENCRYPTION_KEY'],
          message: 'WORKSPACE_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
        });
      }
    }
    if (value.NODE_ENV === 'production' && value.DATABASE_URL && !value.WORKSPACE_ENCRYPTION_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKSPACE_ENCRYPTION_KEY'],
        message: 'WORKSPACE_ENCRYPTION_KEY is required for a production database',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  return parseEnv(envSchema, source);
}
