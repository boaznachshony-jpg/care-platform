export type DeploymentEnvironment = 'production' | 'staging' | 'local';

export function getDeploymentEnvironment(
  hostname = window.location.hostname,
): DeploymentEnvironment {
  if (hostname === 'care-platform-web.vercel.app') return 'production';
  if (hostname.endsWith('.vercel.app')) return 'staging';
  return 'local';
}

export function getEnvironmentTranslationKey(
  environment = getDeploymentEnvironment(),
): 'environment.staging' | 'environment.local' | null {
  if (environment === 'staging') return 'environment.staging';
  if (environment === 'local') return 'environment.local';
  return null;
}
