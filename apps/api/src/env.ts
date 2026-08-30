import { z } from 'zod';
import { nodeEnvSchema, parseEnv } from '@caredesk/config';
import { extractSupabaseProjectRef } from '@caredesk/db';
import { getDeploymentEnvironment } from './deployment-environment.js';

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORRELATION_HEADER: z.string().min(1).default('x-correlation-id'),
    // Report mode preserves the closed-pilot flow while making every missing
    // MFA event visible. Set to enforce after pilot identities have AAL2.
    SENSITIVE_OPERATION_MFA_MODE: z.enum(['report', 'enforce']).default('report'),
    // Comma-separated origin allowlist for CORS. Dev default is the local web
    // shell only; production values come from environment, never a wildcard.
    /**
     * The canonical production origin is listed FIRST among the https entries.
     * CORS itself does not care about order, but resolveInvitationRedirect
     * falls back to the first real https origin when FAMILY_INVITE_REDIRECT_URL
     * is unset - so this ordering is what makes invitations land on the custom
     * domain without needing an environment variable set in the host.
     */
    CORS_ORIGINS: z
      .string()
      .default(
        'https://caredesk-isr.com,https://www.caredesk-isr.com,https://care-platform-web.vercel.app,http://localhost:5173',
      ),
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
    BACKUP_SUPABASE_URL: z.string().url().optional(),
    BACKUP_SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    BACKUP_SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
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
    // Calendar days after chargingStartsAt during which a tenant without a
    // payment method sees a warning instead of a frozen account.
    BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(365).default(7),
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
    // Injected by Vercel, never set by hand. Read as free-form strings rather
    // than as an enum: a value Vercel adds later must degrade to "not
    // production" instead of failing the parse in a way an operator would be
    // tempted to work around.
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    // The project ref of the one Supabase project that holds customer data.
    // It is not a secret - it appears in every connection string - so it is the
    // one variable that is safe, and correct, to set on all environments. It is
    // what lets a preview deployment recognise that it has been handed the
    // production database. See docs/governance/ENVIRONMENT-SEPARATION.md.
    PRODUCTION_SUPABASE_PROJECT_REF: z.string().min(1).optional(),
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
    const backupStorageSettings = [
      value.BACKUP_SUPABASE_URL,
      value.BACKUP_SUPABASE_SERVICE_ROLE_KEY,
      value.BACKUP_SUPABASE_STORAGE_BUCKET,
    ];
    if (backupStorageSettings.some(Boolean) && !backupStorageSettings.every(Boolean)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKUP_SUPABASE_URL'],
        message: 'All BACKUP_SUPABASE_* settings must be configured together',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.SUPABASE_STORAGE_BUCKET &&
      !backupStorageSettings.every(Boolean)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BACKUP_SUPABASE_URL'],
        message: 'Production document storage requires an independent backup destination',
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
    // DB-03. Every setting below was already required by `readiness()`, which
    // reports but does not gate: with DATABASE_URL unset the container silently
    // swaps in the in-memory repositories and the API answers 200 to writes
    // that land in process memory and are gone on the next invocation. Moving
    // the same list to parse time turns that into a startup failure, which
    // index.ts already renders as a 503-everything app carrying the real
    // message - the fail-closed behaviour the documentation claims.
    if (value.NODE_ENV === 'production') {
      const requiredInProduction = [
        ['DATABASE_URL', 'the API would silently run on the in-memory repositories'],
        ['SUPABASE_URL', 'authentication would fall back to the mock auth service'],
        ['SUPABASE_PUBLISHABLE_KEY', 'authentication would fall back to the mock auth service'],
        ['SUPABASE_SERVICE_ROLE_KEY', 'private document storage would be unconfigured'],
        ['SUPABASE_STORAGE_BUCKET', 'private document storage would be unconfigured'],
      ] as const;
      for (const [field, consequence] of requiredInProduction) {
        if (!value[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required in production: without it, ${consequence}`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * REL-02 / DR-08. Refuses to start when a deployment that is not production has
 * been handed the production database.
 *
 * Preview deployments are built from unmerged branches, with half-finished
 * write paths and loops that re-save workspaces. Nothing in the platform stops
 * a preview from inheriting the production `DATABASE_URL` except the Vercel
 * variable scoping the operator set by hand in a dashboard - and a dashboard
 * setting has no test, no diff and no review. This is the code that notices.
 *
 * Three deliberate choices:
 *
 * - Production is exempt. Production is allowed to hold the production
 *   database, and a guard that could refuse to boot production would be a new
 *   way to take the customer offline rather than a way to protect them.
 *
 * - A non-production Vercel deployment with `PRODUCTION_SUPABASE_PROJECT_REF`
 *   unset is refused. Without the ref the guard cannot prove the target is not
 *   production, and "cannot prove" must not read as "probably fine". This is
 *   the fail-closed half; the alternative silently disarms the whole check the
 *   first time somebody forgets one variable.
 *
 * - A local process with the ref configured is refused too. Running the API on
 *   a laptop against production is the same accident with a shorter blast
 *   radius, and there is no reason to keep it available.
 *
 * A `DATABASE_URL` whose project ref cannot be read is allowed: production is a
 * Supabase project, so an unreadable ref is by construction a different target
 * (the CI Postgres container, a local database).
 */
export function assertDatabaseMatchesDeployment(env: Env): void {
  const environment = getDeploymentEnvironment(env);
  if (environment === 'production') return;
  if (!env.DATABASE_URL) return;

  const productionRef = env.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();

  if (environment === 'staging' && !productionRef) {
    throw new Error(
      'Refusing to start: this is a non-production deployment ' +
        `(VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}) with a DATABASE_URL configured, but ` +
        'PRODUCTION_SUPABASE_PROJECT_REF is not set, so the target cannot be proved to be ' +
        'anything other than the production database. Set PRODUCTION_SUPABASE_PROJECT_REF on all ' +
        'environments. See docs/governance/ENVIRONMENT-SEPARATION.md.',
    );
  }

  if (!productionRef) return;

  const configuredRef = extractSupabaseProjectRef(env.DATABASE_URL);
  if (configuredRef !== productionRef) return;

  throw new Error(
    `Refusing to start: DATABASE_URL points at the production Supabase project (${productionRef}) ` +
      `from a ${environment} deployment (VERCEL_ENV=${env.VERCEL_ENV ?? 'unset'}). ` +
      'Scope DATABASE_URL per Vercel environment so this deployment gets its own database. ' +
      'See docs/governance/ENVIRONMENT-SEPARATION.md.',
  );
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = parseEnv(envSchema, source);
  assertDatabaseMatchesDeployment(env);
  return env;
}
