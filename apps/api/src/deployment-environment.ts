/**
 * The server-side counterpart to `apps/web/src/environment.ts`.
 *
 * The web app classifies its deployment from `window.location.hostname` -
 * the custom domain and the canonical Vercel host are production, any other
 * `*.vercel.app` host is staging, loopback is local. The API has no hostname to
 * read, so it classifies from the variables Vercel injects into the function's
 * environment. The vocabulary is deliberately identical: one word means the
 * same thing on both sides of the wire.
 *
 * The classification is deliberately asymmetric. Only an explicit
 * `VERCEL_ENV=production` earns 'production'; anything else that is running on
 * Vercel is 'staging', including a `VERCEL_ENV` value this code has never seen.
 * An unrecognised value must not be able to unlock production data.
 */
export type DeploymentEnvironment = 'production' | 'staging' | 'local';

export interface DeploymentEnvironmentSource {
  readonly VERCEL?: string | undefined;
  readonly VERCEL_ENV?: string | undefined;
}

export function getDeploymentEnvironment(
  source: DeploymentEnvironmentSource,
): DeploymentEnvironment {
  if (source.VERCEL_ENV === 'production') return 'production';
  if (source.VERCEL_ENV !== undefined && source.VERCEL_ENV !== '') return 'staging';
  if (source.VERCEL !== undefined && source.VERCEL !== '') return 'staging';
  return 'local';
}
